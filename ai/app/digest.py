"""The Sunday-evening owner digest: Penny emails YOU a week-in-review.

Model-composed when a real model is configured; a clean template otherwise —
either way it sends through the same Composio path as reminders (simulated
fallback included), and lands in the outbox for the record.
"""
from .agent import get_model
from .composio_client import send_gmail
from .node_client import request


def _gather(user_id: str) -> dict:
    return {
        "summary": request(user_id, "GET", "/api/metrics/summary")["summary"],
        "briefing": request(user_id, "GET", "/api/metrics/briefing")["briefing"],
        "insights": request(user_id, "GET", "/api/metrics/insights")["insights"],
        "forecast": request(user_id, "GET", "/api/metrics/forecast")["forecast"],
    }


def _template_digest(d: dict, first_name: str, business: str) -> str:
    s, b, f = d["summary"], d["briefing"], d["forecast"]
    lines = [
        f"Hi {first_name},",
        "",
        f"Here's the week at {business or 'your business'}:",
        f"• Collected in the last 7 days: ${b['paymentsReceivedTotal']:,.0f} ({b['paymentsReceivedCount']} payment(s))",
        f"• Waiting to be paid: ${s['outstandingTotal']:,.0f} across {s['outstandingCount']} invoices",
        f"• Overdue: ${s['overdueTotal']:,.0f} ({s['overdueCount']} invoice(s))"
        + (f" — {b['newlyOverdueCount']} went late this week" if b["newlyOverdueCount"] else ""),
        f"• Expected in over the next 8 weeks: ${f['totalExpected']:,.0f}",
    ]
    if d["insights"]:
        lines.append("")
        lines.append("Worth a look:")
        lines += [f"• {i['message']}" for i in d["insights"][:3]]
    lines += ["", "I'll keep watch. — Penny"]
    return "\n".join(lines)


def run_digest(user_id: str, user_name: str, business_name: str, owner_email: str) -> dict:
    data = _gather(user_id)
    first = (user_name or "there").split(" ")[0]
    subject = f"Your week at {business_name or 'your business'} — Penny's digest"

    body = None
    try:
        model = get_model("supervisor")
        prompt = (
            f"Write a short, warm weekly email digest (under 160 words, plain text) from Penny, "
            f"an AI back office, to {first}, the owner of {business_name or 'a small business'}. "
            f"Use ONLY these numbers, pick what matters most, end with one actionable suggestion:\n{data}"
        )
        result = model.invoke(prompt)
        text = result.text if hasattr(result, "text") else str(result.content)
        body = str(text).strip()
        if not body or body.startswith("("):  # scripted model placeholder
            body = None
    except Exception:
        body = None
    if not body:
        body = _template_digest(data, first, business_name)

    status, error = send_gmail(owner_email, subject, body)
    request(
        user_id,
        "POST",
        "/api/emails",
        json={"to": owner_email, "subject": subject, "body": body, "status": status if status != "failed" else "failed",
              "provider": "digest", "error": error},
    )
    return {"status": status, "error": error}
