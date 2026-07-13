# api/management/commands/ensure_admin.py
"""Create OR promote a single admin superuser — NON-destructive (no data wiped).

Idempotent: if a user with the email already exists it's promoted to superuser
(and its password reset if one is given); otherwise it's created. Safe to run
against a live database you do NOT want to wipe.

    python manage.py ensure_admin --email orca.backtesting@gmail.com --password '...'
    python manage.py ensure_admin --email orca.backtesting@gmail.com          # Google-SSO only
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create or promote one admin superuser without touching any other data."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", default="", help="Set/reset password. Omit to leave Google-SSO only.")

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        password = options["password"]
        User = get_user_model()

        user = User.objects.filter(email__iexact=email).first()
        created = user is None
        if user is None:
            user = User.objects.create_user(username=email, email=email, password=password or None)

        user.is_staff = True
        user.is_superuser = True
        if password:
            user.set_password(password)
        elif created:
            user.set_unusable_password()
        user.save()

        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Promoted'} superuser {email} "
            f"({'password set' if password else 'Google-SSO only'})."
        ))
