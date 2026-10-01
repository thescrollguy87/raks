/*
  Warnings:

  - You are about to drop the column `unplannedManpowerHoursPerMonth` on the `station_workload_configs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "station_workload_configs" DROP COLUMN "unplannedManpowerHoursPerMonth",
ADD COLUMN     "unplannedHoursB1" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unplannedHoursB2" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unplannedHoursCM" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unplannedHoursNCS" INTEGER NOT NULL DEFAULT 0;
