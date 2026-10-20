import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
const source = path.resolve("extension"), files = {};
async function include(relative) {
  const entries = await readdir(path.join(source, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Release sources must not contain symlinks");
    if (entry.isDirectory()) await include(name);
    else files[name] = [new Uint8Array(await readFile(path.join(source, name))), { mtime: new Date(1980, 0, 1, 0, 0, 0) }];
  }
}
await include("src"); await include("icons");
const manifest = await readFile(path.join(source, "manifest.json"));
files["manifest.json"] = [new Uint8Array(manifest), { mtime: new Date(1980, 0, 1, 0, 0, 0) }];
const version = JSON.parse(manifest).version;
await mkdir("artifacts/releases", { recursive: true });
await writeFile(`artifacts/releases/phrasebook-${version}.zip`, zipSync(files, { level: 9 }));
console.log(`Prepared artifacts/releases/phrasebook-${version}.zip (${Object.keys(files).length} packaged files; no credentials or dictionaries)`);
