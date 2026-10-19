const $ = (selector) => document.querySelector(selector);
const message = (type, values = {}) => chrome.runtime.sendMessage({ protocol: 1, type, ...values });
const labels = { "en-en": "Anh → Anh", "en-vi": "Anh → Việt", "vi-en": "Việt → Anh" };
let installing = false;

function showProgress(progress) {
  if (!progress) return;
  const count = `${progress.installedEntries.toLocaleString("vi-VN")} / ${progress.totalEntries.toLocaleString("vi-VN")} mục`;
  $("#message").textContent = progress.state === "interrupted"
    ? `${labels[progress.mode]} bị gián đoạn: ${progress.error}. Bấm tải lại để tiếp tục từ phần đã kiểm tra.`
    : `${labels[progress.mode]}: ${count} · phần ${progress.completedChunks}/${progress.totalChunks}. Giữ cửa sổ mở đến khi hoàn tất.`;
}

async function refresh() {
  const response = await message("get-config");
  const config = response.data ?? {};
  $("#mode").value = config.mode ?? "en-vi";
  $("#account").textContent = config.account?.email ? `Đã đăng nhập: ${config.account.email}` : "Chưa đăng nhập";
  const installed = await chrome.runtime.sendMessage({ protocol: 1, type: "lookup", term: "the", mode: $("#mode").value });
  $("#dictionary").textContent = installed.data?.missingPack ? "Chưa tải từ điển cho chế độ này." : `Từ điển ${installed.data?.dataVersion ?? "đã sẵn sàng"}`;
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
  $("#message").textContent = "Đang tải và kiểm tra gói… Giữ cửa sổ này mở đến khi hoàn tất.";
  try {
    const { manifestUrl } = await chrome.storage.local.get("manifestUrl");
    if (!manifestUrl) throw new Error("Nhập manifest URL trong Cài đặt trước.");
    let total = 0;
    for (const mode of modes) {
      $("#message").textContent = `Đang chuẩn bị ${labels[mode]}…`;
      const result = await message("install-dictionary", { manifestUrl, mode });
      if (!result.ok) throw new Error(`${labels[mode]}: ${result.error}. Bấm tải lại để tiếp tục.`);
      total += result.data.entryCount;
    }
    $("#message").textContent = `Đã cài ${modes.length} bộ · ${total.toLocaleString("vi-VN")} mục.`;
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
