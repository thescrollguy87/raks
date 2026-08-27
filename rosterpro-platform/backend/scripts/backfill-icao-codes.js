// One-time enrichment for the 30 stations seed-stations.js already
// created: fills in each station's ICAO code so Employee Master import
// can match a Location cell against IATA code, ICAO code, or name (see
// staffImportService.js). Additive-only, like seed-stations.js — only
// fills a station whose icaoCode is currently null, never overwrites one
// that's already set (e.g. by hand, if one of these turns out wrong).
//
// Run with: node scripts/backfill-icao-codes.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Keyed by IATA code, matching STATIONS in seed-stations.js.
const ICAO_BY_IATA = {
  DEL: "VIDP", BOM: "VABB", BLR: "VOBL", MAA: "VOMM", CCU: "VECC",
  HYD: "VOHS", AMD: "VAAH", COK: "VOCI", PNQ: "VAPO", GOI: "VOGO",
  JAI: "VIJP", LKO: "VILK", IXC: "VICG", GAU: "VEGT", PAT: "VEPT",
  BBI: "VEBS", NAG: "VANP", IXB: "VEBD", VNS: "VIBN", IDR: "VAID",
  ATQ: "VIAR", TRV: "VOTV", IXR: "VERC", RPR: "VARP", STV: "VASU",
  VTZ: "VEVZ", IXE: "VOML", CJB: "VOCB", BDQ: "VABO", DED: "VIDN",
};

async function main() {
  let updated = 0, skipped = 0, unknown = 0;
  const stations = await prisma.station.findMany();
  for (const station of stations) {
    if (station.icaoCode) { skipped++; continue; }
    const icao = ICAO_BY_IATA[station.iataCode];
    if (!icao) { unknown++; console.log(`No ICAO code on file for ${station.iataCode} (${station.name}) — left blank.`); continue; }
    await prisma.station.update({ where: { id: station.id }, data: { icaoCode: icao } });
    updated++;
  }
  console.log(`Done. ${updated} filled in, ${skipped} already had one, ${unknown} had no code on file.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
