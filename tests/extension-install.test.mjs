import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getPackage, listQueue, putQueueItem, readRecord, removeDictionary } from "../extension/src/storage.mjs";

let receive;
const local = {};
globalThis.chrome = {
  runtime: { getURL: (path) => `chrome-extension://test/${path}`, onInstalled: { addListener() {} }, onMessage: { addListener(listener) { receive = listener; } } },
  alarms: { onAlarm: { addListener() {} } },
  storage: { local: { async get() { return local; }, async set(values) { Object.assign(local, values); }, async remove(key) { delete local[key]; } } }
};
await import("../extension/src/background.mjs");

function send(type, values, sender = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker did not respond")), 5000);
    receive({ protocol: 1, type, ...values }, sender, (result) => { clearTimeout(timer); resolve(result); });
  });
}

function repository(version, entries, mode = "en-vi") {
  const files = new Map();
  const chunks = entries.map((rows, index) => {
    const plain = Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const bytes = gzipSync(plain);
    const url = `${version}-${index}.json.gz`;
    files.set(`/${url}`, bytes);
    return { url, entryCount: rows.length, compressedBytes: bytes.length, uncompressedBytes: plain.length, checksumSha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return { files, pack: { packageId: `phrasebook-${mode}`, direction: mode, dataVersion: version, contentType: "application/x-ndjson+gzip", chunks, entryCount: entries.flat().length, compressedBytes: chunks.reduce((sum, chunk) => sum + chunk.compressedBytes, 0) } };
}
const row = (term, definition, language = "vi") => ({ term, senses: [{ id: term, definitions: [definition], glossLanguage: language }] });

test("worker resolves local word forms and saved meanings survive offline pack removal", async (t) => {
  let repo = repository("forms-v1", [[
    { term:"excuses", senses:[{id:"excuses-plural",partOfSpeech:"noun",definitions:["plural of excuse"],glossLanguage:"en"}] },
    { term:"excuse", senses:[{id:"excuse-noun",partOfSpeech:"noun",definitions:["a reason given to explain a mistake"],glossLanguage:"en"}] }
  ]], "en-en");
  t.mock.method(globalThis,"fetch",async (input) => new URL(input).pathname === "/manifest.json" ? Response.json({schemaVersion:1,packages:[repo.pack]}) : new Response(repo.files.get(new URL(input).pathname)));
  assert.equal((await send("install-dictionary",{manifestUrl:"https://dictionary.test/manifest.json",mode:"en-en"})).ok,true);
  const sense = (await send("lookup-dictionary",{term:"excuses",mode:"en-en"})).data.result.senses[0];
  assert.equal(sense.baseForm,"excuse"); assert.equal(sense.definitions[0],"a reason given to explain a mistake");
  repo = repository("forms-v1",[[{term:"lý do",senses:[{id:"vi-excuses",partOfSpeech:"noun",definitions:["excuses"],sourceTerm:"excuses",glossLanguage:"en"}]}]],"vi-en");
  await send("install-dictionary",{manifestUrl:"https://dictionary.test/manifest.json",mode:"vi-en"});
  const reverse = (await send("lookup-dictionary",{term:"lý do",mode:"vi-en"})).data.result.senses[0];
  assert.deepEqual(reverse.definitions,["excuses"]); assert.equal(reverse.sourceTerm,"excuses"); assert.equal(reverse.formNote,"Plural of excuse");
  Object.defineProperty(navigator,"onLine",{configurable:true,value:false});
  local.account = {userId:"forms-user",expiresAt:Date.now()+3600000,accessToken:"test-token",appOrigin:"http://localhost:3000"};
  const operationId = crypto.randomUUID();
  await send("save-capture",{capture:{operationId,term:"excuses",queryTerm:"excuses",mode:"en-en",selectedSense:{...sense,ipa:"/saved-form/"},pageUrl:"https://example.com/",context:"She makes excuses."}});
  const merged = (await send("lookup",{term:"excuses",mode:"en-en"})).data.result.senses;
  assert.equal(merged.length,1); assert.equal(merged[0].ipa,"/saved-form/","private filled fields are preserved when a raw dictionary form resolves to the same sense");
  await removeDictionary("en-en");
  const offline = (await send("lookup",{term:"excuses",mode:"en-en"})).data.result.senses[0];
  assert.equal(offline.formNote,"Plural of excuse");
  assert.equal(offline.dataVersion,"forms-v1");
  assert.equal((await readRecord("queue",operationId)).context,"She makes excuses.");
  assert.equal((await send("lookup-dictionary",{term:"excuses",mode:"en-en"})).data.result,null);
  local.account = undefined;
  Object.defineProperty(navigator,"onLine",{configurable:true,value:true});
});

test("dictionary installs activate atomically, preserve the old version on failure, and resume verified chunks", async (t) => {
  let current = repository("test-v1", [[row("bank", "ngân hàng"), row("eco-friendly", "thân thiện với môi trường")]]);
  let failPath = "";
  const requests = new Map();
  t.mock.method(globalThis, "fetch", async (input) => {
    const path = new URL(input).pathname;
    if (path === "/manifest.json") return Response.json({ schemaVersion: 1, packages: [current.pack] });
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (path === failPath) return new Response("unavailable", { status: 503 });
    return new Response(current.files.get(path), { status: current.files.has(path) ? 200 : 404 });
  });
  const install = () => send("install-dictionary", { manifestUrl: "https://dictionary.test/manifest.json", mode: "en-vi" });
  const lookup = () => send("lookup", { term: "bank", mode: "en-vi" });

  assert.equal((await install()).ok, true);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng");
  const compound = await send("lookup", { term: "eco‑friendly", mode: "en-vi" });
  assert.equal(compound.data.result.term, "eco-friendly");
  assert.equal(compound.data.result.senses[0].definitions[0], "thân thiện với môi trường");

  const next = repository("test-v2", [[row("bank", "ngân hàng thương mại")], [row("hello", "xin chào")]]);
  current = next;
  failPath = "/test-v2-1.json.gz";
  assert.equal((await install()).ok, false);
  assert.equal((await getPackage("phrasebook-en-vi@test-v2")).completedChunks, 1);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng");

  current = repository("test-v2", [[row("bank", "nội dung đã đổi")], [row("hello", "xin chào")]]);
  assert.match((await install()).error, /without a new data version/);
  current = next;
  failPath = "";
  assert.equal((await install()).ok, true);
  assert.equal(requests.get("/test-v2-0.json.gz"), 1);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng thương mại");
  assert.equal((await getPackage("phrasebook-en-vi@test-v1")).active, false);
  assert.equal((await getPackage("phrasebook-en-vi@test-v2")).active, true);
  assert.equal(local.dictionaryProgress.state, "ready");

  current = repository("test-wrong-language", [[row("bank", "a financial institution", "en")]]);
  assert.equal((await install()).ok, false);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng thương mại");
});

test("offline words survive dictionary deletion and sync retries keep one operation and private cache per account", async (t) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  local.account = { userId: "account-a", accessToken: "test-token", expiresAt: Date.now() + 3600000, appOrigin: "http://localhost:3000" };
  const operationId = crypto.randomUUID();
  const capture = { operationId, term: "bank", mode: "en-vi", selectedSense: { id: "bank", definitions: ["ngân hàng cá nhân"], ipa: "/bæŋk/" }, pageUrl: "https://example.com/", context: "at the bank" };
  assert.equal((await send("save-capture", { capture })).ok, true);
  assert.equal((await listQueue("account-a")).length, 1);
  assert.equal((await send("lookup", { term: "bank", mode: "en-vi" })).data.result.senses[0].ipa, "/bæŋk/");
  assert.equal((await send("get-config")).data.account.accessToken, undefined);
  assert.equal((await send("management-status")).ok, false, "web content cannot read queue manager data");
  await removeDictionary("en-vi");
  assert.equal((await listQueue("account-a")).length, 1);
  assert.equal((await send("lookup", { term: "bank", mode: "en-vi" })).data.source, "personal");
  assert.equal((await send("lookup-dictionary", { term: "bank", mode: "en-vi" })).data.result, null, "web bridge never reads personal meanings");
  local.account = { ...local.account, userId: "account-b" };
  assert.equal((await send("lookup", { term: "bank", mode: "en-vi" })).data.result, null);
  assert.equal((await send("management-status", {}, { url: "chrome-extension://test/src/manage.html" })).data.queue.length, 0);
  local.account = { ...local.account, userId: "account-a" };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).operationId, operationId);
    if (calls === 1) throw new Error("Lost response after server commit");
    return Response.json({ item_id: "server-word", replayed: true });
  });
  await send("sync-queue");
  assert.equal((await readRecord("queue", operationId)).state, "pending");
  const failed = await readRecord("queue", operationId);
  await putQueueItem({ ...failed, leaseUntil: 0 });
  await Promise.all([send("sync-queue"), send("sync-queue")]);
  const done = await readRecord("queue", operationId);
  assert.equal(calls, 2, "concurrent sync calls share one worker run");
  assert.equal(done.state, "synced");
  assert.equal(done.serverResult.item_id, "server-word");
  await putQueueItem({ ...done, state: "syncing", leaseUntil: Date.now() - 1000 });
  await import("../extension/src/background.mjs?worker-restart");
  await send("sync-queue");
  assert.equal((await readRecord("queue", operationId)).state, "synced", "a restarted worker reclaims an expired syncing lease");
});

test("concurrent token refresh is shared and a late refresh cannot sign a logged-out account back in", async (t) => {
  local.account = { userId: "refresh-user", accessToken: "old-test-token", refreshToken: "test-refresh", expiresAt: 0, appOrigin: "http://localhost:3000", supabaseUrl: "https://supabase.test" };
  let release, calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("grant_type=refresh_token")) { calls++; await new Promise((resolve) => { release = resolve; }); return Response.json({ access_token:"new-test-token", refresh_token:"new-test-refresh",expires_in:3600 }); }
    return Response.json({ state:"not_saved",items:[] });
  });
  const first = send("read-status", {mode:"en-en",term:"hello"}), second = send("read-status", {mode:"en-en",term:"hello"});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  delete local.account; release();
  assert.equal((await first).data.state, "needs_auth");
  assert.equal((await second).data.state, "needs_auth");
  assert.equal(local.account, undefined);
});
