# Nextstep

Nextstep is a personal job-search workspace for finding live roles, tailoring resume drafts, and keeping applications organized.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/job-search-assistant run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (development only)
- Required env: `DATABASE_URL` — PostgreSQL connection; `GEMINI_API_KEY` — server-side Gemini access

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React + Vite
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk
- Job discovery: TheirStack through Replit Connectors
- Resume generation: Gemini through the server-side `GEMINI_API_KEY`
- Validation and API client: Zod + Orval-generated hooks

## Where things live

- `artifacts/job-search-assistant/` — Nextstep web app
- `artifacts/api-server/src/routes/` — authenticated profile, job-search, tracking, and resume-draft endpoints
- `lib/db/src/schema/` — persisted candidate profiles, tracked jobs, and resume drafts
- `lib/api-spec/openapi.yaml` — source of truth for app API contracts

## Architecture decisions

- Candidate records are scoped to the authenticated Clerk user; do not expose resume or job data to signed-out users.
- Job searches call TheirStack through the connector SDK. Search results consume provider credits, so keep result limits deliberate.
- Gemini runs only on the server. Never send model credentials to the browser or include them in logs.
- Resume tailoring must use only source facts and must not invent qualifications or employment history.

## Product

- The first version supports live job searches, saved application tracking, candidate profile/resume source text, and user-prompted Gemini resume drafts that can be edited and downloaded.
- Google Docs synchronization, email monitoring/notifications, calendar scheduling, and the Chrome extension remain follow-up work.

## User preferences

- The user wants task-specific resume prompts and an LLM setup extensible to provider tokens, starting with Gemini.
- Application submission must remain user-reviewed and user-confirmed.

## Gotchas

- The first version uses manually entered application statuses; it does not yet monitor Gmail or company portals.
- LinkedIn is not directly connected. Use the user's pasted profile notes or source resume until an approved connection is available.
- After changing `lib/api-spec/openapi.yaml`, rerun API codegen before relying on generated types and hooks.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
