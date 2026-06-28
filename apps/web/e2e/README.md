# Web E2E (Playwright)

Browser end-to-end tests for the ShipSquares dashboard. Plan & rationale:
[`docs/testing/`](../../../docs/testing/00-index.md). These tests **mimic real user
behavior** — they click, type, and read the rendered UI as an operator would.

## Run

```bash
# from repo root
pnpm -F @ss/web exec playwright install --with-deps chromium   # one-time

# mocked mode (default): built SPA + network mocks, no backend
pnpm -F @ss/web e2e

# full mode: against a real control plane (pnpm dev on :3000, or the test VM)
PLAYWRIGHT_STACK=full E2E_BASE_URL=http://localhost:3000 pnpm -F @ss/web e2e:full

pnpm -F @ss/web e2e:report        # open last HTML report
```

(Windows PowerShell: set env vars with `$env:PLAYWRIGHT_STACK="full"` before the command.)

## Layout

```
e2e/
  playwright.config.ts     # two projects via PLAYWRIGHT_STACK (mocked|full)
  fixtures/
    mock-api.ts            # data-driven mock control plane (one router over
                           #   /auth, /sso-providers, /api/v1; live MockState +
                           #   state.fail for 4xx paths + state.calls assertions)
    test.ts                # Playwright fixtures: `state` + `appPage`
    seed.ts                # full-mode real-API seeding (needs MCL-1 seeded owner)
  utils/run-id.ts          # unique names for isolation
  utils/actions.ts         # shared flows + collision-safe locators (seedSession,
                           #   signIn, openNewAppForm)
  features/                # per-feature scenarios (docs/testing/04)
  journeys/                # cross-feature spines (docs/testing/03)
```

## How the mock works

`mock-api.ts` installs Playwright route handlers on `/auth/**`, `/sso-providers`,
and `/api/v1/**` only — SPA assets pass through `vite preview`. One dispatcher
matches (method, pathname) against an ordered table and reads a live `MockState`
you seed **before** navigating, so handlers reflect per-test data. Helpers:

- `seedSession(state, role?)` — log in as owner/admin/deployer/viewer.
- `state.fail = { "POST /apps": { status: 403, body: {...} } }` — force a status
  on any mutating call to drive negative/RBAC paths (substring match on the path).
- `state.calls` — every intercepted request, so a spec can assert a POST did/didn't
  fire (not just optimistic UI).
- `chatSse` option streams a canned `text/event-stream` body for the assistant.

## Conventions

- Name tests as a persona + intent; reference the scenario id (`AUTH-1`, `J1`).
- Locate by role/label/text first; `data-testid` only for streaming/canvas/grid
  surfaces ([docs/testing/05](../../../docs/testing/05-testability-and-selectors.md)).
- If a scenario needs a major change to pass, mark it `test.fixme(...)` and add a
  row to [docs/testing/07-major-changes-log.md](../../../docs/testing/07-major-changes-log.md).
  Don't block — move to the next test.

## Status

**62 mocked specs passing across every dashboard surface** (chromium), 4 `fixme`
for full-stack-only paths. Run: `pnpm -F @ss/web e2e`.

| Spec file                            | Scenarios                                         |
| ------------------------------------ | ------------------------------------------------- |
| `features/auth.spec.ts`              | AUTH-1/2/3/6, PERSIST-1 (AUTH-4/5 fixme → MCL-11) |
| `features/dashboard.spec.ts`         | DASH-1/2/3/4/4b/8/9                               |
| `features/app-detail.spec.ts`        | APP-1/2/3/7/9/10/11/12/13/4/6                     |
| `features/settings.spec.ts`          | SET-1/2/2b/3/4/5/7/8/9                            |
| `features/invite-loginflow.spec.ts`  | INV-1/2/3/3b, AUTH-7/7b/8                         |
| `features/catalog.spec.ts`           | CAT-1/2/3/4                                       |
| `features/backups.spec.ts`           | BAK-1/2/3                                         |
| `features/studio.spec.ts`            | STU-1/4/5/6 (incl. SSRF guard)                    |
| `features/palette-chat.spec.ts`      | CMD-1/2, CHAT-1/5 (CHAT-4 fixme → live stream)    |
| `features/mail.spec.ts`              | MAIL-1/2/3/4 (mocked per MCL-2/3)                 |
| `features/cross-cutting.spec.ts`     | DEEPLINK-1 (×4), A11Y-1 (axe), J6 RBAC            |
| `journeys/onboarding-deploy.spec.ts` | J1 (deploy step fixme → full-stack)               |

Full-stack-only paths (live WS deploy/logs, console, 2FA) stay `test.fixme` and are
tracked in [docs/testing/07](../../../docs/testing/07-major-changes-log.md). CI runs
the mocked suite on every PR (`e2e` job in `.github/workflows/ci.yml`).
