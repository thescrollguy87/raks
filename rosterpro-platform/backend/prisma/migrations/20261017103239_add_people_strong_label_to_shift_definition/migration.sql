-- Adds a per-shift-code PeopleStrong Shift_List label, configurable on the
-- Shift Definitions tab, so the biometric-attendance export's label mapping
-- no longer depends on a hardcoded table of a handful of codes. Nullable
-- and additive — existing rows come back unmapped (NULL) until an admin
-- sets one, same as before this column existed.
ALTER TABLE "shift_definitions" ADD COLUMN "peopleStrongLabel" TEXT;
