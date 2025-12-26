from django.conf import settings
from django.db import models


class Strategy(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="strategies")
    name = models.CharField(max_length=255)
    dsl_text = models.TextField(blank=True)
    dsl_json = models.JSONField(blank=True, null=True)
    last_result = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_run_at = models.DateTimeField(blank=True, null=True)

    def __str__(self):
        return f"{self.name} ({self.user.email})"
