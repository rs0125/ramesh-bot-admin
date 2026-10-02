# WareOnGo bot admin

Standalone Next.js + TypeScript admin for the sales WhatsApp worker. It provides sign-in, pairing, connection controls, and an inbox for DMs, all group messages, tagged-message filtering, and sending text as Ramesh to existing conversations. Deploy this project to Vercel; run the persistent [ramesh-bot worker](https://github.com/rs0125/ramesh-bot) separately on EC2.

The workspace uses the supplied `rameshadmindesign.md` reference: parchment surfaces, wine primary actions, lilac selected states, violet links, editorial spacing, and self-hosted variable Inter. The original WareOnGo logo is tinted wine on sign-in, in the workspace, and in the browser tab, preserving its artwork. Phosphor duotone icons replace the hand-drawn line set, with direct imports that work on the server and client. The top navigation links to the overview, inbox, connection, and activity. On mobile, conversations open individually with a back control; drafts survive switching conversations within the current session. Send with the button or Ctrl/⌘ + Enter. The logo, icons, fonts and generated sign-in photograph are served locally; see [asset provenance and the image prompt](docs/design-assets.json).

Use **Expand inbox** to give conversations the available screen space. Navigation follows the visible section, and connection links leave focus view without clearing a draft. Reading older messages keeps your position during polling; **Jump to latest** shows when new messages arrive below. Sending with the mentions filter returns to all messages so the reply remains visible. Search and filter counts cover loaded conversations; the inbox identifies partial results while more pages are available.

Drafts and pending send requests stay in memory. Leaving or refreshing with drafts triggers the browser's departure warning; signing out asks before discarding them. Submitted messages are not cancelled by signing out. Connection action errors remain visible until dismissed or another action is attempted, independently of automatic status refreshes.

Initial reads show skeletons for totals, conversations, messages, connection status, and activity; background polling keeps the existing content in place. Failed pagination stays visible with its own retry. If the admin session expires, sign in again in the workspace to keep drafts and your selected conversation. Drafts are never written to browser storage and still disappear if you leave or reload. Send progress and uncertain-send errors survive switching chats, and retries reuse the original request. Short screens and long recovery messages expand the inbox to keep history and the composer accessible.

This project has its own package, lockfile and CI/CD. It has no Prisma/Baileys dependency, shared npm package, or runtime dependency on a neighboring checkout. Its only connection to the worker is the versioned HTTP API configured by `WORKER_API_URL`.

Reviewed **1 October 2026**, alongside the worker's trusted identity and signed Context Engine increment. The worker runs OpenAI Terra through `converser → formatter` in LangGraph and separate Supabase `ramesh-inbound-queue` / `ramesh-outbound-queue` tables. Trusted phone/LID resolution and signed employee-scoped requests are implemented outside the graph. No per-employee OAuth enrollment is needed for this path. Business tools, planner/worker/verifier, reminders and writes remain disconnected. The existing admin API is unchanged.

The inbox requires the worker's `202610010003_inbox.sql` Supabase migration and compatible worker endpoints before rollout. It reads encrypted history through the worker; model keys, MCP credentials, and Supabase connections stay outside this application. History is retained for 30 days and also supplies the worker's recent conversation context. Text cleared by older releases is unavailable. Employee grants, agent traces, and the separate chat playground remain outside this console.

Select a conversation to send up to 4,000 characters as Ramesh. WhatsApp must be connected. The inbox displays queued, sending, sent, failed, expired, and uncertain outcomes; sent means SDK acceptance. Uncertain HTTP results retain the same request ID for retry protection. Automatic replies remain active. Group auto-replies require mentions by default, controlled by the worker's `GROUP_REPLIES_REQUIRE_MENTION` code constant; reading all group messages is always enabled.

## Local setup

Use Node.js 22.16 or newer in the Node 22 release line:

```sh
npm ci
npm run setup:local
npm run dev
```

Edit `.env.local` before signing in. Set `WORKER_API_TOKEN` to the worker's token, `WORKER_API_URL=http://127.0.0.1:3011`, and `ADMIN_ORIGIN=http://127.0.0.1:3010`. `setup:local` creates missing admin secrets without printing them. Find `ADMIN_PASSWORD` in that file. Start the worker separately and open the configured admin origin.

The worker must be reachable even for sign-in because it stores login limits and revocable sessions. Only trusted operators should receive pairing access. Employee-to-CRM authorization is separate: the worker signs trusted employee requests and Context Engine checks current permissions. The signing key stays outside this admin. See [signed access operations](https://github.com/rs0125/ramesh-bot/blob/main/docs/signed-context-auth.md). This console has no credential export, OAuth callback or enrollment UI.

## Fake chat testing and production administration

For conversational testing, run `npm run dev:chat` **in the worker repository** and open `http://127.0.0.1:3012`. That separate GUI uses real OpenAI calls with isolated SQLite and captured replies. It does not pair an account, open WhatsApp, or connect to Supabase. The worker's live-model evaluation harness uses the same fake-delivery boundary. See [worker playground and eval instructions](https://github.com/rs0125/ramesh-bot#safe-local-chat-playground).

This admin at port **3010** controls the worker named by `WORKER_API_URL`. Pointing it at production makes its connect/disconnect/reconnect controls affect the real account. The live linked account belongs to EC2; do not start the retired local pairing alongside it or send real WhatsApp test messages.

The current EC2 API is private. Use the [documented SSM tunnel](https://github.com/rs0125/ramesh-bot/blob/main/docs/ec2-operations.md) on local port **3013**, set `WORKER_API_URL=http://127.0.0.1:3013`, and privately configure the matching production worker token. Keep the tunnel running. This leaves port 3012 available for the fake chat GUI. A Vercel deployment requires a separately provisioned authenticated network path to EC2.

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

The worker must already have its dependencies and Prisma client generated. This mode starts the real worker application against a temporary SQLite database and injects a fake WhatsApp transport, with model calls and the production message database disabled. It tests DM/group eligibility, deduplication, ambiguous sends, persisted pairing and pause, outages, logout revocation and login limits across restarts. It never pairs or messages a real account. The suite uses loopback ports 4310–4313 and cleans up its temporary state. Supabase queue and MCP service tests belong to the worker's independent suite.

On machines with Chrome already installed, `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` selects it instead of Playwright's downloaded Chromium.

## Vercel deployment

For a later Vercel rollout, use this repository's root (`.`), the Next.js preset, and Node.js 22. Set the five variables from [.env.example](.env.example) privately in Vercel Production. `WORKER_API_URL` must be a reachable, authenticated HTTPS origin; `ADMIN_ORIGIN` must be the exact stable browser origin. The current private EC2 stack has no inbound rules and does not install Caddy, so deploying this admin alone does not establish connectivity. Do not give preview deployments production worker credentials.

CI runs type checks, unit tests, the production build, formatting, a dependency audit and browser tests. Successful main CI can trigger the pinned Vercel CLI on that same tested SHA. Configure a GitHub `production` environment restricted to main, repository variable `VERCEL_DEPLOY_ENABLED=true`, variables `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`, and secret `VERCEL_TOKEN`. CD is disabled until the flag is set. `vercel.json` disables automatic Git deployments so they cannot bypass CI; the workflow uses CLI deployment.

Cookies last eight hours, use HttpOnly/SameSite=Strict and Secure on HTTPS, and are backed by revocable worker sessions. Sign-in and controls enforce the configured Origin. Limits are persisted on the worker, shared across Vercel instances, and count successful attempts too. Password or signing-key rotation invalidates existing cookies.

Independent deployments should preserve the `/v1` contract. Deploy compatible worker additions first; use a new API version for breaking changes. The worker's README and deployment guide describe EC2 operations, backups and the wider product plan.

See [admin architecture](docs/architecture.md) for the browser/server/worker boundaries, the [worker implementation reference](https://github.com/rs0125/ramesh-bot/blob/main/docs/current-implementation.md) for the active pipeline, and the [consolidated architecture plan](https://github.com/rs0125/ramesh-bot/blob/main/docs/assistant-architecture-plan.md) for the supplied system diagram and future business workflows.
