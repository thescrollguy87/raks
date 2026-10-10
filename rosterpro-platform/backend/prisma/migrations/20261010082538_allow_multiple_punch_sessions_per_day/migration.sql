-- Allow more than one punch-in/out session per user per calendar day
-- (split/Break Shift days, or any ad-hoc reason someone punches in again
-- after already completing an in+out pair that day). Purely additive for
-- existing data: every existing row gets sessionIndex = 1 via the column
-- default, so no backfill step and no data loss.

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN "sessionIndex" INTEGER NOT NULL DEFAULT 1;

-- DropIndex
DROP INDEX "attendance_records_userId_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_userId_date_sessionIndex_key" ON "attendance_records"("userId", "date", "sessionIndex");
