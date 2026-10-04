import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundle application imports in memory so Node can run the Worker's TS modules.
const bundle = await build({
  stdin: {
    contents: `
      export { getSchedule } from './src/db/schedule';
      export { handleMessage } from './src/services/commands';
      export { broadcastMatch } from './src/services/notifications';
      export { enqueueUpcomingMatches } from './src/scheduler/enqueue';
      export { getCurrentSeason, matchesResponseSchema } from './src/api/vtb';
      export { formatGames } from './src/services/gameFormatter';
    `,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { getSchedule, handleMessage, broadcastMatch, enqueueUpcomingMatches, getCurrentSeason, matchesResponseSchema, formatGames } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function fixture() {
  const state = {
    backup: null as null | { payload: string; fetched_at: number },
    seasons: new Map<string, { season: number; fetched_at: number }>(),
    seasonReads: 0,
    seasonWrites: 0,
    seasonCalls: 0,
    matchCalls: 0,
    currentSeason: 2027,
    noCurrentSeason: false,
    failSeasonWrite: false,
    failUpstream: false,
    failWrite: false,
    reads: 0,
    writes: 0,
    upstreamCalls: 0,
    claims: 0,
    sent: [] as { text: string; parse_mode?: string }[],
    queued: [] as any[],
    game: {
      matchId: 42,
      matchStatus: "SCHEDULED",
      matchTimeMSK: new Date(Date.now() + 14 * 60_000).toISOString(),
      competitors: [
        { isHomeCompetitor: true, scoreString: 92, teamName: { ru: "Home" } },
        { isHomeCompetitor: false, scoreString: 68, teamName: { ru: "Away" } },
      ],
      customValues: { externalBroadcast: { url: "https://example.com/live" } },
    },
  };
  const env = {
    BOT_TOKEN: "test",
    TELEGRAM_API_BASE: "https://telegram.test",
    DB: {
      prepare(sql: string) {
        let args: any[] = [];
        return {
          bind(...values: any[]) { args = values; return this; },
          async first() {
            if (sql.includes("FROM season_cache")) {
              state.seasonReads++;
              return state.seasons.get(args[0]) ?? null;
            }
            assert.match(sql, /SELECT payload/);
            state.reads++;
            return state.backup;
          },
          async all() {
            if (sql.includes("FROM users")) {
              return { results: Array.from({ length: 20 }, (_, i) => ({ user_id: String(args[1] + i + 1) })) };
            }
            assert.match(sql, /FROM enqueued_matches/);
            return { results: [] };
          },
          async run() {
            if (sql.includes("INTO season_cache")) {
              state.seasonWrites++;
              if (state.failSeasonWrite) throw new Error("season write failed");
              state.seasons.set(args[0], { season: args[1], fetched_at: args[2] });
            } else if (sql.includes("INTO schedule_cache")) {
              state.writes++;
              if (state.failWrite) throw new Error("backup write failed");
              state.backup = { payload: args[0], fetched_at: args[1] };
            } else {
              assert.match(sql, /INTO sent_chunks/);
              state.claims++;
            }
            return { meta: { changes: 1 } };
          },
        };
      },
      async batch() { return []; },
    },
    MATCH_BROADCASTS: {
      async send(body: any) { state.queued.push(body); },
      async sendBatch(messages: any[]) { state.queued.push(...messages.map((message) => message.body)); },
    },
  };
  const fetchMock = async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(env.TELEGRAM_API_BASE)) {
      state.sent.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }
    assert.match(url, /^https:\/\/api\.vtb-league\.com\/v2\//);
    assert.ok(init?.signal, "upstream fetch must have a deadline");
    state.upstreamCalls++;
    if (url.includes("/matches?")) state.matchCalls++;
    else state.seasonCalls++;
    if (state.failUpstream) throw new Error("upstream unavailable");
    if (url.includes("/matches?")) {
      assert.deepEqual(new URL(url).searchParams.get("fields")?.split(",").sort(), [
        "matchId", "matchStatus", "matchTimeMSK", "competitors.isHomeCompetitor",
        "competitors.scoreString", "competitors.teamName.ru", "customValues.externalBroadcast.url",
      ].sort());
      return Response.json({ data: url.includes("/leagues/vtb/") ? [state.game] : [] });
    }
    return Response.json({ data: [{ isCurrent: !state.noCurrentSeason, season: state.currentSeason }] });
  };
  return { state, env, fetchMock };
}

test("projected competitors preserve schedule and score formatting", () => {
  const { state } = fixture();
  const projected = matchesResponseSchema.parse({ data: [state.game] }).data;
  const full = matchesResponseSchema.parse({ data: [{
    ...state.game,
    competitors: state.game.competitors.map((competitor, index) => ({
      ...competitor,
      teamId: index + 1,
      teamName: { ...competitor.teamName, en: "Unused English name" },
      roster: [{ unused: "data" }],
    })),
  }] }).data;
  assert.deepEqual(projected, full);
  for (const withScore of [false, true]) {
    const text = formatGames(projected, withScore);
    assert.equal(text, formatGames(full, withScore));
    assert.match(text, /Home/);
    assert.match(text, /Away/);
    assert.match(text, /https:\/\/example.com\/live/);
    if (withScore) assert.match(text, /92 : 68/);
  }
});

test("season cache", async (t) => {
  await t.test("season cache is independent per league", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    assert.equal((await getCurrentSeason(env, "vtb")).season, 2027);
    state.currentSeason = 2028;
    assert.equal((await getCurrentSeason(env, "wbc")).season, 2028);
    assert.equal((await getCurrentSeason(env, "vtb")).season, 2027);
    assert.equal(state.seasonCalls, 2);
    assert.equal(state.seasonWrites, 2);
  });

  await t.test("cache remains valid before 24 hours and refreshes at the boundary", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    const now = Date.now();
    t.mock.method(Date, "now", () => now);
    state.seasons.set("vtb", { season: 2026, fetched_at: now - 24 * 60 * 60_000 + 1 });
    assert.equal((await getCurrentSeason(env, "vtb")).season, 2026);
    assert.equal(state.seasonCalls, 0);
    state.seasons.set("vtb", { season: 2026, fetched_at: now - 24 * 60 * 60_000 });
    assert.equal((await getCurrentSeason(env, "vtb")).season, 2027);
    assert.equal(state.seasonCalls, 1);
    assert.equal(state.seasons.get("vtb")?.fetched_at, now);
  });

  await t.test("expired seasons are not used when refresh fails", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.seasons.set("vtb", { season: 2026, fetched_at: Date.now() - 24 * 60 * 60_000 });
    state.failUpstream = true;
    await assert.rejects(getCurrentSeason(env, "vtb"), /upstream unavailable/);
    assert.equal(state.seasonWrites, 0);
    assert.equal(state.seasons.get("vtb")?.season, 2026);
  });

  await t.test("absence of a current season is not cached", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.noCurrentSeason = true;
    await assert.rejects(getCurrentSeason(env, "vtb"), /No current season/);
    assert.equal(state.seasonWrites, 0);
  });

  await t.test("cache write failure does not discard a freshly fetched season", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.failSeasonWrite = true;
    assert.equal((await getCurrentSeason(env, "vtb")).season, 2027);
    assert.equal(state.seasons.size, 0);
  });
});

