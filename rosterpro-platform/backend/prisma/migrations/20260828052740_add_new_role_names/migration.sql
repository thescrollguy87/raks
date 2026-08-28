-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleName" ADD VALUE 'SHIFT_INCHARGE';
ALTER TYPE "RoleName" ADD VALUE 'DUTY_ENGINEER';
ALTER TYPE "RoleName" ADD VALUE 'SR_AME';
ALTER TYPE "RoleName" ADD VALUE 'CM';
ALTER TYPE "RoleName" ADD VALUE 'SR_TECH';
ALTER TYPE "RoleName" ADD VALUE 'TECH';
ALTER TYPE "RoleName" ADD VALUE 'JR_TECH';
ALTER TYPE "RoleName" ADD VALUE 'NCS';
ALTER TYPE "RoleName" ADD VALUE 'STORES';
