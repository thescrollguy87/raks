-- AlterTable
ALTER TABLE "users" ADD COLUMN     "trainingPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trainingPendingNote" TEXT;
