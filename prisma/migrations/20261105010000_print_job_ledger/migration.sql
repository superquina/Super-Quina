CREATE TYPE "PrintJobPurpose" AS ENUM ('AUTO_RECEIPT', 'MANUAL_REPRINT');
CREATE TYPE "PrintJobStatus" AS ENUM ('RESERVED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN');

CREATE TABLE "PrintJob" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "purpose" "PrintJobPurpose" NOT NULL,
  "autoReceiptKey" TEXT,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'RESERVED',
  "requestedById" TEXT,
  "deviceName" TEXT,
  "errorCode" TEXT,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sendingAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrintJob_autoReceiptKey_key" UNIQUE ("autoReceiptKey"),
  CONSTRAINT "PrintJob_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PrintJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PrintJob_autoReceiptKey_check" CHECK (
    ("purpose" = 'AUTO_RECEIPT' AND "autoReceiptKey" = "purchaseId") OR
    ("purpose" = 'MANUAL_REPRINT' AND "autoReceiptKey" IS NULL)
  ),
  CONSTRAINT "PrintJob_deviceName_length_check" CHECK ("deviceName" IS NULL OR length("deviceName") <= 120),
  CONSTRAINT "PrintJob_errorCode_length_check" CHECK ("errorCode" IS NULL OR length("errorCode") <= 80)
);

CREATE INDEX "PrintJob_purchaseId_createdAt_idx" ON "PrintJob"("purchaseId", "createdAt");
CREATE INDEX "PrintJob_status_updatedAt_idx" ON "PrintJob"("status", "updatedAt");
CREATE INDEX "PrintJob_requestedById_createdAt_idx" ON "PrintJob"("requestedById", "createdAt");
