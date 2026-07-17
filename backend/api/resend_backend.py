"""Django email backend that sends via Resend's HTTPS API.

Why this exists: Railway's free plan blocks outbound SMTP ports (25/465/587),
so smtp.resend.com is unreachable from production — sends hang and die.
Resend's HTTP API rides on 443, which is never blocked, and is Resend's
recommended integration anyway.

Reuses EMAIL_HOST_PASSWORD as the API key (it already holds the Resend key
for SMTP), so switching is a one-variable change:

    EMAIL_BACKEND=api.resend_backend.ResendApiEmailBackend
"""

import logging

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)

_API_URL = "https://api.resend.com/emails"


class ResendApiEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages) -> int:
        api_key = getattr(settings, "RESEND_API_KEY", "") or getattr(
            settings, "EMAIL_HOST_PASSWORD", ""
        )
        if not api_key:
            if not self.fail_silently:
                raise RuntimeError("Resend API key missing (EMAIL_HOST_PASSWORD).")
            return 0

        sent = 0
        for message in email_messages:
            payload = {
                "from": message.from_email or settings.DEFAULT_FROM_EMAIL,
                "to": list(message.to),
                "subject": message.subject,
                "text": message.body,
            }
            if message.cc:
                payload["cc"] = list(message.cc)
            if message.bcc:
                payload["bcc"] = list(message.bcc)
            if message.reply_to:
                payload["reply_to"] = list(message.reply_to)

            try:
                resp = requests.post(
                    _API_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=15,
                )
                if resp.status_code in (200, 201):
                    sent += 1
                else:
                    logger.error(
                        "Resend API rejected email to %s: %s %s",
                        payload["to"], resp.status_code, resp.text[:300],
                    )
                    if not self.fail_silently:
                        raise RuntimeError(f"Resend API error {resp.status_code}: {resp.text[:200]}")
            except requests.RequestException as exc:
                logger.error("Resend API request failed for %s: %s", payload["to"], exc)
                if not self.fail_silently:
                    raise
        return sent
