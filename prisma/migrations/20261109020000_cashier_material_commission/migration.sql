ALTER TABLE "User"
  ADD COLUMN "suppliesPrinter" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suppliesPaper" BOOLEAN NOT NULL DEFAULT false;

-- Existing commission snapshots remain unchanged.
