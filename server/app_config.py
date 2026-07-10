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

    @property
    def email_enabled(self) -> bool:
        return all((self.smtp_host, self.smtp_username, self.smtp_password, self.smtp_recipient))


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
    )


CONFIG = load_config()
