#!/usr/bin/env python3
"""Non-interactive SSH runner for the ShipSquares VM.
Reads the remote command from stdin, streams stdout/stderr live, exits with the
remote exit code. Usage:  printf '<cmd>' | python sshrun.py

VM credentials come from the environment / ops/.env (see _vm.py, ops/.env.example).
"""
import sys
import time

# Windows consoles default to cp1252; remote tool output is UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

try:
    import paramiko
except ImportError:
    sys.stderr.write("paramiko not installed\n")
    sys.exit(254)

from _vm import connection

HOST, USER, PW = connection()

cmd = sys.stdin.read()
if not cmd.strip():
    sys.stderr.write("no command on stdin\n")
    sys.exit(2)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    cli.connect(
        HOST, username=USER, password=PW, timeout=30,
        look_for_keys=False, allow_agent=False, banner_timeout=30, auth_timeout=30,
    )
except Exception as exc:  # noqa: BLE001
    sys.stderr.write(f"CONNECT FAILED: {exc}\n")
    sys.exit(255)

chan = cli.get_transport().open_session()
chan.settimeout(None)
chan.exec_command(cmd)

while not chan.exit_status_ready():
    while chan.recv_ready():
        sys.stdout.write(chan.recv(65536).decode("utf-8", "replace"))
        sys.stdout.flush()
    while chan.recv_stderr_ready():
        sys.stderr.write(chan.recv_stderr(65536).decode("utf-8", "replace"))
        sys.stderr.flush()
    time.sleep(0.05)

while chan.recv_ready():
    sys.stdout.write(chan.recv(65536).decode("utf-8", "replace"))
while chan.recv_stderr_ready():
    sys.stderr.write(chan.recv_stderr(65536).decode("utf-8", "replace"))

code = chan.recv_exit_status()
cli.close()
sys.exit(code)
