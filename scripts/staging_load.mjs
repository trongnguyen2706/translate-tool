// Read-only, explicitly configured staged checks. Never calls a paid model or writes vocabulary.
import { writeFile, mkdir } from "node:fs/promises";
const origin = process.env.LOAD_TEST_ORIGIN, tokens = (process.env.LOAD_TEST_TOKENS ?? "").split(",").filter(Boolean);
const users = Number(process.env.LOAD_TEST_CONCURRENCY ?? 2), count = Number(process.env.LOAD_TEST_REQUESTS ?? 20);
if (!origin || !tokens.length || !Number.isInteger(users) || users < 1 || users > 20 || !Number.isInteger(count) || count < 1 || count > 200) throw new Error("Set LOAD_TEST_ORIGIN and comma-separated LOAD_TEST_TOKENS; concurrency 1–20 and requests 1–200 are supported.");
const url = new URL("/api/extension/session", origin);
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Use HTTPS or a loopback staging origin");
const rows = []; let next = 0;
await Promise.all(Array.from({ length: users }, async (_, worker) => {
  while (next < count) {
    const index = next++, start = performance.now();
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${tokens[worker % tokens.length]}` }, signal: AbortSignal.timeout(15000) });
      await response.arrayBuffer(); rows.push({ index, status: response.status, ms: performance.now() - start });
    } catch { rows.push({ index, status: 0, ms: performance.now() - start }); }
  }
}));
const latencies = rows.map((row) => row.ms).sort((a, b) => a - b);
const report = { origin: url.origin, path: url.pathname, concurrency: users, requests: rows.length,
  errors: rows.filter((row) => row.status !== 200).length, p50Ms: latencies[Math.floor(latencies.length * .5)], p95Ms: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * .95))], measuredAt: new Date().toISOString() };
await mkdir("artifacts/reports", { recursive: true });
await writeFile("artifacts/reports/staging-load.json", JSON.stringify(report, null, 2));
console.log(report);
if (report.errors) process.exitCode = 1;
