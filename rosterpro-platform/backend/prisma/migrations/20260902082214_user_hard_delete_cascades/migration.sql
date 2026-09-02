-- DropForeignKey
ALTER TABLE "audit_findings" DROP CONSTRAINT "audit_findings_raisedById_fkey";

-- DropForeignKey
ALTER TABLE "capas" DROP CONSTRAINT "capas_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "staff_group_members" DROP CONSTRAINT "staff_group_members_userId_fkey";

-- DropForeignKey
ALTER TABLE "staff_shift_allocations" DROP CONSTRAINT "staff_shift_allocations_userId_fkey";

-- AlterTable
ALTER TABLE "audit_findings" ALTER COLUMN "raisedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "capas" ALTER COLUMN "ownerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "staff_shift_allocations" ADD CONSTRAINT "staff_shift_allocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_group_members" ADD CONSTRAINT "staff_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas" ADD CONSTRAINT "capas_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
