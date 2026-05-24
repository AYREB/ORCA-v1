import json
import logging
import urllib.error
import urllib.request
from typing import Any

from django.conf import settings

logger = logging.getLogger(__name__)


STRATEGY_ASSISTANT_INSTRUCTIONS = """
You are Orca's proprietary strategy assistant for a backtesting product.

Your role:
- Help users understand markets, indicators, strategy structure, and backtest design.
- Review the read-only strategy context provided by Orca.
- Explain tradeoffs clearly and identify missing assumptions, risk issues, and overfitting risks.
- Suggest changes in plain language only. Never claim you changed the strategy.

Strict boundaries:
- You cannot edit, save, run, or place trades.
- You do not give personalized investment advice or instructions to buy/sell a real security.
- You do not promise profitability.
- You treat the strategy context as draft backtest data, not live market data.
- If the user asks for a direct trade recommendation, redirect to educational backtesting considerations.

Response style:
- Be concise, specific, and practical.
- Mention which part of the current strategy you are referencing.
- When useful, organize answers as: Read, Risk, Improvements, Next tests.
- Ask at most one clarifying question if the context is missing a critical detail.
""".strip()


class AssistantError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AssistantProviderError(AssistantError):
    pass


def _message_item(role: str, text: str) -> dict[str, Any]:
    return {
        "role": role,
        "content": [{"type": "input_text", "text": text}],
    }


