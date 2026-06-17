# ops/

Operational tooling for deploying and testing ShipSquares against a live VM.
These scripts are **not** part of the pnpm workspace and are excluded from
eslint/prettier (see `eslint.config.js` / `.prettierignore`).

## Layout

```
ops/
  ssh/             # Python SSH/SFTP helpers (paramiko) for the test VM
    _vm.py         # shared credential loader (env / ops/.env)
    sshrun.py      # run a remote command (reads it from stdin), stream output
    sshget.py      # download a file from the VM via SFTP
    sshput.py      # upload a file to the VM via SFTP
  vm-tests/        # remote integration/acceptance scripts, piped to the VM
    vm_*.sh
  mcp_smoke.mjs    # local MCP server JSON-RPC smoke test
```

## Setup

1. `pip install paramiko`
2. Copy `ops/.env.example` to `ops/.env` and set `SS_VM_PASSWORD`
   (`ops/.env` is gitignored — credentials never land in version control).

The helpers read `SS_VM_HOST`, `SS_VM_USER`, `SS_VM_PASSWORD` from the
environment, falling back to `ops/.env`.

## Usage

Run a one-off remote command:

```sh
printf 'uname -a; uptime' | python ops/ssh/sshrun.py
```

Run an integration script on the VM (each `vm-tests/*.sh` does `cd ~/shipsquares`
and runs there):

```sh
python ops/ssh/sshrun.py < ops/vm-tests/vm_validate.sh
```

Move files to/from the VM:

```sh
python ops/ssh/sshput.py ./local.tgz /home/shipsquares/ss.tgz
python ops/ssh/sshget.py /home/shipsquares/server.log ./server.log
```

MCP smoke test (run `pnpm build` first so `mcp/dist/` exists); defaults to the
repo root, or pass an explicit project dir:

```sh
node ops/mcp_smoke.mjs
```

> The `vm-tests/*.sh` scripts use a well-known **dev** auth secret
> (`dev_shipsquares_...`) and localhost dev DB credentials — fixtures for the
> throwaway test VM, not real secrets.
