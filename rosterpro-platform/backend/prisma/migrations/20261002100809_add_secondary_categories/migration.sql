-- AlterTable
ALTER TABLE "users" ADD COLUMN     "secondaryCategories" "StaffCategory"[] DEFAULT ARRAY[]::"StaffCategory"[];
