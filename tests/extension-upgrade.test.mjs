import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
test("upgrading a version-1 dictionary database preserves packs and unsynced captures", async () => {
  const old = await new Promise((resolve, reject) => {
    const request = indexedDB.open("phrasebook-extension", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("entries", { keyPath: ["packageId", "term"] }).createIndex("by-package", "packageId");
      db.createObjectStore("packages", { keyPath: "packageId" }).createIndex("by-direction", "direction");
      const queue = db.createObjectStore("queue", { keyPath: "operationId" }); queue.createIndex("by-state", "state"); queue.createIndex("by-account", "accountId");
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve) => {
    const tx = old.transaction(["packages", "queue", "entries"], "readwrite");
    tx.objectStore("packages").put({ packageId: "old-pack", direction: "en-en", active: true, state: "ready" });
    tx.objectStore("queue").put({ operationId: "old-operation", accountId: "owner", state: "pending" });
    tx.objectStore("entries").put({ packageId: "old-pack", term: "hello", senses: [{ definitions: ["a greeting"] }] });
    tx.oncomplete = resolve;
  }); old.close();
  const storage = await import("../extension/src/storage.mjs");
  assert.equal((await storage.openDatabase()).version, 2);
  assert.equal((await storage.getEntry("old-pack", "hello"))[0].definitions[0], "a greeting");
  assert.equal((await storage.listQueue("owner"))[0].operationId, "old-operation");
  await storage.rememberSense("owner", "en-en", "hello", { definitions: ["personal greeting"] });
  assert.equal((await storage.readRecord("personal", ["owner", "en-en", "hello"])).senses.length, 1);
  assert.equal(await storage.readRecord("personal", ["other", "en-en", "hello"]), null);
});
