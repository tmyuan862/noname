"""Authenticated senior-contributor accounts and moderated advice posts."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone

from app_config import CONFIG


DB_FILE = CONFIG.data_dir / "senior_voice.sqlite3"
POST_STATUSES = {"pending", "published", "hidden"}
SESSION_HOURS = 24
EDITOR_USERNAME = "campus_editor"
EDITOR_DISPLAY_NAME = "梦缘校园整理员"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DB_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    database = sqlite3.connect(DB_FILE, timeout=5)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA foreign_keys=ON")
    return database


def init_db() -> None:
    with closing(connect()) as database:
        database.executescript("""
            CREATE TABLE IF NOT EXISTS senior_authors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                must_change_password INTEGER NOT NULL DEFAULT 1,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS senior_sessions (
                token_hash TEXT PRIMARY KEY,
                author_id INTEGER NOT NULL REFERENCES senior_authors(id) ON DELETE CASCADE,
                csrf_token TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS senior_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author_id INTEGER NOT NULL REFERENCES senior_authors(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                published_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_senior_posts_public ON senior_posts(status, published_at DESC);
            CREATE INDEX IF NOT EXISTS idx_senior_posts_author ON senior_posts(author_id, updated_at DESC);
        """)
        database.commit()


def clean_username(value: object) -> str:
    username = str(value or "").strip().lower()
    return username if 3 <= len(username) <= 32 and all(char.isascii() and (char.isalnum() or char in "_-") for char in username) else ""


def valid_password(password: object) -> bool:
    return isinstance(password, str) and 10 <= len(password) <= 128


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return digest.hex(), salt.hex()


def create_author(username: object, display_name: object, password: object) -> tuple[dict | None, str]:
    username = clean_username(username)
    display_name = str(display_name or "").strip()[:40]
    if not username or not display_name or not valid_password(password):
        return None, "账号需为 3—32 位字母数字，显示名称不能为空，初始密码至少 10 位。"
    password_hash, salt = hash_password(password)
    try:
        with closing(connect()) as database:
            cursor = database.execute(
                "INSERT INTO senior_authors(username, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
                (username, display_name, password_hash, salt, now_iso()),
            )
            database.commit()
            return {"id": cursor.lastrowid, "username": username, "display_name": display_name, "active": True, "must_change_password": True}, ""
    except sqlite3.IntegrityError:
        return None, "该用户名已经存在。"


def authenticate(username: object, password: object) -> tuple[dict | None, str, str]:
    username = clean_username(username)
    if not username or not isinstance(password, str):
        return None, "", "账号或密码错误。"
    with closing(connect()) as database:
        row = database.execute("SELECT * FROM senior_authors WHERE username = ?", (username,)).fetchone()
        if row is None or not row["active"]:
            return None, "", "账号或密码错误。"
        candidate, _ = hash_password(password, row["password_salt"])
        if not hmac.compare_digest(candidate, row["password_hash"]):
            return None, "", "账号或密码错误。"
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        expires = (datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)).isoformat()
        database.execute("DELETE FROM senior_sessions WHERE author_id = ? OR expires_at <= ?", (row["id"], now_iso()))
        database.execute("INSERT INTO senior_sessions(token_hash, author_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)", (hashlib.sha256(token.encode()).hexdigest(), row["id"], csrf, expires))
        database.commit()
        return author_dict(row, csrf), token, ""


def author_dict(row: sqlite3.Row, csrf: str = "") -> dict:
    return {"id": row["id"], "username": row["username"], "display_name": row["display_name"], "must_change_password": bool(row["must_change_password"]), "active": bool(row["active"]), "csrf_token": csrf}


def session_author(token: str) -> dict | None:
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with closing(connect()) as database:
        row = database.execute("""SELECT a.*, s.csrf_token FROM senior_sessions s JOIN senior_authors a ON a.id=s.author_id
            WHERE s.token_hash=? AND s.expires_at>? AND a.active=1""", (token_hash, now_iso())).fetchone()
        return author_dict(row, row["csrf_token"]) if row else None


def logout(token: str) -> None:
    with closing(connect()) as database:
        database.execute("DELETE FROM senior_sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        database.commit()


def change_password(author_id: int, current: object, new_password: object) -> str:
    if not valid_password(new_password):
        return "新密码至少 10 位。"
    with closing(connect()) as database:
        row = database.execute("SELECT * FROM senior_authors WHERE id=?", (author_id,)).fetchone()
        candidate, _ = hash_password(str(current or ""), row["password_salt"])
        if not hmac.compare_digest(candidate, row["password_hash"]):
            return "当前密码错误。"
        password_hash, salt = hash_password(new_password)
        database.execute("UPDATE senior_authors SET password_hash=?, password_salt=?, must_change_password=0 WHERE id=?", (password_hash, salt, author_id))
        database.commit()
    return ""


def create_post(author_id: int, title: object, body: object) -> tuple[dict | None, str]:
    title = str(title or "").strip()[:120]
    body = str(body or "").strip()[:10000]
    if not 4 <= len(title) <= 120 or not 20 <= len(body) <= 10000:
        return None, "标题需为 4—120 字，正文需为 20—10000 字。"
    created = now_iso()
    with closing(connect()) as database:
        cursor = database.execute("INSERT INTO senior_posts(author_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?)", (author_id, title, body, created, created))
        database.commit()
        return {"id": cursor.lastrowid, "title": title, "body": body, "status": "pending", "created_at": created}, ""


def create_editor_post(title: object, body: object) -> tuple[dict | None, str]:
    title = str(title or "").strip()[:120]
    body = str(body or "").strip()[:10000]
    if not 4 <= len(title) <= 120 or not 20 <= len(body) <= 10000:
        return None, "标题需为 4—120 字，正文需为 20—10000 字。"
    created = now_iso()
    with closing(connect()) as database:
        author = database.execute("SELECT id FROM senior_authors WHERE username=?", (EDITOR_USERNAME,)).fetchone()
        if author is None:
            password_hash, salt = hash_password(secrets.token_urlsafe(48))
            cursor = database.execute(
                "INSERT INTO senior_authors(username,display_name,password_hash,password_salt,must_change_password,active,created_at) VALUES(?,?,?,?,0,0,?)",
                (EDITOR_USERNAME, EDITOR_DISPLAY_NAME, password_hash, salt, created),
            )
            author_id = cursor.lastrowid
        else:
            author_id = author["id"]
            database.execute("UPDATE senior_authors SET display_name=?, active=0 WHERE id=?", (EDITOR_DISPLAY_NAME, author_id))
        cursor = database.execute(
            "INSERT INTO senior_posts(author_id,title,body,status,created_at,updated_at,published_at) VALUES(?,?,?,'published',?,?,?)",
            (author_id, title, body, created, created, created),
        )
        database.commit()
        return {"id": cursor.lastrowid, "title": title, "body": body, "status": "published", "display_name": EDITOR_DISPLAY_NAME}, ""


def public_posts(page: int = 1, page_size: int = 8) -> dict:
    page = max(1, page); page_size = min(12, max(1, page_size)); offset = (page - 1) * page_size
    with closing(connect()) as database:
        total = database.execute("SELECT COUNT(*) FROM senior_posts WHERE status='published'").fetchone()[0]
        rows = database.execute("""SELECT p.id,p.title,p.body,p.published_at,a.display_name FROM senior_posts p
            JOIN senior_authors a ON a.id=p.author_id WHERE p.status='published' ORDER BY p.published_at DESC LIMIT ? OFFSET ?""", (page_size, offset)).fetchall()
    return {"posts": [dict(row) for row in rows], "count": total, "page": page, "total_pages": max(1, (total + page_size - 1) // page_size), "has_next": offset + page_size < total}


def author_posts(author_id: int) -> list[dict]:
    with closing(connect()) as database:
        return [dict(row) for row in database.execute("SELECT id,title,body,status,created_at,updated_at,published_at FROM senior_posts WHERE author_id=? ORDER BY updated_at DESC", (author_id,))]


def admin_authors() -> list[dict]:
    with closing(connect()) as database:
        return [author_dict(row) for row in database.execute("SELECT * FROM senior_authors ORDER BY created_at DESC")]


def admin_posts(status: str = "") -> list[dict]:
    query = """SELECT p.id,p.title,p.body,p.status,p.created_at,p.updated_at,p.published_at,a.display_name,a.username
        FROM senior_posts p JOIN senior_authors a ON a.id=p.author_id"""
    values: list[object] = []
    if status in POST_STATUSES:
        query += " WHERE p.status=?"; values.append(status)
    query += " ORDER BY p.updated_at DESC LIMIT 500"
    with closing(connect()) as database:
        return [dict(row) for row in database.execute(query, values)]


def set_post_status(post_id: int, status: str) -> bool:
    if status not in POST_STATUSES:
        return False
    published_at = now_iso() if status == "published" else None
    with closing(connect()) as database:
        cursor = database.execute("UPDATE senior_posts SET status=?, published_at=?, updated_at=? WHERE id=?", (status, published_at, now_iso(), post_id))
        database.commit(); return cursor.rowcount == 1


def set_author_active(author_id: int, active: bool) -> bool:
    with closing(connect()) as database:
        cursor = database.execute("UPDATE senior_authors SET active=? WHERE id=?", (1 if active else 0, author_id))
        if not active: database.execute("DELETE FROM senior_sessions WHERE author_id=?", (author_id,))
        database.commit(); return cursor.rowcount == 1


def delete_post(post_id: int) -> bool:
    with closing(connect()) as database:
        cursor = database.execute("DELETE FROM senior_posts WHERE id=?", (post_id,))
        database.commit(); return cursor.rowcount == 1
