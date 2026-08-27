-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "stationId" TEXT;

-- AlterTable
ALTER TABLE "audit_trail" ADD COLUMN     "stationId" TEXT;

-- CreateIndex
CREATE INDEX "activity_logs_stationId_idx" ON "activity_logs"("stationId");

-- CreateIndex
CREATE INDEX "audit_trail_stationId_idx" ON "audit_trail"("stationId");
