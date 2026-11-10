-- A receipt is issued only after payment confirmation.
-- Existing pending purchases must not retain a code that looks like an issued receipt.
ALTER TABLE "Purchase" ALTER COLUMN "receiptCode" DROP NOT NULL;
UPDATE "Purchase"
SET "receiptCode" = NULL
WHERE "status" = 'PENDING_PAYMENT';
