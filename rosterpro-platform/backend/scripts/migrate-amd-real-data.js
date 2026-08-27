// One-time migration: real AMD (Ahmedabad) M&E staff, their August 2026
// roster, and their standard qualifications, into the platform's database
// under the AMD station.
//
// Data provenance — read this before re-running against different source
// data:
//   - amd-real-data.json's `staff` list is reference-ui/index.html's
//     REAL_DATA.aug (the "AMD M&E AUG 26 ROSTER" — August 2026, the
//     current month as of this migration) cross-referenced by employee ID
//     against the user-supplied AMD_STAFF_EMAIL_ID.xlsx for real email
//     addresses. reference-ui has no email field at all, so a person only
//     appears here if a real email was actually supplied for them.
//   - `skippedNoEmail` lists real August-roster staff who have NO matching
//     row in AMD_STAFF_EMAIL_ID.xlsx — these are NOT imported. A user login
//     needs a real, unique email, and none was fabricated for them (see the
//     migration summary for exactly who and why).
//   - Category, for anyone with an August roster match, comes straight from
//     that roster's own `cat` field (already computed by reference-ui).
//     For the 9 staff who are on the email list but never appear in either
//     the July or August roster (no shift history available at all), the
//     category is derived from their designation using the exact same
//     inCat() rule reference-ui itself uses.
//
// Usage:
//   node scripts/migrate-amd-real-data.js            # dry run — prints the
//                                                     # full summary, writes nothing
//   node scripts/migrate-amd-real-data.js --apply     # actually imports
//
// Idempotent: safe to run --apply more than once. Users/shift assignments
// upsert by their natural keys; qualification/license/training records are
// skipped if a matching one (by userId + the record's own identifying
// field) already exists, so re-running never duplicates them.

const { PrismaClient } = require("@prisma/client");
const path = require("path");
const data = require(path.join(__dirname, "amd-real-data.json"));
const { hashPassword } = require("../src/utils/password");

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const TEMP_PASSWORD = "AkasaAmd2026!"; // shared temporary password — rotate immediately after import

const CODE_TO_ROLES = { B1: ["AME"], B2: ["AME"], CM: ["TECHNICIAN"], NCS: ["TECHNICIAN"], STO: ["STORE_KEEPER"] };

// Shift codes reference-ui's August roster actually uses that the platform
// doesn't already seed (M/A/N/O/L exist; these three don't) — added via
// upsert so re-running is a no-op once they exist.
const MISSING_SHIFT_DEFS = [
  { code: "G", name: "General", startTime: "09:00", endTime: "17:00", breakMin: 60, type: "duty" },
  { code: "G2", name: "General-2", startTime: "08:00", endTime: "16:00", breakMin: 60, type: "duty" },
  { code: "SOD", name: "Staff on Duty", startTime: null, endTime: null, breakMin: 0, type: "other" },
  { code: "PNQ", name: "Deputation PNQ", startTime: null, endTime: null, breakMin: 0, type: "other" },
];

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

// Exactly reference-ui's initQuals(): a DGCA licence + type rating for
// B1/B2/CM, a medical certificate for B1/B2 only, and non-blocking Fire &
// Emergency training for everyone. License and Qualification both block
// roster generation when expired (see complianceService.getComplianceSummary);
// Training never does — same blocking shape as blockOnExpiry in reference.
//
// Two of reference-ui's own hardcoded expiry dates (Type Rating 2026-07-30,
// Fire training 2026-08-15) are already in the past as of this migration —
// its own data comments the Type Rating "Due for renewal". Per explicit
// decision, those two are pushed forward one year on import (issued dates
// left as-is) so newly-imported staff aren't immediately blocked; every
// other date is reference-ui's real value, unchanged.
function qualificationPlanFor(employeeId, category) {
  const plan = { licenses: [], qualifications: [], trainings: [] };
  if (["B1", "B2", "CM"].includes(category)) {
    plan.licenses.push({
      licenseNo: `AME/${category}/${employeeId}`, category,
      issuingAuthority: "DGCA India",
      issuedDate: "2023-01-01", expiryDate: "2027-12-31",
    });
    plan.qualifications.push({
      qualCode: "B737 NG/MAX Type Rating",
      description: `TR/B737/${employeeId} — issued by IndiGo TRG Dept`,
      issuedDate: "2024-01-15", expiryDate: "2027-07-30", // reference-ui: 2026-07-30, pushed +1y so import isn't immediately blocked
    });
  }
  if (["B1", "B2"].includes(category)) {
    plan.qualifications.push({
      qualCode: "DGCA Medical Certificate (Class 2)",
      description: `MED/2/${employeeId} — issued by DGCA Authorised AME`,
      issuedDate: "2025-12-01", expiryDate: "2026-11-30",
    });
  }
  plan.trainings.push({
    courseName: "Fire & Emergency Procedures",
    provider: "Akasa Air Training",
    completedDate: "2025-06-01", validUntil: "2027-08-15", // reference-ui: 2026-08-15, pushed +1y for the same reason
  });
  return plan;
}

