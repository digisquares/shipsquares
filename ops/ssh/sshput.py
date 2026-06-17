#!/usr/bin/env python3
"""Upload a local file to the ShipSquares VM via SFTP.
Usage:  python sshput.py <local_path> <remote_path>

VM credentials come from the environment / ops/.env (see _vm.py, ops/.env.example).
"""
import sys

try:
    import paramiko
except ImportError:
    sys.stderr.write("paramiko not installed\n")
    sys.exit(254)

from _vm import connection

HOST, USER, PW = connection()

if len(sys.argv) != 3:
    sys.stderr.write("usage: sshput.py <local> <remote>\n")
    sys.exit(2)
local, remote = sys.argv[1], sys.argv[2]

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30,
            look_for_keys=False, allow_agent=False)
sftp = cli.open_sftp()
sftp.put(local, remote)
info = sftp.stat(remote)
sys.stdout.write(f"uploaded {local} -> {remote} ({info.st_size} bytes)\n")
sftp.close()
cli.close()
