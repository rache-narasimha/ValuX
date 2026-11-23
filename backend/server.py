"""Application entry point.

Run with: python -m backend.server
"""

import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from backend.app.auth.config import validate_secrets
from backend.app.auth.database import database_pool, wait_for_database
from backend.app.reports.object_storage import validate_configuration
from backend.app.web.handler import Handler
from backend.app.whatsapp import config as whatsapp_config, contacts as whatsapp_contacts, webhook as whatsapp_webhook


class _PrivateWebhookQuery(logging.Filter):
    def filter(self, record):
        return whatsapp_webhook.PATH not in record.getMessage()


@asynccontextmanager
async def lifespan(_app):
    validate_secrets()
    validate_configuration()
    whatsapp_config.validate()
    access_log = logging.getLogger("uvicorn.access")
    private_query = _PrivateWebhookQuery()
    access_log.addFilter(private_query)
    with database_pool():
        try:
            await run_in_threadpool(wait_for_database)
            await run_in_threadpool(whatsapp_contacts.verify_storage)
            yield
        finally:
            access_log.removeFilter(private_query)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)


@app.api_route("/{path:path}", methods=["GET", "HEAD", "POST", "DELETE"], include_in_schema=False)
def dispatch(request: Request):
    # Keep synchronous database, storage and document work in FastAPI's thread pool.
    handler = Handler(request)
    try:
        return handler.dispatch()
    except ClientDisconnect:
        return handler.send_error(400)
    except Exception as error:
        handler.send_internal_error(error, "The request could not be completed.")
        return handler.response


@app.exception_handler(405)
async def unsupported_method(request: Request, _error):
    return Handler(request).send_error(501)


def main():
    uvicorn.run(
        app,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "4173")),
        server_header=False,
        proxy_headers=False,
        ws="none",
    )


if __name__ == "__main__":
    main()
