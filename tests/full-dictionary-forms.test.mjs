// Optional integration check against the operator's full, generated packs.
// No downloads, account credentials, database writes or model requests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { resolveWordForms } from "../extension/src/dictionary-core.mjs";

const manifestPath = path.resolve(process.argv[2] ?? "artifacts/dictionaries-learners/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const wanted = new Set(["excuse", "excuses", "go", "went", "child", "children", "run", "running", "restructure", "restructured", "weak", "weaker"]);
const report = [];
for (const pack of manifest.packages.filter((pack) => pack.direction !== "vi-en")) {
  const index = {};
  for (const chunk of pack.chunks) {
    const lines = gunzipSync(await readFile(path.resolve(path.dirname(manifestPath), chunk.url))).toString("utf8").split("\n");
    for (const line of lines) {
      if (!line) continue;
      const term = /^\{"term":"([^"]+)"/.exec(line)?.[1];
      if (wanted.has(term)) index[term] = JSON.parse(line).senses;
    }
  }
  if (pack.direction === "en-en" && manifest.dataVersion.includes("learners")) {
    assert.ok(index.weak?.some(s=>s.learner), "learner edition must be included in this pack");
    const weaker = await resolveWordForms("weaker",index.weaker,(base)=>index[base],pack.direction,pack.dataVersion);
    assert.equal(weaker[0].learner,true);
    assert.match(weaker[0].definitions[0],/strength/);
    assert.ok(!/uncool|proposition|entails/i.test(weaker[0].definitions[0]));
    report.push({mode:pack.direction,term:"weaker",first:weaker[0].definitions[0],learner:true});
  }
  for (const term of ["excuses", "went", "children", "running", "restructured"]) {
    assert.ok(index[term]?.length, `${pack.direction}: missing ${term}`);
    const started = performance.now();
    const result = await resolveWordForms(term,index[term],(base) => index[base],pack.direction,pack.dataVersion);
    const resolved = result.filter((sense) => sense.formStatus === "resolved");
    const useful = result.filter((sense) => sense.definitions?.length && sense.formStatus !== "unresolved");
    assert.ok(useful.length, `${pack.direction}: ${term} has no useful meaning`);
    if (pack.direction === "en-en" || term !== "running") assert.ok(resolved.length, `${pack.direction}: ${term} form reference was not resolved`);
    assert.ok(resolved.every((sense) => sense.definitions.length && !/^(plural|past tense|simple past|third-person|present participle)\b.*\bof\b/i.test(sense.definitions[0])));
    if (pack.direction === "en-en" && term === "excuses") {
      assert.ok(resolved.some((sense) => sense.partOfSpeech === "noun"));
      assert.ok(resolved.some((sense) => sense.partOfSpeech === "verb"));
      assert.ok(index[term].every((sense) => sense.formOfTerms?.includes("excuse")));
    }
    report.push({mode:pack.direction,term,resolved:resolved.length,useful:useful.length,ms:Math.round((performance.now()-started)*100)/100});
  }
}
console.log(JSON.stringify({dataVersion:manifest.dataVersion,checks:report},null,2));
