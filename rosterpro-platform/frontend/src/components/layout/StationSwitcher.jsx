import { useStation } from "../../store/StationContext.jsx";

export default function StationSwitcher() {
  const { stationId, stations, needsSwitcher, selectStation } = useStation();
  if (!needsSwitcher || stations.length === 0) return null;

  return (
    <select
      className="fi" style={{ width: 160, fontSize: 10 }}
      value={stationId || ""} onChange={(e) => selectStation(e.target.value)}
    >
      {stations.map(s => <option key={s.id} value={s.id}>{s.iataCode} — {s.name}</option>)}
    </select>
  );
}