function rolesFor(row) {
  const roles = new Set(CODE_TO_ROLES[row.category] || ["TECHNICIAN"]);
  if ((row.designation || "").toUpperCase().includes("STN I/C")) roles.add("LMM");
  return [...roles];
}

function printSummary() {
  const withRoster = data.staff.filter(s => s.hasRosterMatch);
  const withoutRoster = data.staff.filter(s => !s.hasRosterMatch);
  const byCategory = {};
  for (const s of data.staff) byCategory[s.category] = (byCategory[s.category] || 0) + 1;

  console.log("=".repeat(78));
  console.log("AMD REAL-DATA MIGRATION — SUMMARY");
  console.log("=".repeat(78));
  console.log(`Source: ${data.source}`);
  console.log(`Roster month to import: ${data.rosterMonthLabel} (${data.rosterMonthKey})`);
  console.log();
  console.log(`Staff to create/update: ${data.staff.length}`);
  console.log(`  By category: ${Object.entries(byCategory).map(([c, n]) => `${c}:${n}`).join("  ")}`);
  console.log(`  With ${data.rosterMonthLabel} shift data to import: ${withRoster.length}`);
  console.log(`  On the email list but with NO shift history in reference-ui (July or Aug): ${withoutRoster.length}`);
  for (const s of withoutRoster) console.log(`    - ${s.fullName} (${s.employeeId}, ${s.category}, category derived from designation "${s.designation}")`);
  console.log();
  console.log(`Staff list (name | employee ID | email | category | designation):`);
  for (const s of data.staff) {
    console.log(`  ${s.fullName.padEnd(30)} ${s.employeeId}  ${s.email.padEnd(32)} ${s.category.padEnd(3)} ${s.designation}`);
  }
  console.log();
  console.log(`Real ${data.rosterMonthLabel} roster staff SKIPPED (no email supplied — cannot create a login): ${data.skippedNoEmail.length}`);
  for (const s of data.skippedNoEmail) console.log(`  - ${s.name} (employee ID ${s.employeeId}, ${s.category}, ${s.designation}) — their ${data.rosterMonthLabel} shifts will NOT be imported`);
  console.log();
  console.log(`Shift definitions to add (used in the real roster, not already seeded): ${MISSING_SHIFT_DEFS.map(d => d.code).join(", ")}`);
  console.log();
  console.log(`Qualifications/licenses/training to generate per reference-ui's own initQuals() logic:`);
  console.log(`  - B1/B2/CM: DGCA AME Licence (expires 2027-12-31) + B737 NG/MAX Type Rating (expires 2027-07-30)`);
  console.log(`  - B1/B2 only, additionally: DGCA Medical Certificate Class 2 (expires 2026-11-30)`);
  console.log(`  - Everyone: Fire & Emergency Procedures training (valid until 2027-08-15, non-blocking)`);
  console.log(`  ⚠ reference-ui's own hardcoded dates for the Type Rating (2026-07-30) and Fire training`);
  console.log(`    (2026-08-15) are already in the past as of today — its own data comments the Type`);
  console.log(`    Rating "Due for renewal". Per explicit decision, both are pushed forward one year on`);
  console.log(`    import (shown above) so newly-imported B1/B2/CM staff aren't immediately BLOCKED from`);
  console.log(`    auto-roster generation. Every other date is reference-ui's real value, unchanged.`);
  console.log();
  console.log(`Temporary shared login password for all imported accounts: ${TEMP_PASSWORD}`);
  console.log(`  (rotate this immediately after distributing real credentials)`);
  console.log("=".repeat(78));
  if (!APPLY) {
    console.log("DRY RUN — nothing was written. Re-run with --apply to actually import.");
  }
}

