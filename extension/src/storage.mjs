const DATABASE = "phrasebook-extension";
const VERSION = 1;

let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entries")) {
        const entries = db.createObjectStore("entries", { keyPath: ["packageId", "term"] });
        entries.createIndex("by-package", "packageId");
      }
      if (!db.objectStoreNames.contains("packages")) {
        const packages = db.createObjectStore("packages", { keyPath: "packageId" });
        packages.createIndex("by-direction", "direction");
      }
      if (!db.objectStoreNames.contains("queue")) {
        const queue = db.createObjectStore("queue", { keyPath: "operationId" });
        queue.createIndex("by-state", "state");
        queue.createIndex("by-account", "accountId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

export async function transaction(stores, mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    try { result = run(tx); } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function getActivePackage(direction) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("packages").objectStore("packages").index("by-direction").getAll(direction);
    request.onsuccess = () => resolve(request.result?.find((item) => item.active && item.state === "ready") ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function getPackage(packageId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("packages").objectStore("packages").get(packageId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function getEntry(packageId, term) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("entries").objectStore("entries").get([packageId, term]);
    request.onsuccess = () => resolve(request.result?.senses ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function putQueueItem(item) {
  return transaction(["queue"], "readwrite", (tx) => tx.objectStore("queue").put(item));
}

export async function listQueue(accountId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("queue").objectStore("queue").index("by-account").getAll(accountId);
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}
