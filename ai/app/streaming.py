"""Translates a LangGraph agent stream into Penny's SSE protocol.

Events sent to the Node relay (and on to the browser):
  token     {text}                                   — assistant prose, word by word
  activity  {id, label, tool, agent, status}         — friendly "what Penny is doing" feed
  artifact  {type, data}                             — rich cards: charts, invoice tables
  interrupt {actions: [{id, tool, args, description}]} — paused for approval (HITL)
  error     {message}
  done      {}
"""
import json
from typing import Iterator

from langchain_core.messages import AIMessage, ToolMessage


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


FRIENDLY_RUNNING = {
    "list_invoices": "Checking your invoices…",
    "create_invoice": "Logging the invoice…",
    "record_payment": "Recording the payment…",
    "update_invoice": "Updating the invoice…",
    "list_clients": "Looking up your clients…",
    "create_client": "Adding the new client…",
    "update_client": "Updating client details…",
    "get_business_metrics": "Crunching your numbers…",
    "make_chart": "Drawing your chart…",
    "send_email": "Preparing the email…",
    "save_memory": "Noting that down…",
}
FRIENDLY_DONE = {
    "list_invoices": "Checked your invoices",
    "create_invoice": "Invoice logged",
    "record_payment": "Payment recorded",
    "update_invoice": "Invoice updated",
    "list_clients": "Found your clients",
    "create_client": "Client added",
    "update_client": "Client updated",
    "get_business_metrics": "Numbers crunched",
    "make_chart": "Chart ready",
    "send_email": "Email handled",
    "save_memory": "Noted for next time",
}


def _label(tool_name: str, args: dict, done: bool = False) -> str:
    base = (FRIENDLY_DONE if done else FRIENDLY_RUNNING).get(tool_name) or (
        f"Finished {tool_name}" if done else f"Working on {tool_name}…"
    )
    # add a human detail where it reads naturally
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
    tool_agent_names = {}  # tool_call_id -> subagent label (multi-agent, later)
    interrupted = False

    try:
        for mode, payload in agent.stream(agent_input, config, stream_mode=["messages", "updates"]):
            if mode == "messages":
                chunk, metadata = payload
                if isinstance(chunk, ToolMessage):
                    continue
                node = metadata.get("langgraph_node", "")
                if node in ("tools",):
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

                for node_name, node_output in payload.items():
                    if not isinstance(node_output, dict):
                        continue
                    for msg in node_output.get("messages", []) or []:
                        if isinstance(msg, AIMessage) and msg.tool_calls:
                            for tc in msg.tool_calls:
                                tool_agent_names[tc["id"]] = node_name
                                yield sse(
                                    "activity",
                                    {
                                        "id": tc["id"],
                                        "tool": tc["name"],
                                        "label": _label(tc["name"], tc.get("args") or {}),
                                        "status": "running",
                                    },
                                )
                        elif isinstance(msg, ToolMessage):
                            result = {}
                            try:
                                result = json.loads(msg.content) if isinstance(msg.content, str) else {}
                            except (json.JSONDecodeError, TypeError):
                                result = {}
                            status = "error" if isinstance(result, dict) and result.get("error") else "done"
                            yield sse(
                                "activity",
                                {
                                    "id": msg.tool_call_id,
                                    "tool": msg.name,
                                    "label": _label(msg.name or "", result if isinstance(result, dict) else {}, done=True),
                                    "status": status,
                                },
                            )
                            # rich cards for data-shaped results
                            if isinstance(result, dict):
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
