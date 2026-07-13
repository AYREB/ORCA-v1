# api/management/commands/export_ai_interactions.py
"""Export logged AI interactions (prompts + responses + performance) as JSONL.

Every row of ``AIInteractionLog`` is dumped in a self-describing shape suitable
for later viewing or curating into a fine-tuning set. Pair with
``export_training_data`` (which covers the NL->strategy parser logs) for the full
picture of every AI call the app has made.

Examples:
    python manage.py export_ai_interactions --output ai_interactions.jsonl
    python manage.py export_ai_interactions --kind strategy_assistant --success-only
"""
import json

from django.core.management.base import BaseCommand

from api.models import AIInteractionLog


class Command(BaseCommand):
    help = "Export logged AI interactions as JSONL for review / retraining."

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="ai_interactions.jsonl")
        parser.add_argument(
            "--kind", type=str, default="",
            help="Filter by kind: strategy_assistant | indicator_assistant | nl_parse | nl_chat",
        )
        parser.add_argument(
            "--success-only", action="store_true",
            help="Only export interactions that succeeded.",
        )

    def handle(self, *args, **options):
        qs = AIInteractionLog.objects.all().order_by("created_at")
        if options["kind"]:
            qs = qs.filter(kind=options["kind"])
        if options["success_only"]:
            qs = qs.filter(success=True)

        count = 0
        with open(options["output"], "w") as f:
            for log in qs.iterator():
                record = {
                    "id": log.id,
                    "kind": log.kind,
                    "provider": log.provider,
                    "model": log.model,
                    "user_id": log.user_id,
                    "system_prompt": log.system_prompt,
                    "context_text": log.context_text,
                    "messages": log.messages,
                    "request_meta": log.request_meta,
                    "response_text": log.response_text,
                    "response_meta": log.response_meta,
                    "success": log.success,
                    "error": log.error,
                    "latency_ms": log.latency_ms,
                    "prompt_tokens": log.prompt_tokens,
                    "completion_tokens": log.completion_tokens,
                    "total_tokens": log.total_tokens,
                    "user_rating": log.user_rating,
                    "created_at": log.created_at.isoformat(),
                }
                f.write(json.dumps(record) + "\n")
                count += 1

        self.stdout.write(self.style.SUCCESS(
            f"Exported {count} AI interactions to {options['output']}"
        ))
        self.stdout.write(f"Total AIInteractionLog rows: {AIInteractionLog.objects.count()}")
