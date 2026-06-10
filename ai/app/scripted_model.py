"""A deterministic chat model for development and E2E tests — no API key needed.

Set PENNY_MODEL=scripted and the whole stack (tools → Node API → live dashboard,
HITL interrupt → approval card → resume, SSE streaming) runs for real; only the
language brain is canned. Swapping to Gemini/OpenAI is one env var.
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


class ScriptedModel(BaseChatModel):
    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001 — middleware calls this; scripted model ignores tools
        return self

    def with_structured_output(self, schema, **kwargs):  # extraction fallback in dev
        raise NotImplementedError("Document extraction needs a real vision model (set PENNY_MODEL to Gemini)")

    def _respond(self, messages) -> AIMessage:
        last = messages[-1]
        last_human = next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)
        human_text = (last_human.content if isinstance(last_human.content, str) else "") if last_human else ""
        h = human_text.lower()

        if isinstance(last, ToolMessage):
            try:
                result = json.loads(last.content) if isinstance(last.content, str) else {}
            except (json.JSONDecodeError, TypeError):
                result = {}

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
                                    "Thanks so much,\nJordan at Bluepeak Studio"
                                ),
                                "invoice_number": i["number"],
                            },
                        )
                        for i in overdue
                    ]
                    return AIMessage(
                        f"I found {len(overdue)} overdue invoice(s) with an email on file. Here are the reminders I'd send:",
                        tool_calls=calls,
                    )
                total = sum(i.get("balance") or 0 for i in invoices)
                return AIMessage(
                    f"You have {result.get('count', 0)} invoice(s) here, worth ${total:,} still unpaid. "
                    "The table above has the details."
                )

            if last.name == "send_email":
                return AIMessage("Done! The reminder is on its way. I'll keep an eye on whether they pay up. 🤞")
            if last.name == "create_invoice":
                created = result.get("created", {})
                return AIMessage(
                    f"Logged it — {created.get('number', 'the invoice')} for {created.get('client', 'your client')}, "
                    f"${(created.get('amount') or 0):,}. You'll see it pop onto your dashboard."
                )
            if last.name == "record_payment":
                return AIMessage("Payment recorded — nice when the money actually arrives, isn't it?")
            if last.name == "make_chart":
                return AIMessage("Here's the picture. Anything in there you'd like me to dig into?")
            if last.name == "get_business_metrics":
                s = result.get("summary", {})
                return AIMessage(
                    f"Quick snapshot: ${s.get('outstandingTotal', 0):,} is waiting to be paid across "
                    f"{s.get('outstandingCount', 0)} invoices, ${s.get('overdueTotal', 0):,} of it overdue. "
                    f"You've collected ${s.get('collectedThisMonth', 0):,} this month."
                )
            if last.name == "save_memory":
                return AIMessage("Noted — I'll remember that.")
            return AIMessage("All done.")

        # fresh human turn
        if "chase" in h or "remind" in h:
            return AIMessage("Let me see who's behind on payments…", tool_calls=[_tc("list_invoices", {"status": "overdue"})])
        if "who owes" in h or "overdue" in h:
            return AIMessage("Checking who still owes you…", tool_calls=[_tc("list_invoices", {"status": "overdue"})])
        if "invoice for" in h or h.startswith("log an invoice") or h.startswith("create an invoice"):
            amount_match = re.search(r"\$?([\d,]+(?:\.\d{1,2})?)", human_text.replace(",", ""))
            client_match = re.search(r"for ([A-Z][\w&' ]+?)(?:,|\.|$|\$)", human_text)
            return AIMessage(
                "On it…",
                tool_calls=[
                    _tc(
                        "create_invoice",
                        {
                            "client_name": (client_match.group(1).strip() if client_match else "Acme Hardware"),
                            "amount": float(amount_match.group(1)) if amount_match else 450.0,
                            "due_date": (date.today() + timedelta(days=14)).isoformat(),
                            "notes": "Logged from chat (scripted dev model)",
                        },
                    )
                ],
            )
        if "chart" in h or "aging" in h or "late" in h:
            return AIMessage("One chart coming up…", tool_calls=[_tc("make_chart", {"kind": "aging"})])
        if "month" in h or "cash" in h or "how did" in h or "how are we" in h:
            return AIMessage("Let me crunch the numbers…", tool_calls=[_tc("get_business_metrics", {})])
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

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._respond(messages))])
