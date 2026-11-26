import { defineRailway, project, service } from "railway/iac";
// KEEP IN STEP BY HAND: `railway config plan/apply` fails on Windows (SDK
// version check), so the live `web` settings were set via the Railway API.
// When a deploy setting changes on Railway, make the same change here, and
// vice versa. See docs/PLAN.md §7 (2026-11-23).
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "web";
export default defineRailway(() => {
  const web = service("web", {
    build: { buildCommand: "pnpm build", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "pnpm start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    preDeploy: "pnpm db:migrate",
    // Singapore (Railway Metal): closest region to Davao. Postgres is there too.
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  // Phase 3: background jobs (pg-boss schedules, outbox sender, nightly
  // sweeps). Same repo, no Next build; runs src/worker/index.ts under tsx.
  // No HTTP health check: it logs a "worker started" line on start.
  // Variables: DATABASE_URL (reference to Postgres), RESEND_API_KEY,
  // EMAIL_FROM, APP_URL (set in Railway, not here).
  const worker = service("worker", {
    build: { buildCommand: "echo worker: no build step", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "pnpm worker",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  return project("jmave-booking", {
    variables: { managed: false },
    resources: [web, worker],
  });
});
