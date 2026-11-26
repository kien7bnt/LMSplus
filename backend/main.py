"""
LMSPLUS E-Learning Extension — FastAPI Application Entrypoint
Logs requests and startup events to `../logs/backend.log`.
"""

import logging
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.elearning_router import router as elearning_router

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "backend.log"

_handlers: list[logging.Handler] = [logging.StreamHandler()]
try:
    _handlers.insert(0, logging.FileHandler(LOG_FILE, encoding="utf-8"))
except PermissionError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    handlers=_handlers,
)
logger = logging.getLogger("lmsplus.elearning")
logger.warning("[LEGACY] backend/main.py (FastAPI) chỉ giữ cho mục đích tương thích /api/v1/elearning/*. Runtime chuẩn là backend/server_fallback.mjs (Node.js ESM + PostgreSQL 18).")

app = FastAPI(
    title="LMSPLUS E-Learning Legacy Extension API",
    version="1.0.0",
    description="API mở rộng kế thừa (/api/v1/elearning/*). Lưu ý: Runtime chuẩn toàn hệ thống sử dụng Node.js ESM + PostgreSQL 18.",
)

_allowed_origins = [
    o.strip()
    for o in os.environ.get("LMSPLUS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Range", "Idempotency-Key"],
)

app.include_router(elearning_router)


@app.on_event("startup")
async def on_startup() -> None:
    logger.info("LMSPLUS E-Learning Backend API started successfully.")


@app.get("/health", tags=["System"])
async def health_check():
    logger.info("Health check endpoint called -> OK")
    return {
        "status": "ok",
        "service": "lmsplus-elearning-api",
        "version": "1.0.0",
    }
