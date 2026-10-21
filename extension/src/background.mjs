import { lookupFromIndex, normalizeLookupTerm, normalizeMode, resolveWordForms, describeWordForm } from "./dictionary-core.mjs";
import { getActivePackage, getPackage, getEntry, listQueue, listPackages, openDatabase, putQueueItem, transaction, readRecord, rememberSense, removeDictionary } from "./storage.mjs";
import { requestJson } from "./network.mjs";

const APP_ORIGIN_DEFAULT = "http://localhost:3000";
const MODES = { "en-en": "phrasebook-en-en", "en-vi": "phrasebook-en-vi", "vi-en": "phrasebook-vi-en" };
const dictionaryInstalls = new Map();
let syncing;
let refreshing;
chrome.runtime.onInstalled.addListener(() => {
  void openDatabase();
  chrome.alarms.create("phrasebook-sync", { periodInMinutes: 2 });
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "phrasebook-sync") void syncQueue().catch(() => {}); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.protocol !== 1 || typeof message.type !== "string") return false;
  const task = handleMessage(message, sender);
  task.then((data) => respond({ ok: true, data })).catch((error) => {
    respond({ ok: false, error: error instanceof Error ? error.message : "Request failed" });
  });
  return true;
});

async function handleMessage(message, sender) {
  if (["management-status", "retry-capture", "discard-capture", "remove-dictionary", "capture-candidates", "ai-history", "reset-ai-request"].includes(message.type)
    && !sender.url?.startsWith(chrome.runtime.getURL(""))) throw new Error("Open the extension manager to use this action");
  switch (message.type) {
    case "lookup": return lookup(message.term, message.mode);
    case "lookup-dictionary": return lookup(message.term, message.mode, false);
    case "save-capture": return saveCapture(message.capture, sender);
    case "read-status": return readStatus(message.mode, message.term);
    case "enrich": return enrich(message);
    case "get-config": {
      const config = await chrome.storage.local.get(["mode", "appOrigin", "manifestUrl", "account", "youtubeEnabled"]);
      return { ...config, account: config.account ? { userId: config.account.userId, email: config.account.email } : null };
    }
    case "management-status": {
      const { account } = await chrome.storage.local.get("account");
      const queue = account?.userId ? await listQueue(account.userId) : [];
      return { packages: await listPackages(), storage: await navigator.storage?.estimate?.(),
        queue: queue.map(({ operationId, term, state, attempts, lastError, createdAt, context, mode, pageUrl, videoTime }) => ({ operationId, term, state, attempts, lastError, createdAt, context, mode, pageUrl, videoTime })) };
    }
    case "retry-capture": {
      const { account } = await chrome.storage.local.get("account");
      const item = await readRecord("queue", message.operationId);
      if (!account?.userId || item?.accountId !== account.userId) throw new Error("Saved word not found for this account");
      if (item.state === "synced") return { state: "synced" };
      if (item.state === "syncing" && item.leaseUntil > Date.now()) throw new Error("This word is syncing. Please wait.");
      if (message.existingItemId) {
        const candidates = await readStatus(item.mode, item.term);
        if (!candidates.items?.some((candidate) => candidate.id === message.existingItemId)) throw new Error("Choose a word from this account's library");
      }
      await putQueueItem({ ...item, ...(message.existingItemId ? { existingItemId: message.existingItemId } : {}), state: "pending", leaseUntil: 0, lastError: "" });
      return syncQueue();
    }
    case "capture-candidates": {
      const { account } = await chrome.storage.local.get("account");
      const item = await readRecord("queue", message.operationId);
      if (!account?.userId || item?.accountId !== account.userId) throw new Error("Saved word not found for this account");
      const status = await readStatus(item.mode, item.term);
      return { items: status.items?.map(({ id, term, meaning_en, meaning_vi }) => ({ id, term, meaning_en, meaning_vi })) ?? [] };
    }
    case "discard-capture": {
      const { account } = await chrome.storage.local.get("account");
      const item = await readRecord("queue", message.operationId);
      if (!account?.userId || item?.accountId !== account.userId) throw new Error("Saved word not found for this account");
      if (item.state === "syncing" && item.leaseUntil > Date.now()) throw new Error("Wait for syncing to finish before removing this entry");
      await transaction(["queue"], "readwrite", (tx) => tx.objectStore("queue").delete(item.operationId));
      return { removed: true };
    }
    case "remove-dictionary": {
      const mode = normalizeMode(message.mode);
      if (dictionaryInstalls.has(mode)) throw new Error("Wait for this dictionary download to finish");
      await removeDictionary(mode);
      return { removed: true };
    }
    case "open-manager": return chrome.tabs.create({ url: chrome.runtime.getURL("src/manage.html") });
    case "ai-history":
    case "reset-ai-request": {
      const account = await getAuthorizedAccount();
      if (!account?.accessToken) throw new Error("Sign in to view AI requests");
      return requestJson(`${validateAppOrigin(account.appOrigin)}/api/extension/enrich/requests`, {
        method: message.type === "ai-history" ? "GET" : "POST",
        headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
        ...(message.type === "reset-ai-request" ? { body: JSON.stringify({ id: message.id, allowAnotherAttempt: true }) } : {})
      });
    }
    case "sign-in": return signIn(message.config);
    case "sign-out": return signOut();
    case "open-settings": return chrome.runtime.openOptionsPage();
    case "set-mode": {
      const mode = normalizeMode(message.mode);
      await chrome.storage.local.set({ mode });
      return { mode };
    }
    case "install-dictionary": return installDictionaryOnce(message.manifestUrl, message.mode);
    case "open-flashcards": {
      const config = await chrome.storage.local.get(["appOrigin"]);
      const origin = validateAppOrigin(config.appOrigin ?? APP_ORIGIN_DEFAULT);
      return chrome.tabs.create({ url: `${origin}/flashcards` });
    }
    case "sync-queue": return syncQueue();
    default: throw new Error("Unknown extension message");
  }
}

