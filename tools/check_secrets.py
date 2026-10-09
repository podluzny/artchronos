#!/usr/bin/env python3
"""NFR-SEC-009: поиск секретов в отслеживаемых git файлах (CI secret scanning без внешних сервисов).

Ищет приватные ключи, токены облачных сервисов и строки подключения с паролем, кроме явно локальных
(localhost / 127.0.0.1) и учебных значений в документации. Код выхода 1 — найдено.
"""
import re
import subprocess
import sys

PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    "Vercel token": re.compile(r"\bvercel_[A-Za-z0-9]{24,}\b", re.I),
    "Slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    "Neon / Postgres URL with password": re.compile(r"postgres(?:ql)?://[^\s:@/]+:[^\s@/]{8,}@(?!localhost|127\.0\.0\.1)[^\s/]+"),
    "Generic API key assignment": re.compile(r"""(?i)\b(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]"""),
}
SKIP = re.compile(r"(^|/)(package-lock\.json|validation/.*\.json|.*\.(png|jpg|jpeg|webp|gif|ico|woff2?))$")
ALLOW = re.compile(r"example|placeholder|<[^>]+>|\$\{|xxxx", re.I)


def main() -> int:
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split()
    found = []
    for f in files:
        if SKIP.search(f):
            continue
        try:
            text = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for name, rx in PATTERNS.items():
                m = rx.search(line)
                if m and not ALLOW.search(m.group(0)):
                    found.append(f"{f}:{n}: {name}")
    for x in found:
        print(x)
    print(f"secret scan: {len(files)} files, {len(found)} findings")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
