"""Environment-backed runtime configuration for 梦缘资源站."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppConfig:
    app_name: str
    version: str
    host: str
    port: int
    data_dir: Path
    backup_dir: Path
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_recipient: str
    notice_ai_base_url: str
    notice_ai_api_key: str
    notice_ai_model: str

    @property
    def email_enabled(self) -> bool:
        return all((self.smtp_host, self.smtp_username, self.smtp_password, self.smtp_recipient))

    @property
    def notice_ai_enabled(self) -> bool:
        return bool(self.notice_ai_api_key)


def load_config() -> AppConfig:
    data_dir = Path(os.environ.get("APP_DATA_DIR", os.environ.get("FEEDBACK_DATA_DIR", "/var/lib/zero-share")))
    return AppConfig(
        app_name="梦缘资源站",
        version=os.environ.get("APP_VERSION", "1.0.0"),
        host=os.environ.get("APP_HOST", "127.0.0.1"),
        port=int(os.environ.get("APP_PORT", os.environ.get("FEEDBACK_PORT", "8787"))),
        data_dir=data_dir,
        backup_dir=Path(os.environ.get("APP_BACKUP_DIR", "/var/backups/mengyuan")),
        smtp_host=os.environ.get("SMTP_HOST", "").strip(),
        smtp_port=int(os.environ.get("SMTP_PORT", "465")),
        smtp_username=os.environ.get("SMTP_USERNAME", "").strip(),
        smtp_password=os.environ.get("SMTP_PASSWORD", ""),
        smtp_recipient=os.environ.get("SMTP_RECIPIENT", "").strip(),
        notice_ai_base_url=os.environ.get("NOTICE_AI_BASE_URL", "https://api.deepseek.com").strip().rstrip("/"),
        notice_ai_api_key=os.environ.get("NOTICE_AI_API_KEY", ""),
        notice_ai_model=os.environ.get("NOTICE_AI_MODEL", "deepseek-chat").strip(),
    )


CONFIG = load_config()