async function lookup(term, requestedMode, includePersonal = true) {
  const mode = normalizeMode(requestedMode);
  const normalized = normalizeLookupTerm(term);
  const { account } = await chrome.storage.local.get("account");
  const personal = includePersonal && account?.userId ? await readRecord("personal", [account.userId, mode, normalized]) : null;
  const pack = await getActivePackage(mode);
  if (!pack?.active) return { mode, result: personal ? { term: normalized, senses: personal.senses } : null, missingPack: !personal, source: personal ? "personal" : "dictionary" };
  const senses = await getEntry(pack.packageId, normalized);
  if (senses || personal) {
    const combined = await resolveWordForms(normalized, senses ?? [], (base) => getEntry(pack.packageId, base), mode, pack.dataVersion);
    const savedSenses = await resolveWordForms(normalized, personal?.senses ?? [], (base) => getEntry(pack.packageId, base), mode, pack.dataVersion);
    for (const saved of savedSenses) {
      const index = combined.findIndex((sense) => saved.id ? sense.id === saved.id : JSON.stringify(sense.definitions) === JSON.stringify(saved.definitions));
      if (index < 0) combined.push(saved); else combined[index] = { ...combined[index], ...saved };
    }
    const resolved = combined;
    // A Vietnamese lookup must keep its English translation/headword intact.
    // Add only an unambiguous grammar note from the optional English pack.
    const englishPack = mode === "vi-en" ? await getActivePackage("en-en") : null;
    const englishReads = new Map();
    if (englishPack) for (const sense of resolved) {
      if (!sense.sourceTerm || !sense.partOfSpeech) continue;
      const headword = normalizeLookupTerm(sense.sourceTerm);
      if (!englishReads.has(headword) && englishReads.size < 32) englishReads.set(headword, await getEntry(englishPack.packageId, headword) ?? []);
      const matches = (englishReads.get(headword) ?? []).filter((candidate) => candidate.partOfSpeech === sense.partOfSpeech);
      const notes = matches.map(describeWordForm);
      const unique = new Map(notes.filter(Boolean).map((note) => [JSON.stringify(note), note]));
      if (notes.length && notes.every(Boolean) && unique.size === 1) Object.assign(sense, [...unique.values()][0]);
    }
    return { mode, result: lookupFromIndex({ [normalized]: resolved }, normalized), source: personal ? "personal+dictionary" : "dictionary", dataVersion: pack.dataVersion };
  }
  return { mode, result: null, source: "dictionary", dataVersion: pack.dataVersion };
}

