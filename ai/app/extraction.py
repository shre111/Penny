"""Invoice/receipt extraction: document bytes → structured proposal via Gemini vision.

Returns a proposal the UI shows as a confirm card; nothing is written to the
books until the user approves it.
"""
import base64
from pydantic import BaseModel, Field

from .agent import get_model


class ExtractedLineItem(BaseModel):
    description: str
    quantity: float = 1
    unitPrice: float = Field(description="price per unit")


class InvoiceExtraction(BaseModel):
    """What could be read off the document."""

    client_name: str = Field(description="who the invoice is billed to (the customer), best guess")
    client_email: str = Field(default="", description="customer email if visible")
    amount: float = Field(description="total amount due")
    currency: str = Field(default="USD")
    issue_date: str = Field(default="", description="YYYY-MM-DD if visible")
    due_date: str = Field(default="", description="YYYY-MM-DD; if absent, leave empty")
    line_items: list[ExtractedLineItem] = Field(default_factory=list)
    notes: str = Field(default="", description="anything notable: PO number, payment terms, etc.")
    confidence: str = Field(description="high | medium | low — how readable the document was")
    summary: str = Field(description="one warm sentence telling the owner what you read, e.g. \"This looks like an invoice for Acme Hardware — $4,500, due July 1.\"")


def extract_invoice(file_bytes: bytes, mime_type: str) -> dict:
    model = get_model().with_structured_output(InvoiceExtraction)
    b64 = base64.b64encode(file_bytes).decode()

    if mime_type == "application/pdf":
        media_block = {"type": "file", "source_type": "base64", "data": b64, "mime_type": mime_type}
    else:
        media_block = {"type": "image", "source_type": "base64", "data": b64, "mime_type": mime_type}

    message = {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": "Read this document (an invoice or receipt a small business owner wants logged). "
                "Extract the fields. If a due date is missing, leave it empty. Be precise with amounts.",
            },
            media_block,
        ],
    }
    result = model.invoke([message])
    return result.model_dump()
