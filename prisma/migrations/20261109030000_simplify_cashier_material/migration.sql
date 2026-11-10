ALTER TABLE "User"
  ADD COLUMN "suppliesMaterial" BOOLEAN NOT NULL DEFAULT false;

-- Carry forward the old meaning: either supplied item qualifies as material.
UPDATE "User"
SET "suppliesMaterial" = ("suppliesPrinter" OR "suppliesPaper");

-- Apply the new fixed commission to existing cashier profiles.
-- Completed-sale commission snapshots in CashierCommission remain unchanged.
UPDATE "User"
SET "commissionRateBasisPoints" = CASE WHEN "suppliesMaterial" THEN 1000 ELSE 2000 END
WHERE "role" = 'CASHIER';

ALTER TABLE "User"
  DROP COLUMN "suppliesPrinter",
  DROP COLUMN "suppliesPaper";
