"""Best-effort persistence of AI interactions.

``log_ai_interaction`` writes one ``AIInteractionLog`` row capturing the full
prompt, response, and performance of a model call. It NEVER raises — logging must
not break the user-facing request — so every failure is swallowed and warned.

The NL->strategy parser already records its own rich rows in ``StrategyQueryLog``;
this covers the strategy/indicator assistants (the OpenAI chatbot) which otherwise
went unrecorded. Together they capture every AI prompt/response in the app.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def log_ai_interaction(
    *,
    kind: str,
    user=None,
    provider: str = "",
    model: str = "",
    system_prompt: str = "",
    context_text: str = "",
    messages: list | None = None,
    request_meta: dict | None = None,
    response_text: str = "",
    response_meta: dict | None = None,
    success: bool = True,
    error: str = "",
    latency_ms: float | int | None = None,
    usage: dict | None = None,
):
    """Persist one AI call. Returns the row (or None on failure)."""
    try:
        from .models import AIInteractionLog

        usage = usage or {}
        return AIInteractionLog.objects.create(
            user=user if getattr(user, "is_authenticated", False) else None,
            kind=kind,
            provider=provider or "",
            model=model or "",
            system_prompt=system_prompt or "",
            context_text=context_text or "",
            messages=messages or [],
            request_meta=request_meta or {},
            response_text=response_text or "",
            response_meta=response_meta or {},
            success=bool(success),
            error=(error or "")[:5000],
            latency_ms=_coerce_int(latency_ms) if latency_ms is not None else None,
            prompt_tokens=_coerce_int(usage.get("prompt_tokens") or usage.get("input_tokens")),
            completion_tokens=_coerce_int(usage.get("completion_tokens") or usage.get("output_tokens")),
            total_tokens=_coerce_int(usage.get("total_tokens")),
        )
    except Exception:  # pragma: no cover - logging must never break the request
        logger.warning("Failed to persist AIInteractionLog", exc_info=True)
        return None
