"""Penny's brain: a LangChain 1.x agent with Mongo-checkpointed conversations.

- Checkpointer (MongoDBSaver) keyed by chat-session id = in-session context
  retention; pending approvals survive restarts because state lives in Mongo.
- HumanInTheLoopMiddleware pauses before any send_email so the owner
  approves/edits/rejects in the UI.
- Cross-session memory facts are injected into the system prompt each run.
"""
from datetime import date

from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.mongodb import MongoDBSaver
from pymongo import MongoClient

from . import config
from .node_client import request
from .tools import build_tools

_mongo = MongoClient(config.MONGODB_URI)
checkpointer = MongoDBSaver(_mongo, db_name="penny_agent")

_model = None


def get_model():
    global _model
    if _model is None:
        if config.PENNY_MODEL.startswith("scripted"):
            from .scripted_model import ScriptedModel

            _model = ScriptedModel()
        else:
            _model = init_chat_model(config.PENNY_MODEL, temperature=0.3)
    return _model


SYSTEM_PROMPT = """You are Penny, the AI back office for a small business. You keep the books tidy: \
invoices, clients, payments, and polite follow-ups. You are talking with {user_name}{business_clause}.

Today's date is {today}.

How you work:
- You have real tools that read and change the business's actual records. For ANY question about \
invoices, clients, money, or activity — use the tools. Never guess or invent numbers.
- Plain, warm language. Your user is a business owner, not an accountant: say "money owed to you", \
not "accounts receivable aging". Keep answers short and useful. Use $ amounts with thousands separators.
- When you change something (create an invoice, record a payment), confirm what you did in one friendly line. \
The user can see their dashboard update live, so there's no need to repeat every detail back.
- For trends or "how are we doing" questions, call make_chart — a picture beats a table.
- When asked to chase/remind clients about overdue invoices: look up the invoices and the client's email, \
then write a warm, specific reminder email and call send_email (one call per email). The user reviews \
each email before it goes out — so just make the drafts good. If a client has no email on file, say so \
and ask for it rather than inventing one.
- When the user shares a lasting fact or preference (their name for the business, payment terms, \
tone preferences, a VIP client), call save_memory with a one-line fact. Don't save trivia.
- If a tool reports an error, tell the user plainly what went wrong and what would fix it.
- Politely decline anything unrelated to running their business.

{memories_block}"""


def build_system_prompt(user_id: str, user_name: str = "", business_name: str = "") -> str:
    memories_block = ""
    try:
        memories = request(user_id, "GET", "/api/memories")["memories"]
        if memories:
            facts = "\n".join(f"- {m['fact']}" for m in memories[-20:])
            memories_block = f"Things you remember about this business from earlier conversations:\n{facts}"
    except Exception:
        pass  # memory is a nice-to-have; never block a chat on it
    return SYSTEM_PROMPT.format(
        user_name=user_name or "the owner",
        business_clause=f", who runs {business_name}" if business_name else "",
        today=date.today().strftime("%A, %B %d, %Y"),
        memories_block=memories_block,
    )


def build_agent(user_id: str, user_name: str = "", business_name: str = ""):
    return create_agent(
        get_model(),
        tools=build_tools(user_id),
        system_prompt=build_system_prompt(user_id, user_name, business_name),
        middleware=[
            HumanInTheLoopMiddleware(
                interrupt_on={"send_email": True},
                description_prefix="Penny wants to send an email",
            )
        ],
        checkpointer=checkpointer,
    )
