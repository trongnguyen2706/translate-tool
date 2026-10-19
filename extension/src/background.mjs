import { lookupFromIndex, normalizeLookupTerm, normalizeMode } from "./dictionary-core.mjs";
import { getActivePackage, getEntry, listQueue, openDatabase, putQueueItem, transaction } from "./storage.mjs";

const APP_ORIGIN_DEFAULT = "http://localhost:3000";
const MODES = { "en-en": "phrasebook-en-en", "en-vi": "phrasebook-en-vi", "vi-en": "phrasebook-vi-en" };
chrome.runtime.onInstalled.addListener(() => {
  void openDatabase();
  chrome.alarms.create("phrasebook-sync", { periodInMinutes: 2 });
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "phrasebook-sync") void syncQueue(); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.protocol !== 1 || typeof message.type !== "string") return false;
  const task = handleMessage(message, sender);
  task.then((data) => respond({ ok: true, data })).catch((error) => {
    respond({ ok: false, error: error instanceof Error ? error.message : "Request failed" });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "lookup": return lookup(message.term, message.mode);
    case "save-capture": return saveCapture(message.capture, sender);
    case "read-status": return readStatus(message.mode, message.term);
    case "enrich": return enrich(message);
    case "get-config": return chrome.storage.local.get(["mode", "appOrigin", "manifestUrl", "account"]);
    case "sign-in": return signIn(message.config);
    case "sign-out": return signOut();
    case "set-mode": {
      const mode = normalizeMode(message.mode);
      await chrome.storage.local.set({ mode });
      return { mode };
    }
    case "install-dictionary": return installDictionary(message.manifestUrl, message.mode);
    case "open-flashcards": {
      const config = await chrome.storage.local.get(["appOrigin"]);
      const origin = validateAppOrigin(config.appOrigin ?? APP_ORIGIN_DEFAULT);
      return chrome.tabs.create({ url: `${origin}/flashcards` });
    }
    case "sync-queue": return syncQueue();
    default: throw new Error("Unknown extension message");
  }
}

async function lookup(term, requestedMode) {
  const mode = normalizeMode(requestedMode);
  const pack = await getActivePackage(mode);
  if (!pack?.active) return { mode, result: null, missingPack: true };
  const normalized = normalizeLookupTerm(term);
  const senses = await getEntry(pack.packageId, normalized);
  if (senses) return { mode, result: lookupFromIndex({ [normalized]: senses }, normalized), source: "dictionary", dataVersion: pack.dataVersion };
  return { mode, result: null, source: "dictionary", dataVersion: pack.dataVersion };
}

async function readStatus(modeInput, term) {
  const account = await getAuthorizedAccount();
  if (!account) return { state: "needs_auth" };
  const mode = normalizeMode(modeInput);
  const origin = validateAppOrigin(account.appOrigin ?? APP_ORIGIN_DEFAULT);
  const response = await fetch(`${origin}/api/extension/saved-status`, {
    method: "POST", headers: { "Authorization": `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ term, mode })
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Cần đăng nhập lại" : "Không thể kiểm tra kho từ");
  return response.json();
}

async function enrich(message) {
  const account = await getAuthorizedAccount();
  if (!account?.accessToken) throw new Error("Đăng nhập để dùng AI bổ sung từ");
  const origin = validateAppOrigin(account.appOrigin ?? APP_ORIGIN_DEFAULT);
  const response = await fetch(`${origin}/api/extension/enrich`, {
    method: "POST", headers: { "Authorization": `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ term: message.term, mode: normalizeMode(message.mode), context: String(message.context ?? "").slice(0, 2000), fields: message.fields, current: message.current ?? {} })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Không thể bổ sung bằng AI");
  return data;
}

async function saveCapture(input, sender) {
  if (!input || typeof input.term !== "string" || !input.term.trim() || input.term.length > 120) throw new Error("Từ không hợp lệ");
  const account = (await chrome.storage.local.get("account")).account;
  if (!account?.userId) throw new Error("Đăng nhập Phrasebook trước khi lưu để gắn đúng tài khoản");
  const operationId = input.operationId || crypto.randomUUID();
  const url = new URL(sender.tab?.url ?? input.pageUrl ?? "https://www.youtube.com/");
  if (!/^https?:$/.test(url.protocol)) throw new Error("Trang nguồn không hợp lệ");
  const capture = {
    operationId, accountId: account.userId,
    term: input.term.trim(), queryTerm: String(input.queryTerm ?? input.term).trim(), phrase: Boolean(input.phrase), mode: normalizeMode(input.mode),
    selectedSense: input.selectedSense ?? null,
    context: String(input.context ?? "").slice(0, 2000), pageUrl: url.href,
    pageTitle: String(input.pageTitle ?? sender.tab?.title ?? "").slice(0, 300),
    videoTime: Number.isFinite(input.videoTime) ? Math.max(0, input.videoTime) : null,
    createdAt: new Date().toISOString(), state: "pending", attempts: 0, leaseUntil: 0
  };
  await putQueueItem(capture);
  void syncQueue();
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
  if (!redirect) throw new Error("Đăng nhập chưa hoàn tất");
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (params.get("state") !== state) throw new Error("Xác thực state không hợp lệ");
  const idToken = params.get("id_token");
  if (!idToken) throw new Error("Google không trả về ID token");

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=id_token`, {
    method: "POST", headers: { "apikey": config.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", id_token: idToken, nonce })
  });
  const session = await response.json();
  if (!response.ok || !session.access_token || !session.user?.id) throw new Error("Không thể tạo phiên Phrasebook");
  const account = {
    userId: session.user.id, email: session.user.email, accessToken: session.access_token,
    refreshToken: session.refresh_token, expiresAt: Date.now() + (session.expires_in ?? 3600) * 1000,
    appOrigin: config.appOrigin, supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey
  };
  await chrome.storage.local.set({ account, authConfig: config });
  await resetAuthQueue(account.userId);
  const verify = await fetch(`${config.appOrigin}/api/extension/session`, { headers: { Authorization: `Bearer ${account.accessToken}` } });
  if (!verify.ok) {
    await chrome.storage.local.remove("account");
    throw new Error(verify.status === 403 ? "Tài khoản chưa được cấp quyền dùng Phrasebook" : "Không xác minh được tài khoản");
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
  if (!account.refreshToken) {
    await chrome.storage.local.remove("account");
    return null;
  }
  const response = await fetch(`${account.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: account.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: account.refreshToken })
  });
  const refreshed = await response.json();
  if (!response.ok || !refreshed.access_token) {
    if (response.status === 400 || response.status === 401) await chrome.storage.local.remove("account");
    return null;
  }
  const next = { ...account, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000 };
  await chrome.storage.local.set({ account: next });
  return next;
}

