#!/usr/bin/env python3
"""Small, dependency-free feedback API for the static site."""

from __future__ import annotations

import json
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = int(os.environ.get("FEEDBACK_PORT", "8787"))
DATA_DIR = Path(os.environ.get("FEEDBACK_DATA_DIR", "/var/lib/zero-share"))
DATA_FILE = DATA_DIR / "feedback.jsonl"
MAX_BODY_BYTES = 4096
MAX_MESSAGE_LENGTH = 1000
MIN_MESSAGE_LENGTH = 5
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 600
ALLOWED_CATEGORIES = {"建议", "问题", "内容纠错", "想要的新功能", "其他"}

write_lock = threading.Lock()
rate_lock = threading.Lock()
request_times: dict[str, deque[float]] = defaultdict(deque)


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


def append_feedback(category: str, message: str) -> None:
    record = {
        "category": category,
        "message": message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    with write_lock:
        descriptor = os.open(DATA_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(descriptor, line.encode("utf-8"))
        finally:
            os.close(descriptor)


class FeedbackHandler(BaseHTTPRequestHandler):
    server_version = "FeedbackAPI/1.0"

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/feedback":
            self.send_json(404, {"error": "not_found"})
            return

        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip()
        if content_type != "application/json":
            self.send_json(415, {"error": "content_type", "message": "请使用正确的提交格式。"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "body_size", "message": "反馈内容过长。"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid_json", "message": "反馈格式不正确。"})
            return

        if not isinstance(payload, dict):
            self.send_json(422, {"error": "validation", "message": "请填写反馈内容。"})
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

        now = time.monotonic()
        if is_rate_limited(client_key(self), now):
            self.send_json(429, {"error": "rate_limit", "message": "提交得有点频繁，请稍后再试。"})
            return

        try:
            append_feedback(category, message)
        except OSError:
            self.send_json(500, {"error": "storage", "message": "暂时无法保存，请稍后再试。"})
            return
        self.send_json(201, {"ok": True, "message": "已收到，谢谢你让这里变得更好。"})

    def log_message(self, format_string: str, *args: object) -> None:
        # Do not log request bodies or user feedback.
        print(f"{self.address_string()} - {format_string % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), FeedbackHandler)
    print(f"Feedback API listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()
