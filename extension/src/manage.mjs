const $ = (selector) => document.querySelector(selector);
const labels = { "en-en": "English → English", "en-vi": "English → Vietnamese", "vi-en": "Vietnamese → English" };
let data = { queue: [], packages: [] }, limit = 50;
const bytes = (value) => `${((value ?? 0) / 1048576).toLocaleString("en", { maximumFractionDigits: 1 })} MiB`;
async function send(type, values = {}) {
  const result = await chrome.runtime.sendMessage({ protocol: 1, type, ...values });
  if (!result?.ok) throw new Error(result?.error ?? "The extension was updated. Reload this page.");
  return result.data;
}
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function action(label, task) {
  const button = element("button", label);
  button.type = "button";
  button.onclick = async () => {
    button.disabled = true;
    try { const changed = await task(); if (changed !== false) await refresh(); } catch (error) { $("#status").textContent = error.message; }
    finally { button.disabled = false; }
  };
  return button;
}
function render() {
  $("#packages").replaceChildren();
  for (const mode of Object.keys(labels)) {
    const versions = data.packages.filter((pack) => pack.direction === mode);
    const active = versions.find((pack) => pack.active);
    const row = element("div", "", "row"), info = element("div", "");
    info.append(element("strong", labels[mode]), element("p", active ? `${(active.entryCount ?? active.installedEntries ?? 0).toLocaleString("en")} entries · ${active.dataVersion}` : "Not installed"), element("small", `${bytes(versions.reduce((sum, pack) => sum + (pack.compressedBytes ?? 0), 0))} downloaded · ${versions.length} stored versions`));
    if (active?.license) info.append(element("p", active.license, "hint"));
    if (active?.attributionUrl && /^https?:\/\//.test(active.attributionUrl)) { const link = element("a", "Dictionary sources and attribution"); link.href = active.attributionUrl; link.target = "_blank"; link.rel = "noreferrer"; info.append(link); }
    row.append(info);
    if (versions.length) row.append(action("Remove dictionary", async () => {
      if (confirm(`Remove all downloaded versions of ${labels[mode]}? Saved words and the sync queue will be kept.`)) await send("remove-dictionary", { mode });
    }));
    $("#packages").append(row);
  }
  $("#storage").textContent = data.storage ? `Extension storage: ${bytes(data.storage.usage)} used / ${bytes(data.storage.quota)} available quota. Download sizes below exclude database indexes.` : "Storage estimate unavailable.";
  const waiting = data.queue.filter((item) => item.state !== "synced").length;
  $("#summary").textContent = `${waiting} waiting or needing attention · ${data.queue.length - waiting} synced`;
  const filter = $("#filter").value;
  const rows = data.queue.filter((item) => filter === "all" || (filter === "synced" ? item.state === "synced" : item.state !== "synced")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#queue").replaceChildren();
  for (const item of rows.slice(0, limit)) {
    const row = element("article", "", "row"), info = element("div", ""), actions = element("div", "", "actions");
    info.append(element("strong", item.term), element("small", `${labels[item.mode]} · ${item.state.replaceAll("_", " ")} · ${new Date(item.createdAt).toLocaleString()}`));
    if (item.context) info.append(element("p", item.context));
    if (/^https?:\/\//.test(item.pageUrl ?? "")) {
      const source = new URL(item.pageUrl), link = element("a", "Open source");
      if (source.hostname === "www.youtube.com" && Number.isFinite(item.videoTime)) source.searchParams.set("t", `${Math.floor(item.videoTime)}s`);
      link.href = source.href; link.target = "_blank"; link.rel = "noreferrer"; info.append(link);
    }
    if (item.lastError && item.state !== "synced") info.append(element("p", item.lastError, "error"));
    if (item.state === "needs_resolution" && !item.lastError?.includes("deleted after")) actions.append(action("Choose existing word", async () => {
      const result = await send("capture-candidates", { operationId: item.operationId });
      if (!result.items.length) throw new Error("No matching words in your library. Check this entry or remove it and save again.");
      const select = document.createElement("select"); select.setAttribute("aria-label", `Existing meaning for ${item.term}`);
      for (const candidate of result.items) { const option = element("option", `${candidate.term} · ${candidate.meaning_en || candidate.meaning_vi}`); option.value = candidate.id; select.append(option); }
      const form = element("div", "", "resolution");
      form.append(element("p", "Choose the same meaning. Existing content and study progress will be preserved."), select, action("Use selected word", () => send("retry-capture", { operationId: item.operationId, existingItemId: select.value })));
      info.querySelector(".resolution")?.remove(); info.append(form); return false;
    }));
    if (item.state !== "synced") actions.append(action(item.state === "needs_auth" ? "Retry after sign-in" : "Retry", () => send("retry-capture", { operationId: item.operationId })));
    actions.append(action("Remove entry", async () => {
      if (confirm(`Remove the local sync entry for “${item.term}”? Unsynced changes will be lost.`)) await send("discard-capture", { operationId: item.operationId });
    }));
    row.append(info, actions); $("#queue").append(row);
  }
  if (!rows.length) $("#queue").append(element("p", "No entries to show."));
  $("#more").hidden = rows.length <= limit;
}
async function refresh() { data = await send("management-status"); render(); }
$("#refresh").onclick = () => { void refresh().catch((error) => { $("#status").textContent = error.message; }); };
$("#sync").onclick = async () => {
  $("#sync").disabled = true; $("#status").textContent = "Syncing…";
  try { const result = await send("sync-queue"); $("#status").textContent = result.state === "needs_auth" ? "Sign in from Settings to sync." : result.state === "offline" ? "You are offline. Entries remain on this device." : `Synced ${result.synced} words.`; await refresh(); }
  catch (error) { $("#status").textContent = error.message; }
  finally { $("#sync").disabled = false; }
};
$("#filter").onchange = () => { limit = 50; render(); };
$("#more").onclick = () => { limit += 50; render(); };
void refresh().catch((error) => { $("#status").textContent = error.message; });
$("#load-ai").onclick = async () => {
  $("#load-ai").disabled = true;
  try {
    const result = await send("ai-history"); $("#ai-requests").replaceChildren();
    for (const entry of result.items) {
      const row = element("div", "", "row"), info = element("div", "");
      info.append(element("strong", entry.term || "AI request"), element("p", `${entry.mode} · ${entry.state} · ${entry.requested_fields.join(", ")}`), element("small", new Date(entry.updated_at).toLocaleString()));
      row.append(info);
      if (["uncertain", "reserved"].includes(entry.state)) row.append(action("Allow another attempt", async () => {
        if (confirm("The previous outcome is unknown. Another attempt may use another AI request. Allow retrying it after two minutes?")) { await send("reset-ai-request", { id: entry.id }); $("#load-ai").click(); }
      }));
      $("#ai-requests").append(row);
    }
    if (!result.items.length) $("#ai-requests").append(element("p", "No requests yet."));
  } catch (error) { $("#status").textContent = error.message; }
  finally { $("#load-ai").disabled = false; }
};
