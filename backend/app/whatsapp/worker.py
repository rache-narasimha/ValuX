"""Private scheduled Cloud Run service and one-shot local dispatcher."""

import argparse
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from starlette.concurrency import run_in_threadpool

from ..auth.config import AUTH_ENCRYPTION_KEY, DATABASE_URL
from ..auth.database import database_pool, wait_for_database
from . import config, contacts, outbox


@asynccontextmanager
async def lifespan(_app):
    config.validate(worker=True)
    validate_worker()
    with database_pool():
        await run_in_threadpool(wait_for_database)
        yield


# Deploy this entry point as a separate service that requires Cloud Run IAM.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.post("/dispatch")
def run_batch():
    return {"attempted": outbox.dispatch()}


def validate_worker():
    if not DATABASE_URL or not AUTH_ENCRYPTION_KEY:
        raise RuntimeError("Worker requires a database connection and phone encryption key")


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--opt-out-user")
    options = parser.parse_args()
    if options.opt_out_user:
        contacts.operator_opt_out(options.opt_out_user)
        print("WhatsApp assignment alerts turned off.")
        return None
    if options.once:
        config.validate(worker=True)
        validate_worker()
        with database_pool():
            return run_batch()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")), ws="none")


if __name__ == "__main__":
    result = main()
    if result is not None:
        print(f"WhatsApp send attempts: {result['attempted']}")
