// One-time rebrand for the existing tenant: this deployment started as a
// single airline provisioned under a placeholder name ("Default Airline",
// from create-admin.js's genesis bootstrap, before it was updated to create
// "Akasa Air" directly — or "Demo Airlines" in a local/dev seed) and needs
// to actually read "Akasa Air" everywhere, since that's the real airline
// this deployment is for.
//
// Deliberately scoped to "there is exactly one airline in the whole
// database" rather than matching a specific old name — safe to run blindly
// against any environment: a single-tenant deployment gets renamed (a
// no-op if it's already "Akasa Air"), and the moment a second real tenant
// exists this becomes a no-op forever, so it can never rebrand the wrong
// airline once this platform is genuinely multi-tenant.
//
// Run with: node scripts/rename-default-airline.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const AKASA = { name: "Akasa Air", icaoCode: "AKJ", iataCode: "QP" };

async function main() {
  const airlines = await prisma.airline.findMany({ where: { deletedAt: null } });

  if (airlines.length === 0) {
    console.log("No airlines exist yet — nothing to rename.");
    return;
  }
  if (airlines.length > 1) {
    console.log(`${airlines.length} airlines already exist — this platform is multi-tenant now, so nothing was renamed automatically. Rename the intended one by hand (Tenants page, or PATCH /api/airlines/:id) if it still needs it.`);
    return;
  }

  const [airline] = airlines;
  if (airline.name === AKASA.name && airline.icaoCode === AKASA.icaoCode) {
    console.log("The one airline on this deployment is already Akasa Air — nothing to do.");
    return;
  }

  await prisma.airline.update({
    where: { id: airline.id },
    data: { name: AKASA.name, icaoCode: AKASA.icaoCode, iataCode: AKASA.iataCode, version: { increment: 1 } },
  });
  console.log(`Renamed "${airline.name}" (${airline.icaoCode}) -> "${AKASA.name}" (${AKASA.icaoCode}/${AKASA.iataCode}). Set its logo from the Tenants page (Edit) when you have the image.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