async function syncQueue() {
  if (!navigator.onLine) return { synced: 0, state: "offline" };
  const account = await getAuthorizedAccount();
  if (!account?.userId || !account?.accessToken) return { synced: 0, state: "needs_auth" };
  const pending = await listQueue(account.userId);
  let synced = 0;
  for (const item of pending) {
    if (item.state === "synced" || item.state === "needs_resolution" || (item.leaseUntil ?? 0) > Date.now()) continue;
    if (item.state !== "pending" && item.state !== "syncing") continue;
    const claimed = { ...item, state: "syncing", leaseUntil: Date.now() + 60_000 };
    await putQueueItem(claimed);
    try {
      const origin = validateAppOrigin(account.appOrigin ?? APP_ORIGIN_DEFAULT);
      const response = await fetch(`${origin}/api/extension/capture`, {
        method: "POST", headers: { "Authorization": `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(claimed)
      });
      if (response.status === 401) {
        await putQueueItem({ ...claimed, state: "needs_auth", leaseUntil: 0 });
        break;
      }
      if (response.status === 409 || (response.status >= 400 && response.status < 500)) {
        await putQueueItem({ ...claimed, state: "needs_resolution", lastError: `HTTP ${response.status}`, leaseUntil: 0 });
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await putQueueItem({ ...claimed, state: "synced", syncedAt: new Date().toISOString(), leaseUntil: 0 });
      synced += 1;
    } catch (error) {
      const attempts = (claimed.attempts ?? 0) + 1;
      await putQueueItem({ ...claimed, state: "pending", attempts, leaseUntil: Date.now() + Math.min(3_600_000, 2 ** Math.min(attempts, 10) * 1000), lastError: String(error).slice(0, 200) });
    }
  }
  return { synced, state: "done" };
}

function validateAuthConfig(value) {
  if (!value || typeof value !== "object") throw new Error("Cấu hình đăng nhập chưa đầy đủ");
  const appOrigin = validateAppOrigin(value.appOrigin ?? APP_ORIGIN_DEFAULT);
  const supabaseUrl = new URL(value.supabaseUrl);
  if (!/^https?:$/.test(supabaseUrl.protocol) || (supabaseUrl.protocol !== "https:" && supabaseUrl.hostname !== "localhost")) throw new Error("Supabase URL không hợp lệ");
  const googleClientId = String(value.googleClientId ?? "").trim();
  const supabaseAnonKey = String(value.supabaseAnonKey ?? "").trim();
  if (!googleClientId.endsWith(".apps.googleusercontent.com") || !supabaseAnonKey) throw new Error("Cần Google OAuth client ID và Supabase publishable key");
  return { appOrigin, supabaseUrl: supabaseUrl.origin, googleClientId, supabaseAnonKey };
}

async function installDictionary(manifestUrl, modeInput) {
  const mode = normalizeMode(modeInput);
  const url = validateHttpsUrl(manifestUrl);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được manifest (${response.status})`);
  const manifest = await response.json();
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) throw new Error("Phiên bản manifest không được hỗ trợ");
  const pack = manifest.packages.find((candidate) => candidate.direction === mode);
  if (!pack || pack.packageId !== MODES[mode] || pack.contentType !== "application/x-ndjson+gzip") throw new Error("Gói từ điển cho chế độ này không hợp lệ");
  const chunks = Array.isArray(pack.chunks) && pack.chunks.length ? pack.chunks : [pack];
  if (chunks.some((chunk) => typeof chunk.url !== "string" || !/^[a-f0-9]{64}$/.test(chunk.checksumSha256 ?? "") || !Number.isInteger(chunk.entryCount) || chunk.entryCount < 0 || chunk.entryCount > 5000 || !Number.isInteger(chunk.compressedBytes) || chunk.compressedBytes < 1 || chunk.compressedBytes > 8 * 1024 * 1024 || !Number.isInteger(chunk.uncompressedBytes) || chunk.uncompressedBytes < 1 || chunk.uncompressedBytes > 2 * 1024 * 1024)) {
    throw new Error("Danh sách gói từ điển không hợp lệ");
  }
  const packageId = `${pack.packageId}@${pack.dataVersion}`;
  await transaction(["entries", "packages"], "readwrite", (tx) => {
    tx.objectStore("packages").put({ packageId, direction: mode, dataVersion: pack.dataVersion, state: "installing", active: false, installedAt: new Date().toISOString() });
  });
  try {
    let checksum = "";
    let installedEntries = 0;
    for (const chunk of chunks) {
      checksum = await installChunk(chunk, url, packageId);
      installedEntries += chunk.entryCount;
    }
    if (installedEntries !== pack.entryCount) throw new Error("Số mục từ điển không khớp manifest");
    await transaction(["entries", "packages"], "readwrite", (tx) => {
      const packages = tx.objectStore("packages");
      const cursorRequest = packages.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const current = cursor.value;
        if (current.direction === mode) cursor.update({ ...current, active: false });
        cursor.continue();
      };
      packages.put({ packageId, direction: mode, dataVersion: pack.dataVersion, state: "ready", active: true, installedAt: new Date().toISOString(), compressedBytes: pack.compressedBytes, checksum });
    });
    return { mode, dataVersion: pack.dataVersion, entryCount: installedEntries, compressedBytes: pack.compressedBytes };
  } catch (error) {
    await transaction(["entries", "packages"], "readwrite", (tx) => {
      tx.objectStore("entries").index("by-package").openCursor(IDBKeyRange.only(packageId)).onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete(); cursor.continue();
      };
      tx.objectStore("packages").delete(packageId);
    });
    throw error;
  }
}

async function installChunk(chunk, manifestUrl, packageId) {
  const chunkUrl = new URL(chunk.url, manifestUrl);
  if (chunkUrl.origin !== new URL(manifestUrl).origin) throw new Error("Gói từ điển phải cùng domain với manifest");
  const response = await fetch(chunkUrl);
  if (!response.ok) throw new Error(`Không tải được gói (${response.status})`);
  const compressed = await readBoundedBody(response, 8 * 1024 * 1024);
  if (chunk.compressedBytes && compressed.byteLength !== chunk.compressedBytes) throw new Error("Kích thước gói từ điển không khớp manifest");
  const digest = await crypto.subtle.digest("SHA-256", compressed);
  const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (checksum !== chunk.checksumSha256) throw new Error("Checksum gói từ điển không khớp");
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
    if (uncompressedBytes > chunk.uncompressedBytes) throw new Error("Gói từ điển lớn hơn manifest");
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    if (pending.length > 1_000_000) throw new Error("Dòng trong gói từ điển vượt giới hạn");
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
  if (count !== chunk.entryCount || uncompressedBytes !== chunk.uncompressedBytes) throw new Error("Số mục hoặc kích thước giải nén không khớp manifest");
  return checksum;
}

async function readBoundedBody(response, maxBytes) {
  const contentLength = response.headers.get("content-length");
  const declared = contentLength === null ? null : Number(contentLength);
  if (declared !== null && Number.isFinite(declared) && declared > maxBytes) throw new Error("Gói từ điển vượt giới hạn kích thước");
  if (!response.body) throw new Error("Gói từ điển không có nội dung");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("Gói từ điển vượt giới hạn kích thước"); }
    chunks.push(value);
  }
  if (declared !== null && Number.isFinite(declared) && declared !== size) throw new Error("Kích thước gói tải về không khớp");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

function readDictionaryLine(line, packageId) {
  const entry = JSON.parse(line);
  if (typeof entry.term !== "string" || entry.term.length > 120 || !Array.isArray(entry.senses) || entry.senses.length > 100) {
    throw new Error("Dòng từ điển không hợp lệ");
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
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Cần URL HTTPS cho manifest");
  return url.href;
}

function validateAppOrigin(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) throw new Error("URL Phrasebook không hợp lệ");
  return url.origin;
}
