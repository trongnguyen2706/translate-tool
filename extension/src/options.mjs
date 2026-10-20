const $ = (selector) => document.querySelector(selector);
const fields = ["appOrigin", "supabaseUrl", "supabaseAnonKey", "googleClientId", "manifestUrl"];

async function load() {
  const stored = await chrome.storage.local.get(fields);
  for (const field of fields) if (stored[field]) $(`#${field}`).value = stored[field];
  $("#youtubeEnabled").checked = (await chrome.storage.local.get("youtubeEnabled")).youtubeEnabled !== false;
}

$("#settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(fields.map((field) => [field, $(`#${field}`).value.trim()]));
  await chrome.storage.local.set({ ...values, youtubeEnabled: $("#youtubeEnabled").checked });
  $("#status").textContent = "Settings saved.";
});

$("#signIn").addEventListener("click", async () => {
  $("#status").textContent = "Opening Google sign-in…";
  const values = Object.fromEntries(fields.map((field) => [field, $(`#${field}`).value.trim()]));
  const result = await chrome.runtime.sendMessage({ protocol: 1, type: "sign-in", config: values });
  $("#status").textContent = result.ok ? `Signed in as ${result.data.email}.` : result.error;
});

$("#signOut").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ protocol: 1, type: "sign-out" });
  $("#status").textContent = result.ok ? "Signed out. The previous account's pending saves have been kept." : result.error;
});

void load();
