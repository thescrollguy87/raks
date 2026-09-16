import { useState, useEffect, useCallback, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { useCamera } from "../hooks/useCamera.js";
import { usePunchQueue } from "../hooks/usePunchQueue.js";
import { nearestLocation, isMobileDevice } from "../utils/geo.js";
import * as attendanceApi from "../api/attendance.js";

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

// The mobile-only punch screen. Two hard requirements drive everything
// here: (1) never require a live connection at the exact moment of
// punching — GPS + photo are captured into a local queue instantly, synced
// whenever connectivity returns (see usePunchQueue) — and (2) show the
// person their distance to the nearest configured location BEFORE they
// attempt a punch, not only as a failure after the fact.
export default function PunchPage() {
  const { currentStation } = useStation();
  const { getPosition } = useGeolocation();
  const camera = useCamera();
  const queue = usePunchQueue();

  const [allowed] = useState(() => isMobileDevice());
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  // Optimistic local echo of a just-queued punch — the server-fetched ctx
  // won't reflect it until the queue actually syncs, and offline that could
  // be hours away, so the UI shouldn't sit there looking like nothing happened.
  const [localPunch, setLocalPunch] = useState({ in: null, out: null });

  usePageHeader({ title: "Punch In / Out", subtitle: currentStation ? `${currentStation.name} Line Maintenance` : "" });

  const loadContext = useCallback(() => {
    attendanceApi.getToday().then(setCtx).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { if (allowed) loadContext(); }, [allowed, loadContext]);
  useEffect(() => { if (allowed) camera.start(); return () => camera.stop(); }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshLocation = useCallback(async () => {
    setLocating(true);
    setError("");
    try {
      const pos = await getPosition();
      setPosition(pos);
    } catch (err) {
      setError(err.message);
    } finally {
      setLocating(false);
    }
  }, [getPosition]);

  useEffect(() => { if (allowed) refreshLocation(); }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearest = useMemo(() => (
    position && ctx?.officeLocations ? nearestLocation(position.lat, position.lng, ctx.officeLocations) : null
  ), [position, ctx]);

  const withinRange = nearest ? nearest.distanceM <= nearest.location.radiusMeters : false;

  async function doPunch(kind) {
    setError("");
    setBusy(true);
    try {
      const pos = await getPosition(); // always a fresh reading right at the moment of the tap, not the last-displayed one
      setPosition(pos);
      const photoBase64 = camera.capture();
      const payload = {
        lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy,
        capturedAt: new Date().toISOString(),
        photoBase64,
      };
      await queue.enqueue(kind, payload);
      setLocalPunch((p) => ({ ...p, [kind === "punch-in" ? "in" : "out"]: payload.capturedAt }));
      loadContext();
    } catch (err) {
      setError(err.message || "Couldn't capture the punch");
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📵</div>
        <div className="card-title" style={{ justifyContent: "center" }}>Mobile Only</div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
          Punch In/Out is only available from a phone — it needs your device's real GPS and camera, which desktop
          and tablet browsers can't reliably provide. Open this page on your phone to punch in or out.
        </p>
      </div>
    );
  }

  if (!ctx) {
    return <div className="card" style={{ maxWidth: 480, margin: "20px auto" }}>{error || "Loading…"}</div>;
  }

  const hasPunchedIn = !!ctx.record?.punchInAt || !!localPunch.in;
  const hasPunchedOut = !!ctx.record?.punchOutAt || !!localPunch.out;

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div className="card">
        <div className="card-title">Today — {ctx.date}</div>
        {ctx.exempt ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Your roster shows <strong>{ctx.scheduledShift?.code || "a non-duty day"}</strong> today — no punch is required.
          </div>
        ) : ctx.scheduledShift ? (
          <div style={{ fontSize: 12 }}>
            Scheduled: <strong>{ctx.scheduledShift.code}</strong> ({ctx.scheduledShift.startTime}–{ctx.scheduledShift.endTime})
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>No shift scheduled today.</div>
        )}
      </div>

      {(queue.pendingCount > 0 || queue.syncing || queue.lastError) && (
        <div className="card" style={{ background: queue.pendingCount > 0 ? "rgba(217,119,6,.08)" : undefined }}>
          <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            {queue.syncing ? "🔄 Syncing…" : queue.pendingCount > 0 ? `⏳ ${queue.pendingCount} punch(es) saved on this device, waiting to sync` : "✅ All synced"}
          </div>
          {queue.lastError && <div style={{ fontSize: 11, color: "var(--rp-red)", marginTop: 4 }}>{queue.lastError}</div>}
          {queue.pendingCount > 0 && !queue.syncing && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={queue.sync}>Retry sync now</button>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">Your Location</div>
        {position ? (
          nearest ? (
            <div style={{ fontSize: 13, fontWeight: 700, color: withinRange ? "var(--rp-green)" : "var(--rp-red)" }}>
              {Math.round(nearest.distanceM)}m from {nearest.location.name} {withinRange ? "— within range ✓" : `(needs to be within ${nearest.location.radiusMeters}m)`}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--rp-red)" }}>No office locations configured for your station.</div>
          )
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{locating ? "Getting your location…" : "Location not available yet."}</div>
        )}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={refreshLocation} disabled={locating}>
          {locating ? "Locating…" : "🔄 Refresh location"}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Camera</div>
        <video ref={camera.videoRef} muted playsInline style={{ width: "100%", borderRadius: 10, background: "#000", transform: "scaleX(-1)" }} />
        {camera.error && <div style={{ fontSize: 11, color: "var(--rp-red)", marginTop: 6 }}>{camera.error}</div>}
      </div>

      {error && <div className="ab red">{error}</div>}

      <div className="card" style={{ textAlign: "center" }}>
        {!hasPunchedIn ? (
          <button className="btn btn-primary" style={{ width: "100%", padding: 16, fontSize: 15 }} disabled={busy || !camera.active} onClick={() => doPunch("punch-in")}>
            {busy ? "Capturing…" : "🟢 Punch In"}
          </button>
        ) : !hasPunchedOut ? (
          <>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
              Punched in at {fmtTime(ctx.record?.punchInAt || localPunch.in)}
            </div>
            <button className="btn btn-primary" style={{ width: "100%", padding: 16, fontSize: 15, background: "linear-gradient(135deg,#DC2626,#EF4444)" }} disabled={busy || !camera.active} onClick={() => doPunch("punch-out")}>
              {busy ? "Capturing…" : "🔴 Punch Out"}
            </button>
          </>
        ) : (
          <div style={{ fontSize: 13 }}>
            ✅ Done for today — {fmtTime(ctx.record?.punchInAt || localPunch.in)} → {fmtTime(ctx.record?.punchOutAt || localPunch.out)}
          </div>
        )}
      </div>
    </div>
  );
}
