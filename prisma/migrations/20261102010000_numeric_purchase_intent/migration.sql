CREATE TABLE "NumericPurchaseIntent" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "roundCount" INTEGER NOT NULL,
  "numbers" JSONB NOT NULL,
  "allocation" JSONB NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "ruleSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NumericPurchaseIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NumericPurchaseIntent_purchaseId_key" UNIQUE ("purchaseId"),
  CONSTRAINT "NumericPurchaseIntent_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NumericPurchaseIntent_roundCount_check" CHECK ("roundCount" BETWEEN 1 AND 10)
);
