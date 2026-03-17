import json

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token


User = get_user_model()


class SecurityBehaviorTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_backtest_endpoint_requires_authentication(self):
        response = self.client.post(
            "/api/backtestDSLText/",
            data=json.dumps({"dsl_text": ":TICKER(AAPL)"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_login_rotates_existing_token(self):
        user = User.objects.create_user(
            username="user@example.com",
            email="user@example.com",
            password="P@ssword123!",
        )
        old_token = Token.objects.create(user=user)

        response = self.client.post(
            "/api/login/",
            data=json.dumps({"email": "user@example.com", "password": "P@ssword123!"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        new_token = response.json()["token"]
        self.assertNotEqual(new_token, old_token.key)
        self.assertFalse(Token.objects.filter(key=old_token.key).exists())

    @override_settings(
        API_RATE_LIMITS={
            "auth": {"max_requests": 1, "window_seconds": 60},
            "compute": {"max_requests": 10, "window_seconds": 60},
            "status": {"max_requests": 10, "window_seconds": 60},
            "general": {"max_requests": 10, "window_seconds": 60},
        }
    )
    def test_login_rate_limit_blocks_excess_attempts(self):
        first = self.client.post(
            "/api/login/",
            data=json.dumps({"email": "none@example.com", "password": "bad-password"}),
            content_type="application/json",
        )
        second = self.client.post(
            "/api/login/",
            data=json.dumps({"email": "none@example.com", "password": "bad-password"}),
            content_type="application/json",
        )

        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)
