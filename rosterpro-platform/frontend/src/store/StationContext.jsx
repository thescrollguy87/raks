import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "../api/client.js";

const STORAGE_KEY = "rp_selected_station_id";
const StationContext = createContext(null);

// Most roles (Station Manager, LMM, Shift Engineer, AME, Technician, Store
// Keeper) are scoped to exactly one station — their JWT already carries
// `stationId`, so there's nothing to choose and no API call needed. Only
// airline-level roles (Super Admin, Airline Admin) aren't scoped to a
// single station and need an actual switcher; those roles are also the
// only ones with the `station:read` permission the /api/stations endpoint
// requires, so this component never calls an endpoint a signed-in user
// can't reach.
export function StationProvider({ children }) {
  const { claims, user, isAuthenticated } = useAuth();
  const [stations, setStations] = useState([]);
  const [selectedStationId, setSelectedStationId] = useState(null);
  const [loading, setLoading] = useState(true);

  const needsSwitcher = isAuthenticated && !claims?.stationId;

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }

    if (claims?.stationId) {
      // Station-scoped user — done, no fetch needed.
      setSelectedStationId(claims.stationId);
      setLoading(false);
      return;
    }

    // Airline-level user — fetch the list, restore a prior choice if valid.
    setLoading(true);
    api.get("/api/stations").then(list => {
      setStations(list);
      const stored = localStorage.getItem(STORAGE_KEY);
      const valid = list.find(s => s.id === stored);
      setSelectedStationId(valid ? stored : list[0]?.id || null);
    }).finally(() => setLoading(false));
  }, [isAuthenticated, claims?.stationId]);

  const selectStation = useCallback((id) => {
    setSelectedStationId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  // Display info for whichever station is "current" — the user's own
  // station for a station-scoped role (from their login payload, since most
  // of those roles can't call GET /api/stations to look it up themselves),
  // or whichever one an airline-wide user has selected in the switcher.
  const currentStation = useMemo(() => {
    if (claims?.stationId) return user?.station || null;
    return stations.find(s => s.id === selectedStationId) || null;
  }, [claims?.stationId, user?.station, stations, selectedStationId]);

  const value = useMemo(() => ({
    stationId: selectedStationId, stations, needsSwitcher, loading, selectStation, currentStation,
  }), [selectedStationId, stations, needsSwitcher, loading, selectStation, currentStation]);

  return <StationContext.Provider value={value}>{children}</StationContext.Provider>;
}

export function useStation() {
  const ctx = useContext(StationContext);
  if (!ctx) throw new Error("useStation must be used within a StationProvider");
  return ctx;
}
