import { useCallback, useEffect, useRef, useState } from "react";
import { addPunch, listPunches, removePunch } from "../utils/punchDb.js";
import * as attendanceApi from "../api/attendance.js";

// THE fix for punches failing in poor hangar connectivity (the direct
// cause of "network issue" regularization requests): capture happens into
// IndexedDB the instant the button is tapped, before any network attempt
// at all, so a punch is never lost to a bad connection — only ever
// re-sent, in order, once connectivity comes back. The payload's own
// capturedAt (the device's clock at the moment of the tap) travels through
// completely unchanged; nothing here ever substitutes the sync time for it.
export function usePunchQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState("");
  const syncingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    const items = await listPunches();
    setPendingCount(items.length);
    return items;
  }, []);

  const sync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    setLastError("");
    try {
      const items = await listPunches();
      for (const item of items) {
        try {
          if (item.kind === "punch-in") await attendanceApi.punchIn(item.payload);
          else await attendanceApi.punchOut(item.payload);
          await removePunch(item.localId);
        } catch (err) {
          // A real server rejection (bad distance, suspected mock location,
          // already punched) will never succeed by simply waiting and
          // retrying the exact same captured reading — surface it and drop
          // it, rather than getting stuck retrying it forever. Only a
          // genuine network-level failure (no `status` at all) keeps the
          // item queued for the next connectivity window.
          if (err.status) {
            setLastError(err.message);
            await removePunch(item.localId);
            continue;
          }
          setLastError("Still offline — this punch is saved on your device and will sync automatically.");
          break;
        }
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      refreshCount();
    }
  }, [refreshCount]);

  const enqueue = useCallback(async (kind, payload) => {
    const localId = `${kind}-${payload.capturedAt}-${Math.random().toString(36).slice(2, 8)}`;
    await addPunch({ localId, kind, payload, queuedAt: Date.now() });
    await refreshCount();
    sync(); // try immediately in case connectivity is actually fine — the common case shouldn't feel "queued"
  }, [refreshCount, sync]);

  useEffect(() => {
    refreshCount();
    sync();
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync, refreshCount]);

  return { pendingCount, syncing, lastError, enqueue, sync };
}
