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
from .extraction import extract_invoice
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
