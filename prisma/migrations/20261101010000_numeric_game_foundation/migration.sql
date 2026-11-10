-- Add the numeric game alongside the historical plate model.
-- Existing rounds, participation lines, receipts and financial records remain untouched.
CREATE TYPE "GameMode" AS ENUM ('PLATE', 'NUMERIC');

ALTER TABLE "Round"
  ADD COLUMN "gameMode" "GameMode" NOT NULL DEFAULT 'PLATE',
  ADD COLUMN "resultNumber" TEXT;

CREATE TABLE "NumericParticipationLine" (
  "id" TEXT NOT NULL,
  "participationId" TEXT NOT NULL,
  "numberValue" TEXT NOT NULL,
  "unitCents" INTEGER NOT NULL,
  "tensCents" INTEGER NOT NULL,
  "hundredsCents" INTEGER NOT NULL,
  "thousandsCents" INTEGER NOT NULL,
  "quinaCents" INTEGER NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "ruleSnapshot" JSONB NOT NULL,
  "prizeCents" INTEGER,
  "prizeCreditedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NumericParticipationLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NumericParticipationLine_participationId_fkey"
    FOREIGN KEY ("participationId") REFERENCES "PurchaseParticipation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "NumericParticipationLine_numberValue_idx"
  ON "NumericParticipationLine"("numberValue");
CREATE INDEX "NumericParticipationLine_participationId_idx"
  ON "NumericParticipationLine"("participationId");

ALTER TABLE "Round"
  ADD CONSTRAINT "Round_resultNumber_format_check"
  CHECK ("resultNumber" IS NULL OR "resultNumber" ~ '^[0-9]{5}$');
ALTER TABLE "NumericParticipationLine"
  ADD CONSTRAINT "NumericParticipationLine_numberValue_format_check"
  CHECK ("numberValue" ~ '^[0-9]{5}$');
