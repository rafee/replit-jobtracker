# Nextstep

Nextstep is a personal job-search workspace for finding live roles, tailoring resume drafts, and keeping applications organized.

## Run & Operate

- `cd backend && go run .` — run the API server locally (requires Google Application Default Credentials and the environment variables below)
- `cd backend && go test ./...` — run API tests
- `pnpm --filter @workspace/job-search-assistant run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required API env: `FIREBASE_PROJECT_ID`, `CLERK_JWKS_URL`, `CLERK_ISSUER`, and `CLERK_SECRET_KEY`
- Optional integration env: `GEMINI_API_KEY` — server-side resume generation; `THEIRSTACK_API_KEY` — live job search (the previous Replit-managed connector key cannot be used on Cloud Run; provide a TheirStack API key)
- Cloud Run deployment: build `backend/Dockerfile`, grant its service account the Firestore user role, and set secrets with Secret Manager
- Cloudflare Pages routes `/api/*` through `functions/api/[[path]].ts`; set its `API_ORIGIN` binding to the deployed Cloud Run URL

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9; Go API service
- Web: React + Vite
- API: Go `net/http`, deployed as a Docker container on Google Cloud Run
- DB: Firebase Cloud Firestore
- Auth: Clerk
- Job discovery: TheirStack API
- Resume generation: Gemini through the server-side `GEMINI_API_KEY`
- Validation and API client: Zod + Orval-generated hooks

## Where things live

- `artifacts/job-search-assistant/` — Nextstep web app
- `backend/` — authenticated Go API, Firestore access, integrations, and container build
- `functions/api/[[path]].ts` — same-origin Cloudflare Pages proxy to Cloud Run; frontend source stays unchanged
- `lib/api-spec/openapi.yaml` — source of truth for app API contracts

## Architecture decisions

- Candidate records are scoped to the authenticated Clerk user; do not expose resume or job data to signed-out users.
- Job searches call TheirStack directly using a server-side API key. Search results consume provider credits, so keep result limits deliberate.
- Gemini runs only on the server. Never send model credentials to the browser or include them in logs.
- Resume tailoring must use only source facts and must not invent qualifications or employment history.
- Firestore documents are scoped to hashed Clerk user IDs; the initial Firestore deployment starts empty and does not import the old PostgreSQL data.

## Cloud deployment

1. Create a Firebase project and a Firestore database in Native mode. Enable the Firestore API.
2. Create a Cloud Run service account with the `roles/datastore.user` and `roles/secretmanager.secretAccessor` roles and deploy the container from `backend/`. Allow unauthenticated Cloud Run invocation so the Cloudflare Pages proxy can reach it; the API itself verifies Clerk session tokens. Configure `FIREBASE_PROJECT_ID`, `CLERK_JWKS_URL` (the Clerk instance's `/.well-known/jwks.json` URL), and `CLERK_ISSUER` (the exact `iss` claim from a Clerk session token); store `CLERK_SECRET_KEY`, `GEMINI_API_KEY`, and `THEIRSTACK_API_KEY` in Secret Manager.

   After creating an Artifact Registry Docker repository and the secrets, build and deploy with:

   ```sh
   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/containers/jobtracker-api backend
   gcloud run deploy jobtracker-api --image REGION-docker.pkg.dev/PROJECT_ID/containers/jobtracker-api --region REGION --service-account jobtracker-api@PROJECT_ID.iam.gserviceaccount.com --allow-unauthenticated --set-env-vars FIREBASE_PROJECT_ID=PROJECT_ID,CLERK_JWKS_URL=JWKS_URL,CLERK_ISSUER=CLERK_ISSUER --set-secrets CLERK_SECRET_KEY=clerk-secret:latest,GEMINI_API_KEY=gemini-api-key:latest,THEIRSTACK_API_KEY=theirstack-api-key:latest
   ```

3. Configure the Cloudflare Pages project to build from the repository root with output directory `artifacts/job-search-assistant/dist/public`. Provide `PORT=4173`, `BASE_PATH=/`, `VITE_CLERK_PUBLISHABLE_KEY`, and `VITE_CLERK_PROXY_URL=/api/__clerk` as build variables.
4. Add the Pages Function binding `API_ORIGIN` with the Cloud Run service URL. The Pages Function forwards `/api/*` to Cloud Run, keeping API requests same-origin for the unchanged frontend and Clerk session cookie.
5. Set the Pages environment to the intended public domain and verify sign-in, profile save, job tracking, search, and resume generation. Add Firestore and third-party API secrets only to Cloud Run, never to the frontend build.

For a local API, use `gcloud auth application-default login`, set the same API environment variables, then run `cd backend && go run .`. If the frontend is run outside Cloudflare Pages, configure a local same-origin `/api` proxy to the API server.

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
