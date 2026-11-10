CREATE TYPE "NumericPrizePayoutChannel" AS ENUM ('PLATFORM_PIX', 'CASHIER_CASH');

ALTER TABLE "CashierSettlement"
  ADD COLUMN "cashPrizePayoutCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cashPrizePayoutCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CashierSettlement"
  ADD CONSTRAINT "CashierSettlement_cashPrizePayoutCount_check" CHECK ("cashPrizePayoutCount" >= 0),
  ADD CONSTRAINT "CashierSettlement_cashPrizePayoutCents_check" CHECK ("cashPrizePayoutCents" >= 0);

CREATE TABLE "NumericPrizePayout" (
  "id" TEXT NOT NULL,
  "participationLineId" TEXT NOT NULL,
  "channel" "NumericPrizePayoutChannel" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "cashierId" TEXT,
  "settlementId" TEXT,
  "reference" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NumericPrizePayout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NumericPrizePayout_participationLineId_key" UNIQUE ("participationLineId"),
  CONSTRAINT "NumericPrizePayout_participationLineId_fkey" FOREIGN KEY ("participationLineId") REFERENCES "NumericParticipationLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NumericPrizePayout_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NumericPrizePayout_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NumericPrizePayout_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CashierSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NumericPrizePayout_amountCents_check" CHECK ("amountCents" > 0),
  CONSTRAINT "NumericPrizePayout_channel_cashier_check" CHECK (
    ("channel" = 'CASHIER_CASH' AND "cashierId" IS NOT NULL) OR
    ("channel" = 'PLATFORM_PIX' AND "cashierId" IS NULL)
  ),
  CONSTRAINT "NumericPrizePayout_settlement_channel_check" CHECK (
    "settlementId" IS NULL OR "channel" = 'CASHIER_CASH'
  )
);

CREATE INDEX "NumericPrizePayout_cashierId_paidAt_idx" ON "NumericPrizePayout"("cashierId", "paidAt");
CREATE INDEX "NumericPrizePayout_settlementId_idx" ON "NumericPrizePayout"("settlementId");
