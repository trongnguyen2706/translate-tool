const $ = (selector) => document.querySelector(selector);
const message = (type, values = {}) => chrome.runtime.sendMessage({ protocol: 1, type, ...values });

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
$("#install").addEventListener("click", async () => {
  $("#message").textContent = "Đang tải và kiểm tra gói…";
  try {
    const { manifestUrl } = await chrome.storage.local.get("manifestUrl");
    if (!manifestUrl) throw new Error("Nhập manifest URL trong Cài đặt trước.");
    const result = await message("install-dictionary", { manifestUrl, mode: $("#mode").value });
    if (!result.ok) throw new Error(result.error);
    $("#message").textContent = `Đã cài ${result.data.entryCount.toLocaleString("vi-VN")} mục.`;
    await refresh();
  } catch (error) { $("#message").textContent = error.message; }
});
$("#flashcards").addEventListener("click", async () => {
  const result = await message("open-flashcards");
  if (!result.ok) $("#message").textContent = result.error;
});
for (const id of ["#settings", "#open-settings"]) $(id).addEventListener("click", () => chrome.runtime.openOptionsPage());
void refresh();
