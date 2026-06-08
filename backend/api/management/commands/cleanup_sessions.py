# api/management/commands/cleanup_sessions.py
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from api.models import StrategyConversation

class Command(BaseCommand):
    help = "Clean up abandoned strategy conversations"

    def add_arguments(self, parser):
        parser.add_argument(
            '--hours',
            type=int,
            default=24,
            help='Abandon conversations older than this many hours (default: 24)'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be deleted without deleting'
        )

    def handle(self, *args, **options):
        hours = options['hours']
        dry_run = options['dry_run']
        cutoff = timezone.now() - timedelta(hours=hours)

        abandoned = StrategyConversation.objects.filter(
            status='in_progress',
            updated_at__lt=cutoff
        )

        count = abandoned.count()

        if dry_run:
            self.stdout.write(f"Would delete {count} abandoned conversations")
            for c in abandoned[:5]:
                self.stdout.write(f"  {c.session_id} - last updated {c.updated_at}")
            return

        abandoned.update(status='abandoned')
        self.stdout.write(
            self.style.SUCCESS(f"Marked {count} conversations as abandoned")
        )