async function readStatus(modeInput, term) {
  const account = await getAuthorizedAccount();
  if (!account) return { state: "needs_auth" };
  const mode = normalizeMode(modeInput);
  const origin = validateAppOrigin(account.appOrigin ?? APP_ORIGIN_DEFAULT);
  const response = await fetch(`${origin}/api/extension/saved-status`, {
    signal: AbortSignal.timeout(15_000),
    method: "POST", headers: { "Authorization": `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ term, mode })
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Please sign in again" : "Could not check your library");
  return response.json();
}

async function enrich(message) {
  const account = await getAuthorizedAccount();
  if (!account?.accessToken) throw new Error("Sign in to use AI enrichment");
  const origin = validateAppOrigin(account.appOrigin ?? APP_ORIGIN_DEFAULT);
  return requestJson(`${origin}/api/extension/enrich`, {
    method: "POST", headers: { "Authorization": `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ term: message.term, mode: normalizeMode(message.mode), context: String(message.context ?? "").slice(0, 2000), fields: message.fields, current: message.current ?? {} })
  });
}

async function saveCapture(input, sender) {
  if (!input || typeof input.term !== "string" || !input.term.trim() || input.term.length > 120) throw new Error("Invalid word");
  const account = (await chrome.storage.local.get("account")).account;
  if (!account?.userId) throw new Error("Sign in to Phrasebook before saving words");
  const operationId = input.operationId || crypto.randomUUID();
  const previous = await readRecord("queue", operationId);
  if (previous) {
    if (previous.accountId !== account.userId) throw new Error("Operation belongs to a different account");
    return { operationId, state: previous.state };
  }
  const url = new URL(sender.tab?.url ?? input.pageUrl ?? "https://www.youtube.com/");
  if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid source page");
  const capture = {
    ...(input.existingItemId ? { existingItemId: input.existingItemId } : {}),
    operationId, accountId: account.userId,
    term: input.term.trim(), queryTerm: String(input.queryTerm ?? input.term).trim(), phrase: Boolean(input.phrase), mode: normalizeMode(input.mode),
    selectedSense: input.selectedSense ?? null,
    context: String(input.context ?? "").slice(0, 2000), pageUrl: url.href,
    pageTitle: String(input.pageTitle ?? sender.tab?.title ?? "").slice(0, 300),
    videoTime: Number.isFinite(input.videoTime) ? Math.max(0, input.videoTime) : null,
    createdAt: new Date().toISOString(), state: "pending", attempts: 0, leaseUntil: 0
  };
  await putQueueItem(capture);
  if (capture.selectedSense) await rememberSense(account.userId, capture.mode, normalizeLookupTerm(capture.queryTerm), capture.selectedSense).catch(() => {});
  void syncQueue().catch(() => {});
  return { operationId, state: "queued" };
}

async function signIn(input) {
  const config = validateAuthConfig(input);
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const nonceDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const hashedNonce = [...new Uint8Array(nonceDigest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const redirectUri = chrome.identity.getRedirectURL("supabase-auth");
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", config.googleClientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "id_token");
  authorize.searchParams.set("response_mode", "fragment");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", hashedNonce);
  authorize.searchParams.set("prompt", "select_account");
  const redirect = await chrome.identity.launchWebAuthFlow({ url: authorize.href, interactive: true });
  if (!redirect) throw new Error("Sign-in was not completed");
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (params.get("state") !== state) throw new Error("Invalid sign-in state");
  const idToken = params.get("id_token");
  if (!idToken) throw new Error("Google did not return an ID token");

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=id_token`, {
    signal: AbortSignal.timeout(15_000),
    method: "POST", headers: { "apikey": config.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", id_token: idToken, nonce })
  });
  const session = await response.json();
  if (!response.ok || !session.access_token || !session.user?.id) throw new Error("Could not create a Phrasebook session");
  const account = {
    userId: session.user.id, email: session.user.email, accessToken: session.access_token,
    refreshToken: session.refresh_token, expiresAt: Date.now() + (session.expires_in ?? 3600) * 1000,
    appOrigin: config.appOrigin, supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey
  };
  await chrome.storage.local.set({ account, authConfig: config });
  await resetAuthQueue(account.userId);
  const verify = await fetch(`${config.appOrigin}/api/extension/session`, { signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${account.accessToken}` } });
  if (!verify.ok) {
    await chrome.storage.local.remove("account");
    throw new Error(verify.status === 403 ? "This account does not have access to Phrasebook" : "Could not verify this account");
  }
  void syncQueue();
  return { email: account.email, userId: account.userId };
}

