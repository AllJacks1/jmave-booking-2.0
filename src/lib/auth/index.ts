import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { PASSWORD_MIN_LENGTH } from "./password";

export const auth = betterAuth({
  appName: "J-MaVe Booking",
  baseURL: process.env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Staff accounts are created by a Super Admin / Admin, never by sign-up.
    disableSignUp: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: 128,
  },
  // Belt and braces: the sign-up endpoint is removed, not just disabled.
  disabledPaths: ["/sign-up/email"],
  user: {
    additionalFields: {
      role: { type: "string", required: false, input: false, defaultValue: "sales" },
      active: { type: "boolean", required: false, input: false, defaultValue: true },
      displayName: { type: "string", required: false, input: false },
      reworkOwnerId: { type: "string", required: false, input: false },
      mustChangePassword: {
        type: "boolean",
        required: false,
        input: false,
        defaultValue: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
  },
  rateLimit: {
    enabled: process.env.AUTH_RATE_LIMIT !== "off",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/change-password": { window: 60, max: 10 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
    // Phase 5: explicit cookie flags. Secure whenever the app runs on HTTPS
    // (Railway); HttpOnly + SameSite=Lax always (CSRF defence with the
    // origin checks on server actions and route handlers).
    useSecureCookies: (process.env.APP_URL ?? "").startsWith("https://"),
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    // Phase 5: the proxy stamps the trusted client IP (last x-forwarded-for
    // hop, src/lib/security/client-ip.ts); a client-sent header cannot spoof it.
    ipAddress: { ipAddressHeaders: ["x-client-ip"] },
  },
  databaseHooks: {
    session: {
      create: {
        // Inactive users cannot sign in (PLAN §2, brief 1a step 3).
        before: async (session) => {
          const row = await db.query.user.findFirst({
            where: eq(schema.user.id, String(session.userId)),
            columns: { active: true },
          });
          if (!row?.active) {
            throw new APIError("FORBIDDEN", {
              message: "This account is deactivated. Contact an administrator.",
            });
          }
        },
      },
    },
  },
  telemetry: { enabled: false },
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
