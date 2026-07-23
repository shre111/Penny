"""Penny's brain: a LangGraph multi-agent team with Mongo-checkpointed conversations.

Topology (subagents-as-tools, the current LangChain 1.x idiom):
  Penny (supervisor) ── ask_bookkeeper ──► Bookkeeper agent (invoice/client CRUD)
        │                ask_analyst ────► Analyst agent (metrics, charts)
        │                send_email  ────  gated by HumanInTheLoopMiddleware
        │                save_memory
        └── MongoDBSaver checkpointer keyed by chat-session id

Design notes:
- send_email lives on the SUPERVISOR (not inside a subagent) so the
  human-in-the-loop interrupt/resume cycle stays a single, well-tested seam.
- Subagents are stateless per call; conversation state lives in the
  supervisor's checkpointer. Pending approvals survive restarts (state in Mongo).
- PENNY_MULTI_AGENT=false collapses everything into one agent — same tools,
  same behavior, one fewer hop (useful for debugging and tight rate limits).
"""
import os
from datetime import date

from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain.chat_models import init_chat_model
from langchain_core.tools import tool
from langgraph.checkpoint.mongodb import MongoDBSaver
from pymongo import MongoClient

from . import config
from .node_client import request
from .tools import build_tools

MULTI_AGENT = os.getenv("PENNY_MULTI_AGENT", "true").lower() != "false"

_mongo = MongoClient(config.MONGODB_URI)
checkpointer = MongoDBSaver(_mongo, db_name="penny_agent")


def delete_thread(thread_id: str) -> None:
    """Best-effort cleanup of a conversation's agent checkpoint, called when its
    chat session is deleted so orphaned state doesn't pile up in penny_agent."""
    try:
        checkpointer.delete_thread(thread_id)
        return
    except AttributeError:
        pass  # older langgraph without delete_thread → drop the docs directly
    db = _mongo["penny_agent"]
    for coll in ("checkpoints", "checkpoint_writes", "checkpoint_blobs"):
        try:
            db[coll].delete_many({"thread_id": thread_id})
        except Exception:  # noqa: BLE001 — cleanup must never raise into the caller
            pass

_models: dict = {}


def get_model(role: str = "supervisor"):
    if role not in _models:
        if config.PENNY_MODEL.startswith("scripted"):
            from .scripted_model import ScriptedModel

            _models[role] = ScriptedModel(role=role if MULTI_AGENT else "single")
        else:
            # one shared underlying model for every role today; split per-role if needed
            if "_real" not in _models:
                _models["_real"] = init_chat_model(config.PENNY_MODEL, temperature=0.3)
            _models[role] = _models["_real"]
    return _models[role]


def _today() -> str:
    return date.today().strftime("%A, %B %d, %Y")


SUPERVISOR_PROMPT = """You are Penny, the AI back office for a small business. You keep the books tidy: \
invoices, clients, payments, and polite follow-ups. You are talking with {user_name}{business_clause}.

Today's date is {today}.

You lead a small team:
- The Bookkeeper handles records: looking up/creating/updating invoices and clients, recording payments. \
Use ask_bookkeeper for ANY records task, passing along every detail the user gave (names, amounts, dates).
- The Analyst handles numbers and pictures: business health summaries, charts, and the cash-flow \
forecast (it knows each client's payment habits and when money should actually arrive). Use ask_analyst \
for "how are we doing", "when will I get paid", trends, totals, or anything chart-worthy.
- YOU write and send emails (send_email) — e.g. payment reminders. First have the Bookkeeper fetch the \
relevant invoices and client emails, then write each email yourself: warm, specific, professional. \
One send_email call per email. The user reviews every email before it actually goes out, so never \
announce that an email "was sent" until the tool has actually run. If a client has no email on file, \
say so rather than inventing one.

House rules:
- Never guess or invent numbers — if it's about their data, ask your team.
- Plain, warm language: your user is a business owner, not an accountant. Say "money owed to you", \
never "accounts receivable". Keep answers short. Use $ amounts with thousands separators.
- After changes, confirm in one friendly line — the dashboard updates live next to this chat.
- When the user shares a lasting fact or preference, call save_memory with a one-line fact. No trivia.
- For questions about your own policies/terms/pricing rules, use search_knowledge (the owner taught you) and cite the source.
- Politely decline anything unrelated to running their business.

{memories_block}"""

