"""Tests for the page-view tracking beacon (/api/track/) and the
superuser visitor-analytics endpoint (/api/admin/visitors/)."""

import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from .models import PageView

User = get_user_model()

ANON = "11111111-1111-1111-1111-111111111111"
SESSION = "22222222-2222-2222-2222-222222222222"


def beacon(client, body: dict, token: str | None = None):
    kwargs = {"content_type": "application/json"}
    if token:
        kwargs["HTTP_AUTHORIZATION"] = f"Token {token}"
    return client.post("/api/track/", data=json.dumps(body), **kwargs)


class TrackEventTests(TestCase):
    def setUp(self):
        cache.clear()

    def _view(self, **overrides):
        body = {"event": "view", "anon_id": ANON, "session_id": SESSION, "path": "/dashboard"}
        body.update(overrides)
        return beacon(self.client, body)

    def test_anonymous_view_creates_row(self):
        resp = self._view()
        self.assertEqual(resp.status_code, 200)
        row = PageView.objects.get()
        self.assertEqual(row.path, "/dashboard")
        self.assertEqual(row.anon_id, ANON)
        self.assertIsNone(row.user)

    def test_ping_extends_engaged_time_without_new_row(self):
        self._view()
        row = PageView.objects.get()
        PageView.objects.filter(id=row.id).update(
            created_at=timezone.now() - timedelta(seconds=60),
            last_seen_at=timezone.now() - timedelta(seconds=60),
        )
        beacon(self.client, {"event": "ping", "anon_id": ANON, "session_id": SESSION, "path": "/dashboard"})
        self.assertEqual(PageView.objects.count(), 1)
        row.refresh_from_db()
        self.assertGreater((row.last_seen_at - row.created_at).total_seconds(), 30)

    def test_logged_in_view_attaches_user(self):
        user = User.objects.create_user(username="u1", email="u1@x.com", password="pw12345!")
        token = Token.objects.create(user=user)
        beacon(self.client, {"event": "view", "anon_id": ANON, "session_id": SESSION, "path": "/dashboard"},
               token=token.key)
        self.assertEqual(PageView.objects.get().user, user)

    def test_mid_session_login_identifies_earlier_anonymous_view_on_ping(self):
        self._view()
        user = User.objects.create_user(username="u2", email="u2@x.com", password="pw12345!")
        token = Token.objects.create(user=user)
        beacon(self.client, {"event": "ping", "anon_id": ANON, "session_id": SESSION, "path": "/dashboard"},
               token=token.key)
        self.assertEqual(PageView.objects.get().user, user)

    def test_sendbeacon_text_plain_body_is_accepted(self):
        resp = self.client.post(
            "/api/track/",
            data=json.dumps({"event": "view", "anon_id": ANON, "session_id": SESSION, "path": "/"}),
            content_type="text/plain",  # navigator.sendBeacon can't set JSON content type
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(PageView.objects.count(), 1)

    def test_garbage_input_is_rejected_quietly(self):
        for body in (
            {"event": "view", "anon_id": "<script>", "session_id": SESSION, "path": "/"},
            {"event": "view", "anon_id": ANON, "session_id": SESSION, "path": "no-slash"},
            {"event": "nope", "anon_id": ANON, "session_id": SESSION, "path": "/"},
        ):
            resp = beacon(self.client, body)
            self.assertEqual(resp.status_code, 200)  # never an error status
        self.assertEqual(PageView.objects.count(), 0)


class AdminVisitorsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            username="admin", email="admin@orca.com", password="pw12345!", is_superuser=True)
        self.admin_token = Token.objects.create(user=self.admin)
        self.user = User.objects.create_user(username="u3", email="u3@x.com", password="pw12345!")

    def _get(self, token=None):
        kwargs = {"HTTP_AUTHORIZATION": f"Token {(token or self.admin_token).key}"}
        return self.client.get("/api/admin/visitors/?days=30", **kwargs)

    def test_requires_superuser(self):
        token = Token.objects.create(user=self.user)
        self.assertEqual(self._get(token=token).status_code, 403)

    def test_totals_returning_and_session_time(self):
        now = timezone.now()
        # Visitor A: two days (returning), 90s engaged on one view.
        PageView.objects.create(anon_id="a" * 8, session_id="s1", path="/", user=None)
        PageView.objects.filter(session_id="s1").update(
            created_at=now - timedelta(days=1, seconds=90), last_seen_at=now - timedelta(days=1))
        PageView.objects.create(anon_id="a" * 8, session_id="s2", path="/dashboard", user=self.user)
        # Visitor B: single day (not returning).
        PageView.objects.create(anon_id="b" * 8, session_id="s3", path="/", user=None)
        # Superuser browsing must not count.
        PageView.objects.create(anon_id="c" * 8, session_id="s4", path="/dashboard/admin", user=self.admin)

        data = json.loads(self._get().content)
        totals = data["totals"]
        self.assertEqual(totals["views"], 3)
        self.assertEqual(totals["unique_visitors"], 2)
        self.assertEqual(totals["returning_visitors"], 1)
        self.assertEqual(totals["signed_in_visitors"], 1)
        self.assertEqual(totals["sessions"], 3)
        self.assertGreaterEqual(totals["total_time_seconds"], 90)

        visitors = {v["anon_id"]: v for v in data["visitors"]}
        self.assertEqual(set(visitors), {"a" * 8, "b" * 8})
        self.assertTrue(visitors["a" * 8]["returning"])
        self.assertEqual(visitors["a" * 8]["email"], "u3@x.com")
        self.assertFalse(visitors["b" * 8]["returning"])
        self.assertGreaterEqual(visitors["a" * 8]["total_seconds"], 90)


class AdminOnlineTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            username="admin2", email="admin2@orca.com", password="pw12345!", is_superuser=True)
        self.token = Token.objects.create(user=self.admin)

    def test_online_counts_recent_heartbeats_only(self):
        user = User.objects.create_user(username="u9", email="u9@x.com", password="pw12345!")
        # Fresh heartbeat (online), stale visitor (offline), superuser (excluded).
        PageView.objects.create(anon_id="live1234", session_id="s1", path="/dashboard", user=user)
        stale = PageView.objects.create(anon_id="old12345", session_id="s2", path="/")
        PageView.objects.filter(id=stale.id).update(
            last_seen_at=timezone.now() - timedelta(minutes=10))
        PageView.objects.create(anon_id="boss1234", session_id="s3", path="/dashboard/admin", user=self.admin)

        resp = self.client.get("/api/admin/online/", HTTP_AUTHORIZATION=f"Token {self.token.key}")
        data = json.loads(resp.content)
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["visitors"][0]["anon_id"], "live1234")
        self.assertEqual(data["visitors"][0]["email"], "u9@x.com")
        self.assertEqual(data["visitors"][0]["path"], "/dashboard")

    def test_requires_superuser(self):
        pleb = User.objects.create_user(username="p9", email="p9@x.com", password="pw12345!")
        token = Token.objects.create(user=pleb)
        resp = self.client.get("/api/admin/online/", HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(resp.status_code, 403)
