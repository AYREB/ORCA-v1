# api/management/commands/export_training_data.py
import json
from django.core.management.base import BaseCommand
from api.models import StrategyQueryLog

class Command(BaseCommand):
    help = "Export successful query logs as training data for retraining"

    def add_arguments(self, parser):
        parser.add_argument(
            '--status',
            type=str,
            default='complete',
            help='Filter by status: complete, clarify, failed, non_strategy'
        )
        parser.add_argument(
            '--output',
            type=str,
            default='new_training_data.jsonl',
            help='Output file path'
        )
        parser.add_argument(
            '--min-turns',
            type=int,
            default=1,
            help='Minimum turns to include'
        )

    def handle(self, *args, **options):
        status = options['status']
        output = options['output']
        min_turns = options['min_turns']

        logs = StrategyQueryLog.objects.filter(
            status=status,
            model_output__isnull=False,
        ).order_by('-created_at')

        if min_turns > 1:
            logs = logs.filter(turns_taken__gte=min_turns)

        count = 0
        skipped = 0

        with open(output, 'w') as f:
            for log in logs:
                # Skip if no model output
                if not log.model_output:
                    skipped += 1
                    continue

                # Build the input from conversation history
                if log.conversation_history:
                    user_messages = [
                        t["content"] for t in log.conversation_history
                        if t["role"] == "user"
                    ]
                    combined_input = " ".join(user_messages)
                else:
                    combined_input = log.raw_input

                example = {
                    "instruction": "Convert this trading strategy to JSON",
                    "input": combined_input,
                    "output": json.dumps(log.model_output)
                }

                f.write(json.dumps(example) + "\n")
                count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Exported {count} examples to {output} ({skipped} skipped)"
            )
        )
        self.stdout.write(f"Total logs in DB: {StrategyQueryLog.objects.count()}")