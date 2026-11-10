ALTER TABLE "User"
  ADD COLUMN "fullName" TEXT,
  ADD COLUMN "whatsapp" TEXT,
  ADD COLUMN "commissionRateBasisPoints" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User"
  ADD CONSTRAINT "User_commissionRateBasisPoints_check"
  CHECK ("commissionRateBasisPoints" >= 0 AND "commissionRateBasisPoints" <= 10000);
