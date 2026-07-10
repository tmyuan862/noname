"""SQLite-backed score repository and short-lived game sessions."""

from __future__ import annotations

import secrets
import sqlite3
import threading
import time
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app_config import CONFIG


DB_FILE = CONFIG.data_dir / "snake_scores.sqlite3"
MODES = {"classic", "level", "chaos", "bossRush"}
DIFFICULTIES = {"easy", "normal", "hard", "hell"}
SCORE_STATUSES = {"visible", "hidden"}
SESSION_MIN_SECONDS = 3
SESSION_MAX_SECONDS = 3 * 60 * 60
USE_WAL = True
sessions: dict[str, float] = {}
session_lock = threading.Lock()


def connect() -> sqlite3.Connection:
    DB_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_FILE, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL" if USE_WAL else "PRAGMA journal_mode=DELETE")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_db() -> None:
    with closing(connect()) as database:
        database.executescript(
            """
            CREATE TABLE IF NOT EXISTS snake_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                score INTEGER NOT NULL CHECK(score > 0 AND score <= 999999),
                mode TEXT NOT NULL,
                diff TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'visible',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_snake_scores_rank
                ON snake_scores(status, score DESC, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_snake_scores_created
                ON snake_scores(created_at DESC);
            """
        )
        database.commit()


def create_session() -> str:
    now = time.monotonic()
    token = secrets.token_urlsafe(24)
    with session_lock:
        expired = [key for key, started in sessions.items() if now - started > SESSION_MAX_SECONDS]
        for key in expired:
            sessions.pop(key, None)
        sessions[token] = now
    return token


def consume_session(token: str, score: int) -> tuple[bool, str]:
    with session_lock:
        started = sessions.pop(token, None)
    if started is None:
        return False, "游戏会话已失效，请重新开始一局。"
    elapsed = time.monotonic() - started
    if elapsed < SESSION_MIN_SECONDS:
        return False, "本局时间过短，成绩未记录。"
    if elapsed > SESSION_MAX_SECONDS:
        return False, "本局时间过长，会话已过期。"
    if score > int(elapsed * 500) + 2000:
        return False, "成绩与游戏时长不匹配。"
    return True, ""


def clean_name(value: object) -> str:
    raw = str(value or "匿名").strip()
    cleaned = "".join(char for char in raw if not unicodedata.category(char).startswith("C"))
    return cleaned[:12] or "匿名"


def submit_score(payload: dict) -> tuple[dict | None, str]:
    try:
        score = int(payload.get("score", 0))
    except (TypeError, ValueError):
        return None, "分数格式不正确。"
    mode = payload.get("mode")
    diff = payload.get("diff")
    token = payload.get("token")
    if isinstance(payload.get("score"), bool) or not 0 < score <= 999999:
        return None, "分数超出允许范围。"
    if mode not in MODES or diff not in DIFFICULTIES:
        return None, "游戏模式或难度无效。"
    if not isinstance(token, str) or len(token) > 100:
        return None, "游戏会话无效。"
    valid, message = consume_session(token, score)
    if not valid:
        return None, message
    created_at = datetime.now(timezone.utc).isoformat()
    name = clean_name(payload.get("name"))
    with closing(connect()) as database:
        cursor = database.execute(
            "INSERT INTO snake_scores(name, score, mode, diff, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, score, mode, diff, created_at),
        )
        record_id = cursor.lastrowid
        database.commit()
    return {"id": record_id, "name": name, "score": score, "mode": mode, "diff": diff, "created_at": created_at}, ""


def leaderboard(time_range: str, mode: str = "", diff: str = "") -> list[dict]:
    clauses = ["status = 'visible'"]
    values: list[object] = []
    if time_range == "day":
        clauses.append("created_at >= ?")
        values.append((datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
    elif time_range == "week":
        clauses.append("created_at >= ?")
        values.append((datetime.now(timezone.utc) - timedelta(days=7)).isoformat())
    if mode in MODES:
        clauses.append("mode = ?")
        values.append(mode)
    if diff in DIFFICULTIES:
        clauses.append("diff = ?")
        values.append(diff)
    query = f"SELECT name, score, mode, diff, created_at FROM snake_scores WHERE {' AND '.join(clauses)} ORDER BY score DESC, created_at ASC LIMIT 100"
    with closing(connect()) as database:
        return [dict(row) for row in database.execute(query, values)]


def admin_scores(status: str = "") -> list[dict]:
    query = "SELECT id, name, score, mode, diff, status, created_at FROM snake_scores"
    values: list[object] = []
    if status in SCORE_STATUSES:
        query += " WHERE status = ?"
        values.append(status)
    query += " ORDER BY created_at DESC LIMIT 500"
    with closing(connect()) as database:
        return [dict(row) for row in database.execute(query, values)]


def set_score_status(record_id: int, status: str) -> bool:
    if status not in SCORE_STATUSES:
        return False
    with closing(connect()) as database:
        cursor = database.execute("UPDATE snake_scores SET status = ? WHERE id = ?", (status, record_id))
        database.commit()
        return cursor.rowcount == 1


def delete_score(record_id: int) -> bool:
    with closing(connect()) as database:
        cursor = database.execute("DELETE FROM snake_scores WHERE id = ?", (record_id,))
        database.commit()
        return cursor.rowcount == 1


def score_count() -> int:
    with closing(connect()) as database:
        return int(database.execute("SELECT COUNT(*) FROM snake_scores").fetchone()[0])
