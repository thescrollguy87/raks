import { useCallback, useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 600;
// Flush immediately (skip the debounce wait) once this many jobs are
// queued — a burst of edits shouldn't sit around waiting the full
// debounce window just because more kept arriving.
const IMMEDIATE_FLUSH_SIZE = 20;

// A resilience/status layer over a page's own save calls — NOT a merger of
// different network requests into one. Each enqueued job still runs its
// own `run()` (a single-cell edit keeps its own PATCH, with its own
// reason/audit-trail entry; a paste/cut/clear's bulk write is already one
// job covering many cells via the existing bulk endpoint). What this hook
// adds: the caller can apply its change to local state and enqueue the
// save without blocking the UI on the network round-trip (optimistic),
// rapid-fire edits collapse into one flush cycle instead of firing the
// instant each key is pressed, a failed job stays queued (never silently
// dropped) until retried, and there's one shared status indicator instead
// of each call site managing its own loading/error state.
export function usePendingSaveQueue() {
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [pendingCount, setPendingCount] = useState(0);
  const jobsRef = useRef(new Map());
  const failedRef = useRef(new Map());
  const timerRef = useRef(null);
  const flushingRef = useRef(false);

  const updateCounts = useCallback(() => {
    setPendingCount(jobsRef.current.size + failedRef.current.size);
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (flushingRef.current || jobsRef.current.size === 0) return;
    flushingRef.current = true;
    setStatus("saving");

    const jobs = [...jobsRef.current.entries()];
    jobsRef.current.clear();
    updateCounts();

    let anyFailure = false;
    for (const [id, job] of jobs) {
      try {
        await job.run();
      } catch (err) {
        anyFailure = true;
        failedRef.current.set(id, job);
      }
    }
    updateCounts();
    flushingRef.current = false;
    setStatus(anyFailure ? "error" : "saved");

    // Edits that arrived WHILE this flush was in flight are already queued
    // for the next cycle via their own debounce timer — nothing to do here.
  }, [updateCounts]);

  // id de-dupes: a second edit to the SAME cell before the first flush
  // replaces the pending job rather than queuing both (the newer value is
  // simply what should actually be saved).
  const enqueue = useCallback((id, run) => {
    jobsRef.current.set(id, { run });
    failedRef.current.delete(id);
    updateCounts();
    if (jobsRef.current.size >= IMMEDIATE_FLUSH_SIZE) {
      flush();
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush, updateCounts]);

  const retry = useCallback(() => {
    for (const [id, job] of failedRef.current) jobsRef.current.set(id, job);
    failedRef.current.clear();
    updateCounts();
    flush();
  }, [flush, updateCounts]);

  // Warn on reload/close whenever anything hasn't made it to the server
  // yet — still queued, mid-flush, or stuck in the failed/retry state.
  useEffect(() => {
    function onBeforeUnload(e) {
      if (jobsRef.current.size > 0 || failedRef.current.size > 0 || flushingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { status, pendingCount, enqueue, retry };
}
