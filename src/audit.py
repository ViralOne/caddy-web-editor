import json
from datetime import datetime

from .config import AUDIT_LOG


def log_action(action: str, user: str, detail: str = ""):
    entry = {
        "time": datetime.now().isoformat(),
        "user": user,
        "action": action,
        "detail": detail[:300],
    }
    with open(AUDIT_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")
