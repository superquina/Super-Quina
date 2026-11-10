-- Convert the new application schema to a numeric-only game.
-- Financial, payment, receipt, wallet, commission and round records remain intact.
DROP TABLE IF EXISTS "ParticipationLine";

ALTER TABLE "Round"
  DROP COLUMN IF EXISTS "resultLegacyPlate",
  DROP COLUMN IF EXISTS "resultMercosurPlate",
  DROP COLUMN IF EXISTS "gameMode";

DROP TYPE IF EXISTS "PlateFormat";
DROP TYPE IF EXISTS "GameMode";
