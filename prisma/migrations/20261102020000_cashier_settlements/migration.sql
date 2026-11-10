CREATE TABLE "CashierSettlement" (
  "id" TEXT NOT NULL,
  "cashierId" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cashSalesCents" INTEGER NOT NULL,
  "pixSalesCents" INTEGER NOT NULL,
  "totalSalesCents" INTEGER NOT NULL,
  "salesCount" INTEGER NOT NULL,
  "gamesCount" INTEGER NOT NULL DEFAULT 0,
  "commissionCents" INTEGER NOT NULL,
  CONSTRAINT "CashierSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashierSettlement_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashierSettlement_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashierSettlement_cashSalesCents_check" CHECK ("cashSalesCents" >= 0),
  CONSTRAINT "CashierSettlement_pixSalesCents_check" CHECK ("pixSalesCents" >= 0),
  CONSTRAINT "CashierSettlement_totalSalesCents_check" CHECK ("totalSalesCents" = "cashSalesCents" + "pixSalesCents"),
  CONSTRAINT "CashierSettlement_salesCount_check" CHECK ("salesCount" >= 0),
  CONSTRAINT "CashierSettlement_gamesCount_check" CHECK ("gamesCount" >= 0),
  CONSTRAINT "CashierSettlement_commissionCents_check" CHECK ("commissionCents" >= 0)
);
CREATE INDEX "CashierSettlement_cashierId_settledAt_idx" ON "CashierSettlement"("cashierId", "settledAt");
CREATE INDEX "CashierSettlement_adminId_settledAt_idx" ON "CashierSettlement"("adminId", "settledAt");
