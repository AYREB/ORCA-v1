# api/management/commands/factory_reset.py
"""DESTRUCTIVE: wipe ALL data from the database, then (re)create one admin superuser.

Deletes every row in every table (users, strategies, backtests, AI logs, custom
indicators, paper accounts, feedback, usage counters, tokens, sessions, …) via
Django's ``flush``, then creates a single superuser so you keep access.

    python manage.py factory_reset --email orca.backtesting@gmail.com --password '...' --yes

Runs against whatever database ``DATABASE_URL``/settings point at, so scope it
deliberately (local sqlite vs a Railway Postgres via ``railway run``).
"""
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "DESTRUCTIVE: wipe all data, then create one admin superuser."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="Admin superuser email (also the username).")
        parser.add_argument(
            "--password", default="",
            help="Admin password. Omit for an unusable password (Google-SSO only).",
        )
        parser.add_argument(
            "--yes", action="store_true",
            help="Skip the interactive 'type WIPE to confirm' prompt.",
        )

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        password = options["password"]

        if not options["yes"]:
            confirm = input(
                "This DELETES ALL DATA in the current database and cannot be undone.\n"
                "Type WIPE to continue: "
            )
            if confirm.strip() != "WIPE":
                raise CommandError("Aborted — confirmation not given.")

        self.stdout.write("Flushing all data…")
        # flush deletes every row and re-runs post_migrate (recreates content
        # types + permissions). Schema/migrations are left intact.
        call_command("flush", "--noinput")

        User = get_user_model()
        self.stdout.write(f"Creating superuser {email}…")
        user = User.objects.create_superuser(username=email, email=email, password=password or None)
        if not password:
            user.set_unusable_password()
            user.save(update_fields=["password"])
            self.stdout.write("  (no password set — sign in with Google using this email)")

        self.stdout.write(self.style.SUCCESS(
            f"Factory reset complete. Superuser: {email} "
            f"({'password set' if password else 'Google-SSO only'})."
        ))