BOOKKEEPER_PROMPT = """You are the Bookkeeper on Penny's team, working the records for a small business. \
Today's date is {today}. Use your tools to do exactly what was asked: look up, create or update invoices \
and clients, record payments. Then reply to Penny with a tight, factual summary of what you found or did — \
always include invoice numbers, client names, amounts/balances, due dates, and client email addresses \
when they exist (Penny needs emails to write reminders). No pleasantries; just the facts."""

ANALYST_PROMPT = """You are the Analyst on Penny's team, crunching numbers for a small business. \
Today's date is {today}. Use get_business_metrics for health questions (it includes the cash-flow \
forecast with each client's payment habits) and make_chart when a picture would help — kinds: 'aging', \
'cashflow', and 'forecast' for "when will money arrive" questions (charts render automatically in the \
owner's chat — mention them, don't describe every bar). When discussing expected payments, say WHY \
("Acme usually pays ~12 days late, so expect it around July 2"). Reply to Penny with the few numbers \
that matter, plainly stated."""


def build_system_prompt(user_id: str, user_name: str = "", business_name: str = "") -> str:
    memories_block = ""
    try:
        memories = request(user_id, "GET", "/api/memories")["memories"]
        if memories:
            facts = "\n".join(f"- {m['fact']}" for m in memories[-20:])
            memories_block = f"Things you remember about this business from earlier conversations:\n{facts}"
    except Exception:
        pass  # memory is a nice-to-have; never block a chat on it
    return SUPERVISOR_PROMPT.format(
        user_name=user_name or "the owner",
        business_clause=f", who runs {business_name}" if business_name else "",
        today=_today(),
        memories_block=memories_block,
    )


def build_agent(user_id: str, user_name: str = "", business_name: str = ""):
    groups = build_tools(user_id)
    hitl = HumanInTheLoopMiddleware(
        interrupt_on={"send_email": True},
        description_prefix="Penny wants to send an email",
    )

    if not MULTI_AGENT:
        return create_agent(
            get_model("single"),
            tools=[*groups["bookkeeping"], *groups["analyst"], *groups["outreach"], *groups["memory"]],
            system_prompt=build_system_prompt(user_id, user_name, business_name),
            middleware=[hitl],
            checkpointer=checkpointer,
        )

    bookkeeper = create_agent(
        get_model("bookkeeper"),
        tools=groups["bookkeeping"],
        system_prompt=BOOKKEEPER_PROMPT.format(today=_today()),
        name="bookkeeper",
    )
    analyst = create_agent(
        get_model("analyst"),
        tools=groups["analyst"],
        system_prompt=ANALYST_PROMPT.format(today=_today()),
        name="analyst",
    )

    @tool
    def ask_bookkeeper(request: str) -> str:
        """Hand a records task to the Bookkeeper: look up / create / update invoices and clients,
        record payments. Pass along every detail the user gave (names, amounts, dates, etc.)."""
        result = bookkeeper.invoke({"messages": [{"role": "user", "content": request}]})
        return str(result["messages"][-1].text)

    @tool
    def ask_analyst(request: str) -> str:
        """Hand a numbers question to the Analyst: business health, totals, trends, charts
        (charts render in the owner's chat automatically)."""
        result = analyst.invoke({"messages": [{"role": "user", "content": request}]})
        return str(result["messages"][-1].text)

    return create_agent(
        get_model("supervisor"),
        tools=[ask_bookkeeper, ask_analyst, *groups["outreach"], *groups["memory"]],
        system_prompt=build_system_prompt(user_id, user_name, business_name),
        middleware=[hitl],
        checkpointer=checkpointer,
    )
