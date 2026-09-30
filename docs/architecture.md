# Admin boundary

The browser communicates only with this Next.js application. Server routes verify the admin cookie and its persisted hash, then call an allowlisted worker endpoint with the private API token. The worker owns WhatsApp and durable state; it is not imported into this application.

`src/lib/worker-api.ts` describes the expected v1 wire format. `src/server/worker-client.ts` validates it and limits response size/time. Login and mutating routes reject foreign origins and oversized JSON. Rendering components receive status, never server secrets. QR values stay in memory and are removed when the worker is unavailable or a control operation invalidates them.

The HTTP worker fixture lets this repository run CI independently. Setting `BOT_WORKER_DIR` switches only the test supervisor to a real, separately installed worker's simulated transport entry point. Application code never reads that setting.

A shared operator password protects this first admin surface. Replace it with organizational SSO when individual admin attribution is needed. Salesperson identity, CRM scopes and group information policy remain worker/product design work rather than admin permissions.
