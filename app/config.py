"""Application configuration loaded from environment variables."""

from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class Settings(BaseSettings):
    app_name: str = "Oasis AstroTools"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_debug: bool = False


settings = Settings()
