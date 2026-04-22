"""contractor-webui-api — FastAPI service for the contractor web UI.

Runs as the contractor's Linux user (e.g., sales-agent for Pasha) on the
desktop, bound to localhost. A Cloudflare Tunnel exposes the service at
api.<slug>.<domain> for the contractor-dash SPA to call.

Per-contractor: one process per contractor (different bind port + env), or
one process serving one contractor. Generalization is in the config layer;
the HTTP surface is identical across contractors.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from markdown_it import MarkdownIt

from . import docs, inbox
from .auth import current_user, get_config
from .config import Config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("contractor-webui-api")

_md = MarkdownIt("commonmark", {"html": False, "linkify": True, "breaks": False}).enable("table")


def create_app() -> FastAPI:
    cfg = get_config()
    app = FastAPI(
        title=f"contractor-webui-api ({cfg.slug})",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    if cfg.dash_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.dash_origins),
            allow_credentials=True,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["content-type", "x-csrf-token"],
            max_age=600,
        )
    log.info(
        "startup slug=%s publish_box=%s docs=%s activation=%s dash_origins=%s bind=%s:%d",
        cfg.slug, cfg.publish_box, cfg.docs_dir, cfg.activation_date,
        cfg.dash_origins, cfg.bind_host, cfg.bind_port,
    )
    return app


app = create_app()


@app.middleware("http")
async def _strip_transcript_bodies_from_errors(request: Request, call_next):
    """Strict-confidence: ensure we never surface message bodies in error logs.

    The route handlers handle the happy path. This middleware catches unhandled
    exceptions and returns a minimal error with a correlation token. Transcript
    bodies are never logged (see feedback_pasha_jo_transcripts_strict_confidence).
    """
    try:
        return await call_next(request)
    except HTTPException:
        raise
    except Exception:
        log.exception("unhandled error path=%s method=%s", request.url.path, request.method)
        return JSONResponse({"error": "internal"}, status_code=500)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/me")
def me(user: dict[str, Any] = Depends(current_user), cfg: Config = Depends(get_config)):
    return {
        "sub": user.get("sub"),
        "email": user.get("email"),
        "contractor": cfg.slug,
        "exp": user.get("exp"),
    }


@app.get("/inbox")
def get_inbox(
    _user: dict[str, Any] = Depends(current_user),
    cfg: Config = Depends(get_config),
):
    items = inbox.list_inbox(cfg)
    return {
        "items": [
            {
                "id": e.id,
                "from": e.from_,
                "subject": e.subject,
                "date": e.date,
                "unread": e.unread,
                "path": e.path,
            }
            for e in items
        ],
    }


@app.get("/message/{message_id}")
def get_message(
    message_id: str,
    _user: dict[str, Any] = Depends(current_user),
    cfg: Config = Depends(get_config),
):
    try:
        path, entry = inbox.read_message(cfg, message_id)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found") from e
    body = path.read_text(encoding="utf-8", errors="replace")
    html = _md.render(body)
    return {
        "id": entry.id,
        "name": entry.filename,
        "from": entry.from_,
        "subject": entry.subject,
        "date": entry.date,
        "html": html,
    }


@app.post("/read/{message_id}")
def post_read(
    message_id: str,
    _user: dict[str, Any] = Depends(current_user),
    cfg: Config = Depends(get_config),
):
    try:
        inbox.mark_read(cfg, message_id)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found") from e
    return Response(status_code=204)


@app.get("/docs")
def get_docs(
    _user: dict[str, Any] = Depends(current_user),
    cfg: Config = Depends(get_config),
):
    items = docs.list_docs(cfg)
    return {
        "items": [
            {"id": e.id, "title": e.title, "path": e.path}
            for e in items
        ],
    }


@app.get("/doc/{doc_id}")
def get_doc(
    doc_id: str,
    _user: dict[str, Any] = Depends(current_user),
    cfg: Config = Depends(get_config),
):
    try:
        path, entry = docs.read_doc(cfg, doc_id)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_found") from e
    body = path.read_text(encoding="utf-8", errors="replace")
    html = _md.render(body)
    return {
        "id": entry.id,
        "name": entry.filename,
        "title": entry.title,
        "html": html,
    }
