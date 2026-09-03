// One-off backfill for tenants that existed before subscription billing was
// added — every airline needs exactly one AirlineBilling row (the read-only
// gate in middleware/billingGate.js fails OPEN when a row is missing, so
// this isn't strictly required for the app to keep working, but every
// tenant should actually be on the metered plan going forward).
//
// DECISION (flagged explicitly, since this affects real revenue and is a
// business call, not a technical one): every pre-existing tenant — Demo
// Airlines locally, Akasa Air in production — is bootstrapped with a FRESH
// 2-month trial starting from whenever this script runs, identical to a
// brand-new tenant. No special-casing, no immediate charge, no grandfathered
// "active" status with no card on file (which the billing state machine
// doesn't have a defined path for anyway — see billingService.js). If Akasa
// should instead be comped, discounted, or billed retroactively, that's a
// deliberate follow-up action, not something this script should decide.
//
// Safe to re-run: skips any airline that already has a billing row.
//
// Run with: npm run backfill-billing
const { PrismaClient } = require("@prisma/client");
const billingService = require("../src/services/billingService");
const prisma = new PrismaClient();

async function main() {
  const airlines = await prisma.airline.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, billing: { select: { id: true } } },
  });

  let created = 0, skipped = 0;
  for (const airline of airlines) {
    if (airline.billing) { skipped++; continue; }
    await billingService.startTrial(airline.id, null);
    created++;
    console.log(`Started trial billing for "${airline.name}"`);
  }
  console.log(`Done — ${created} airline(s) started on a fresh trial, ${skipped} already had a billing record.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
