-- Defense in depth: keep money in integer cents and reject invalid negative values.
-- Cross-table totals and the two-result publication policy remain enforced by domain
-- transactions until their historical-data policy is explicitly settled.
ALTER TABLE "Purchase"
  ADD CONSTRAINT "Purchase_totalCents_minimum_check" CHECK ("totalCents" >= 100);

ALTER TABLE "PurchaseParticipation"
  ADD CONSTRAINT "PurchaseParticipation_totalCents_minimum_check" CHECK ("totalCents" >= 100);

ALTER TABLE "ParticipationLine"
  ADD CONSTRAINT "ParticipationLine_allocations_nonnegative_check"
  CHECK (
    "unitCents" >= 0 AND
    "tensCents" >= 0 AND
    "hundredsCents" >= 0 AND
    "thousandsCents" >= 0 AND
    "lettersCents" >= 0 AND
    "fullPlateCents" >= 0 AND
    ("prizeCents" IS NULL OR "prizeCents" >= 0)
  );

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amountCents_positive_check" CHECK ("amountCents" > 0);

ALTER TABLE "CashierCommission"
  ADD CONSTRAINT "CashierCommission_values_check"
  CHECK ("rateBasisPoints" BETWEEN 0 AND 10000 AND "amountCents" >= 0);

ALTER TABLE "Withdrawal"
  ADD CONSTRAINT "Withdrawal_amountCents_positive_check" CHECK ("amountCents" > 0);

-- Validate each result independently, without fabricating a missing historical result.
ALTER TABLE "Round"
  ADD CONSTRAINT "Round_resultLegacyPlate_format_check"
  CHECK ("resultLegacyPlate" IS NULL OR upper(regexp_replace(trim("resultLegacyPlate"), '[[:space:]]+', '', 'g')) ~ '^[A-Z]{3}-?[0-9]{4}$');

ALTER TABLE "Round"
  ADD CONSTRAINT "Round_resultMercosurPlate_format_check"
  CHECK ("resultMercosurPlate" IS NULL OR upper(regexp_replace(trim("resultMercosurPlate"), '[[:space:]]+', '', 'g')) ~ '^[A-Z]{3}[0-9][A-Z][0-9]{2}$');