async function apply() {
  const station = await prisma.station.findFirst({ where: { iataCode: "AMD" } });
  if (!station) throw new Error("No AMD station found — seed stations first.");

  const roleRows = await prisma.role.findMany();
  const roleIdByName = Object.fromEntries(roleRows.map(r => [r.name, r.id]));

  console.log(`\nImporting into station: ${station.name} (${station.id})\n`);

  // 1. Shift definitions the real roster uses that aren't already seeded.
  for (const def of MISSING_SHIFT_DEFS) {
    await prisma.shiftDefinition.upsert({
      where: { code: def.code },
      update: {},
      create: { code: def.code, name: def.name, startTime: def.startTime, endTime: def.endTime, breakMin: def.breakMin, type: def.type, isActive: true },
    });
  }
  console.log(`Shift definitions ensured: ${MISSING_SHIFT_DEFS.map(d => d.code).join(", ")}`);

  const passwordHash = await hashPassword(TEMP_PASSWORD);
  const userIdByEmployeeId = {};
  let usersCreated = 0, usersUpdated = 0;

  // 2. Staff.
  for (const row of data.staff) {
    const existing = await prisma.user.findUnique({ where: { email: row.email } });
    const userData = {
      airlineId: station.airlineId, stationId: station.id,
      employeeId: row.employeeId, fullName: row.fullName, email: row.email,
      category: row.category, designation: row.designation, department: row.department,
      isEmailVerified: true, isActive: true,
    };
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: userData })
      : await prisma.user.create({ data: { ...userData, passwordHash } });
    if (existing) usersUpdated++; else usersCreated++;
    userIdByEmployeeId[row.employeeId] = user.id;

    for (const roleName of rolesFor(row)) {
      const roleId = roleIdByName[roleName];
      if (!roleId) continue;
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {}, create: { userId: user.id, roleId },
      });
    }
  }
  console.log(`Staff: ${usersCreated} created, ${usersUpdated} updated.`);

  // 3. Qualifications / licenses / training — skip if an equivalent record
  // already exists for that user, so --apply is safe to re-run.
  let qualsCreated = 0, licensesCreated = 0, trainingsCreated = 0;
  for (const row of data.staff) {
    const userId = userIdByEmployeeId[row.employeeId];
    const plan = qualificationPlanFor(row.employeeId, row.category);

    for (const lic of plan.licenses) {
      const dup = await prisma.license.findFirst({ where: { userId, licenseNo: lic.licenseNo, deletedAt: null } });
      if (dup) continue;
      await prisma.license.create({ data: { userId, ...lic, issuedDate: new Date(lic.issuedDate), expiryDate: new Date(lic.expiryDate) } });
      licensesCreated++;
    }
    for (const q of plan.qualifications) {
      const dup = await prisma.qualification.findFirst({ where: { userId, qualCode: q.qualCode, deletedAt: null } });
      if (dup) continue;
      const expiryDate = new Date(q.expiryDate);
      const status = expiryDate < new Date() ? "EXPIRED" : "VALID";
      await prisma.qualification.create({ data: { userId, qualCode: q.qualCode, description: q.description, issuedDate: new Date(q.issuedDate), expiryDate, status } });
      qualsCreated++;
    }
    for (const t of plan.trainings) {
      const dup = await prisma.training.findFirst({ where: { userId, courseName: t.courseName, deletedAt: null } });
      if (dup) continue;
      await prisma.training.create({ data: { userId, courseName: t.courseName, provider: t.provider, completedDate: new Date(t.completedDate), validUntil: t.validUntil ? new Date(t.validUntil) : null } });
      trainingsCreated++;
    }
  }
  console.log(`Qualifications: ${qualsCreated} created. Licenses: ${licensesCreated} created. Trainings: ${trainingsCreated} created.`);

  // 4. The August 2026 roster, for staff with real shift data.
  const monthKey = data.rosterMonthKey;
  const nDays = daysInMonth(monthKey);
  let roster = await prisma.roster.findFirst({ where: { stationId: station.id, monthKey, deletedAt: null } });
  if (!roster) roster = await prisma.roster.create({ data: { stationId: station.id, monthKey } });

  const shiftDefs = await prisma.shiftDefinition.findMany();
  const shiftDefIdByCode = Object.fromEntries(shiftDefs.map(d => [d.code, d.id]));

  let assignmentsCreated = 0, assignmentsSkippedUnknownCode = new Set();
  const withRoster = data.staff.filter(s => s.hasRosterMatch);
  for (const row of withRoster) {
    const userId = userIdByEmployeeId[row.employeeId];
    for (let day = 1; day <= nDays; day++) {
      const code = row.shifts[day - 1];
      const shiftDefId = shiftDefIdByCode[code];
      if (!shiftDefId) { assignmentsSkippedUnknownCode.add(code); continue; }
      await prisma.shiftAssignment.upsert({
        where: { rosterId_userId_shiftDate: { rosterId: roster.id, userId, shiftDate: dateAt(monthKey, day) } },
        update: { shiftDefId },
        create: { rosterId: roster.id, userId, shiftDate: dateAt(monthKey, day), shiftDefId },
      });
      assignmentsCreated++;
    }
  }
  console.log(`Roster (${monthKey}): ${assignmentsCreated} shift assignments upserted for ${withRoster.length} staff.`);
  if (assignmentsSkippedUnknownCode.size) console.log(`  Unrecognized codes skipped: ${[...assignmentsSkippedUnknownCode].join(", ")}`);

  console.log(`\nSkipped (no email, not imported): ${data.skippedNoEmail.length} real staff — ${data.skippedNoEmail.map(s => s.name).join(", ")}`);
  console.log("\nDone.");
}

async function main() {
  printSummary();
  if (APPLY) await apply();
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
