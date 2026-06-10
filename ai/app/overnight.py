"""The overnight shift: draft reminder emails for newly-neglected overdue
invoices and QUEUE them for the owner's morning approval. Nothing sends here.

Drafting uses the real model when configured (warm, specific, informed by the
owner's saved tone preferences); on any model failure — including scripted
dev mode — it falls back to a respectable template so the nightly job never
breaks the morning experience.
"""
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from .agent import get_model
from .node_client import request

REMINDER_COOLDOWN_DAYS = 3
MAX_DRAFTS_PER_NIGHT = 5


class EmailDraft(BaseModel):
    subject: str = Field(description="short, friendly subject line naming the invoice")
    body: str = Field(description="the full email body: warm, specific, professional, ~90 words, signed off with the owner's name")


def _template_draft(inv: dict, owner: str) -> dict:
    days = inv.get("days_overdue", 0)
    return {
        "subject": f"Friendly reminder: invoice {inv['number']}",
        "body": (
            f"Hi {inv.get('client', 'there')},\n\n"
            f"Hope all is well! Just a gentle nudge that invoice {inv['number']} "
            f"for ${(inv.get('balance') or 0):,.0f} was due {days} day{'s' if days != 1 else ''} ago. "
            "Could you take a look when you get a moment? Happy to resend the invoice or answer any questions.\n\n"
            f"Thanks so much,\n{owner}"
        ),
    }


def _model_draft(inv: dict, owner: str, tone_notes: str) -> dict:
    model = get_model("supervisor").with_structured_output(EmailDraft)
    prompt = (
        "Write a payment reminder email from a small business owner to their client.\n"
        f"Owner name: {owner}\n"
        f"Client: {inv.get('client')} (contact email {inv.get('client_email')})\n"
        f"Invoice: {inv['number']}, balance ${(inv.get('balance') or 0):,.0f}, "
        f"due {inv.get('due_date')} — now {inv.get('days_overdue', 0)} days overdue.\n"
        f"{tone_notes}"
        "Keep it warm, specific and brief (~90 words). Never threaten; assume good faith."
    )
    result = model.invoke(prompt)
    return result.model_dump()


def run_overnight(user_id: str, user_name: str = "", business_name: str = "") -> dict:
    invoices = request(user_id, "GET", "/api/invoices", params={"status": "overdue", "limit": 50})["invoices"]
    queued_already = request(user_id, "GET", "/api/emails", params={"status": "queued"})["emails"]
    queued_invoice_ids = {str(e.get("invoiceId")) for e in queued_already if e.get("invoiceId")}

    try:
        owner = request(user_id, "GET", "/api/memories")["memories"]
    except Exception:
        owner = []
    tone_notes = ""
    facts = [m["fact"] for m in owner]
    if facts:
        tone_notes = "Owner preferences from memory: " + " ".join(facts[-5:]) + "\n"
    # sign-off: a remembered name wins, then the account name, then the business
    owner_name = next(
        (f.split("name is ")[-1].rstrip(".") for f in facts if "name is" in f),
        (user_name or "").split(" ")[0] or business_name or "the team",
    )

    cutoff = datetime.now(timezone.utc) - timedelta(days=REMINDER_COOLDOWN_DAYS)
    queued, skipped = 0, 0
    for inv in invoices:
        if queued >= MAX_DRAFTS_PER_NIGHT:
            break
        client = inv.get("clientId") or {}
        email_addr = client.get("email") if isinstance(client, dict) else None
        last_reminder = inv.get("lastReminderAt")
        recently_reminded = False
        if last_reminder:
            try:
                recently_reminded = datetime.fromisoformat(str(last_reminder).replace("Z", "+00:00")) > cutoff
            except ValueError:
                pass
        if not email_addr or recently_reminded or str(inv["_id"]) in queued_invoice_ids:
            skipped += 1
            continue

        compact = {
            "number": inv["number"],
            "client": client.get("name"),
            "client_email": email_addr,
            "balance": inv.get("balance"),
            "due_date": str(inv.get("dueDate", ""))[:10],
            "days_overdue": inv.get("daysOverdue", 0),
        }
        try:
            draft = _model_draft(compact, owner_name, tone_notes)
        except Exception as e:  # scripted mode / rate limit / anything — template keeps the night shift alive
            print(f"[overnight] model draft failed ({type(e).__name__}: {str(e)[:160]}) — using template")
            draft = _template_draft(compact, owner_name)

        request(
            user_id,
            "POST",
            "/api/emails",
            json={
                "to": email_addr,
                "subject": draft["subject"],
                "body": draft["body"],
                "status": "queued",
                "provider": "overnight",
                "invoiceId": inv["_id"],
                "clientId": client.get("_id"),
            },
        )
        queued += 1

    return {"queued": queued, "skipped": skipped}
