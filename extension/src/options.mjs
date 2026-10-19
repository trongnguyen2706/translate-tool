const $ = (selector) => document.querySelector(selector);
const fields = ["appOrigin", "supabaseUrl", "supabaseAnonKey", "googleClientId", "manifestUrl"];

async function load() {
  const stored = await chrome.storage.local.get(fields);
  for (const field of fields) if (stored[field]) $(`#${field}`).value = stored[field];
}

$("#settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(fields.map((field) => [field, $(`#${field}`).value.trim()]));
  await chrome.storage.local.set(values);
  $("#status").textContent = "Đã lưu cấu hình.";
});

$("#signIn").addEventListener("click", async () => {
  $("#status").textContent = "Đang mở đăng nhập Google…";
  const values = Object.fromEntries(fields.map((field) => [field, $(`#${field}`).value.trim()]));
  const result = await chrome.runtime.sendMessage({ protocol: 1, type: "sign-in", config: values });
  $("#status").textContent = result.ok ? `Đã đăng nhập ${result.data.email}.` : result.error;
});

$("#signOut").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ protocol: 1, type: "sign-out" });
  $("#status").textContent = result.ok ? "Đã đăng xuất. Hàng đợi của tài khoản cũ được giữ lại." : result.error;
});

void load();
