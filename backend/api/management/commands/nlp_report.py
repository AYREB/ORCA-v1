"""Weekly NLP quality digest from StrategyQueryLog.

Usage:
    python manage.py nlp_report            # last 7 days
    python manage.py nlp_report --days 30
"""

from collections import Counter
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import StrategyQueryLog


class Command(BaseCommand):
    help = "Print an NLP parse-quality report (feed for training data v2)"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=7)
        parser.add_argument("--failures", type=int, default=10,
                            help="How many failed inputs to print verbatim")

    def handle(self, *args, **opts):
        since = timezone.now() - timedelta(days=opts["days"])
        logs = list(StrategyQueryLog.objects.filter(created_at__gte=since))
        total = len(logs)

        self.stdout.write(f"\n=== NLP report — last {opts['days']} days ({total} queries) ===\n")
        if not total:
            self.stdout.write("No queries logged in this window.\n")
            return

        by_status = Counter(l.status for l in logs)
        for status in ("complete", "clarify", "failed", "non_strategy"):
            n = by_status.get(status, 0)
            self.stdout.write(f"  {status:<13} {n:>5}  ({n / total * 100:.1f}%)")

        completes = [l for l in logs if l.status == "complete"]
        if completes:
            self.stdout.write("\n--- Parse quality (completed parses) ---")
            repaired = [l for l in completes if l.errors]
            self.stdout.write(f"  needed repair       {len(repaired)}/{len(completes)} "
                              f"({len(repaired) / len(completes) * 100:.1f}%)")

            ran = [l for l in completes if l.ran_backtest]
            known = [l for l in completes if l.ran_backtest is not None]
            self.stdout.write(f"  ran the backtest    {len(ran)}/{len(completes)} "
                              f"(outcome known for {len(known)})")

            edited = [l for l in ran if l.edited_fields]
            clean = [l for l in ran if not l.edited_fields]
            if ran:
                self.stdout.write(f"  ran WITHOUT edits   {len(clean)}/{len(ran)} "
                                  f"({len(clean) / len(ran) * 100:.1f}%)  <- 'model got it right'")
            field_counts = Counter(f for l in edited for f in l.edited_fields)
            if field_counts:
                self.stdout.write("  corrected fields (what the model gets wrong):")
                for field, n in field_counts.most_common():
                    self.stdout.write(f"    {field:<14} {n}")

        clarified = Counter(l.missing_field for l in logs
                            if l.status == "clarify" and l.missing_field)
        if clarified:
            self.stdout.write("\n--- Clarifications asked ---")
            for field, n in clarified.most_common():
                self.stdout.write(f"  {field:<20} {n}")

        failures = [l for l in logs if l.status == "failed"][: opts["failures"]]
        if failures:
            self.stdout.write(f"\n--- Failed inputs (training data v2 candidates) ---")
            for l in failures:
                self.stdout.write(f"  • {l.raw_input[:120]!r}")

        self.stdout.write("")
