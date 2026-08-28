-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reportsToId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
