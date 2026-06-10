"""Thin httpx wrapper over the Node API.

Every agent tool goes through here — the Node API is the single source of
truth (validation + Socket.IO live-update events), so agent writes light up
the dashboard exactly like human writes do.
"""
import httpx
from . import config


class NodeAPIError(Exception):
    pass


def _client(user_id: str) -> httpx.Client:
    return httpx.Client(
        base_url=config.NODE_API_URL,
        headers={
            "X-Service-Token": config.SERVICE_TOKEN,
            "X-User-Id": user_id,
            "X-Actor": "agent",
        },
        timeout=15.0,
    )


def request(user_id: str, method: str, path: str, json: dict | None = None, params: dict | None = None) -> dict:
    with _client(user_id) as client:
        resp = client.request(method, path, json=json, params=params)
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("error", resp.text)
        except Exception:
            detail = resp.text[:200]
        raise NodeAPIError(detail)
    return resp.json()
