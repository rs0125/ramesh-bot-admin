# WareOnGo bot admin

Standalone Next.js + TypeScript admin for the sales WhatsApp worker. It provides sign-in, QR display, connection status, activity and connect/disconnect/reconnect controls. Deploy this project to Vercel; run the persistent [ramesh-bot worker](https://github.com/rs0125/ramesh-bot) separately on EC2.

This project has its own package, lockfile and CI/CD. It has no Prisma/Baileys dependency, shared npm package, or runtime dependency on a neighboring checkout. Its only connection to the worker is the versioned HTTP API configured by `WORKER_API_URL`.

## Local setup

Use Node.js 22.16 or newer in the Node 22 release line:

```sh
npm ci
npm run setup:local
npm run dev
```

Edit `.env.local` before signing in. Set `WORKER_API_TOKEN` to the worker's token, `WORKER_API_URL=http://127.0.0.1:3011`, and `ADMIN_ORIGIN=http://127.0.0.1:3010`. `setup:local` creates missing admin secrets without printing them. Find `ADMIN_PASSWORD` in that file. Start the worker separately and open the configured admin origin.

The worker must be reachable even for sign-in because it stores login limits and revocable sessions. Only trusted operators should be given the pairing screen. Employee-to-CRM authorization is separate future work.

## Structure

```text
src/app/             Pages and authenticated route handlers
src/components/      Dashboard, login and in-memory QR rendering
src/server/          Server-only configuration, authorization and worker client
src/lib/             Signing, bounded JSON reader and local v1 API types
scripts/             Independent local setup
tests/               Session and request-boundary unit tests
e2e/                 Browser tests, HTTP fixture and optional full integration
.github/workflows/   Independent CI and Vercel CD
```

Each module starts with a responsibility comment. `worker-client.ts` allowlists paths, applies deadlines and response limits, and validates API data. The browser never sees the worker token. Poll responses are discarded after a newer control action; stale QR codes are hidden during controls, logout and outages.

## Validation

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

The default browser suite uses a local HTTP fixture, so CI needs neither a worker checkout nor WhatsApp credentials. To verify interoperability with a local worker project, run the same suite with its path:

```sh
BOT_WORKER_DIR=../baileys-ramesh npm run test:e2e
```

The worker must already have its dependencies and Prisma client generated. This mode starts the real worker application against a temporary SQLite database and injects a fake WhatsApp transport. It tests DM/group eligibility, deduplication, ambiguous sends, persisted pairing and pause, outages, logout revocation and login limits across restarts. It never pairs or messages a real account. The suite uses loopback ports 4310–4313 and cleans up its temporary state.

On machines with Chrome already installed, `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` selects it instead of Playwright's downloaded Chromium.

## Vercel deployment

Use this repository's root (`.`) and the Next.js preset, Node.js 22. Set the five variables from [.env.example](.env.example) privately in Vercel Production. `WORKER_API_URL` must be the EC2 worker's HTTPS origin; `ADMIN_ORIGIN` must be the exact stable browser origin. Do not give preview deployments production worker credentials.

CI runs type checks, unit tests, the production build, formatting, a dependency audit and browser tests. Successful main CI can trigger the pinned Vercel CLI on that same tested SHA. Configure a GitHub `production` environment restricted to main, repository variable `VERCEL_DEPLOY_ENABLED=true`, variables `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`, and secret `VERCEL_TOKEN`. CD is disabled until the flag is set. `vercel.json` disables automatic Git deployments so they cannot bypass CI; the workflow uses CLI deployment.

Cookies last eight hours, use HttpOnly/SameSite=Strict and Secure on HTTPS, and are backed by revocable worker sessions. Sign-in and controls enforce the configured Origin. Limits are persisted on the worker, shared across Vercel instances, and count successful attempts too. Password or signing-key rotation invalidates existing cookies.

Independent deployments should preserve the `/v1` contract. Deploy compatible worker additions first; use a new API version for breaking changes. The worker's README and deployment guide describe EC2 operations, backups and the wider product plan.
