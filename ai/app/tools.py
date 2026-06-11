"""Penny's tools. Built per-request as closures over the signed-in user's id.

Tools return JSON strings; the streaming layer maps some tool results to rich
UI artifacts (invoice tables, charts) by tool name.
"""
import json
from langchain_core.tools import tool

from .node_client import request, NodeAPIError
from .composio_client import send_gmail


def _compact_invoice(inv: dict) -> dict:
    client = inv.get("clientId") or {}
    return {
        "number": inv.get("number"),
        "client": client.get("name") if isinstance(client, dict) else None,
        "client_email": client.get("email") if isinstance(client, dict) else None,
        "amount": inv.get("amount"),
        "balance": inv.get("balance"),
        "status": inv.get("effectiveStatus", inv.get("status")),
        "issue_date": str(inv.get("issueDate", ""))[:10],
        "due_date": str(inv.get("dueDate", ""))[:10],
        "days_overdue": inv.get("daysOverdue", 0),
        "id": inv.get("_id"),
        "notes": inv.get("notes", "")[:120],
    }


def build_tools(user_id: str) -> list:
    @tool
    def list_invoices(status: str = "all", client_name: str = "") -> str:
        """Look up invoices. status: all | open (sent, unpaid) | overdue | paid | draft.
        Optionally filter by client_name. Returns invoice numbers, clients, amounts, balances, due dates."""
        params = {"status": status, "limit": 50}
        data = request(user_id, "GET", "/api/invoices", params=params)
        invoices = [_compact_invoice(i) for i in data["invoices"]]
        if client_name:
            invoices = [i for i in invoices if i["client"] and client_name.lower() in i["client"].lower()]
        return json.dumps({"count": len(invoices), "invoices": invoices})

    @tool
    def create_invoice(
        client_name: str,
        due_date: str,
        amount: float = 0,
        line_items: list[dict] | None = None,
        notes: str = "",
        status: str = "sent",
    ) -> str:
        """Create an invoice for a client (created automatically if new).
        due_date: YYYY-MM-DD. Provide either amount, or line_items as
        [{"description": str, "quantity": int, "unitPrice": number}]. status: sent | draft."""
        payload = {
            "clientName": client_name,
            "dueDate": due_date,
            "notes": notes,
            "status": status,
            "source": "chat",
        }
        if line_items:
            payload["lineItems"] = line_items
        if amount:
            payload["amount"] = amount
        data = request(user_id, "POST", "/api/invoices", json=payload)
        return json.dumps({"created": _compact_invoice(data["invoice"])})

    @tool
    def record_payment(invoice_number: str, amount: float, date: str = "") -> str:
        """Record a payment received against an invoice (e.g. INV-0003). date: YYYY-MM-DD, default today.
        Marks the invoice paid when the balance reaches zero."""
        inv = _find_invoice(invoice_number)
        payload = {"amount": amount}
        if date:
            payload["date"] = date
        data = request(user_id, "POST", f"/api/invoices/{inv['id']}/payments", json=payload)
        return json.dumps({"updated": _compact_invoice(data["invoice"])})

    @tool
    def update_invoice(invoice_number: str, status: str = "", due_date: str = "", notes: str = "") -> str:
        """Update an invoice's status (sent | paid | void | draft), due_date (YYYY-MM-DD) or notes.
        To record money received, prefer record_payment."""
        inv = _find_invoice(invoice_number)
        payload = {}
        if status:
            payload["status"] = status
        if due_date:
            payload["dueDate"] = due_date
        if notes:
            payload["notes"] = notes
        if not payload:
            return json.dumps({"error": "Nothing to update"})
        data = request(user_id, "PATCH", f"/api/invoices/{inv['id']}", json=payload)
        return json.dumps({"updated": _compact_invoice(data["invoice"])})

    def _find_invoice(invoice_number: str) -> dict:
        data = request(user_id, "GET", "/api/invoices", params={"status": "all", "limit": 200})
        for i in data["invoices"]:
            if i.get("number", "").lower() == invoice_number.lower().strip():
                return _compact_invoice(i)
        raise NodeAPIError(f"No invoice found with number {invoice_number}")

    @tool
    def list_clients(search: str = "") -> str:
        """Look up the client list: names, contacts, emails — and each client's payment
        personality (how late they usually pay, learned from their history)."""
        params = {"q": search} if search else None
        data = request(user_id, "GET", "/api/clients", params=params)
        clients = [
            {
                "name": c["name"],
                "contact": c.get("contactName", ""),
                "email": c.get("email", ""),
                "phone": c.get("phone", ""),
                "payment_habits": (c.get("behavior") or {}).get("label") or "no history yet",
                "id": c["_id"],
            }
            for c in data["clients"]
        ]
        return json.dumps({"count": len(clients), "clients": clients})

    @tool
    def create_client(name: str, contact_name: str = "", email: str = "", phone: str = "", notes: str = "") -> str:
        """Add a new client to the books."""
        data = request(
            user_id,
            "POST",
            "/api/clients",
            json={"name": name, "contactName": contact_name, "email": email, "phone": phone, "notes": notes},
        )
        return json.dumps({"created": {"name": data["client"]["name"], "id": data["client"]["_id"]}})

    @tool
    def update_client(client_name: str, email: str = "", phone: str = "", contact_name: str = "", notes: str = "") -> str:
        """Update a client's contact details (email, phone, contact person, notes)."""
        data = request(user_id, "GET", "/api/clients", params={"q": client_name})
        matches = data["clients"]
        if not matches:
            raise NodeAPIError(f"No client found matching '{client_name}'")
        client = matches[0]
        payload = {}
        if email:
            payload["email"] = email
        if phone:
            payload["phone"] = phone
        if contact_name:
            payload["contactName"] = contact_name
        if notes:
            payload["notes"] = notes
        data = request(user_id, "PATCH", f"/api/clients/{client['_id']}", json=payload)
        return json.dumps({"updated": {"name": data["client"]["name"], "email": data["client"].get("email", "")}})

    @tool
    def get_invoice_pdf_link(invoice_number: str) -> str:
        """Get a downloadable PDF link for an invoice (e.g. to share or print).
        Present it to the user as a markdown link."""
        inv = _find_invoice(invoice_number)
        return json.dumps({"pdf_link": f"/api/invoices/{inv['id']}/pdf", "number": inv["number"]})

    @tool
    def get_business_metrics() -> str:
        """The money snapshot: outstanding total, overdue total/count, collected this month,
        what's newly overdue or due soon, recent payments — plus a forecast of when open
        invoices will actually be paid (based on each client's payment habits)."""
        summary = request(user_id, "GET", "/api/metrics/summary")["summary"]
        briefing = request(user_id, "GET", "/api/metrics/briefing")["briefing"]
        forecast = request(user_id, "GET", "/api/metrics/forecast")["forecast"]
        insights = request(user_id, "GET", "/api/metrics/insights")["insights"]
        return json.dumps(
            {
                "summary": summary,
                "this_week": briefing,
                "things_penny_noticed": [i["message"] for i in insights],
                "forecast_next_8_weeks": {
                    "total_expected": forecast["totalExpected"],
                    "expected_payments": [
                        {
                            "invoice": p["number"],
                            "client": p["client"],
                            "amount": p["amount"],
                            "expected_around": str(p["expectedDate"])[:10],
                            "basis": p["basis"],
                        }
                        for p in forecast["expectedPayments"]
                    ],
                },
            }
        )

    @tool
    def make_chart(kind: str) -> str:
        """Show the user a chart. kind: 'aging' (who's late and by how much, by bucket),
        'cashflow' (billed vs collected, last 6 months) or 'forecast' (money expected to
        arrive over the next 8 weeks, based on payment habits). Renders in the chat."""
        if kind not in ("aging", "cashflow", "forecast"):
            return json.dumps({"error": "kind must be 'aging', 'cashflow' or 'forecast'"})
        if kind == "forecast":
            forecast = request(user_id, "GET", "/api/metrics/forecast")["forecast"]
            data = [{"name": w["name"], "value": w["expected"]} for w in forecast["weeks"]]
            return json.dumps(
                {"chart": {"kind": "forecast", "title": "Money expected in — next 8 weeks", "data": data}}
            )
        charts = request(user_id, "GET", "/api/metrics/charts")
        title = "Unpaid invoices by how late they are" if kind == "aging" else "Billed vs collected — last 6 months"
        return json.dumps({"chart": {"kind": kind, "title": title, "data": charts[kind]}})

    @tool
    def make_rescue_plan() -> str:
        """Build a concrete, one-tap action plan to bring money in faster: who to chase,
        broken promises to follow up, forgotten retainers to bill, who could be offered an
        early-payment nudge. Renders as an executable checklist in the chat."""
        invoices = request(user_id, "GET", "/api/invoices", params={"status": "overdue", "limit": 20})["invoices"]
        insights = request(user_id, "GET", "/api/metrics/insights")["insights"]
        forecast = request(user_id, "GET", "/api/metrics/forecast")["forecast"]

        steps = []
        chased = set()
        # broken promises first — those clients already said yes once
        for ins in insights:
            if ins["type"] == "broken-promise" and ins.get("invoices"):
                num = ins["invoices"][0]
                chased.add(num)
                steps.append(
                    {"label": f"Follow up on the broken promise for {num}", "impact": "they already committed once",
                     "ask": f"Draft a gentle follow-up for invoice {num} — they promised to pay and the date slipped."}
                )
        # then the biggest overdue invoices not nudged recently
        compact = sorted((_compact_invoice(i) for i in invoices), key=lambda x: -(x.get("balance") or 0))
        for inv in compact[:2]:
            if inv["number"] in chased or not inv.get("client_email"):
                continue
            steps.append(
                {"label": f"Chase {inv['number']} — {inv['client']} (${(inv.get('balance') or 0):,.0f}, {inv.get('days_overdue', 0)}d late)",
                 "impact": f"+${(inv.get('balance') or 0):,.0f}",
                 "ask": f"Draft a payment reminder for invoice {inv['number']}."}
            )
        # forgotten recurring work
        for ins in insights:
            if ins["type"] == "retainer-gap":
                steps.append(
                    {"label": f"Bill the monthly retainer for {ins.get('client')}", "impact": "recurring revenue you forgot",
                     "ask": f"Log this month's retainer invoice for {ins.get('client')} — same amount as last time."}
                )
            elif ins["type"] == "duplicate":
                steps.append(
                    {"label": f"Check a possible duplicate: {' & '.join(ins.get('invoices', []))}", "impact": "avoid an awkward client moment",
                     "ask": f"Tell me about invoices {' and '.join(ins.get('invoices', []))} — are they duplicates? If so, void the newer one."}
                )
        total_expected = forecast.get("totalExpected", 0)
        return json.dumps(
            {"plan": {"title": "Penny's plan to bring money in", "context": f"${total_expected:,.0f} expected over 8 weeks if nothing changes", "steps": steps[:5]}}
        )

    @tool
    def send_email(to: str, subject: str, body: str, invoice_number: str = "") -> str:
        """Send an email to a client (e.g. a payment reminder). Write the subject and body
        yourself first — warm, professional, specific. The user will review before it sends."""
        invoice_id = None
        if invoice_number:
            try:
                invoice_id = _find_invoice(invoice_number)["id"]
            except NodeAPIError:
                invoice_id = None
        status, error = send_gmail(to, subject, body)
        request(
            user_id,
            "POST",
            "/api/emails",
            json={
                "to": to,
                "subject": subject,
                "body": body,
                "status": status,
                "provider": "composio-gmail" if status == "sent" else "simulated",
                "invoiceId": invoice_id,
                "error": error,
            },
        )
        if status == "sent":
            return json.dumps({"sent": True, "to": to, "subject": subject})
        if status == "simulated":
            return json.dumps(
                {"sent": True, "simulated": True, "to": to, "note": "Email recorded in the outbox (sending not configured)."}
            )
        return json.dumps({"sent": False, "error": error})

    @tool
    def save_memory(fact: str) -> str:
        """Remember a durable fact or preference about the user/business for future
        conversations (e.g. 'Net-30 payment terms', 'VIP client: Acme Hardware')."""
        request(user_id, "POST", "/api/memories", json={"fact": fact})
        return json.dumps({"saved": fact})

    return {
        "bookkeeping": [
            list_invoices,
            create_invoice,
            record_payment,
            update_invoice,
            list_clients,
            create_client,
            update_client,
            get_invoice_pdf_link,
        ],
        "analyst": [get_business_metrics, make_chart, make_rescue_plan],
        "outreach": [send_email],
        "memory": [save_memory],
    }
