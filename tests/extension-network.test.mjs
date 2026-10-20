import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../extension/src/network.mjs";

test("enrichment transport returns JSON and preserves server errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ fields: { definitions: ["xin chào"] } }));
  assert.deepEqual(await requestJson("https://example.test/enrich"), { fields: { definitions: ["xin chào"] } });
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ error: "You have reached your daily AI limit." }, { status: 429 }));
  await assert.rejects(requestJson("https://example.test/enrich"), /daily AI limit/);
});

test("a stopped local server and an HTML error page produce actionable messages", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(requestJson("http://localhost:3000/api/extension/enrich"), /npm run dev/);
  globalThis.fetch.mock.mockImplementation(async () => new Response("<html>Error</html>", { status: 500 }));
  await assert.rejects(requestJson("https://example.test/enrich"), /HTTP 500/);
});

test("a stalled AI request is aborted instead of waiting indefinitely", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({})), 200);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }));
  await assert.rejects(requestJson("https://example.test/enrich", {}, 10), /timed out/);
});
