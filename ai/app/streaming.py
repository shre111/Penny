"""Translates a LangGraph agent stream into Penny's SSE protocol.

Events sent to the Node relay (and on to the browser):
  token     {text}                                   — assistant prose, word by word
  activity  {id, label, tool, agent, status}         — friendly "what the team is doing" feed
  artifact  {type, data}                             — rich cards: charts, invoice tables
  interrupt {actions: [{id, tool, args, description}]} — paused for approval (HITL)
  error     {message}
  done      {}

Multi-agent: we stream with subgraphs=True, so the Bookkeeper/Analyst
subagents' tool work surfaces too. Only the supervisor's prose becomes tokens —
subagent text is internal team chatter. Activity events carry an `agent` badge.
"""
import json
from typing import Iterator

from langchain_core.messages import AIMessage, ToolMessage


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


AGENT_DISPLAY = {"ask_bookkeeper": "Bookkeeper", "ask_analyst": "Analyst"}

FRIENDLY_RUNNING = {
    "list_invoices": "Checking the invoices…",
    "create_invoice": "Logging the invoice…",
    "record_payment": "Recording the payment…",
    "update_invoice": "Updating the invoice…",
    "list_clients": "Looking up clients…",
    "create_client": "Adding the new client…",
    "update_client": "Updating client details…",
    "get_business_metrics": "Crunching the numbers…",
    "make_chart": "Drawing your chart…",
    "send_email": "Preparing the email…",
    "save_memory": "Noting that down…",
    "ask_bookkeeper": "Asking the Bookkeeper…",
    "ask_analyst": "Asking the Analyst…",
}
FRIENDLY_DONE = {
    "list_invoices": "Checked the invoices",
    "create_invoice": "Invoice logged",
    "record_payment": "Payment recorded",
    "update_invoice": "Invoice updated",
    "list_clients": "Found the clients",
    "create_client": "Client added",
    "update_client": "Client updated",
    "get_business_metrics": "Numbers crunched",
    "make_chart": "Chart ready",
    "send_email": "Email handled",
    "save_memory": "Noted for next time",
    "ask_bookkeeper": "Bookkeeper reported back",
    "ask_analyst": "Analyst reported back",
}


def _label(tool_name: str, args: dict, done: bool = False) -> str:
    base = (FRIENDLY_DONE if done else FRIENDLY_RUNNING).get(tool_name) or (
        f"Finished {tool_name}" if done else f"Working on {tool_name}…"
    )
    if tool_name == "create_invoice" and args.get("client_name"):
        return f"Invoice logged for {args['client_name']}" if done else f"Logging an invoice for {args['client_name']}…"
    if tool_name == "send_email" and args.get("to"):
        return f"Email to {args['to']} handled" if done else f"Preparing an email to {args['to']}…"
    if tool_name == "record_payment" and args.get("invoice_number"):
        return (
            f"Payment recorded on {args['invoice_number']}"
            if done
            else f"Recording a payment on {args['invoice_number']}…"
        )
    return base


