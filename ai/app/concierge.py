"""The client-facing concierge: Penny working the OTHER side of the invoice.

Lives on the public (tokenized) invoice page. Strictly scoped to one invoice,
for one client, within guardrails the owner controls. She can explain charges,
hand over the PDF, record a payment promise, or negotiate an extension /
installment plan — which only ever becomes real after the OWNER approves it.
"""
import json
from datetime import date, datetime

from langchain.agents import create_agent
from langchain_core.tools import tool

from .agent import checkpointer, get_model
from .node_client import request, NodeAPIError

CONCIERGE_PROMPT = """You are Penny, the friendly billing assistant for {business_name}. You are talking to \
THEIR CLIENT ({client_name}) about exactly one invoice. Today's date is {today}.

The invoice in front of you both:
{invoice_block}

What you can do for the client:
- Answer questions about this invoice plainly (what the charges are, when it's due, what's been paid).
- Give them the PDF (get_invoice_pdf_link) when asked for a copy.
- If they tell you when they'll pay, record it (record_payment_promise) and thank them — {owner_name} \
plans around these promises.
- If they ask for more time or to split the payment, you may negotiate WITHIN these limits: \
extensions of up to {max_extension_days} days past the current due date, or a plan of up to \
{max_installments} installments that together cover the full balance. Use propose_arrangement. \
Make clear it needs {owner_name}'s quick OK before it's final — never present it as agreed.
- If a request is outside those limits, decline warmly and suggest they leave a payment promise \
or contact {business_name} directly.
- For questions about {business_name}'s policies or ways of working (late fees, turnaround, refunds, \
terms), use search_knowledge and answer ONLY from what it returns, naming the source. If nothing \
comes back, say you'll pass the question along — never guess at policy.

Hard rules:
- ONLY this invoice. Never discuss other invoices, other clients, or {business_name}'s finances.
- Never invent numbers, discounts, or terms. Never mark anything as paid.
- Warm, professional, brief. You represent {business_name} — be gracious even if the client is frustrated.
- Politely decline anything unrelated to this invoice."""


def _invoice_block(inv: dict) -> str:
    items = "\n".join(
        f"  - {li.get('description')} × {li.get('quantity', 1)} @ ${li.get('unitPrice', 0):,.2f}"
        for li in inv.get("line_items") or []
    )
    lines = [
        f"Invoice {inv['number']} from the business to {inv['client_name']}",
        f"Total ${inv['amount']:,.2f} · unpaid balance ${inv['balance']:,.2f} · status: {inv['status']}"
        + (f" ({inv['days_overdue']} days overdue)" if inv.get("days_overdue") else ""),
        f"Issued {inv.get('issue_date')} · due {inv.get('due_date')}",
    ]
    if items:
        lines.append("Line items:\n" + items)
    if inv.get("promised_date"):
        lines.append(f"The client previously promised payment by {inv['promised_date']}.")
    if inv.get("notes"):
        lines.append(f"Notes: {inv['notes']}")
    return "\n".join(lines)


def build_concierge_agent(payload: dict):
    inv = payload["invoice"]
    user_id = payload["user_id"]
    guardrails = payload.get("guardrails") or {}
    max_ext = int(guardrails.get("max_extension_days", 14))
    max_inst = int(guardrails.get("max_installments", 3))

    @tool
    def get_invoice_pdf_link() -> str:
        """A downloadable PDF copy of this invoice for the client. Present as a markdown link."""
        return json.dumps({"pdf_link": f"/api/public/invoice/{payload['share_token']}/pdf", "number": inv["number"]})

    @tool
    def search_knowledge(query: str) -> str:
        """Search the business's policies/terms/FAQ to answer the client's question.
        Answer only from the results and name the source; if empty, offer to pass the question along."""
        from .knowledge import search

        results = search(user_id, query)
        if not results:
            return json.dumps({"found": False})
        return json.dumps({"found": True, "results": [{"source": r["source"], "text": r["chunk"]} for r in results]})

    @tool
    def record_payment_promise(date: str, note: str = "") -> str:
        """Record when the client says they will pay. date: YYYY-MM-DD. Use after they
        clearly commit to a date. Thank them once recorded."""
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            return json.dumps({"error": "date must be YYYY-MM-DD"})
        data = request(user_id, "POST", f"/api/invoices/{inv['id']}/promise", json={"date": date, "note": note})
        return json.dumps({"recorded": True, "date": date, "invoice": data["invoice"]["number"]})

    @tool
    def propose_arrangement(kind: str, reason: str, new_due_date: str = "", installments: list[dict] | None = None) -> str:
        """Send the owner a payment arrangement the client asked for. kind: 'extension'
        (with new_due_date YYYY-MM-DD) or 'installments' (with installments as
        [{"amount": number, "date": "YYYY-MM-DD"}, ...] covering the full balance).
        Stay within the limits in your instructions; the owner must approve before it's final."""
        try:
            if kind == "extension":
                if not new_due_date:
                    return json.dumps({"error": "new_due_date is required for an extension"})
                current_due = datetime.strptime(inv["due_date"], "%Y-%m-%d").date()
                proposed = datetime.strptime(new_due_date, "%Y-%m-%d").date()
                delta = (proposed - current_due).days
                if delta <= 0:
                    return json.dumps({"error": "the new date must be after the current due date"})
                if delta > max_ext:
                    return json.dumps({"error": f"that's {delta} days — beyond the {max_ext}-day limit you may offer. Decline politely."})
                details = {"newDueDate": new_due_date}
            elif kind == "installments":
                plan = installments or []
                if not 2 <= len(plan) <= max_inst:
                    return json.dumps({"error": f"installment plans can be 2 to {max_inst} parts. Decline politely if the client wants more."})
                total = sum(float(p.get("amount", 0)) for p in plan)
                if abs(total - float(inv["balance"])) > max(1.0, 0.01 * float(inv["balance"])):
                    return json.dumps({"error": f"installments add up to ${total:,.2f} but the balance is ${inv['balance']:,.2f} — they must match."})
                for p in plan:
                    datetime.strptime(str(p.get("date", "")), "%Y-%m-%d")
                details = {"installments": plan}
            else:
                return json.dumps({"error": "kind must be 'extension' or 'installments'"})

            data = request(
                user_id,
                "POST",
                "/api/proposals",
                json={"invoiceId": inv["id"], "type": kind, "details": details, "clientReason": reason},
            )
            return json.dumps({"sent_to_owner": True, "proposal_id": data["proposal"]["_id"], "kind": kind})
        except NodeAPIError as e:
            return json.dumps({"error": str(e)})
        except ValueError:
            return json.dumps({"error": "dates must be YYYY-MM-DD"})

    system_prompt = CONCIERGE_PROMPT.format(
        business_name=payload.get("business_name") or "the business",
        client_name=inv.get("client_name") or "the client",
        owner_name=payload.get("owner_name") or "the owner",
        today=date.today().strftime("%A, %B %d, %Y"),
        invoice_block=_invoice_block(inv),
        max_extension_days=max_ext,
        max_installments=max_inst,
    )

    return create_agent(
        get_model("concierge"),
        tools=[get_invoice_pdf_link, search_knowledge, record_payment_promise, propose_arrangement],
        system_prompt=system_prompt,
        checkpointer=checkpointer,
    )
