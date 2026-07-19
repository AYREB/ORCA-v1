"""Tests for the Resend HTTPS email backend and its settings wiring."""

import json
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
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

    @override_settings(RESEND_API_KEY="re_test_key")
    def test_html_alternative_is_forwarded_to_resend(self):
        msg = mail.EmailMultiAlternatives(
            subject="s", body="plain", from_email="noreply@example.com", to=["to@example.com"])
        msg.attach_alternative("<b>rich</b>", "text/html")
        with patch("api.resend_backend.requests.post", return_value=_FakeResponse()) as post:
            ResendApiEmailBackend().send_messages([msg])
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["text"], "plain")
        self.assertEqual(payload["html"], "<b>rich</b>")


class WelcomeEmailTests(TestCase):
    def setUp(self):
        cache.clear()

    def _html_of(self, msg):
        return next((c for c, mt in msg.alternatives if mt == "text/html"), None)

    def test_register_sends_combined_welcome_with_verify_link(self):
        resp = self.client.post(
            "/api/register/",
            data=json.dumps(
                {"email": "new@example.com", "password": "P@ssword123!", "name": "Ada"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        # It's the onboarding email, not the bare verification one.
        self.assertIn("first backtest", msg.subject.lower())
        self.assertIn("Ada", msg.body)
        # Password signups still get a verification link, folded in.
        self.assertIn("/verify-email?token=", msg.body)
        # And it carries an HTML version with the CTA + UTM tagging.
        html = self._html_of(msg)
        self.assertIsNotNone(html)
        self.assertIn("utm_source=welcome_email", html)

    @override_settings(GOOGLE_CLIENT_ID="google-client-id")
    def _google_login(self, email):
        with patch(
            "api.views.verify_google_id_token",
            return_value={
                "aud": "google-client-id",
                "iss": "https://accounts.google.com",
                "email": email,
                "email_verified": "true",
                "name": "Grace",
            },
        ):
            return self.client.post(
                "/api/login/google/",
                data=json.dumps({"id_token": "google-token"}),
                content_type="application/json",
            )

    def test_google_signup_sends_welcome_without_verify_link(self):
        resp = self._google_login("grace@example.com")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        # Google pre-verifies the address, so no verification link.
        self.assertNotIn("/verify-email?token=", mail.outbox[0].body)

    def test_google_returning_login_does_not_resend_welcome(self):
        User.objects.create_user(
            username="grace@example.com", email="grace@example.com", password="x")
        resp = self._google_login("grace@example.com")
        self.assertEqual(resp.status_code, 200)
        # Existing account signing in again — must not re-trigger the welcome.
        self.assertEqual(len(mail.outbox), 0)
