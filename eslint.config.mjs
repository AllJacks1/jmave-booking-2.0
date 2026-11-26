import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The pricing engine is pure: no database, no server-only modules.
  {
    files: ["src/lib/pricing/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/db", "@/db/*", "drizzle-orm", "drizzle-orm/*", "postgres", "server-only"], message: "The pricing engine must stay pure (PLAN §6.3)." },
          ],
        },
      ],
    },
  },
  // External calls never run inside a web request (PLAN §6.6): only the
  // worker may import the worker code (Resend transport, pg-boss).
  {
    files: ["src/app/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/proxy.ts"],
    // The pricing block above has its own (stricter) list; rule configs do not merge.
    ignores: ["src/lib/pricing/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/worker", "@/worker/*", "**/worker/*", "pg-boss", "resend"], message: "Web code enqueues outbox rows; only src/worker sends (PLAN §6.6)." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Railway IaC file, typed by the Railway CLI, not this project.
    ".railway/**",
    // Playwright output (gitignored).
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
