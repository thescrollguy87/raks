// Plain IndexedDB, not a library — this is a single key-value queue with
// maybe a handful of rows at once, well within what the native API handles
// comfortably without needing idb/Dexie as a dependency. Deliberately NOT
// built on the service worker's Background Sync API (registration.sync) —
// that API has no support at all on iOS Safari, which would silently break
// the one thing this queue exists for on a large share of phones. Plain
// IndexedDB + an online-event listener in application code (see
// hooks/usePunchQueue.js) works identically everywhere.
const DB_NAME = "rosterpro-attendance";
const DB_VERSION = 1;
const STORE = "pending-punches";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// item = { localId, kind: "punch-in"|"punch-out", payload, queuedAt }
export async function addPunch(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listPunches() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.queuedAt - b.queuedAt));
    req.onerror = () => reject(req.error);
  });
}

export async function removePunch(localId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
