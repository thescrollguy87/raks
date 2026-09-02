-- ShiftDefinition used to be shared globally across every airline (no
-- airlineId at all) — any authenticated actor with roster:update could
-- alter a shift code every other tenant's roster relied on. This scopes it
-- per-airline like everything else, backfilling existing rows onto
-- whichever airline already existed (there was only ever one tenant's
-- worth of shift definitions live, by construction of the bug being fixed).

-- DropIndex
DROP INDEX "shift_definitions_code_key";

-- AlterTable: add nullable first so existing rows aren't rejected outright
ALTER TABLE "shift_definitions" ADD COLUMN "airlineId" TEXT;

-- Backfill: every pre-existing shift definition onto the oldest airline
-- row. In every environment this migration has actually run against
-- (dev and production alike), exactly one airline has existed up to this
-- point — there was no way to create a second tenant's shift definitions
-- distinctly until this migration, since the column didn't exist.
UPDATE "shift_definitions"
SET "airlineId" = (SELECT "id" FROM "airlines" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "airlineId" IS NULL;

-- AlterTable: now safe to enforce NOT NULL
ALTER TABLE "shift_definitions" ALTER COLUMN "airlineId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "shift_definitions_airlineId_idx" ON "shift_definitions"("airlineId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_definitions_airlineId_code_key" ON "shift_definitions"("airlineId", "code");

-- AddForeignKey
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "airlines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
