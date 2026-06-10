"""Gmail send via Composio, with a graceful simulated fallback.

If COMPOSIO_API_KEY is set and a Gmail account is connected (one-time, via the
Composio dashboard), emails really send. Otherwise they are recorded in the
outbox as 'simulated' — the product flow stays fully demoable either way.
"""
from . import config

_composio = None


def _get_composio():
    global _composio
    if _composio is None and config.COMPOSIO_API_KEY:
        from composio import Composio

        _composio = Composio(api_key=config.COMPOSIO_API_KEY)
    return _composio


def send_gmail(to: str, subject: str, body: str) -> tuple[str, str | None]:
    """Returns (status, error): status is 'sent' or 'simulated' or 'failed'."""
    composio = _get_composio()
    if composio is None:
        return "simulated", None
    try:
        result = composio.tools.execute(
            "GMAIL_SEND_EMAIL",
            user_id=config.COMPOSIO_USER_ID,
            arguments={"recipient_email": to, "subject": subject, "body": body},
        )
        if isinstance(result, dict) and result.get("successful") is False:
            return "failed", str(result.get("error", "unknown Composio error"))[:300]
        return "sent", None
    except Exception as e:  # noqa: BLE001 — any Composio failure falls back loudly but safely
        return "failed", str(e)[:300]