async function signOut() {
  const { account } = await chrome.storage.local.get("account");
  if (account?.userId) {
    for (const item of await listQueue(account.userId)) {
      if (["pending", "syncing", "needs_auth"].includes(item.state)) {
        await putQueueItem({ ...item, state: "needs_auth", leaseUntil: 0 });
      }
    }
  }
  await chrome.storage.local.remove("account");
  return { signedOut: true };
}

async function resetAuthQueue(accountId) {
  for (const item of await listQueue(accountId)) {
    if (item.state === "needs_auth") await putQueueItem({ ...item, state: "pending", attempts: 0, leaseUntil: 0 });
  }
}

async function getAuthorizedAccount() {
  const { account } = await chrome.storage.local.get("account");
  if (!account?.accessToken) return null;
  if (account.expiresAt > Date.now() + 60_000) return account;
  if (refreshing?.userId === account.userId) return refreshing.promise;
  const promise = refreshAccount(account).finally(() => { if (refreshing?.promise === promise) refreshing = null; });
  refreshing = { userId: account.userId, promise };
  return promise;
}

async function refreshAccount(account) {
  if (!account.refreshToken) {
    await chrome.storage.local.remove("account");
    return null;
  }
  const response = await fetch(`${account.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    signal: AbortSignal.timeout(10_000),
    method: "POST", headers: { apikey: account.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: account.refreshToken })
  });
  const refreshed = await response.json();
  if (!response.ok || !refreshed.access_token) {
    if ((response.status === 400 || response.status === 401) && (await chrome.storage.local.get("account")).account?.refreshToken === account.refreshToken) await chrome.storage.local.remove("account");
    return null;
  }
  const next = { ...account, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000 };
  const current = (await chrome.storage.local.get("account")).account;
  if (current?.userId !== account.userId || current?.refreshToken !== account.refreshToken) return null;
  await chrome.storage.local.set({ account: next });
  return next;
}

function syncQueue() {
  if (!syncing) syncing = runSyncQueue().finally(() => { syncing = null; });
  return syncing;
}

async function runSyncQueue() {
  if (!navigator.onLine) return { synced: 0, state: "offline" };
  const account = await getAuthorizedAccount();
  if (!account?.userId || !account?.accessToken) return { synced: 0, state: "needs_auth" };
  const pending = await listQueue(account.userId);
  let synced = 0;
  for (const item of pending) {
    if ((await chrome.storage.local.get("account")).account?.userId !== account.userId) break;
    if (item.state === "synced" || item.state === "needs_resolution" || (item.leaseUntil ?? 0) > Date.now()) continue;
    if (item.state !== "pending" && item.state !== "syncing") continue;
    const claimed = { ...item, state: "syncing", leaseUntil: Date.now() + 60_000 };
    await putQueueItem(claimed);
    try {
      const origin = validateAppOrigin(account.appOrigin ?? APP_ORIGIN_DEFAULT);
      const response = await fetch(`${origin}/api/extension/capture`, {
        signal: AbortSignal.timeout(30_000),
        method: "POST", headers: { "Authorization": `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(claimed)
      });
      if (response.status === 401) {
        await putQueueItem({ ...claimed, state: "needs_auth", leaseUntil: 0 });
        break;
      }
      if (response.status === 409 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        const detail = await response.json().catch(() => ({}));
        await putQueueItem({ ...claimed, state: "needs_resolution", lastError: String(detail.error ?? `HTTP ${response.status}`).slice(0, 300), leaseUntil: 0 });
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      await putQueueItem({ ...claimed, state: "synced", serverResult: result, syncedAt: new Date().toISOString(), leaseUntil: 0 });
      await chrome.storage.local.set({ lastSyncAt: Date.now() });
      synced += 1;
    } catch (error) {
      const attempts = (claimed.attempts ?? 0) + 1;
      await putQueueItem({ ...claimed, state: "pending", attempts, leaseUntil: Date.now() + Math.min(3_600_000, 2 ** Math.min(attempts, 10) * 1000), lastError: String(error).slice(0, 200) });
    }
  }
  return { synced, state: "done" };
}

