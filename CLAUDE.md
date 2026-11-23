# J-MaVe Booking 2.0

Quotation, booking and fleet-movement system for J-MaVe Cars (car rental, Davao City, Philippines).
Replaces a Google Sheets workbook and a Google Calendar.

## Read first, every session

1. `docs/PLAN.md` — architecture, data model, roles, decisions, and the **Progress log**.
2. The phase brief you were asked to build: `docs/phases/*.md`.
3. Only the `docs/reference/*.md` files that brief lists.

Do not start work outside the brief's scope. If the brief and PLAN.md disagree, PLAN.md wins; say so to the user.

## Stack (fixed — do not swap)

- Next.js (App Router, TypeScript strict), deployed on **Railway** (app service + Postgres + worker service)
- Tailwind CSS, shadcn/ui, lucide-react
- Drizzle ORM + drizzle-kit migrations, Postgres
- Better Auth (email + password, sessions in Postgres)
- `@react-pdf/renderer` for PDFs (server-side)
- `exceljs` for the Excel import
- `pg-boss` for background jobs (worker service)
- Vitest for unit tests, Playwright for end-to-end tests

## Conventions

- **Money:** integer centavos in the DB and in the pricing engine (`₱1,580.00` = `158000`). Format only at the edge.
- **Time:** store `timestamptz` (UTC). Display and input in `Asia/Manila`. Never use the server's local time zone.
- **Phones:** store E.164 (`+639…`). Accept `09…` input and normalise.
- **Pricing:** all price math lives in `src/lib/pricing/` as pure functions with golden tests. UI and API never compute prices themselves.
- **Permissions:** every server action and route handler checks `can(user, action)` from `src/lib/permissions.ts`. Never rely on hiding UI.
- **IDs:** UUID primary keys. Human numbers (`QTN-2026-929`, `JMV-0123`) are separate unique columns.
- **Audit:** writes to prices, bookings, payments, users and settings go through a helper that also writes `audit_log` (table exists from Phase 1a; viewer comes in Phase 5).
- Server Components by default; client components only where interaction needs them.
- Forms: shadcn `Form` + `react-hook-form` + `zod`. Share zod schemas between client and server.

## Secrets and private data

- Secrets only in env vars (`.env.local` locally, Railway Variables in production). Never commit them, never print them, never put them in logs. `.env.example` lists names only.
- The source workbooks contain real client data. They live in `migration/source/` which is gitignored. Never copy client names, phones, emails, addresses or IDs into code, tests, fixtures, docs or commit messages. Use invented data in tests.

## End of every session

1. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` (and `pnpm e2e` once it exists). Report real results.
2. Append an entry to **Progress log** in `docs/PLAN.md`: date, phase, what was built, what was not, known issues, any decision you had to make (also add it to **Decisions log**).
3. Ask the user before committing. Commit on a branch named after the phase (e.g. `phase-1a`).
