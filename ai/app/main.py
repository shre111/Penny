"""Penny AI service — FastAPI wrapper around the LangGraph agent.

Endpoints (called only by the Node API, authenticated by shared secret):
  POST /chat    {thread_id, user_id, content, user_name, business_name} → SSE
  POST /resume  {thread_id, user_id, decisions}                        → SSE
  POST /extract multipart file                                          → JSON
"""
from fastapi import FastAPI, Header, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel

from . import config
from .agent import build_agent
from .composio_client import send_gmail
from .extraction import extract_invoice
from .overnight import run_overnight
from .streaming import stream_agent_sse

app = FastAPI(title="penny-ai")


def check_service_token(x_service_token: str | None):
    if x_service_token != config.SERVICE_TOKEN:
        raise HTTPException(401, "bad service token")


@app.get("/health")
def health():
    return {"ok": True, "service": "penny-ai", "model": config.PENNY_MODEL}


class ChatIn(BaseModel):
    thread_id: str
    user_id: str
    content: str
    user_name: str = ""
    business_name: str = ""


@app.post("/chat")
def chat(body: ChatIn, x_service_token: str | None = Header(default=None)):
    check_service_token(x_service_token)
    agent = build_agent(body.user_id, body.user_name, body.business_name)
    agent_input = {"messages": [{"role": "user", "content": body.content}]}
    return StreamingResponse(
        stream_agent_sse(agent, agent_input, body.thread_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ResumeIn(BaseModel):
    thread_id: str
    user_id: str
    decisions: list[dict]
    user_name: str = ""
    business_name: str = ""


@app.post("/resume")
def resume(body: ResumeIn, x_service_token: str | None = Header(default=None)):
    check_service_token(x_service_token)
    agent = build_agent(body.user_id, body.user_name, body.business_name)
    return StreamingResponse(
        stream_agent_sse(agent, Command(resume={"decisions": body.decisions}), body.thread_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ConciergeIn(BaseModel):
    thread_id: str
    user_id: str
    content: str
    invoice: dict
    business_name: str = ""
    owner_name: str = ""
    share_token: str
    guardrails: dict = {}


@app.post("/concierge")
def concierge(body: ConciergeIn, x_service_token: str | None = Header(default=None)):
    """The client-facing invoice concierge (public page) — same SSE protocol."""
    check_service_token(x_service_token)
    from .concierge import build_concierge_agent

    agent = build_concierge_agent(body.model_dump())
    agent_input = {"messages": [{"role": "user", "content": body.content}]}
    return StreamingResponse(
        stream_agent_sse(agent, agent_input, body.thread_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class KnowledgeIngestIn(BaseModel):
    user_id: str
    source: str
    text: str


@app.post("/knowledge/ingest")
def knowledge_ingest(body: KnowledgeIngestIn, x_service_token: str | None = Header(default=None)):
    """Chunk + embed a knowledge source ('Teach Penny your business')."""
    check_service_token(x_service_token)
    from .knowledge import ingest

    try:
        return {"chunks": ingest(body.text, body.source)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"embedding failed: {str(e)[:200]}") from e


class DigestIn(BaseModel):
    user_id: str
    user_name: str = ""
    business_name: str = ""
    owner_email: str


@app.post("/digest")
def digest(body: DigestIn, x_service_token: str | None = Header(default=None)):
    """Compose + send the weekly owner digest."""
    check_service_token(x_service_token)
    from .digest import run_digest

    return run_digest(body.user_id, body.user_name, body.business_name, body.owner_email)


class CheckRepliesIn(BaseModel):
    user_id: str


@app.post("/check-replies")
def check_replies(body: CheckRepliesIn, x_service_token: str | None = Header(default=None)):
    """Scan the connected Gmail inbox for client replies to reminders."""
    check_service_token(x_service_token)
    from .replies import check_replies as run

    return run(body.user_id)


class OvernightIn(BaseModel):
    user_id: str
    user_name: str = ""
    business_name: str = ""


@app.post("/overnight")
def overnight(body: OvernightIn, x_service_token: str | None = Header(default=None)):
    """Draft + queue reminder emails for neglected overdue invoices (cron / manual)."""
    check_service_token(x_service_token)
    return run_overnight(body.user_id, body.user_name, body.business_name)


class SendIn(BaseModel):
    to: str
    subject: str
    body: str


@app.post("/send")
def send(body: SendIn, x_service_token: str | None = Header(default=None)):
    """Send an owner-approved email (Composio Gmail, simulated fallback)."""
    check_service_token(x_service_token)
    status, error = send_gmail(body.to, body.subject, body.body)
    return {"status": status, "error": error}


@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    x_service_token: str | None = Header(default=None),
):
    check_service_token(x_service_token)
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    try:
        extraction = extract_invoice(file_bytes, file.content_type or "image/png")
        return {"extraction": extraction}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read document: {str(e)[:200]}") from e
