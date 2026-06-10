import os
from pathlib import Path
from dotenv import load_dotenv

# ai/.env wins, then repo-root .env (shared in dev)
_here = Path(__file__).resolve().parent.parent
load_dotenv(_here / ".env")
load_dotenv(_here.parent / ".env")

NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:4000")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN", "dev-service-token")
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/penny")

# Provider-agnostic: "google_genai:gemini-3-flash-preview", "openai:gpt-4.1-mini", ...
PENNY_MODEL = os.getenv("PENNY_MODEL", "google_genai:gemini-3-flash-preview")

COMPOSIO_API_KEY = os.getenv("COMPOSIO_API_KEY", "")
# Composio scopes connected accounts by user id; for the demo a single
# dashboard-connected Gmail account is used for all sends.
COMPOSIO_USER_ID = os.getenv("COMPOSIO_USER_ID", "default")
