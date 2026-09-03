const ApiError = require("./ApiError");
const stationRepo = require("../repositories/stationRepository");

// SUPER_ADMIN is the ONLY role that legitimately crosses tenant (airline)
// boundaries — the platform owner. Never provisioned by self-signup: there
// is no public registration endpoint in this app (see authRoutes.js), and
// granting it to someone else requires already being SUPER_ADMIN yourself
// (see userService.assignRoles's escalation guard).
function isSuperAdmin(actor) {
  return !!actor.roles?.includes("SUPER_ADMIN");
}

// AIRLINE_ADMIN sees every station WITHIN THEIR OWN AIRLINE; everyone else
// (STATION_MANAGER, LMM, SHIFT_INCHARGE, AME, TECHNICIAN, STORE_KEEPER,
// READ_ONLY_AUDITOR, ...) is scoped to exactly the one station on their own
// token. This flag alone does NOT mean "skip the ownership check" — see
// assertOwnStation below, which is the actual security boundary. It's kept
// as its own export because call sites like userController.list/
// stationController.list use it purely to decide "show me one station's
// worth of data or every station I can legitimately see" — a query-shaping
// decision, not itself an authorization decision.
function isAirlineWide(actor) {
  return isSuperAdmin(actor) || !!actor.roles?.includes("AIRLINE_ADMIN");
}

// THE tenant-isolation boundary. Every station-scoped read or write in this
// app that resolves a stationId — whether it's a route param/query/body
// value up front, or a station belonging to some other record (a leave
// request's owner, a tool, a flight) — must pass its target through here
// before doing anything with it.
//
// - SUPER_ADMIN: always allowed (the one legitimate cross-airline role).
// - A plain station-scoped actor (not airline-wide): must be their own
//   exact station.
// - AIRLINE_ADMIN: airline-wide within their OWN airline only. This used to
//   be treated the same as SUPER_ADMIN and skip the check entirely — that
//   was the core multi-tenancy hole this function exists to close. An
//   AIRLINE_ADMIN's claimed target station is now always resolved from the
//   database and its REAL airlineId compared against the actor's — a
//   station belonging to a different airline is rejected exactly like one
//   that doesn't exist.
//
// Every mismatch — including "no such station" and "wrong airline" — comes
// back as 404, never 403: a 403 would itself leak that the ID is real, just
// off-limits, which is precisely the kind of cross-tenant existence leak
// this function is meant to prevent.
async function assertOwnStation(actor, targetStationId) {
  if (isSuperAdmin(actor)) return;
  if (!targetStationId) throw ApiError.notFound("Station not found");

  if (!actor.roles?.includes("AIRLINE_ADMIN")) {
    if (targetStationId !== actor.stationId) throw ApiError.notFound("Station not found");
    return;
  }

  const station = await stationRepo.findStationAirlineId(targetStationId);
  if (!station || station.airlineId !== actor.airlineId) {
    throw ApiError.notFound("Station not found");
  }
}

// Express middleware form of assertOwnStation, for routes where the
// requested stationId IS a route param/query/body value up front
// (dashboard/:stationId, ?stationId=... on roster/reports, stationId in a
// create-tool/create-flight body). Rejects before the controller/service
// even runs, rather than fetching data for a station the caller has no
// business seeing and filtering it out after.
function requireOwnStation(source) {
  return async function (req, res, next) {
    try {
      const stationId = source
        ? req[source]?.stationId
        : req.params?.stationId || req.query?.stationId || req.body?.stationId;
      await assertOwnStation(req.user, stationId);
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Same boundary as assertOwnStation, for the rarer records that carry an
// airlineId directly instead of (or in addition to) a stationId — Flight,
// Aircraft. A client-supplied airlineId must NEVER be trusted at face
// value: this is what stops an actor from writing a record that claims to
// belong to a different airline than the one they're actually scoped to.
function assertOwnAirline(actor, targetAirlineId) {
  if (isSuperAdmin(actor)) return;
  if (!targetAirlineId || targetAirlineId !== actor.airlineId) {
    throw ApiError.notFound("Airline not found");
  }
}

// For a list endpoint that's internally unscoped (an "every station"
// query with no natural single stationId to check) but must still come
// back station-scoped for anyone but SUPER_ADMIN — audit trail/activity,
// expiring qualifications/licenses, leave lists, anything that used to
// mean "give me everything" whenever an airline-wide caller simply didn't
// name a station. Returns { stationId, stationIdIn } for the repository to
// turn into a real WHERE clause — pass a specific stationId through
// unfiltered ({stationId} only) once it's been verified; the "no specific
// station named" case resolves to every station belonging to the ACTOR'S
// OWN airline ({stationIdIn}), a genuine DB-level filter, never "no
// filter at all" (that was the actual hole: an unfiltered query used to
// mean "every station on the whole platform," not "every station I'm
// allowed to see").
async function resolveStationScope(actor, requestedStationId) {
  if (isSuperAdmin(actor)) return { stationId: requestedStationId || undefined, stationIdIn: undefined };
  if (!isAirlineWide(actor)) return { stationId: actor.stationId, stationIdIn: undefined };
  if (requestedStationId) {
    await assertOwnStation(actor, requestedStationId);
    return { stationId: requestedStationId, stationIdIn: undefined };
  }
  const stations = await stationRepo.listStations({ airlineId: actor.airlineId, isSuperAdmin: false });
  return { stationId: undefined, stationIdIn: stations.map(s => s.id) };
}

// Resolves the airlineId a station-scoped read/write should actually use.
// Never trust actor.airlineId at face value for this: SUPER_ADMIN's JWT
// deliberately carries no airlineId (see isSuperAdmin above — the platform
// owner isn't tied to one tenant), so any airline-scoped reference data
// (shift definitions, roster generation, imports, departure allocation)
// only has meaning once resolved against whichever station's airline the
// request actually names. Everyone else's actor.airlineId is already the
// authoritative answer regardless of stationId (fixed once at login, and
// never valid for more than their own airline), so the lookup is skipped
// for them — same "isSuperAdmin only" gate as assertOwnStation.
async function resolveAirlineId(actor, stationId) {
  if (!isSuperAdmin(actor)) return actor.airlineId;
  if (!stationId) throw ApiError.badRequest("stationId is required");
  const station = await stationRepo.findStationAirlineId(stationId);
  if (!station) throw ApiError.notFound("Station not found");
  return station.airlineId;
}

module.exports = { isSuperAdmin, isAirlineWide, assertOwnStation, requireOwnStation, assertOwnAirline, resolveStationScope, resolveAirlineId };