function validateAuthConfig(value) {
  if (!value || typeof value !== "object") throw new Error("Sign-in settings are incomplete");
  const appOrigin = validateAppOrigin(value.appOrigin ?? APP_ORIGIN_DEFAULT);
  const supabaseUrl = new URL(value.supabaseUrl);
  if (!/^https?:$/.test(supabaseUrl.protocol) || (supabaseUrl.protocol !== "https:" && supabaseUrl.hostname !== "localhost")) throw new Error("Invalid Supabase URL");
  const googleClientId = String(value.googleClientId ?? "").trim();
  const supabaseAnonKey = String(value.supabaseAnonKey ?? "").trim();
  if (!googleClientId.endsWith(".apps.googleusercontent.com") || !supabaseAnonKey) throw new Error("A Google OAuth client ID and Supabase publishable key are required");
  return { appOrigin, supabaseUrl: supabaseUrl.origin, googleClientId, supabaseAnonKey };
}

async function installDictionaryOnce(manifestUrl, modeInput) {
  const mode = normalizeMode(modeInput);
  if (dictionaryInstalls.has(mode)) return dictionaryInstalls.get(mode);
  const work = installDictionary(manifestUrl, mode).finally(() => dictionaryInstalls.delete(mode));
  dictionaryInstalls.set(mode, work);
  return work;
}

async function installDictionary(manifestUrl, modeInput) {
  const mode = normalizeMode(modeInput);
  const url = validateHttpsUrl(manifestUrl);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not download the manifest (HTTP ${response.status})`);
  const manifest = await response.json();
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) throw new Error("Unsupported manifest version");
  const pack = manifest.packages.find((candidate) => candidate.direction === mode);
  if (!pack || pack.packageId !== MODES[mode] || pack.contentType !== "application/x-ndjson+gzip") throw new Error("Invalid dictionary package for this mode");
  const chunks = Array.isArray(pack.chunks) && pack.chunks.length ? pack.chunks : [pack];
  if (chunks.some((chunk) => typeof chunk.url !== "string" || !/^[a-f0-9]{64}$/.test(chunk.checksumSha256 ?? "") || !Number.isInteger(chunk.entryCount) || chunk.entryCount < 0 || chunk.entryCount > 5000 || !Number.isInteger(chunk.compressedBytes) || chunk.compressedBytes < 1 || chunk.compressedBytes > 8 * 1024 * 1024 || !Number.isInteger(chunk.uncompressedBytes) || chunk.uncompressedBytes < 1 || chunk.uncompressedBytes > 2 * 1024 * 1024)) {
    throw new Error("Invalid dictionary chunk list");
  }
  const packageId = `${pack.packageId}@${pack.dataVersion}`;
  if (!Number.isInteger(pack.entryCount) || chunks.reduce((total, chunk) => total + chunk.entryCount, 0) !== pack.entryCount) throw new Error("Manifest entry count mismatch");
  const fingerprintBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(chunks)));
  const fingerprint = [...new Uint8Array(fingerprintBytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const existing = await getPackage(packageId);
  if (existing?.fingerprint && existing.fingerprint !== fingerprint) throw new Error("Dictionary contents changed without a new data version.");
  if (existing?.state === "ready" && existing.active) {
    return { mode, dataVersion: pack.dataVersion, entryCount: pack.entryCount, compressedBytes: pack.compressedBytes, alreadyInstalled: true };
  }
  let completedChunks = existing?.fingerprint === fingerprint && Number.isInteger(existing.completedChunks) && existing.completedChunks >= 0 && existing.completedChunks <= chunks.length ? existing.completedChunks : 0;
  let installedEntries = chunks.slice(0, completedChunks).reduce((total, chunk) => total + chunk.entryCount, 0);
  const storage = await navigator.storage?.estimate?.();
  const estimatedBytes = chunks.slice(completedChunks).reduce((sum, chunk) => sum + chunk.uncompressedBytes, 0) * 2;
  if (storage?.quota && storage.quota - (storage.usage ?? 0) < estimatedBytes) throw new Error("Not enough storage for this dictionary and its indexes. Remove an unused dictionary in Downloads and sync, then retry.");

  const checkpoint = () => ({ packageId, direction: mode, dataVersion: pack.dataVersion, entryCount: pack.entryCount, fingerprint, state: "installing", active: false, completedChunks, installedEntries, installedAt: new Date().toISOString(), sources: pack.sources, license: pack.license, attributionUrl: manifest.attributionUrl ? new URL(manifest.attributionUrl, url).href : "" });
  const report = (state, error = "") => chrome.storage.local.set({ dictionaryProgress: { mode, state, completedChunks, totalChunks: chunks.length, installedEntries, totalEntries: pack.entryCount, error } });
  await transaction(["packages"], "readwrite", (tx) => tx.objectStore("packages").put(checkpoint()));
  await report("installing");
  try {
    let checksum = "";
    for (let index = completedChunks; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      checksum = await installChunk(chunk, url, packageId);
      installedEntries += chunk.entryCount;
      completedChunks = index + 1;
      await transaction(["packages"], "readwrite", (tx) => tx.objectStore("packages").put(checkpoint()));
      await report("installing");
    }
    if (installedEntries !== pack.entryCount) throw new Error("Dictionary entry count does not match the manifest");
    await transaction(["entries", "packages"], "readwrite", (tx) => {
      const packages = tx.objectStore("packages");
      const cursorRequest = packages.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const current = cursor.value;
        if (current.direction === mode && current.packageId !== packageId) cursor.update({ ...current, active: false });
        cursor.continue();
      };
      packages.put({ ...checkpoint(), state: "ready", active: true, compressedBytes: pack.compressedBytes, checksum });
    });
    await report("ready");
    return { mode, dataVersion: pack.dataVersion, entryCount: installedEntries, compressedBytes: pack.compressedBytes };
  } catch (error) {
    await report("interrupted", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function installChunk(chunk, manifestUrl, packageId) {
  const chunkUrl = new URL(chunk.url, manifestUrl);
  if (chunkUrl.origin !== new URL(manifestUrl).origin) throw new Error("Dictionary chunks must use the same origin as the manifest");
  const response = await fetch(chunkUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not download the chunk (HTTP ${response.status})`);
  const compressed = await readBoundedBody(response, 8 * 1024 * 1024);
  if (chunk.compressedBytes && compressed.byteLength !== chunk.compressedBytes) throw new Error("Dictionary chunk size does not match the manifest");
  const digest = await crypto.subtle.digest("SHA-256", compressed);
  const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (checksum !== chunk.checksumSha256) throw new Error("Dictionary checksum mismatch");
  const decompressed = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = decompressed.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let batch = [];
  let count = 0;
  let uncompressedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    uncompressedBytes += value?.byteLength ?? 0;
    if (uncompressedBytes > chunk.uncompressedBytes) throw new Error("Dictionary exceeds the size declared in the manifest");
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    if (pending.length > 1_000_000) throw new Error("Dictionary entry exceeds the size limit");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      batch.push(readDictionaryLine(line, packageId)); count += 1;
      if (batch.length >= 400) { await writeEntries(batch); batch = []; }
    }
    if (done) break;
  }
  if (pending.trim()) { batch.push(readDictionaryLine(pending, packageId)); count += 1; }
  if (batch.length) await writeEntries(batch);
  if (count !== chunk.entryCount || uncompressedBytes !== chunk.uncompressedBytes) throw new Error("Uncompressed size or entry count does not match the manifest");
  return checksum;
}

