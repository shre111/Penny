"""A deterministic chat model for development and E2E tests — no API key needed.

Set PENNY_MODEL=scripted and the whole stack runs for real (tools → Node API →
live dashboard, supervisor → subagents, HITL interrupt → approval card →
resume, SSE streaming); only the language brain is canned. Each agent role
(supervisor / bookkeeper / analyst / single) gets its own behaviors, so even
the multi-agent topology is exercised end-to-end. Swapping to Gemini/OpenAI is
one env var.
"""
import json
import re
from datetime import date, timedelta
from uuid import uuid4

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult


def _tc(name: str, args: dict) -> dict:
    return {"name": name, "args": args, "id": f"call_{uuid4().hex[:12]}", "type": "tool_call"}


def _parse_invoice_request(text: str) -> dict:
    amount_match = re.search(r"\$?\s?([\d][\d,]*(?:\.\d{1,2})?)", text)
    client_match = re.search(r"(?:invoice )?for ([A-Z][\w&'’ ]+?)(?:,|\.|\$|$)", text)
    return {
        "client_name": (client_match.group(1).strip() if client_match else "Acme Hardware"),
        "amount": float(amount_match.group(1).replace(",", "")) if amount_match else 450.0,
        "due_date": (date.today() + timedelta(days=14)).isoformat(),
        "notes": "Logged from chat",
    }


