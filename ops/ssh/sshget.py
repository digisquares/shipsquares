#!/usr/bin/env python3
"""Download a file from the ShipSquares VM via SFTP.
Usage:  python sshget.py <remote_path> <local_path>

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
    sys.stderr.write("usage: sshget.py <remote> <local>\n")
    sys.exit(2)
remote, local = sys.argv[1], sys.argv[2]

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30, look_for_keys=False, allow_agent=False)
sftp = cli.open_sftp()
sftp.get(remote, local)
info = sftp.stat(remote)
sys.stdout.write(f"downloaded {remote} -> {local} ({info.st_size} bytes)\n")
sftp.close()
cli.close()
