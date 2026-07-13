# api/management/commands/export_custom_indicators.py
"""Export user-authored custom indicators (code + params + last test) as JSONL.

    python manage.py export_custom_indicators --output custom_indicators.jsonl
"""
import json

from django.core.management.base import BaseCommand

from api.models import CustomIndicator


class Command(BaseCommand):
    help = "Export custom indicators as JSONL for review / retraining."

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="custom_indicators.jsonl")

    def handle(self, *args, **options):
        count = 0
        with open(options["output"], "w") as f:
            for ind in CustomIndicator.objects.all().order_by("created_at").iterator():
                record = {
                    "id": ind.id,
                    "user_id": ind.user_id,
                    "name": ind.name,
                    "description": ind.description,
                    "parameters": ind.parameters,
                    "code": ind.code,
                    "last_test_result": ind.last_test_result,
                    "created_at": ind.created_at.isoformat(),
                    "updated_at": ind.updated_at.isoformat(),
                }
                f.write(json.dumps(record) + "\n")
                count += 1

        self.stdout.write(self.style.SUCCESS(
            f"Exported {count} custom indicators to {options['output']}"
        ))