async function readBoundedBody(response, maxBytes) {
  const contentLength = response.headers.get("content-length");
  const declared = contentLength === null ? null : Number(contentLength);
  if (declared !== null && Number.isFinite(declared) && declared > maxBytes) throw new Error("Dictionary chunk exceeds the size limit");
  if (!response.body) throw new Error("Dictionary chunk has no content");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("Dictionary chunk exceeds the size limit"); }
    chunks.push(value);
  }
  if (declared !== null && Number.isFinite(declared) && declared !== size) throw new Error("Download size mismatch");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

function readDictionaryLine(line, packageId) {
  const entry = JSON.parse(line);
  const language = packageId.startsWith("phrasebook-en-vi@") ? "vi" : "en";
  if (typeof entry.term !== "string" || entry.term.length > 120 || !Array.isArray(entry.senses) || entry.senses.length > 1000 || entry.senses.some((sense) => sense.glossLanguage && sense.glossLanguage !== language)) {
    throw new Error("Invalid dictionary entry");
  }
  return { packageId, term: entry.term, senses: entry.senses };
}

async function writeEntries(entries) {
  await transaction(["entries"], "readwrite", (tx) => {
    const store = tx.objectStore("entries");
    for (const entry of entries) store.put(entry);
  });
}

function validateHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("The manifest requires an HTTPS URL");
  return url.href;
}

function validateAppOrigin(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid Phrasebook URL");
  return url.origin;
}