test("live schedule and fallback policies", async (t) => {
  await t.test("every call fetches live data and updates the backup without reading it", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    const first = await getSchedule(env, true);
    state.game.customValues.externalBroadcast.url = "https://example.com/new";
    const second = await getSchedule(env, true);
    assert.equal(first.stale, false);
    assert.equal(second.games[0].customValues.externalBroadcast.url, "https://example.com/new");
    assert.equal(state.upstreamCalls, 6);
    assert.equal(state.seasonCalls, 2);
    assert.equal(state.matchCalls, 4);
    assert.equal(state.reads, 0);
    assert.equal(state.writes, 2);
  });

  await t.test("commands report stale backup data and its timestamp", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.backup = { payload: JSON.stringify([state.game]), fetched_at: Date.parse("2026-01-01T00:00:00Z") };
    state.failUpstream = true;
    for (const text of ["/today", "/soon", "/past"]) {
      await handleMessage(env, { chatId: 1, username: "test", text });
    }
    assert.equal(state.sent.length, 3);
    for (const reply of state.sent) {
      assert.match(reply.text, /резервные данные/);
      assert.match(reply.text.replaceAll("\\", ""), /2026-01-01T00:00:00.000Z/);
    }
    assert.equal(state.writes, 0);
  });

  await t.test("all schedule commands request live data even with a fresh backup", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    for (const text of ["/today", "/soon", "/past"]) {
      await handleMessage(env, { chatId: 1, username: "test", text });
    }
    assert.equal(state.upstreamCalls, 8);
    assert.equal(state.seasonCalls, 2);
    assert.equal(state.matchCalls, 6);
    assert.equal(state.reads, 0);
    assert.equal(state.sent.length, 3);
    assert.ok(state.sent.every((reply) => !reply.text.includes("резервные данные")));
  });

  await t.test("commands with no backup return an unavailable message", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.failUpstream = true;
    await handleMessage(env, { chatId: 1, username: "test", text: "/today" });
    assert.match(state.sent[0].text, /временно недоступно/);
  });

  await t.test("a failed backup write does not discard live data", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.failWrite = true;
    assert.equal((await getSchedule(env)).stale, false);
    assert.equal(state.reads, 0);
  });

  await t.test("cron fetches on each run and never schedules from stale fallback", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.game.matchTimeMSK = new Date(Date.now() + 60 * 60_000).toISOString();
    await enqueueUpcomingMatches(env);
    await enqueueUpcomingMatches(env);
    assert.equal(state.upstreamCalls, 6);
    const queued = state.queued.length;
    state.failUpstream = true;
    await assert.rejects(enqueueUpcomingMatches(env), /upstream unavailable/);
    assert.equal(state.queued.length, queued);
    assert.equal(state.reads, 0);
  });

  await t.test("broadcast prepares a fresh snapshot once and reuses it across chunks", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    await broadcastMatch(env, { matchId: 42, offset: 0 });
    assert.equal(state.upstreamCalls, 4);
    const continuation = state.queued[0];
    assert.equal(continuation.offset, 20);
    assert.ok(continuation.snapshot.text.includes("https://example.com/live"));
    state.failUpstream = true;
    await broadcastMatch(env, continuation);
    assert.equal(state.upstreamCalls, 4);
    assert.equal(state.sent.length, 40);
    assert.ok(state.sent.every((reply) => reply.text === continuation.snapshot.text));
  });

  await t.test("old snapshots are refreshed before sending", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    await broadcastMatch(env, {
      matchId: 42, offset: 20,
      snapshot: { text: "old", fetchedAt: Date.now() - 5 * 60_000 },
    });
    assert.equal(state.upstreamCalls, 4);
    assert.ok(state.sent.every((reply) => reply.text !== "old"));
  });

  await t.test("broadcast refresh failure throws before claiming or sending", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.failUpstream = true;
    state.backup = { payload: JSON.stringify([state.game]), fetched_at: Date.now() };
    await assert.rejects(broadcastMatch(env, { matchId: 42, offset: 0 }), /upstream unavailable/);
    await assert.rejects(broadcastMatch(env, {
      matchId: 42, offset: 20,
      snapshot: { text: "old", fetchedAt: Date.now() - 5 * 60_000 },
    }), /upstream unavailable/);
    assert.equal(state.claims, 0);
    assert.equal(state.sent.length, 0);
    assert.equal(state.reads, 0);
  });

  await t.test("refresh suppresses broadcasts for moved or completed matches", async (t) => {
    const { state, env, fetchMock } = fixture();
    t.mock.method(globalThis, "fetch", fetchMock);
    state.game.matchTimeMSK = new Date(Date.now() + 60 * 60_000).toISOString();
    await broadcastMatch(env, { matchId: 42, offset: 0 });
    state.game.matchStatus = "COMPLETE";
    await broadcastMatch(env, { matchId: 42, offset: 0 });
    assert.equal(state.claims, 0);
    assert.equal(state.sent.length, 0);
  });
});
