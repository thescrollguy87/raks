-- Corrects a bug in 20260828053500_drop_legacy_role_names: that migration
-- recreated the RoleName enum WITHOUT the legacy SHIFT_ENGINEER/TECHNICIAN/
-- STORE_KEEPER values, but never reassigned any Role rows still using
-- those values first — the enum-cast has no fallback for them, so it
-- fails (P3009) on any database where the legacy roles haven't already
-- been cleared out by scripts/remap-legacy-roles.js (true for every real
-- deploy: that script only ever ran ad hoc against a local sandbox DB,
-- never as part of the actual migration history). This migration does
-- the reassignment itself, in SQL, so it's safe to run from a clean
-- database with no external script required — then finishes the same
-- enum swap the earlier migration attempted.
--
-- Every comparison against a legacy role name below casts the enum
-- column to ::text first, deliberately — comparing directly against the
-- RoleName enum type throws "invalid input value for enum" the moment
-- that enum no longer HAS the legacy label at all, which is exactly the
-- state a database ends up in once this migration (or the manual
-- cleanup it replaces) has already run once. Comparing as text keeps
-- every step a true no-op on a database that's already clean, rather
-- than erroring.

-- Ensure the new granular roles exist as real rows before anyone gets
-- reassigned onto them — normally created by `prisma db seed`, but that
-- runs AFTER migrations in the deploy chain, and the enum swap below
-- needs them to exist first.
INSERT INTO "roles" ("id","name","isSystem","updatedAt") VALUES
  (gen_random_uuid(), 'SHIFT_INCHARGE', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DUTY_ENGINEER', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SR_AME', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CM', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SR_TECH', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TECH', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'JR_TECH', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'NCS', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'STORES', true, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO NOTHING;

-- SHIFT_ENGINEER -> DUTY_ENGINEER (straight rename, no per-user logic).
INSERT INTO "user_roles" ("userId","roleId")
SELECT ur."userId", newr.id
FROM "user_roles" ur
JOIN "roles" oldr ON oldr.id = ur."roleId" AND oldr.name::text = 'SHIFT_ENGINEER'
JOIN "roles" newr ON newr.name::text = 'DUTY_ENGINEER'
ON CONFLICT DO NOTHING;

-- STORE_KEEPER -> STORES.
INSERT INTO "user_roles" ("userId","roleId")
SELECT ur."userId", newr.id
FROM "user_roles" ur
JOIN "roles" oldr ON oldr.id = ur."roleId" AND oldr.name::text = 'STORE_KEEPER'
JOIN "roles" newr ON newr.name::text = 'STORES'
ON CONFLICT DO NOTHING;

-- TECHNICIAN -> CM if their category is CM, else split by JR/SR/plain TECH
-- in their designation text, else NCS as the catch-all — same rule
-- scripts/remap-legacy-roles.js used.
INSERT INTO "user_roles" ("userId","roleId")
SELECT ur."userId", newr.id
FROM "user_roles" ur
JOIN "roles" oldr ON oldr.id = ur."roleId" AND oldr.name::text = 'TECHNICIAN'
JOIN "users" u ON u.id = ur."userId"
JOIN "roles" newr ON newr.name::text = (
  CASE
    WHEN u."category"::text = 'CM' THEN 'CM'
    WHEN u."designation" ILIKE '%jr%' AND u."designation" ILIKE '%tech%' THEN 'JR_TECH'
    WHEN u."designation" ILIKE '%sr%' AND u."designation" ILIKE '%tech%' THEN 'SR_TECH'
    WHEN u."designation" ILIKE '%tech%' THEN 'TECH'
    ELSE 'NCS'
  END
)
ON CONFLICT DO NOTHING;

-- AME stays a valid role name on its own, but anyone whose designation
-- reads "Sr. AME" additionally gets the more specific SR_AME role.
INSERT INTO "user_roles" ("userId","roleId")
SELECT ur."userId", newr.id
FROM "user_roles" ur
JOIN "roles" oldr ON oldr.id = ur."roleId" AND oldr.name::text = 'AME'
JOIN "users" u ON u.id = ur."userId"
JOIN "roles" newr ON newr.name::text = 'SR_AME'
WHERE u."designation" ILIKE '%sr%'
ON CONFLICT DO NOTHING;

-- Now safe to remove every UserRole row still pointing at a legacy role,
-- and the legacy Role rows themselves (role_permissions cascades).
DELETE FROM "user_roles" WHERE "roleId" IN (SELECT id FROM "roles" WHERE name::text IN ('SHIFT_ENGINEER','TECHNICIAN','STORE_KEEPER'));
DELETE FROM "roles" WHERE name::text IN ('SHIFT_ENGINEER','TECHNICIAN','STORE_KEEPER');

-- Finalize the enum: recreate without the legacy values (same swap the
-- earlier migration attempted, now safe since nothing references them).
-- Only runs at all if the enum still has a legacy value to remove — a
-- no-op on a database where this has already happened.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'RoleName' AND e.enumlabel = 'SHIFT_ENGINEER'
  ) THEN
    CREATE TYPE "RoleName_new" AS ENUM (
      'SUPER_ADMIN', 'AIRLINE_ADMIN', 'STATION_MANAGER', 'LMM', 'SHIFT_INCHARGE',
      'DUTY_ENGINEER', 'SR_AME', 'AME', 'CM', 'SR_TECH', 'TECH', 'JR_TECH', 'NCS', 'STORES',
      'READ_ONLY_AUDITOR'
    );
    ALTER TABLE "roles" ALTER COLUMN "name" TYPE "RoleName_new" USING ("name"::text::"RoleName_new");
    DROP TYPE "RoleName";
    ALTER TYPE "RoleName_new" RENAME TO "RoleName";
  END IF;
END $$;
