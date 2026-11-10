-- Keep recurring queue scans bounded by indexed status and ordering columns.
CREATE INDEX "Purchase_status_paymentMethod_id_idx"
  ON "Purchase"("status", "paymentMethod", "id");

CREATE INDEX "Payment_provider_status_updatedAt_createdAt_idx"
  ON "Payment"("provider", "status", "updatedAt", "createdAt");
