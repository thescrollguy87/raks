import { useMemo, useState } from "react";
import { useStation } from "../../store/StationContext.jsx";
import { useAuth } from "../../store/AuthContext.jsx";
import AddStationModal from "../admin/AddStationModal.jsx";

// Replaces the old plain station-only dropdown. A SUPER_ADMIN's station
// list spans every tenant on the platform (see GET /api/stations), so a
// flat "IATA — Station Name" list gives no way to tell which airline
// you're about to switch into — this groups by airline first, with the
// airline's real name front and center, then narrows to a station within
// it. An AIRLINE_ADMIN's list is already just their own one airline, so
// the Airline dropdown collapses to a single (still labeled) option for
// them — same component, no special-casing needed.
export default function AirlineSwitcher() {
  const { stationId, stations, needsSwitcher, selectStation, reloadStations } = useStation();
  const { hasPermission } = useAuth();
  const [showAddStation, setShowAddStation] = useState(false);
  if (!needsSwitcher || stations.length === 0) return null;

  const airlines = useMemo(() => {
    const byId = new Map();
    stations.forEach(s => {
      if (!byId.has(s.airlineId)) byId.set(s.airlineId, { id: s.airlineId, name: s.airlineName || "Unnamed airline" });
    });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [stations]);

  const currentStationObj = stations.find(s => s.id === stationId);
  const currentAirlineId = currentStationObj?.airlineId || airlines[0]?.id;
  const currentAirlineName = airlines.find(a => a.id === currentAirlineId)?.name;
  const stationsInAirline = stations.filter(s => s.airlineId === currentAirlineId);
  const canAddStation = hasPermission("station", "create");

  function selectAirline(airlineId) {
    if (airlineId === currentAirlineId) return;
    const firstStation = stations.find(s => s.airlineId === airlineId);
    if (firstStation) selectStation(firstStation.id);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <div>
        <label style={{ display: "block", fontSize: 8.5, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 2 }}>
          Airline
        </label>
        <select
          className="fi" style={{ width: 170, fontSize: 11, fontWeight: 700 }}
          value={currentAirlineId || ""} onChange={(e) => selectAirline(e.target.value)}
        >
          {airlines.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label style={{ display: "block", fontSize: 8.5, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 2 }}>
          Station
        </label>
        <select
          className="fi" style={{ width: 170, fontSize: 10 }}
          value={stationId || ""} onChange={(e) => selectStation(e.target.value)}
        >
          {stationsInAirline.map(s => <option key={s.id} value={s.id}>{s.iataCode} — {s.name}</option>)}
        </select>
      </div>
      {canAddStation && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ width: 170, fontSize: 9.5 }}
          onClick={() => setShowAddStation(true)}
        >
          ＋ Add Station
        </button>
      )}
      {showAddStation && (
        <AddStationModal
          airlineName={currentAirlineName}
          onClose={() => setShowAddStation(false)}
          onCreated={(station) => reloadStations(station?.id)}
        />
      )}
    </div>
  );
}