def _chunk_text(content) -> str:
    """Model chunk content may be a plain string or a list of content blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return ""


def _normalize_interrupt(value) -> list[dict]:
    """HumanInTheLoopMiddleware interrupt payloads → [{id, tool, args, description}].
    Defensive across payload shapes (the schema is middleware-version-specific)."""
    requests = None
    if isinstance(value, dict):
        requests = value.get("action_requests") or value.get("requests") or value.get("tool_calls")
    elif isinstance(value, (list, tuple)):
        requests = list(value)
    if requests is None:
        requests = [value]

    actions = []
    for idx, item in enumerate(requests):
        if not isinstance(item, dict):
            continue
        inner = item.get("action_request") if isinstance(item.get("action_request"), dict) else item
        tool = inner.get("action") or inner.get("name") or inner.get("tool") or "send_email"
        args = inner.get("args") or inner.get("arguments") or {}
        actions.append(
            {
                "id": str(item.get("id", idx)),
                "tool": tool,
                "args": args,
                "description": item.get("description", ""),
            }
        )
    return actions


def stream_agent_sse(agent, agent_input, thread_id: str) -> Iterator[str]:
    """Sync generator (Starlette runs it in a threadpool) — pairs with the sync
    MongoDB checkpointer so there are no async-saver edge cases."""
    config = {"configurable": {"thread_id": thread_id}}
    interrupted = False
    # Which subagent is currently working (for labeling nested events). With
    # one subagent active at a time this is exact; with parallel subagents the
    # badge may occasionally attribute to the most recent — cosmetic only.
    open_subagents: dict[str, str] = {}  # tool_call_id -> display name

    def current_agent(ns: tuple) -> str | None:
        if not ns:
            return None  # supervisor itself — no badge needed
        return next(reversed(open_subagents.values()), "Team") if open_subagents else "Team"

    try:
        for item in agent.stream(agent_input, config, stream_mode=["messages", "updates"], subgraphs=True):
            # items are (namespace, mode, payload) with subgraphs=True
            if len(item) == 3:
                ns, mode, payload = item
            else:
                ns, (mode, payload) = (), item

            if mode == "messages":
                chunk, metadata = payload
                if ns:  # subagent prose is internal team chatter — not user-facing
                    continue
                if isinstance(chunk, ToolMessage):
                    continue
                if metadata.get("langgraph_node", "") == "tools":
                    continue
                text = _chunk_text(getattr(chunk, "content", ""))
                if text:
                    yield sse("token", {"text": text})

            elif mode == "updates":
                if "__interrupt__" in payload:
                    raw = payload["__interrupt__"]
                    value = raw[0].value if isinstance(raw, (list, tuple)) and raw else raw
                    actions = _normalize_interrupt(value)
                    interrupted = True
                    yield sse("interrupt", {"actions": actions})
                    continue

                for _node_name, node_output in payload.items():
                    if not isinstance(node_output, dict):
                        continue
                    for msg in node_output.get("messages", []) or []:
                        if isinstance(msg, AIMessage) and msg.tool_calls:
                            for tc in msg.tool_calls:
                                if tc["name"] in AGENT_DISPLAY:
                                    open_subagents[tc["id"]] = AGENT_DISPLAY[tc["name"]]
                                yield sse(
                                    "activity",
                                    {
                                        "id": tc["id"],
                                        "tool": tc["name"],
                                        "label": _label(tc["name"], tc.get("args") or {}),
                                        "status": "running",
                                        "agent": AGENT_DISPLAY.get(tc["name"], "Penny") if not ns else current_agent(ns),
                                    },
                                )
                        elif isinstance(msg, ToolMessage):
                            result = {}
                            try:
                                result = json.loads(msg.content) if isinstance(msg.content, str) else {}
                                if not isinstance(result, dict):
                                    result = {}
                            except (json.JSONDecodeError, TypeError):
                                result = {}
                            status = "error" if result.get("error") else "done"
                            label = _label(msg.name or "", result, done=True)
                            # HITL reject: middleware injects a plain-text ToolMessage instead of running the tool
                            raw_content = msg.content if isinstance(msg.content, str) else ""
                            if msg.name == "send_email" and not result and "not" in raw_content.lower():
                                label = "Skipped — you said no"
                            agent_badge = AGENT_DISPLAY.get(msg.name or "") if not ns else current_agent(ns)
                            yield sse(
                                "activity",
                                {
                                    "id": msg.tool_call_id,
                                    "tool": msg.name,
                                    "label": label,
                                    "status": status,
                                    "agent": agent_badge or "Penny",
                                },
                            )
                            if msg.tool_call_id in open_subagents:
                                open_subagents.pop(msg.tool_call_id, None)
                            # rich cards for data-shaped results (works nested too)
                            if result.get("chart"):
                                yield sse("artifact", {"type": "chart", "data": result["chart"]})
                            elif result.get("invoices") and result.get("count", 0) > 0 and msg.name == "list_invoices":
                                yield sse(
                                    "artifact",
                                    {"type": "invoices", "data": {"invoices": result["invoices"][:10]}},
                                )

    except Exception as e:  # noqa: BLE001
        msg = str(e)
        friendly = "Penny hit a snag answering that. Please try again."
        if "429" in msg or "quota" in msg.lower() or "rate" in msg.lower():
            friendly = "Penny is thinking a little too fast for the free plan — give it a few seconds and try again."
        yield sse("error", {"message": friendly, "detail": msg[:400]})

    if not interrupted:
        yield sse("done", {})
