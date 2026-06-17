# Contributing to ShipSquares

Thanks for your interest! ShipSquares is **beta** software under active development, so
contributions, bug reports, and ideas are all very welcome.

## Prerequisites

- **Node 22+** and **pnpm 10+**.
- A PostgreSQL instance for anything beyond unit tests (Docker works:
  `docker compose -f infra/docker-compose.dev.yml up -d`).

## Getting started

```sh
pnpm install
cp .env.example .env     # set DATABASE_URL / AUTH_SECRET / AUTH_URL
pnpm dev                 # control plane
pnpm test                # vitest
pnpm lint                # eslint + prettier
```

## Workflow

1. Fork the repo and branch off `main`.
2. Make your change **with tests** (the project is test-driven).
3. Ensure `pnpm lint` and `pnpm test` pass.
4. Open a pull request with a clear description; link any related issue.

Keep PRs focused and reasonably small. CI must be green before review.

## Reporting issues

Use the issue templates for bug reports and feature requests. For **security**
vulnerabilities, do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Code of Conduct

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache-2.0](LICENSE) license.
