"""Tests for the Resend HTTPS email backend and its settings wiring."""

from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings

from .resend_backend import ResendApiEmailBackend


class _FakeResponse:
    def __init__(self, status_code=200, text="ok"):
        self.status_code = status_code
        self.text = text


@override_settings(DEFAULT_FROM_EMAIL="noreply@example.com")
class ResendBackendTests(TestCase):
    def _send_one(self):
        msg = mail.EmailMessage(
            subject="s", body="b", from_email="noreply@example.com", to=["to@example.com"])
        return ResendApiEmailBackend().send_messages([msg])

    @override_settings(RESEND_API_KEY="re_test_key", EMAIL_HOST_PASSWORD="")
    def test_uses_resend_api_key_setting(self):
        # Regression: RESEND_API_KEY was read via getattr(settings, ...) but never
        # defined in settings.py, so setting only that env var sent nothing.
        with patch("api.resend_backend.requests.post", return_value=_FakeResponse()) as post:
            sent = self._send_one()
        self.assertEqual(sent, 1)
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer re_test_key")

    @override_settings(RESEND_API_KEY="", EMAIL_HOST_PASSWORD="re_smtp_key")
    def test_falls_back_to_email_host_password(self):
        with patch("api.resend_backend.requests.post", return_value=_FakeResponse()) as post:
            sent = self._send_one()
        self.assertEqual(sent, 1)
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer re_smtp_key")

    @override_settings(RESEND_API_KEY="", EMAIL_HOST_PASSWORD="")
    def test_missing_key_raises_loudly(self):
        with self.assertRaises(RuntimeError):
            self._send_one()

    @override_settings(RESEND_API_KEY="re_test_key")
    def test_api_rejection_raises_with_details(self):
        rejection = _FakeResponse(403, "The example.com domain is not verified")
        with patch("api.resend_backend.requests.post", return_value=rejection):
            with self.assertRaises(RuntimeError) as ctx:
                self._send_one()
        self.assertIn("403", str(ctx.exception))
        self.assertIn("not verified", str(ctx.exception))
