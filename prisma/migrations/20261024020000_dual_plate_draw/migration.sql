-- The previous resultPlate field stored the existing Mercosur draw result.
-- Preserve those values as Mercosur results; never relabel them as gray-plate results.
ALTER TABLE "Round" RENAME COLUMN "resultPlate" TO "resultMercosurPlate";
ALTER TABLE "Round" ADD COLUMN "resultLegacyPlate" TEXT;

-- Store the bet's format explicitly so settlement can never infer it from a converted key.
CREATE TYPE "PlateFormat" AS ENUM ('LEGACY', 'MERCOSUR');
ALTER TABLE "ParticipationLine" ADD COLUMN "plateFormat" "PlateFormat";

-- Backfill existing bets from their displayed input, not normalizedPlate, because
-- the old normalizer converted some Mercosur letters into digits.
UPDATE "ParticipationLine"
SET "plateFormat" = CASE
  WHEN upper(regexp_replace(trim("plateDisplay"), '[[:space:]]+', '', 'g')) ~ '^[A-Z]{3}[0-9][A-Z][0-9]{2}$'
    THEN 'MERCOSUR'::"PlateFormat"
  WHEN upper(regexp_replace(trim("plateDisplay"), '[[:space:]]+', '', 'g')) ~ '^[A-Z]{3}-?[0-9]{4}$'
    THEN 'LEGACY'::"PlateFormat"
  ELSE NULL
END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ParticipationLine" WHERE "plateFormat" IS NULL) THEN
    RAISE EXCEPTION 'Cannot safely classify all existing ParticipationLine rows by plateDisplay; reconcile invalid/ambiguous rows before migration';
  END IF;
END $$;

ALTER TABLE "ParticipationLine" ALTER COLUMN "plateFormat" SET NOT NULL;
