const DATABASE = "phrasebook-extension";
const VERSION = 2;

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
      if (!db.objectStoreNames.contains("personal")) {
        const personal = db.createObjectStore("personal", { keyPath: ["accountId", "mode", "term"] });
        personal.createIndex("by-account", "accountId");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { databasePromise = null; reject(request.error); };
    request.onblocked = () => { databasePromise = null; reject(new Error("Close old extension pages and try again")); };
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

export async function readRecord(store, key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function listPackages() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("packages").objectStore("packages").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// One transaction deletes only dictionary data; personal drafts and the queue are separate stores.
export async function removeDictionary(direction) {
  const packages = (await listPackages()).filter((pack) => pack.direction === direction);
  await transaction(["entries", "packages"], "readwrite", (tx) => {
    for (const pack of packages) {
      tx.objectStore("packages").delete(pack.packageId);
      // Compound key range covers every string term for exactly this package.
      // A native range delete avoids a JS callback for each of a million entries.
      tx.objectStore("entries").delete(IDBKeyRange.bound([pack.packageId], [pack.packageId, []]));
    }
  });
}

export async function rememberSense(accountId, mode, term, sense) {
  const key = [accountId, mode, term];
  // Read and write in the same transaction so simultaneous saves cannot lose senses.
  return transaction(["personal"], "readwrite", (tx) => {
    const store = tx.objectStore("personal");
    const read = store.get(key);
    read.onsuccess = () => {
      const senses = read.result?.senses ?? [];
      const identity = (value) => value.id || JSON.stringify(value.definitions ?? []);
      const index = senses.findIndex((value) => identity(value) === identity(sense));
      if (index < 0) senses.push(sense); else senses[index] = sense;
      store.put({ accountId, mode, term, senses, updatedAt: Date.now() });
    };
  });
}
