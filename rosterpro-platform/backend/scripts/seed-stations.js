// Seeds the starting list of Indian airport stations under the existing
// airline. Idempotent (upsert by [airlineId, iataCode], the schema's
// existing unique constraint) and additive-only — never updates or removes
// a station that already exists, so re-running this after AMD (or any
// other station) has real staff/roster data attached is always safe.
//
// This is a deliberately curated starting list, not a generated one — see
// the conversation that asked for it before adding to or trimming it.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const STATIONS = [
  { iataCode: "DEL", name: "Delhi" },
  { iataCode: "BOM", name: "Mumbai" },
  { iataCode: "BLR", name: "Bengaluru" },
  { iataCode: "MAA", name: "Chennai" },
  { iataCode: "CCU", name: "Kolkata" },
  { iataCode: "HYD", name: "Hyderabad" },
  { iataCode: "AMD", name: "Ahmedabad" },
  { iataCode: "COK", name: "Kochi" },
  { iataCode: "PNQ", name: "Pune" },
  { iataCode: "GOI", name: "Goa (Dabolim)" },
  { iataCode: "JAI", name: "Jaipur" },
  { iataCode: "LKO", name: "Lucknow" },
  { iataCode: "IXC", name: "Chandigarh" },
  { iataCode: "GAU", name: "Guwahati" },
  { iataCode: "PAT", name: "Patna" },
  { iataCode: "BBI", name: "Bhubaneswar" },
  { iataCode: "NAG", name: "Nagpur" },
  { iataCode: "IXB", name: "Bagdogra" },
  { iataCode: "VNS", name: "Varanasi" },
  { iataCode: "IDR", name: "Indore" },
  { iataCode: "ATQ", name: "Amritsar" },
  { iataCode: "TRV", name: "Thiruvananthapuram" },
  { iataCode: "IXR", name: "Ranchi" },
  { iataCode: "RPR", name: "Raipur" },
  { iataCode: "STV", name: "Surat" },
  { iataCode: "VTZ", name: "Visakhapatnam" },
  { iataCode: "IXE", name: "Mangalore" },
  { iataCode: "CJB", name: "Coimbatore" },
  { iataCode: "BDQ", name: "Vadodara" },
  { iataCode: "DED", name: "Dehradun" },
];

async function main() {
  const airline = await prisma.airline.findFirst();
  if (!airline) {
    console.error("No airline exists yet — nothing to seed stations under. Run the admin/default-station bootstrap first.");
    process.exit(1);
  }

  let created = 0, skipped = 0;
  for (const s of STATIONS) {
    const existing = await prisma.station.findUnique({
      where: { airlineId_iataCode: { airlineId: airline.id, iataCode: s.iataCode } },
    });
    if (existing) { skipped++; continue; }
    await prisma.station.create({ data: { airlineId: airline.id, iataCode: s.iataCode, name: s.name } });
    created++;
    console.log(`Created station: ${s.iataCode} — ${s.name}`);
  }
  console.log(`Done. ${created} created, ${skipped} already existed (untouched).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
