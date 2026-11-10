import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;

function keyFor(username: string) {
  const normalized = username.trim().toLocaleLowerCase("en-US");
  return createHash("sha256").update(`login-account:v1:${normalized}`).digest("hex");
}

export async function getLoginBlock(prisma: PrismaClient, username: string, now = new Date()) {
  const keyHash = keyFor(username);
  const bucket = await prisma.loginAttemptBucket.findUnique({
    where: { keyHash },
    select: { attempts: true, blockedUntil: true, windowStartedAt: true },
  });
  if (!bucket || !bucket.blockedUntil || bucket.blockedUntil <= now) return null;
  return { blockedUntil: bucket.blockedUntil, retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil.getTime() - now.getTime()) / 1000)) };
}

/**
 * Atomically records a failed login in PostgreSQL. This works across application
 * instances and avoids read-modify-write races. The bucket stores only a hash of
 * the normalized username, never the username or submitted password.
 */
export async function recordLoginFailure(prisma: PrismaClient, username: string, now = new Date()) {
  const keyHash = keyFor(username);
  const result = await prisma.$queryRaw<Array<{ attempts: number; blockedUntil: Date | null }>>`
    INSERT INTO "LoginAttemptBucket" ("keyHash", "attempts", "windowStartedAt", "blockedUntil", "updatedAt")
    VALUES (${keyHash}, 1, CAST(${now} AS TIMESTAMP), NULL, CAST(${now} AS TIMESTAMP))
    ON CONFLICT ("keyHash") DO UPDATE SET
      "attempts" = CASE
        WHEN "LoginAttemptBucket"."windowStartedAt" <= CAST(${now} AS TIMESTAMP) - INTERVAL '15 minutes' THEN 1
        ELSE "LoginAttemptBucket"."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "LoginAttemptBucket"."windowStartedAt" <= CAST(${now} AS TIMESTAMP) - INTERVAL '15 minutes' THEN CAST(${now} AS TIMESTAMP)
        ELSE "LoginAttemptBucket"."windowStartedAt"
      END,
      "blockedUntil" = CASE
        WHEN (CASE
          WHEN "LoginAttemptBucket"."windowStartedAt" <= CAST(${now} AS TIMESTAMP) - INTERVAL '15 minutes' THEN 1
          ELSE "LoginAttemptBucket"."attempts" + 1
        END) >= ${LOGIN_MAX_ATTEMPTS}
        THEN CAST(${now} AS TIMESTAMP) + INTERVAL '15 minutes'
        ELSE NULL
      END,
      "updatedAt" = CAST(${now} AS TIMESTAMP)
    RETURNING "attempts", "blockedUntil"
  `;
  const bucket = result[0]!;
  return {
    attempts: bucket.attempts,
    blockedUntil: bucket.blockedUntil,
    blocked: bucket.blockedUntil !== null && bucket.blockedUntil > now,
    retryAfterSeconds: bucket.blockedUntil && bucket.blockedUntil > now
      ? Math.max(1, Math.ceil((bucket.blockedUntil.getTime() - now.getTime()) / 1000))
      : 0,
  };
}

export async function clearLoginFailures(prisma: PrismaClient, username: string) {
  await prisma.loginAttemptBucket.deleteMany({ where: { keyHash: keyFor(username) } });
}