def _clean_message(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None

    role = raw.get("role")
    if role not in {"user", "assistant"}:
        return None

    content = raw.get("content")
    if not isinstance(content, str):
        return None

    max_len = int(getattr(settings, "ORCA_ASSISTANT_MAX_MESSAGE_CHARS", 4000))
    cleaned = content.strip()[:max_len]
    if not cleaned:
        return None

    return {"role": role, "content": cleaned}


def normalize_assistant_messages(raw_messages: Any) -> list[dict[str, str]]:
    if not isinstance(raw_messages, list):
        raise AssistantError("messages must be an array.")

    max_messages = int(getattr(settings, "ORCA_ASSISTANT_MAX_HISTORY_MESSAGES", 16))
    messages = [_clean_message(message) for message in raw_messages[-max_messages:]]
    cleaned = [message for message in messages if message is not None]

    if not cleaned or cleaned[-1]["role"] != "user":
        raise AssistantError("The latest assistant message must be from the user.")

    return cleaned


def normalize_strategy_context(raw_context: Any) -> dict[str, Any]:
    if not isinstance(raw_context, dict):
        raise AssistantError("strategy_context must be a JSON object.")
    return raw_context


def _extract_response_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    parts: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                parts.append(content["text"])
            elif content.get("type") == "refusal" and isinstance(content.get("refusal"), str):
                parts.append(content["refusal"])

    return "\n".join(part.strip() for part in parts if part.strip()).strip()


def _context_text(strategy_context: dict[str, Any]) -> str:
    return json.dumps(strategy_context, indent=2, sort_keys=True)[: int(
        getattr(settings, "ORCA_ASSISTANT_MAX_CONTEXT_CHARS", 20000)
    )]


def _ask_openai(messages: list[dict[str, str]], strategy_context: dict[str, Any]) -> dict[str, Any]:
    api_key = getattr(settings, "OPENAI_API_KEY", "")
    if not api_key:
        raise AssistantProviderError(
            "Strategy assistant is not configured. Set OPENAI_API_KEY on the backend.",
            status_code=503,
        )

    model = getattr(settings, "ORCA_ASSISTANT_MODEL", "gpt-5.1")
    input_items = [
        _message_item(
            "developer",
            "Current read-only Orca strategy context follows. Use it to answer the user's next message.\n\n"
            f"{_context_text(strategy_context)}",
        )
    ]
    input_items.extend(_message_item(message["role"], message["content"]) for message in messages)

    request_payload = {
        "model": model,
        "instructions": STRATEGY_ASSISTANT_INSTRUCTIONS,
        "input": input_items,
        "max_output_tokens": int(getattr(settings, "ORCA_ASSISTANT_MAX_OUTPUT_TOKENS", 900)),
        "store": bool(getattr(settings, "ORCA_ASSISTANT_STORE_RESPONSES", False)),
        "tool_choice": "none",
    }

    api_base = getattr(settings, "OPENAI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    request = urllib.request.Request(
        f"{api_base}/responses",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=float(getattr(settings, "ORCA_ASSISTANT_TIMEOUT_SECONDS", 30.0)),
        ) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        logger.warning("OpenAI assistant request failed with status %s: %s", exc.code, body)
        message = "Assistant provider rejected the request."
        try:
            error_payload = json.loads(body)
            message = error_payload.get("error", {}).get("message") or message
        except json.JSONDecodeError:
            pass
        raise AssistantProviderError(message, status_code=502)
    except urllib.error.URLError as exc:
        logger.warning("OpenAI assistant request failed: %s", exc)
        raise AssistantProviderError("Assistant provider is unreachable.", status_code=502)
    except TimeoutError:
        raise AssistantProviderError("Assistant request timed out.", status_code=504)

    answer = _extract_response_text(response_payload)
    if not answer:
        raise AssistantProviderError("Assistant returned an empty response.", status_code=502)

    return {
        "answer": answer,
        "model": response_payload.get("model", model),
        "provider": "openai",
    }


def _ask_ollama(messages: list[dict[str, str]], strategy_context: dict[str, Any]) -> dict[str, Any]:
    model = getattr(settings, "ORCA_ASSISTANT_OLLAMA_MODEL", "llama3.1:8b")
    ollama_base = getattr(settings, "ORCA_ASSISTANT_OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    ollama_messages = [
        {
            "role": "system",
            "content": (
                f"{STRATEGY_ASSISTANT_INSTRUCTIONS}\n\n"
                "Current read-only Orca strategy context follows. Use it to answer the user's next message.\n\n"
                f"{_context_text(strategy_context)}"
            ),
        },
        *messages,
    ]
    request_payload: dict[str, Any] = {
        "model": model,
        "messages": ollama_messages,
        "stream": False,
        "options": {
            "temperature": float(getattr(settings, "ORCA_ASSISTANT_TEMPERATURE", 0.2)),
            "num_predict": int(getattr(settings, "ORCA_ASSISTANT_MAX_OUTPUT_TOKENS", 900)),
        },
    }

    request = urllib.request.Request(
        f"{ollama_base}/api/chat",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=float(getattr(settings, "ORCA_ASSISTANT_TIMEOUT_SECONDS", 60.0)),
        ) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        logger.warning("Ollama assistant request failed with status %s: %s", exc.code, body)
        raise AssistantProviderError(
            f"Ollama rejected the request. Check that model {model!r} is available locally.",
            status_code=502,
        )
    except urllib.error.URLError as exc:
        logger.warning("Ollama assistant request failed: %s", exc)
        raise AssistantProviderError(
            "Local Ollama is unreachable. Start Ollama and make sure it is listening on 127.0.0.1:11434.",
            status_code=502,
        )
    except TimeoutError:
        raise AssistantProviderError("Local Ollama request timed out.", status_code=504)

    answer = response_payload.get("message", {}).get("content")
    if not isinstance(answer, str) or not answer.strip():
        raise AssistantProviderError("Ollama returned an empty response.", status_code=502)

    return {
        "answer": answer.strip(),
        "model": response_payload.get("model", model),
        "provider": "ollama",
    }


def ask_strategy_assistant(messages: list[dict[str, str]], strategy_context: dict[str, Any]) -> dict[str, Any]:
    provider = str(getattr(settings, "ORCA_ASSISTANT_PROVIDER", "ollama")).strip().lower()
    if provider == "openai":
        return _ask_openai(messages, strategy_context)
    if provider == "ollama":
        return _ask_ollama(messages, strategy_context)
    raise AssistantProviderError(
        "Invalid ORCA_ASSISTANT_PROVIDER. Use 'ollama' or 'openai'.",
        status_code=500,
    )
