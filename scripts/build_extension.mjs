import { cp, mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const output = path.join(root, "artifacts", "extension");
const manifestPath = path.join(source, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.manifest_version !== 3 || manifest.background?.type !== "module") {
  throw new Error("Expected a Manifest V3 extension with an ES module service worker");
}
if (manifest.permissions?.includes("unlimitedStorage")) {
  throw new Error("Do not request unlimitedStorage without a measured need");
}
for (const remoteExecutable of [manifest.background.service_worker, ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? [])]) {
  if (/^https?:/i.test(remoteExecutable)) throw new Error("Extension executable code must be packaged locally");
}
for (const relativePath of [manifest.background.service_worker, manifest.action?.default_popup, manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])])]) {
  if (relativePath) await access(path.join(source, relativePath));
}

await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true });
console.log(`Validated and copied Phrasebook extension ${manifest.version} to artifacts/extension`);
