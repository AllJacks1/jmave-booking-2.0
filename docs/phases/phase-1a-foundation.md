# Phase 1a — Foundation

> **Kickoff prompt** (paste into a new Claude Code session opened in this repo):
> Build Phase 1a of J-MaVe Booking 2.0. Follow `CLAUDE.md`, `docs/PLAN.md` and `docs/phases/phase-1a-foundation.md`. Show me your plan first, then build. Ask me if anything in the brief is unclear or blocked.

## Goal

A deployed, empty-but-real app: scaffold, database, login, first-run Super Admin setup, the four roles enforced, user management, app shell, settings, audit helper.

## Owner does before this session

- Create a Railway project with a **Postgres** service. Have the Railway CLI logged in (`railway login`) or be ready to paste `DATABASE_URL`.
- Pick a `SETUP_TOKEN` (any long random string) and set it in Railway Variables.

## Read first

- `CLAUDE.md`, `docs/PLAN.md` (§2 roles, §3 architecture, §4 data model rows marked 1a, §6.4 setup)

## Build, in order

1. **Scaffold**
   - `pnpm create next-app` — TypeScript, App Router, `src/`, Tailwind, ESLint, alias `@/*`.
   - shadcn/ui init; add: button, input, label, form, card, table, dialog, sheet, dropdown-menu, select, badge, tabs, separator, avatar, skeleton, tooltip, sonner, alert, checkbox, switch, textarea, popover, command.
   - lucide-react. Fonts via `next/font`.
   - Scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (Vitest), `e2e` (Playwright), `db:generate`, `db:migrate`, `db:studio`.
   - `.gitignore` already exists; keep `migration/source/` and `.env*` (except `.env.example`) ignored.
2. **Database**: Drizzle + `postgres` driver, `src/db/client.ts`, `src/db/schema.ts`, migrations folder. Tables for this phase: Better Auth tables, `settings`, `audit_log`.
3. **Auth** (Better Auth): email + password; sessions in Postgres; **public sign-up disabled**; extra user fields `role`, `active`, `display_name`, `rework_owner_id`, `must_change_password`. Built-in rate limiting on sign-in. Inactive users cannot sign in. Middleware redirects signed-out users to `/login`.
4. **First-run setup** per PLAN §6.4: `/setup` form (setup token, name, email, password ×2). Constant-time token compare. Transaction re-checks no users exist. 404 afterwards.
5. **Permissions**: `src/lib/permissions.ts` implementing the full table in PLAN §2 (all phases, so later phases only use it). `can(user, action, resource?)` + `requirePermission()` for server actions/route handlers. Vitest table-driven tests covering every row.
6. **App shell**: sidebar (collapsible; sheet on mobile) with lucide icons, items filtered by role; top bar with user menu (profile, change password, sign out); light/dark toggle. Placeholder pages for later sections show "Coming in Phase N" (only to roles that will have access). Operations lands on `/board` placeholder; others on `/dashboard`.
7. **Users** (`/users`): list, create (temporary password → `must_change_password`), edit name/role, deactivate/reactivate, reset password. Enforce: Admin can only manage Sales and Operations; nobody can demote or deactivate the last active Super Admin.
8. **Settings** (`/settings`): business details (seed from `docs/reference/quote-documents.md`), default fuel prices (gasoline 94, premium 99, diesel 98 — placeholder values, editable), `quote_validity_hours` 24, `turnaround_buffer_minutes` 60. Super Admin edits; Admin read-only.
9. **Audit helper**: `withAudit(actor, action, entity, id, before, after)` used by user and settings writes.
10. **Health**: `GET /api/health` → DB ping, returns `{ ok: true }`.
11. **Railway deploy**: `railway.json` (or Nixpacks defaults) with build `pnpm build`, start `pnpm start`, **pre-deploy** `pnpm db:migrate`. `.env.example` with every variable in PLAN §3 (names only). Deploy and confirm `/api/health` on the Railway domain.
12. **Tests**: permissions unit tests; Playwright: setup flow → login → create a Sales user → Sales user sees no Users menu.

## Acceptance criteria

- [ ] Fresh DB: `/` redirects to `/login` with "System not set up"; `/setup` without the right token fails; with it, creates a Super Admin; `/setup` then 404s.
- [ ] Sign-up endpoint is not reachable.
- [ ] Each role sees only its menu items; calling a forbidden server action directly returns 403 (test at least one per role).
- [ ] Admin cannot create an Admin or Super Admin; the last Super Admin cannot be demoted or deactivated.
- [ ] Settings save writes an `audit_log` row with before/after.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e` pass.
- [ ] Deployed on Railway; `/api/health` OK; migrations ran on deploy.

## Out of scope

Vehicles, rates, clients, quotations, any import. Custom domain (Phase 4).

## Hand-off

Progress log entry in `docs/PLAN.md` including the Railway URL. Ask before committing (branch `phase-1a`).
