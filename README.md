<div align="center">

# ShipSquares

**AI-native, self-hosted Platform-as-a-Service** — deploy apps, databases, and more to
servers **you own**, with push-to-deploy, automatic HTTPS, and a built-in AI assistant.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)](#-beta)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

🌐 [shipsquares.com](https://shipsquares.com) · 📚 [Documentation](https://shipsquares.com/docs)

</div>

## ⚠️ Beta

ShipSquares is under active development and **not yet recommended for production-critical
workloads**. Expect rough edges and breaking changes on the road to 1.0 — feedback, bug
reports, and issues are very welcome.

**Need a production-ready self-hosted PaaS today?** We'd point you to the more mature,
battle-tested open-source projects in this space — [Dokploy](https://github.com/Dokploy/dokploy)
and [Coolify](https://github.com/coollabsio/coolify) — until ShipSquares reaches a stable
release.

## Why ShipSquares

- **Own your data** — runs entirely on your servers; no central control plane, no lock-in.
- **Push-to-deploy** — from a GitHub repo, a Docker image, or a one-click catalog template.
- **Automatic HTTPS** — custom domains get certificates issued and renewed for you (Caddy).
- **Multi-server fleet** — start on one server, add more over agentless SSH.
- **Built-in data tools** — Database Studio (SQL browser) and managed email.
- **AI-native** — an MCP server and assistant can operate the platform with your permissions.
- **Lean core** — one TypeScript control plane on PostgreSQL + Caddy; no extra broker, no
  Swarm/Kubernetes to run.

## Quickstart

Install on a fresh Linux server:

```sh
curl -fsSL https://get.shipsquares.com | bash
```

Full installation and usage guides live at **https://shipsquares.com/docs**.

## How it works

A single TypeScript **control plane** (`apps/server`) owns all state in PostgreSQL, runs
background work on an in-database job queue, and drives a **Caddy** reverse proxy for
automatic TLS. It deploys workloads as Docker containers — on the local host or on remote
servers reached over **agentless SSH** (nothing to install on the targets). A **React**
dashboard, an `ss` **CLI**, and an **MCP server** all talk to the same typed HTTP API, so
humans and AI assistants operate the platform through one contract.

## How it compares

[Coolify](https://github.com/coollabsio/coolify) and [Dokploy](https://github.com/Dokploy/dokploy)
are excellent, production-ready PaaS projects, and ShipSquares keeps parity on the basics
(push-to-deploy, one-click catalog, backups, multi-server over SSH). Where it differs is an
**AI-native, batteries-included core**:

|                                                                                      |              ShipSquares               |     Coolify      |     Dokploy      |
| ------------------------------------------------------------------------------------ | :------------------------------------: | :--------------: | :--------------: |
| Built-in **AI assistant + MCP** — operate the platform via AI, with your permissions |                   ✅                   |        —         |        —         |
| **Database Studio** — in-dashboard SQL browser & editor (Postgres + MySQL)           |                   ✅                   |        —         |        —         |
| **Managed email** — host mailboxes + DKIM/SPF/DMARC records generated & verified     |                   ✅                   |        —         |        —         |
| Automatic-HTTPS proxy                                                                | **Caddy** (zero-config, on-demand TLS) |     Traefik      |     Traefik      |
| Control-plane datastore                                                              |  **PostgreSQL only** (pg-boss queue)   | Postgres + Redis | Postgres + Redis |
| Process model                                                                        |  native systemd core (apps in Docker)  |      Docker      |      Docker      |
| Push-to-deploy · catalog · backups · multi-server                                    |                   ✅                   |        ✅        |        ✅        |
| License                                                                              |               Apache-2.0               |    Apache-2.0    |    Apache-2.0    |

> ShipSquares is **beta**; Coolify and Dokploy are battle-tested today. If you need production
> stability right now, use them — and check back as ShipSquares heads to 1.0.

## Built with

ShipSquares stands on a deliberately small, battle-tested set of open-source libraries.

**Core**

- [Node.js](https://nodejs.org) 22 + [TypeScript](https://www.typescriptlang.org) (strict, ESM)
- [pnpm](https://pnpm.io) workspaces

**Control plane** (`apps/server`)

- [Fastify](https://fastify.dev) — HTTP server, with [`@fastify/*`](https://github.com/fastify) plugins (CORS, Helmet, rate-limit, WebSocket, Swagger, static)
- [Drizzle ORM](https://orm.drizzle.team) + [postgres.js](https://github.com/porsager/postgres) on [PostgreSQL](https://www.postgresql.org)
- [pg-boss](https://github.com/timgit/pg-boss) — Postgres-backed job queue (no separate broker)
- [better-auth](https://www.better-auth.com) — authentication + RBAC
- [TypeBox](https://github.com/sinclairzx81/typebox) + [Zod](https://zod.dev) — schema and validation
- [ssh2](https://github.com/mscdex/ssh2) — agentless remote-server orchestration
- [Octokit](https://github.com/octokit) — GitHub App / repo integration
- [Nodemailer](https://nodemailer.com) — managed email delivery
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol) — MCP server
- [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) — the built-in AI assistant

**Dashboard** (`apps/web`)

- [React](https://react.dev) 19 + [Vite](https://vite.dev)
- [TanStack Table & Virtual](https://tanstack.com) — fast data grids
- [CodeMirror](https://codemirror.net) — the SQL editor in Database Studio
- [xterm.js](https://xtermjs.org) — the in-browser console

**Infrastructure**

- [Caddy](https://caddyserver.com) — reverse proxy with automatic HTTPS
- [Docker](https://www.docker.com) — workload runtime

**Tooling**

- [Vitest](https://vitest.dev), [ESLint](https://eslint.org), [Prettier](https://prettier.io), [tsx](https://github.com/privatenumber/tsx)

Full per-subsystem attributions for adapted code are in [NOTICE](NOTICE).

## Monorepo layout

```
apps/server              the Fastify control plane (API, deploy engine, Drizzle, pg-boss)
apps/web                 the React/Vite dashboard
apps/cli                 the `ss` command-line client
mcp                      the MCP server (tools over the typed client)
packages/shared          shared config schema, ids, error taxonomy
packages/openapi-client  generated TypeScript client from the server's openapi.json
infra                    installer + dev compose, Caddy/systemd templates
ops                      operational helper scripts
```

## Development

Requires **Node 22+** and **pnpm 10+**.

```sh
pnpm install
cp .env.example .env     # set DATABASE_URL / AUTH_SECRET / AUTH_URL

pnpm dev                 # boot the control plane
pnpm -F @ss/web dev      # the dashboard (Vite)
pnpm test                # vitest
pnpm lint                # eslint + prettier
pnpm build               # typecheck + build the web app
pnpm openapi:gen         # re-emit openapi.json + the typed client
```

Every runtime value comes from the environment and is validated once at boot; a missing or
malformed key fails fast with a single aggregated error.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See [SECURITY.md](SECURITY.md).

## Acknowledgments

ShipSquares learns from the excellent open-source self-hosted PaaS ecosystem — including
[Dokploy](https://github.com/Dokploy/dokploy), [Coolify](https://github.com/coollabsio/coolify),
[CapRover](https://github.com/caprover/caprover), [Dockge](https://github.com/louislam/dockge),
[Kamal](https://github.com/basecamp/kamal), and [Portainer](https://github.com/portainer/portainer).
Per-subsystem provenance for any adapted code is documented in [NOTICE](NOTICE).

## License

[Apache-2.0](LICENSE) © Digisquares and the ShipSquares contributors.
