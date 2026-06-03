import os
import re
import subprocess
import tempfile

DOMAIN_RE = re.compile(
    r'^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'
)


def caddy_validate(content: str) -> tuple[bool, str]:
    """Run caddy validate and return (is_valid, message)."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".caddyfile", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    result = subprocess.run(
        ["caddy", "validate", "--config", tmp_path, "--adapter", "caddyfile"],
        capture_output=True, text=True,
    )
    os.remove(tmp_path)

    if result.returncode == 0:
        return True, "Config is valid"
    return False, result.stderr or result.stdout


def smart_validate(content: str) -> list[str]:
    """Check site addresses look like real domains (caddy is too permissive)."""
    warnings = []
    in_global = False
    brace_depth = 0

    for i, line in enumerate(content.split("\n"), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped == "{" and brace_depth == 0:
            in_global = True
            brace_depth += 1
            continue

        if in_global:
            brace_depth += stripped.count("{") - stripped.count("}")
            if brace_depth <= 0:
                in_global = False
            continue

        if brace_depth == 0 and not stripped.startswith("}") and not stripped.startswith("import "):
            addr = stripped.rstrip(" {")
            if addr and not DOMAIN_RE.match(addr) and not addr.startswith(":") and not addr.startswith("http"):
                if not addr.startswith("*.") and "." not in addr:
                    warnings.append(f"Line {i}: '{addr}' doesn't look like a valid domain")

    return warnings
