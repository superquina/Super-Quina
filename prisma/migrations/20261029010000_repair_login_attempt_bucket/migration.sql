-- Repair deployments where Prisma recorded the login rate-limit migration
-- but the physical table is missing. Safe to run on both fresh and existing DBs.
CREATE TABLE IF NOT EXISTS "LoginAttemptBucket" (
    "keyHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoginAttemptBucket_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX IF NOT EXISTS "LoginAttemptBucket_blockedUntil_idx"
    ON "LoginAttemptBucket"("blockedUntil");
CREATE INDEX IF NOT EXISTS "LoginAttemptBucket_windowStartedAt_idx"
    ON "LoginAttemptBucket"("windowStartedAt");
