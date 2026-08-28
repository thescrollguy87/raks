-- Postgres has no native "DROP VALUE" for enums, so removing
-- SHIFT_ENGINEER/TECHNICIAN/STORE_KEEPER (already remapped off by
-- scripts/remap-legacy-roles.js, zero rows reference them) means
-- recreating the type: new type with only the surviving values, repoint
-- the column, drop the old type, rename the new one into its place.
CREATE TYPE "RoleName_new" AS ENUM (
  'SUPER_ADMIN', 'AIRLINE_ADMIN', 'STATION_MANAGER', 'LMM', 'SHIFT_INCHARGE',
  'DUTY_ENGINEER', 'SR_AME', 'AME', 'CM', 'SR_TECH', 'TECH', 'JR_TECH', 'NCS', 'STORES',
  'READ_ONLY_AUDITOR'
);

ALTER TABLE "roles" ALTER COLUMN "name" TYPE "RoleName_new" USING ("name"::text::"RoleName_new");

DROP TYPE "RoleName";
ALTER TYPE "RoleName_new" RENAME TO "RoleName";
