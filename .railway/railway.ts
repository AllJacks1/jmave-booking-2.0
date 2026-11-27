import { defineRailway, project, service } from "railway/iac";
// KEEP IN STEP BY HAND: `railway config plan/apply` fails on Windows (SDK
// version check), so live settings are changed with the Railway API. When a
// deploy setting changes on Railway, make the same change here, and vice
// versa. See docs/PLAN.md §7 (2026-11-23, 2026-11-27 Phase 5).
//
// Live layout (checked 2026-11-27, Phase 5):
// - The app service is named "jmave-booking-2.0" (the earlier "web" service
//   was replaced). It deploys from GitHub webdevastra01/jmave-booking-2.0,
//   branch main, in BOTH environments (staging also gets `railway up` deploys).
// - production: app, Postgres, backup.   staging: app, Postgres, worker, backup.
//   Production has NO worker yet (go-live checklist, PLAN §9 Phase 5).
// - Health check /api/health is set on staging only; production has none yet.
// - Postgres (image ghcr.io/railwayapp-templates/postgres-ssl:18) is a
//   template database and is not declared here.
//
// This repository manages only its own resources in the environment.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "web";
export default defineRailway(() => {
  const app = service("jmave-booking-2.0", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    // Railpack runs `pnpm build` / `pnpm start` from package.json.
    preDeploy: "pnpm db:migrate",
    healthcheck: "/api/health", // staging only so far; add on production at go-live
    healthcheckTimeout: 120,
    // Singapore (Railway Metal): closest region to Davao. Postgres is there too.
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  // Phase 3: background jobs (pg-boss schedules, outbox sender, nightly
  // sweeps). Same repo, no Next build; runs src/worker/index.ts under tsx.
  // No HTTP health check: it logs a "worker started" line on start.
  // Variables: DATABASE_URL (reference to Postgres), APP_URL, SENTRY_DSN
  // (worker project), SENTRY_ENVIRONMENT, RESEND_API_KEY, EMAIL_FROM,
  // REWORK_WEBHOOK_URL, REWORK_WEBHOOK_TOKEN (set in Railway, not here).
  // Exists in staging only (2026-11-27).
  const worker = service("worker", {
    build: { buildCommand: "echo worker: no build step", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "pnpm worker",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  // Phase 5: nightly off-site pg_dump (02:00 Asia/Manila = 18:00 UTC), built
  // from ops/backup/Dockerfile (postgres:18 + aws-cli). Logs "backup
  // disabled" and exits until BACKUP_S3_* variables are set. Variables:
  // DATABASE_URL (reference to Postgres), RAILWAY_DOCKERFILE_PATH,
  // BACKUP_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION/PREFIX.
  const backup = service("backup", {
    build: { builder: "DOCKERFILE", dockerfilePath: "ops/backup/Dockerfile" },
    deploy: { cronSchedule: "0 18 * * *", restartPolicyType: "NEVER" },
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  return project("jmave-booking", {
    variables: { managed: false },
    resources: [app, worker, backup],
  });
});
