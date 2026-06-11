"""Reply ingestion: did clients answer Penny's reminders?

Reads the connected Gmail inbox (Composio), matches senders against clients
with open invoices, and extracts payment intent — a stated date becomes a
first-party payment promise on the invoice (which the forecast then uses).
Degrades gracefully: no Composio → clear message; no model → keyword scan.
"""
import json
import re
from datetime import date, timedelta

from pydantic import BaseModel, Field

from . import config
from .agent import get_model
from .composio_client import _get_composio  # shared client + version handling pattern
from .node_client import request


class ReplyRead(BaseModel):
    mentions_payment: bool = Field(description="does the email talk about paying this invoice?")
    promised_date: str = Field(default="", description="YYYY-MM-DD if the sender commits to a payment date, else empty")
    summary: str = Field(description="one short sentence summarizing the reply for the owner")


def _fetch_inbox(max_results: int = 10) -> list[dict]:
    composio = _get_composio()
    if composio is None:
        raise RuntimeError("Composio is not configured")
    raw = composio.tools.get_raw_composio_tool_by_slug("GMAIL_FETCH_EMAILS")
    data = raw.model_dump() if hasattr(raw, "model_dump") else vars(raw)
    version = str(data.get("version") or (data.get("available_versions") or ["latest"])[0])
    result = composio.tools.execute(
        "GMAIL_FETCH_EMAILS",
        user_id=config.COMPOSIO_USER_ID,
        arguments={"query": "in:inbox newer_than:7d", "max_results": max_results},
        version=version,
    )
    payload = result.get("data", result) if isinstance(result, dict) else {}
    messages = payload.get("messages") or payload.get("response_data", {}).get("messages") or []
    out = []
    for m in messages:
        sender = m.get("sender") or m.get("from") or ""
        out.append(
            {
                "from": sender,
                "subject": m.get("subject", ""),
                "text": (m.get("messageText") or m.get("snippet") or m.get("preview") or "")[:1500],
            }
        )
    return out


def _read_reply(text: str, subject: str) -> dict:
    try:
        model = get_model("supervisor").with_structured_output(ReplyRead)
        result = model.invoke(
            f"A client replied to a payment reminder. Subject: {subject}\nBody:\n{text}\n\n"
            f"Today is {date.today().isoformat()}. Extract whether they discuss paying, and any committed date."
        )
        return result.model_dump()
    except Exception:
        # keyword fallback (also covers scripted/zero-key mode)
        lowered = f"{subject} {text}".lower()
        mentions = any(k in lowered for k in ("pay", "payment", "invoice", "transfer", "settle"))
        promised = ""
        if "friday" in lowered:
            d = date.today()
            promised = (d + timedelta(days=(4 - d.weekday()) % 7 or 7)).isoformat()
        else:
            m = re.search(r"(\d{4}-\d{2}-\d{2})", lowered)
            if m:
                promised = m.group(1)
        return {"mentions_payment": mentions, "promised_date": promised, "summary": (text or subject)[:120]}


def check_replies(user_id: str) -> dict:
    try:
        inbox = _fetch_inbox()
    except Exception as e:  # noqa: BLE001
        return {"checked": 0, "findings": [], "error": str(e)[:200]}

    clients = request(user_id, "GET", "/api/clients")["clients"]
    by_email = {c["email"].lower(): c for c in clients if c.get("email")}
    open_invoices = request(user_id, "GET", "/api/invoices", params={"status": "open", "limit": 100})["invoices"]

    findings = []
    for mail in inbox:
        sender_email = (re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", mail["from"]) or [None])
        sender = sender_email.group(0).lower() if hasattr(sender_email, "group") else None
        if not sender or sender not in by_email:
            continue
        client = by_email[sender]
        invoice = next((i for i in open_invoices if str((i.get("clientId") or {}).get("_id")) == client["_id"]), None)
        read = _read_reply(mail["text"], mail["subject"])
        if not read["mentions_payment"]:
            continue
        finding = {"client": client["name"], "summary": read["summary"], "promised_date": read["promised_date"] or None}
        if invoice and read["promised_date"]:
            request(user_id, "POST", f"/api/invoices/{invoice['_id']}/promise",
                    json={"date": read["promised_date"], "note": f"From their email reply: {read['summary'][:140]}"})
            finding["recorded_on"] = invoice["number"]
        findings.append(finding)

    return {"checked": len(inbox), "findings": findings}
