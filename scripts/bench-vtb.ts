import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: "export { downloadGames, matchesResponseSchema } from './src/api/vtb';",
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { downloadGames, matchesResponseSchema } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

// Capture real response bodies using the same URLs and field selection as the Worker.
// The benchmark has no access to local/remote D1 and needs no bot credentials.
const payloads: { league: string; text: string; url: string; selection: string }[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  const url = String(input);
  if (response.ok && url.includes("/matches?")) {
    payloads.push({ league: url.match(/\/leagues\/([^/]+)\//)?.[1] ?? url, text: await response.clone().text(), url, selection: "projected" });
  }
  return response;
};
try {
  await downloadGames({
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { return null; },
          async run() { return { meta: { changes: 0 } }; },
        };
      },
    },
  });
} finally {
  globalThis.fetch = originalFetch;
}

const ITERATIONS = 500;
function measure(stage: string, operation: () => unknown) {
  for (let i = 0; i < 50; i++) operation();
  const samples: number[] = [];
  const cpuStart = process.cpuUsage();
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  const cpu = process.cpuUsage(cpuStart);
  samples.sort((a, b) => a - b);
  return {
    stage,
    median_ms: samples[Math.floor(samples.length * 0.5)].toFixed(3),
    p95_ms: samples[Math.floor(samples.length * 0.95)].toFixed(3),
    mean_process_cpu_ms: ((cpu.user + cpu.system) / 1000 / ITERATIONS).toFixed(3),
  };
}

if (process.argv.includes("--compare-fields")) {
  for (const projected of [...payloads]) {
    const url = new URL(projected.url);
    url.searchParams.set("fields", "matchId,matchStatus,matchTimeMSK,competitors,customValues.externalBroadcast.url");
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`VTB API ${response.status} for ${url}`);
    const text = await response.text();
    const normalize = (body: string) => matchesResponseSchema.parse(JSON.parse(body)).data
      .sort((a: { matchId: number }, b: { matchId: number }) => a.matchId - b.matchId);
    assert.deepEqual(normalize(projected.text), normalize(text), `${projected.league}: consumed fields differ`);
    const before = Buffer.byteLength(text);
    const after = Buffer.byteLength(projected.text);
    console.log(`${projected.league}: consumed fields identical; ${before} -> ${after} bytes (${(100 * (1 - after / before)).toFixed(1)}% reduction)`);
    payloads.push({ league: projected.league, text, url: url.toString(), selection: "full competitors" });
  }
}

console.log(`Node ${process.version}; ${ITERATIONS} measured iterations after warmup`);
console.log("Network and response-body reading are excluded. Node timings are not Cloudflare CPU measurements.");
for (const { league, text, selection } of payloads.sort((a, b) => a.league.localeCompare(b.league))) {
  const parsed = JSON.parse(text);
  console.log(`\n${league} (${selection}): ${parsed.data.length} matches, ${Buffer.byteLength(text)} bytes`);
  console.table([
    measure("JSON.parse", () => JSON.parse(text)),
    measure("Zod.parse (already decoded JSON)", () => matchesResponseSchema.parse(parsed)),
    measure("JSON.parse + Zod.parse", () => matchesResponseSchema.parse(JSON.parse(text))),
  ]);
}
