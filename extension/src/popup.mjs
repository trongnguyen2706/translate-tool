const $ = (selector) => document.querySelector(selector);
const message = (type, values = {}) => chrome.runtime.sendMessage({ protocol: 1, type, ...values });
const labels = { "en-en": "English → English", "en-vi": "English → Vietnamese", "vi-en": "Vietnamese → English" };
let installing = false;

function showProgress(progress) {
  if (!progress) return;
  const count = `${progress.installedEntries.toLocaleString("en-US")} / ${progress.totalEntries.toLocaleString("en-US")} entries`;
  $("#message").textContent = progress.state === "interrupted"
    ? `${labels[progress.mode]} interrupted: ${progress.error}. Download again to resume from verified chunks.`
    : `${labels[progress.mode]}: ${count} · chunk ${progress.completedChunks}/${progress.totalChunks}. Keep this window open until installation finishes.`;
}

async function refresh() {
  const response = await message("get-config");
  const config = response.data ?? {};
  $("#mode").value = config.mode ?? "en-vi";
  $("#account").textContent = config.account?.email ? `Signed in as ${config.account.email}` : "Not signed in";
  const installed = await chrome.runtime.sendMessage({ protocol: 1, type: "lookup", term: "the", mode: $("#mode").value });
  $("#dictionary").textContent = installed.data?.missingPack ? "No dictionary installed for this mode." : `Dictionary ${installed.data?.dataVersion ?? "ready"}`;
}

$("#mode").addEventListener("change", async (event) => {
  await message("set-mode", { mode: event.target.value });
  await refresh();
});
async function installModes(modes) {
  if (installing) return;
  installing = true;
  $("#install").disabled = true;
  $("#install-all").disabled = true;
  $("#mode").disabled = true;
  $("#message").textContent = "Downloading and verifying… Keep this window open until installation finishes.";
  try {
    const { manifestUrl } = await chrome.storage.local.get("manifestUrl");
    if (!manifestUrl) throw new Error("Enter a dictionary manifest URL in Settings first.");
    let total = 0;
    for (const mode of modes) {
      $("#message").textContent = `Preparing ${labels[mode]}…`;
      const result = await message("install-dictionary", { manifestUrl, mode });
      if (!result.ok) throw new Error(`${labels[mode]}: ${result.error}. Download again to resume.`);
      total += result.data.entryCount;
    }
    $("#message").textContent = `Installed ${modes.length} dictionaries · ${total.toLocaleString("en-US")} entries.`;
    await refresh();
  } catch (error) { $("#message").textContent = error.message; }
  finally { installing = false; $("#install").disabled = false; $("#install-all").disabled = false; $("#mode").disabled = false; }
}
$("#install").addEventListener("click", () => { void installModes([$("#mode").value]); });
$("#install-all").addEventListener("click", () => { void installModes(["en-vi", "vi-en", "en-en"]); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.dictionaryProgress && installing && changes.dictionaryProgress.newValue?.state !== "ready") showProgress(changes.dictionaryProgress.newValue);
});
$("#flashcards").addEventListener("click", async () => {
  const result = await message("open-flashcards");
  if (!result.ok) $("#message").textContent = result.error;
});
for (const id of ["#settings", "#open-settings"]) $(id).addEventListener("click", () => chrome.runtime.openOptionsPage());
void refresh();
