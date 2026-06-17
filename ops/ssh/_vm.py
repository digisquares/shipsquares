#!/usr/bin/env python3
"""Shared VM connection config for the ssh helpers in this folder.

Credentials are read from the environment, falling back to ``ops/.env`` (a
gitignored ``KEY=VALUE`` file; copy ``ops/.env.example`` to get started). This
keeps the VM password out of version control.

Required: ``SS_VM_HOST``, ``SS_VM_USER``, ``SS_VM_PASSWORD``.
"""
import os
import sys
from pathlib import Path

# ops/ssh/_vm.py -> ops/.env
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def _load_env_file() -> None:
    if not _ENV_FILE.exists():
        return
    for raw in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        # Don't clobber values already set in the real environment.
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def connection() -> tuple[str, str, str]:
    """Return ``(host, user, password)`` or exit(3) with a helpful message."""
    _load_env_file()
    host = os.environ.get("SS_VM_HOST")
    user = os.environ.get("SS_VM_USER")
    pw = os.environ.get("SS_VM_PASSWORD")
    missing = [k for k, v in (("SS_VM_HOST", host), ("SS_VM_USER", user), ("SS_VM_PASSWORD", pw)) if not v]
    if missing:
        sys.stderr.write(
            "missing VM credentials: " + ", ".join(missing) + "\n"
            "set them in the environment or in ops/.env (see ops/.env.example)\n"
        )
        sys.exit(3)
    return host, user, pw