class ScriptedModel(BaseChatModel):
    role: str = "single"

    @property
    def _llm_type(self) -> str:
        return f"scripted-{self.role}"

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001 — create_agent calls this; scripted model ignores tools
        return self

    def with_structured_output(self, schema, **kwargs):  # extraction needs real vision
        raise NotImplementedError("Document extraction needs a real vision model (set PENNY_MODEL to Gemini)")

    # ── helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _human_text(messages) -> str:
        last_human = next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)
        if not last_human:
            return ""
        return last_human.content if isinstance(last_human.content, str) else ""

    @staticmethod
    def _tool_result(msg: ToolMessage) -> dict:
        try:
            data = json.loads(msg.content) if isinstance(msg.content, str) else {}
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    # ── supervisor: routes to the team, writes emails, remembers facts ────
    def _supervisor(self, messages) -> AIMessage:
        last = messages[-1]
        human = self._human_text(messages)
        h = human.lower()

        if isinstance(last, ToolMessage):
            if last.name == "ask_bookkeeper":
                text = last.content if isinstance(last.content, str) else ""
                if "chase" in h or "remind" in h:
                    rows = re.findall(r"EMAIL:(\S+) INV:(\S+) BAL:(\d+(?:\.\d+)?) CLIENT:(.+?) DAYS:(\d+)", text)
                    if not rows:
                        return AIMessage("Good news — nobody is overdue with an email on file, so there's no one to chase.")
                    calls = [
                        _tc(
                            "send_email",
                            {
                                "to": email,
                                "subject": f"Friendly reminder: invoice {inv}",
                                "body": (
                                    f"Hi {client},\n\nHope business is going well! Just a gentle nudge that "
                                    f"invoice {inv} for ${float(bal):,.0f} was due {days} days ago. "
                                    "Could you take a look when you get a chance?\n\nThanks so much,\nJordan"
                                ),
                                "invoice_number": inv,
                            },
                        )
                        for email, inv, bal, client, days in rows[:3]
                    ]
                    return AIMessage(
                        f"The Bookkeeper found {len(calls)} overdue invoice(s) with an email on file. "
                        "Here are the reminders I'd send:",
                        tool_calls=calls,
                    )
                return AIMessage(f"Here's what the Bookkeeper reports:\n\n{text}")
            if last.name == "ask_analyst":
                text = last.content if isinstance(last.content, str) else ""
                return AIMessage(f"{text}\n\nAnything in there you'd like me to dig into?")
            if last.name == "send_email":
                return AIMessage("Done! The reminder is on its way. I'll keep an eye on whether they pay up. 🤞")
            if last.name == "save_memory":
                return AIMessage("Noted — I'll remember that.")
            return AIMessage("All done.")

        if "chase" in h or "remind" in h:
            return AIMessage(
                "Let me have the Bookkeeper pull up who's behind…",
                tool_calls=[_tc("ask_bookkeeper", {"request": "List overdue invoices with client emails so I can write reminders. " + human})],
            )
        if any(k in h for k in ("who owes", "overdue", "invoice for", "log an invoice", "create an invoice", "payment", "client")):
            return AIMessage(
                "One moment — handing this to the Bookkeeper…",
                tool_calls=[_tc("ask_bookkeeper", {"request": human})],
            )
        if any(k in h for k in ("chart", "aging", "late", "month", "cash", "how did", "how are we", "doing")):
            return AIMessage(
                "Let me get the Analyst on this…",
                tool_calls=[_tc("ask_analyst", {"request": human})],
            )
        name_match = re.search(r"my name is (\w+)", h)
        if name_match:
            name = name_match.group(1).title()
            return AIMessage(
                f"Lovely to meet you, {name}!",
                tool_calls=[_tc("save_memory", {"fact": f"The owner's first name is {name}."})],
            )
        return AIMessage(
            "(Penny is running on the scripted dev model — no API key set.) I can still do real work though: "
            'try "Who owes me money?", "Log an invoice for Acme, $450", "Chase the overdue invoices", or "Show me a chart".'
        )

    # ── bookkeeper: records in, machine-readable facts out ────────────────
    def _bookkeeper(self, messages) -> AIMessage:
        last = messages[-1]
        human = self._human_text(messages)
        h = human.lower()

        if isinstance(last, ToolMessage):
            result = self._tool_result(last)
            if last.name == "list_invoices":
                invoices = result.get("invoices", [])
                if "remind" in h or "chase" in h or "email" in h:
                    rows = [
                        f"EMAIL:{i['client_email']} INV:{i['number']} BAL:{i.get('balance') or 0:.0f} CLIENT:{i['client']} DAYS:{i.get('days_overdue', 0)}"
                        for i in invoices
                        if i.get("client_email")
                    ]
                    if not rows:
                        return AIMessage("No overdue invoices with client emails on file.")
                    return AIMessage("Overdue invoices with emails on file:\n" + "\n".join(rows))
                total = sum(i.get("balance") or 0 for i in invoices)
                lines = [
                    f"- {i['number']} · {i['client']} · ${i.get('balance') or 0:,.0f} · {i['status']}"
                    + (f" ({i['days_overdue']}d late)" if i.get("days_overdue") else "")
                    for i in invoices[:8]
                ]
                return AIMessage(f"{result.get('count', 0)} invoice(s), ${total:,.0f} unpaid:\n" + "\n".join(lines))
            if last.name == "create_invoice":
                c = result.get("created", {})
                return AIMessage(f"Created {c.get('number')} for {c.get('client')}, ${c.get('amount', 0):,.0f}, due {c.get('due_date')}.")
            if last.name == "record_payment":
                u = result.get("updated", {})
                return AIMessage(f"Payment recorded on {u.get('number')}; balance now ${u.get('balance', 0):,.0f} ({u.get('status')}).")
            return AIMessage("Done: " + (last.content if isinstance(last.content, str) else "ok")[:200])

        if "invoice for" in h or h.startswith("log an invoice") or h.startswith("create an invoice"):
            return AIMessage("Creating…", tool_calls=[_tc("create_invoice", _parse_invoice_request(human))])
        if "payment" in h and re.search(r"inv-\d+", h):
            inv = re.search(r"(inv-\d+)", h).group(1).upper()
            amount = re.search(r"\$?\s?([\d][\d,]*(?:\.\d{1,2})?)", h)
            return AIMessage(
                "Recording…",
                tool_calls=[_tc("record_payment", {"invoice_number": inv, "amount": float(amount.group(1).replace(",", "")) if amount else 100.0})],
            )
        if "overdue" in h or "chase" in h or "remind" in h or "who owes" in h or "late" in h:
            return AIMessage("Checking…", tool_calls=[_tc("list_invoices", {"status": "overdue"})])
        return AIMessage("Checking…", tool_calls=[_tc("list_invoices", {"status": "all"})])

    # ── analyst: numbers and charts ───────────────────────────────────────
    def _analyst(self, messages) -> AIMessage:
        last = messages[-1]
        h = self._human_text(messages).lower()

        if isinstance(last, ToolMessage):
            result = self._tool_result(last)
            if last.name == "make_chart":
                chart = result.get("chart", {})
                return AIMessage(f"Chart's ready — {chart.get('title', 'see the chart in chat')}.")
            if last.name == "get_business_metrics":
                s = result.get("summary", {})
                return AIMessage(
                    f"${s.get('outstandingTotal', 0):,} is waiting to be paid across {s.get('outstandingCount', 0)} invoices; "
                    f"${s.get('overdueTotal', 0):,} of it is overdue ({s.get('overdueCount', 0)} invoices). "
                    f"${s.get('collectedThisMonth', 0):,} collected so far this month."
                )
            return AIMessage("Numbers delivered.")

        if "aging" in h or "late" in h or "owe" in h:
            return AIMessage("Charting…", tool_calls=[_tc("make_chart", {"kind": "aging"})])
        if "chart" in h or "month" in h or "cash" in h or "billed" in h:
            return AIMessage("Charting…", tool_calls=[_tc("make_chart", {"kind": "cashflow"})])
        return AIMessage("Crunching…", tool_calls=[_tc("get_business_metrics", {})])

    # ── single-agent mode (PENNY_MULTI_AGENT=false): flat behaviors ───────
    def _single(self, messages) -> AIMessage:
        last = messages[-1]
        human = self._human_text(messages)
        h = human.lower()

        if isinstance(last, ToolMessage):
            result = self._tool_result(last)
            if last.name == "list_invoices":
                invoices = result.get("invoices", [])
                if "chase" in h or "remind" in h:
                    overdue = [i for i in invoices if i.get("status") == "overdue" and i.get("client_email")][:2]
                    if not overdue:
                        return AIMessage("Good news — nobody is overdue right now, so there's no one to chase.")
                    calls = [
                        _tc(
                            "send_email",
                            {
                                "to": i["client_email"],
                                "subject": f"Friendly reminder: invoice {i['number']}",
                                "body": (
                                    f"Hi {i['client']},\n\nHope business is going well! Just a gentle nudge that "
                                    f"invoice {i['number']} for ${i['balance']:,} was due "
                                    f"{i['days_overdue']} days ago. Could you take a look when you get a chance?\n\n"
                                    "Thanks so much,\nJordan"
                                ),
                                "invoice_number": i["number"],
                            },
                        )
                        for i in overdue
                    ]
                    return AIMessage(f"I found {len(overdue)} overdue invoice(s) with an email on file. Here are the reminders I'd send:", tool_calls=calls)
                total = sum(i.get("balance") or 0 for i in invoices)
                return AIMessage(f"You have {result.get('count', 0)} invoice(s) here, worth ${total:,} still unpaid. The table above has the details.")
            if last.name == "send_email":
                return AIMessage("Done! The reminder is on its way. I'll keep an eye on whether they pay up. 🤞")
            if last.name == "create_invoice":
                created = result.get("created", {})
                return AIMessage(f"Logged it — {created.get('number', 'the invoice')} for {created.get('client', 'your client')}, ${(created.get('amount') or 0):,}. You'll see it pop onto your dashboard.")
            if last.name == "make_chart":
                return AIMessage("Here's the picture. Anything in there you'd like me to dig into?")
            if last.name == "get_business_metrics":
                s = result.get("summary", {})
                return AIMessage(f"Quick snapshot: ${s.get('outstandingTotal', 0):,} waiting to be paid, ${s.get('overdueTotal', 0):,} overdue. ${s.get('collectedThisMonth', 0):,} collected this month.")
            if last.name == "save_memory":
                return AIMessage("Noted — I'll remember that.")
            return AIMessage("All done.")

        if "chase" in h or "remind" in h or "who owes" in h or "overdue" in h:
            return AIMessage("Let me see who's behind on payments…", tool_calls=[_tc("list_invoices", {"status": "overdue"})])
        if "invoice for" in h or h.startswith("log an invoice") or h.startswith("create an invoice"):
            return AIMessage("On it…", tool_calls=[_tc("create_invoice", _parse_invoice_request(human))])
        if "chart" in h or "aging" in h or "late" in h:
            return AIMessage("One chart coming up…", tool_calls=[_tc("make_chart", {"kind": "aging"})])
        if "month" in h or "cash" in h or "how did" in h:
            return AIMessage("Let me crunch the numbers…", tool_calls=[_tc("get_business_metrics", {})])
        name_match = re.search(r"my name is (\w+)", h)
        if name_match:
            name = name_match.group(1).title()
            return AIMessage(f"Lovely to meet you, {name}!", tool_calls=[_tc("save_memory", {"fact": f"The owner's first name is {name}."})])
        return AIMessage(
            "(Penny is running on the scripted dev model — no API key set.) I can still do real work though: "
            'try "Who owes me money?", "Log an invoice for Acme, $450", "Chase the overdue invoices", or "Show me a chart".'
        )

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        handler = {
            "supervisor": self._supervisor,
            "bookkeeper": self._bookkeeper,
            "analyst": self._analyst,
        }.get(self.role, self._single)
        return ChatResult(generations=[ChatGeneration(message=handler(messages))])
