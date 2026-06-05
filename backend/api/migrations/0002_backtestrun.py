from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='BacktestRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('strategy_name', models.CharField(blank=True, max_length=255)),
                ('pct_change', models.FloatField()),
                ('final_balance', models.FloatField()),
                ('cash', models.FloatField()),
                ('invested', models.FloatField()),
                ('trades_count', models.IntegerField(default=0)),
                ('winning_trades', models.IntegerField(default=0)),
                ('losing_trades', models.IntegerField(default=0)),
                ('win_rate', models.FloatField(default=0)),
                ('equity_curve', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('strategy', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='backtest_runs', to='api.strategy')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='backtest_runs', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
