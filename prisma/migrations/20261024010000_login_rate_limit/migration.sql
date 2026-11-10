CREATE TABLE "LoginAttemptBucket" (
    "keyHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoginAttemptBucket_pkey" PRIMARY KEY ("keyHash")
);
CREATE INDEX "LoginAttemptBucket_blockedUntil_idx" ON "LoginAttemptBucket"("blockedUntil");
CREATE INDEX "LoginAttemptBucket_windowStartedAt_idx" ON "LoginAttemptBucket"("windowStartedAt");
