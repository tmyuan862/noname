#!/usr/bin/env python3
"""Dependency-free feedback API and loopback-only admin API."""

from __future__ import annotations

import json
import hashlib
import os
import smtplib
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
PORT = int(os.environ.get("FEEDBACK_PORT", "8787"))
DATA_DIR = Path(os.environ.get("FEEDBACK_DATA_DIR", "/var/lib/zero-share"))
DATA_FILE = DATA_DIR / "feedback.jsonl"
RESOURCE_FILE = DATA_DIR / "resources.json"
MAX_BODY_BYTES = 4096
MAX_RESOURCE_BODY_BYTES = 2 * 1024 * 1024
MAX_MESSAGE_LENGTH = 1000
MIN_MESSAGE_LENGTH = 5
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 600
ALLOWED_CATEGORIES = {"建议", "问题", "内容纠错", "想要的新功能", "其他"}
ALLOWED_STATUSES = {"new", "processing", "done"}

data_lock = threading.Lock()
resource_lock = threading.Lock()
rate_lock = threading.Lock()
request_times: dict[str, deque[float]] = defaultdict(deque)


def clean_resource_content(content: str) -> str:
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    marker = "点击率："
    if marker in content:
        content = content.split(marker, 1)[1]
    if "分享到：" in content:
        content = content.split("分享到：", 1)[0]
    lines = [line.strip() for line in content.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def normalize_resource(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None
    detail = item.get("detail") if isinstance(item.get("detail"), dict) else {}
    title = str(item.get("title", "")).strip()[:300]
    url = str(item.get("url", "")).strip()[:1000]
    category = str(item.get("category", "other")).strip()[:80]
    if category == "safety" and any(keyword in title for keyword in ("发布会", "讲座", "论坛")):
        category = "activity_competition"
    content = clean_resource_content(str(detail.get("content", "")))[:100000]
    if not title or not content or not url.startswith(("https://", "http://")):
        return None
    return {
        "id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:20],
        "title": title,
        "url": url,
        "category": category,
        "content": content,
        "summary": content[:180] + ("…" if len(content) > 180 else ""),
        "publish_date": str(detail.get("publish_date", "")).strip()[:20],
        "department": str(detail.get("department", "")).strip()[:120],
        "crawl_time": str(item.get("crawl_time", detail.get("crawl_time", ""))).strip()[:40],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def load_resources() -> list[dict]:
    if not RESOURCE_FILE.exists():
        return []
    try:
        payload = json.loads(RESOURCE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return payload if isinstance(payload, list) else []


def write_resources(records: list[dict]) -> None:
    DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = RESOURCE_FILE.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(records, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, RESOURCE_FILE)
    finally:
        temporary.unlink(missing_ok=True)


def import_resources(items: list) -> dict:
    with resource_lock:
        existing = {record["url"]: record for record in load_resources() if record.get("url")}
        inserted = updated = skipped = 0
        for item in items:
            normalized = normalize_resource(item)
            if normalized is None:
                skipped += 1
                continue
            if normalized["url"] in existing:
                updated += 1
            else:
                inserted += 1
            existing[normalized["url"]] = normalized
        records = sorted(existing.values(), key=lambda record: record.get("publish_date", ""), reverse=True)
        write_resources(records)
    return {"inserted": inserted, "updated": updated, "skipped": skipped, "total": len(records)}


def delete_resource(record_id: str) -> bool:
    with resource_lock:
        records = load_resources()
        remaining = [record for record in records if record.get("id") != record_id]
        if len(records) == len(remaining):
            return False
        write_resources(remaining)
        return True


def client_key(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Real-IP", "").strip()
    return forwarded if forwarded else handler.client_address[0]


def is_rate_limited(key: str, now: float) -> bool:
    with rate_lock:
        recent = request_times[key]
        while recent and recent[0] <= now - RATE_WINDOW_SECONDS:
            recent.popleft()
        if len(recent) >= RATE_LIMIT:
            return True
        recent.append(now)
        return False


def load_feedback() -> list[dict]:
    if not DATA_FILE.exists():
        return []
    records = []
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            record.setdefault("id", uuid.uuid4().hex)
            record.setdefault("status", "new")
            records.append(record)
    return records


def write_feedback(records: list[dict]) -> None:
    DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = DATA_FILE.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, DATA_FILE)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)


def append_feedback(category: str, message: str) -> dict:
    record = {
        "id": uuid.uuid4().hex,
        "category": category,
        "message": message,
        "status": "new",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with data_lock:
        records = load_feedback()
        records.append(record)
        write_feedback(records)
    return record


def update_feedback(record_id: str, status: str) -> bool:
    with data_lock:
        records = load_feedback()
        found = False
        for record in records:
            if record.get("id") == record_id:
                record["status"] = status
                record["updated_at"] = datetime.now(timezone.utc).isoformat()
                found = True
                break
        if found:
            write_feedback(records)
        return found


def delete_feedback(record_id: str) -> bool:
    with data_lock:
        records = load_feedback()
        remaining = [record for record in records if record.get("id") != record_id]
        if len(remaining) == len(records):
            return False
        write_feedback(remaining)
        return True


def send_notification(record: dict) -> None:
    host = os.environ.get("SMTP_HOST", "").strip()
    username = os.environ.get("SMTP_USERNAME", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    recipient = os.environ.get("SMTP_RECIPIENT", "").strip()
    if not all((host, username, password, recipient)):
        return
    try:
        message = EmailMessage()
        message["Subject"] = f"[零号共享站] 新反馈：{record['category']}"
        message["From"] = username
        message["To"] = recipient
        message.set_content(
            f"反馈类型：{record['category']}\n"
            f"提交时间：{record['created_at']}\n"
            f"反馈编号：{record['id']}\n\n"
            f"{record['message']}\n"
        )
        port = int(os.environ.get("SMTP_PORT", "465"))
        with smtplib.SMTP_SSL(host, port, timeout=10) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError) as error:
        print(f"email notification failed: {type(error).__name__}", flush=True)


class FeedbackHandler(BaseHTTPRequestHandler):
    server_version = "FeedbackAPI/2.0"

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, max_bytes: int = MAX_BODY_BYTES) -> dict | list | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > max_bytes:
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, (dict, list)) else None

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        if parsed.path == "/admin/feedback":
            status_filter = parse_qs(parsed.query).get("status", [""])[0]
            with data_lock:
                records = load_feedback()
            if status_filter in ALLOWED_STATUSES:
                records = [record for record in records if record.get("status") == status_filter]
            records.sort(key=lambda item: item.get("created_at", ""), reverse=True)
            self.send_json(200, {"feedback": records, "count": len(records)})
            return
        if parsed.path == "/resources":
            query = parse_qs(parsed.query)
            category = query.get("category", [""])[0].strip()
            keyword = query.get("q", [""])[0].strip().casefold()[:100]
            with resource_lock:
                records = load_resources()
            categories: dict[str, int] = {}
            for record in records:
                key = record.get("category", "other")
                categories[key] = categories.get(key, 0) + 1
            if category:
                records = [record for record in records if record.get("category") == category]
            if keyword:
                records = [record for record in records if keyword in f"{record.get('title', '')} {record.get('summary', '')}".casefold()]
            public_records = [{key: value for key, value in record.items() if key != "content"} for record in records]
            self.send_json(200, {"resources": public_records, "count": len(public_records), "categories": categories})
            return
        resource_prefix = "/resources/"
        if parsed.path.startswith(resource_prefix):
            record_id = parsed.path[len(resource_prefix):]
            with resource_lock:
                record = next((item for item in load_resources() if item.get("id") == record_id), None)
            if record is None:
                self.send_json(404, {"error": "not_found"})
                return
            self.send_json(200, {"resource": record})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path == "/admin/resources/import":
            payload = self.read_json(MAX_RESOURCE_BODY_BYTES)
            items = payload.get("items") if isinstance(payload, dict) else payload
            if not isinstance(items, list) or len(items) > 500:
                self.send_json(422, {"error": "invalid_resources", "message": "JSON 必须是资料数组，且不超过 500 条。"})
                return
            try:
                result = import_resources(items)
            except OSError:
                self.send_json(500, {"error": "storage", "message": "资料暂时无法保存。"})
                return
            self.send_json(200, {"ok": True, **result})
            return
        if self.path != "/feedback":
            self.send_json(404, {"error": "not_found"})
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
            self.send_json(415, {"error": "content_type", "message": "请使用正确的提交格式。"})
            return
        payload = self.read_json()
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "invalid_request", "message": "反馈格式不正确。"})
            return
        if payload.get("website"):
            self.send_json(201, {"ok": True, "message": "感谢你的反馈。"})
            return
        category = payload.get("category", "")
        message = payload.get("message", "")
        if not isinstance(category, str) or category not in ALLOWED_CATEGORIES:
            self.send_json(422, {"error": "category", "message": "请选择反馈类型。"})
            return
        if not isinstance(message, str):
            self.send_json(422, {"error": "message", "message": "请填写反馈内容。"})
            return
        message = message.strip()
        if not MIN_MESSAGE_LENGTH <= len(message) <= MAX_MESSAGE_LENGTH:
            self.send_json(422, {"error": "message_length", "message": "反馈请填写 5—1000 个字。"})
            return
        if is_rate_limited(client_key(self), time.monotonic()):
            self.send_json(429, {"error": "rate_limit", "message": "提交得有点频繁，请稍后再试。"})
            return
        try:
            record = append_feedback(category, message)
        except OSError:
            self.send_json(500, {"error": "storage", "message": "暂时无法保存，请稍后再试。"})
            return
        threading.Thread(target=send_notification, args=(record,), daemon=True).start()
        self.send_json(201, {"ok": True, "message": "已收到，谢谢你让这里变得更好。"})

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        prefix = "/admin/feedback/"
        if not parsed.path.startswith(prefix):
            self.send_json(404, {"error": "not_found"})
            return
        payload = self.read_json()
        status = payload.get("status") if isinstance(payload, dict) else None
        if status not in ALLOWED_STATUSES:
            self.send_json(422, {"error": "status"})
            return
        if not update_feedback(parsed.path[len(prefix):], status):
            self.send_json(404, {"error": "not_found"})
            return
        self.send_json(200, {"ok": True})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        resource_prefix = "/admin/resources/"
        if parsed.path.startswith(resource_prefix):
            if not delete_resource(parsed.path[len(resource_prefix):]):
                self.send_json(404, {"error": "not_found"})
                return
            self.send_json(200, {"ok": True})
            return
        prefix = "/admin/feedback/"
        if not parsed.path.startswith(prefix) or not delete_feedback(parsed.path[len(prefix):]):
            self.send_json(404, {"error": "not_found"})
            return
        self.send_json(200, {"ok": True})

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"{self.address_string()} - {format_string % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), FeedbackHandler).serve_forever()
