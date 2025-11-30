from django.urls import path
from .views import backtestDSLJSON, backtestDSLText, registry  # import registry view

urlpatterns = [
    path("backtestDSLText/", backtestDSLText, name="backtestDSLText"),
    path("backtestDSLJSON/", backtestDSLJSON, name="backtestDSLJSON"),
    path("registry/", registry, name="registry"),  # add this line
]
