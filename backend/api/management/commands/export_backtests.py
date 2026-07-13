# api/management/commands/export_backtests.py
"""Export recorded backtest runs (inputs + results) as JSONL.

Each row captures the exact strategy definition, run config, and the resulting
performance, so a run can be replayed or mined later. Runs recorded before the
input-capture fields existed simply carry empty ``dsl_json``/``config``.

Examples:
    python manage.py export_backtests --output backtests.jsonl
    python manage.py export_backtests --with-dsl-only   # only rows that captured a strategy
"""
import json

from django.core.management.base import BaseCommand

from api.models import BacktestRun


class Command(BaseCommand):
    help = "Export recorded backtest runs (inputs + results) as JSONL."

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="backtests.jsonl")
        parser.add_argument(
            "--with-dsl-only", action="store_true",
            help="Only export runs that captured the strategy DSL.",
        )
        parser.add_argument(
            "--full-result", action="store_true",
            help="Include the full engine result payload (large).",
        )

    def handle(self, *args, **options):
        qs = BacktestRun.objects.all().order_by("created_at")
        if options["with_dsl_only"]:
            qs = qs.exclude(dsl_json__isnull=True)

        count = 0
        with open(options["output"], "w") as f:
            for run in qs.iterator():
                record = {
                    "id": run.id,
                    "user_id": run.user_id,
                    "strategy_id": run.strategy_id,
                    "strategy_name": run.strategy_name,
                    "source": run.source,
                    "dsl_json": run.dsl_json,
                    "dsl_text": run.dsl_text,
                    "config": run.config,
                    "metrics": {
                        "pct_change": run.pct_change,
                        "final_balance": run.final_balance,
                        "cash": run.cash,
                        "invested": run.invested,
                        "trades_count": run.trades_count,
                        "winning_trades": run.winning_trades,
                        "losing_trades": run.losing_trades,
                        "win_rate": run.win_rate,
                    },
                    "equity_curve": run.equity_curve,
                    "created_at": run.created_at.isoformat(),
                }
                if options["full_result"]:
                    record["result"] = run.result
                f.write(json.dumps(record) + "\n")
                count += 1

        self.stdout.write(self.style.SUCCESS(
            f"Exported {count} backtest runs to {options['output']}"
        ))
        self.stdout.write(f"Total BacktestRun rows: {BacktestRun.objects.count()}")
