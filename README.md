# tg_bot

Telegram bot that publishes the VTB League basketball schedule and broadcasts each
match to subscribers 15 minutes before tip-off.

The bot runs as a TypeScript Cloudflare Worker with D1 and Queues.

## Architecture

| Concern | Implementation |
| --- | --- |
| Telegram commands | Worker `fetch` handler, webhook |
| Subscribers | D1 `users` table |
| Delayed broadcast | Cloudflare Queue with `delaySeconds` |
| Schedule polling | Wrangler cron, hourly at :05 |
| Schedule freshness | Live VTB request for each schedule command, cron run, and broadcast start |
| Current season IDs | D1 `season_cache`, independent 24 h TTL for each league |

```
scheduled (hourly)  ->  download season schedule  ->  queue message per match
                                                          delay = start - 15 min
queue (consumer)    ->  load subscribers in chunks of 20  ->  send broadcast
```

An hourly cron fetches the live season schedule and publishes a
queue message for every match whose broadcast instant falls inside the next 24
hours, which is the maximum `delaySeconds`. Later hourly runs pick up the matches
that were still out of range, so the 24-hour cap never causes a missed match.
`enqueued_matches` keys on `(match_id, fire_at)` so repeated runs are idempotent
and a rescheduled match gets a fresh message.

Schedule commands always attempt a live download, with a 10-second timeout per
upstream request. If the download fails, commands report temporary unavailability.
Match responses are not saved to D1. The legacy `schedule_cache` table is no longer
read or written; existing migrations and stored rows are left unchanged.

Only the current season ID is cached, separately for `vtb` and `wbc`. The first
request after 24 hours refreshes it; no background refresh is needed. Match data
is still downloaded on every schedule request: normally two VTB API calls instead
of four. A season switch may take up to 24 hours to be noticed. Expired season IDs
are not used if their refresh fails. Cache write failures are logged and do not
discard a freshly fetched season. Apply `0002_season_cache.sql` before deployment.

Cron requests and validates only match ID and start time, reducing JSON decoding
and validation work without changing the scheduling window or deduplication.
Command and broadcast requests project only consumed fields: ID, status, start time, home/away
flag, score, Russian team name, and broadcast URL. In particular, `competitors`
is projected through nested field paths rather than fetching complete team objects.

The first broadcast chunk fetches live data and prepares the notification text.
Continuation messages carry that text and its fetch time, avoiding repeated season
downloads for every chunk. Snapshots at least five minutes old are refreshed and
the match is rechecked before sending. Missing, completed, or not-yet-due matches
are skipped. A failed broadcast refresh throws before claiming the chunk, allowing
Queue retries rather than sending stale match data. This freshness change does
not change the existing chunk-claim or Telegram delivery guarantees.

## Commands

| Command | Result |
| --- | --- |
| `/today` | Matches today |
| `/soon` | Matches for the next 5 days |
| `/past` | Matches from the last 5 days, with scores |
| `/register` | Subscribe to broadcasts |
| `/unregister` | Unsubscribe |
| `/help` | Command list |

## Requirements

Workers **Free** plan. Relevant limits and how this project stays inside them:

| Limit | Value | How it is respected |
| --- | --- | --- |
| Subrequests per invocation | 50 | 20 recipients plus 2 VTB requests (4 on season cache misses) before retries; Telegram retries can exceed this budget |
| Simultaneous connections | 6 | `sendMessage` concurrency capped at 6 |
| Cron triggers per account | 5 | One cron |
| Queue `delaySeconds` | 86400 | Hourly cron re-queues the remainder |
| Queue message retention (Free) | 24 h | Enqueued messages are always delivered inside a day |
| CPU per invocation | 10 ms | Selected upstream fields; broadcast text reused across chunks; live download CPU must be measured |

## Local development

```bash
npm install
npm run db:init          # apply migrations to local D1
npm run dev              # wrangler dev on :8787
```

Put the token and API base into `.dev.vars` (git-ignored, see `.dev.vars.example`):

```
BOT_TOKEN="<token>"
TELEGRAM_API_BASE="https://api.telegram.org"
```

### End-to-end test

`npm test` runs deterministic schedule-policy tests with mocked VTB, Telegram,
D1, and Queue calls. It checks live refreshes, command unavailability, minimal cron fields, strict cron and
broadcast refreshes, snapshot reuse/expiration, and refresh failures without network
access. `npm run typecheck` checks the Worker source.

### Measuring JSON and validation cost

Run `npm run bench:vtb` to download real match responses using the Worker's URLs,
field selection, and Zod schema, then measure `JSON.parse`, Zod validation of
already-decoded JSON, and both together. The script reports median, p95 elapsed
time and mean process CPU per iteration after warmup. It does not use bot secrets
or D1, and excludes network/body-reading time from the measurements. These are
Node measurements for identifying expensive stages, not the production CPU budget.

Run `npm run bench:vtb -- --compare-fields` to additionally fetch the previous
full-competitor responses, verify that all consumed match fields are identical,
and compare byte sizes and parsing costs. This makes two additional API requests;
if live match data changes between requests, rerun the comparison.

For a profile in the actual local Workers runtime, run `npm run dev`, press `D`,
open the DevTools Profiler, start recording, issue several schedule commands, and
stop recording after their Telegram replies arrive. Inspect JSON decoding, Zod
parsing and formatting in the bottom-up view. Use a separate
test bot or the Telegram mock. Compare cold season-cache requests with warm ones.

Do not use `performance.now()` or `Date.now()` around synchronous parsing as a
production CPU meter: deployed Workers only advance those clocks after I/O, so
they may report zero. In production compare invocation CPU (not wall time) in
Workers Logs/metrics for the same command type, including p95 and `exceededCpu`
outcomes. Local runtimes/hardware and sampling differ from Cloudflare production.

`npm run e2e` drives the real production path with no token and no network to
Telegram:

```
mock Telegram  <--  poller (long polling)  -->  wrangler dev  -->  mock Telegram
```

It starts a scriptable Telegram mock, migrates a throwaway D1 via
`--persist-to`, boots the Worker with secrets from a temporary `--env-file`,
replays an 8-command conversation through the poller, then asserts on the
captured `sendMessage` calls — command routing, chat routing, `parse_mode`
selection and MarkdownV2 escaping. Exits non-zero on the first failed assertion,
and tears down its whole process tree. Your local D1 and `.dev.vars` are never
touched.

The schedule commands (`/today`, `/soon`, `/past`) do query the real
api.vtb-league.com, so the test needs outbound internet for those three.

### Driving a real bot against the local Worker

No tunnel and no public URL. The poller long-polls the Bot API and replays each
update into `wrangler dev`, so the production code runs unmodified:

```bash
npm run dev              # terminal 1
npm run poll             # terminal 2
```

Use a **separate bot from @BotFather**. A registered webhook makes Telegram
answer `getUpdates` with `409 Conflict` and stops the bot receiving updates
entirely, so the poller refuses to start while one is set:

```bash
node scripts/poller.ts --delete-webhook   # unregister, then poll
node scripts/poller.ts --drop-pending     # discard the backlog first
```

`scripts/poller.ts` reads the same `.dev.vars` as the Worker, advances its offset
only after the Worker accepts an update, honours `429` `retry_after`, and backs
off on network errors.

### Driving updates by hand

```bash
curl -X POST http://127.0.0.1:8787/ -H "Content-Type: application/json" \
  -d '{"update_id":1,"message":{"text":"/today","from":{"id":123,"username":"me"}}}'
```

The `200`/`!` reply only means the update was accepted; the bot answers in
Telegram.

### What stays manual locally

- **Cron does not fire by itself.** Trigger it:
  `curl http://127.0.0.1:8787/cdn-cgi/local/scheduled`.
- **The queue consumer honours `delaySeconds`,** so a broadcast scheduled 15
  minutes out will not be delivered during a test. `BROADCAST_LEAD_MINUTES` in
  `src/util/datetime.ts` is a constant, not a variable; shorten it temporarily if
  you need to watch a send land.
- Logs go to the `npm run dev` stdout. `npm run tail` only works against a
  deployed Worker.
- Reset local state by deleting `.wrangler/state`.

## Deployment

1. Create the D1 database and note its id:

   ```bash
   npx wrangler d1 create users
   ```

   Put the returned id into `wrangler.jsonc` in place of `REPLACE_WITH_D1_DATABASE_ID`.

2. Create both queues referenced in `wrangler.jsonc`:

   ```bash
   npx wrangler queues create match-broadcasts
   npx wrangler queues create match-broadcasts-dlq
   ```

3. Store the bot token and apply the schema:

   ```bash
   npx wrangler secret put BOT_TOKEN
   npm run db:init:remote
   ```

   `TELEGRAM_WEBHOOK_SECRET` is optional. If set, register the same value with
   Telegram so the Worker rejects requests that do not carry it.

4. Deploy and point the Telegram webhook at the Worker:

   ```bash
   npm run deploy
   curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d url=https://<worker>.<subdomain>.workers.dev \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```

5. CI tests, applies remote D1 migrations, and deploys on every push to `master`.
   It needs two repository secrets:
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Broadcast links

The link is read from `customValues.externalBroadcast.url` in the matches
response. Three things are worth knowing:

- **Most matches have no link yet.** In the current 2027 season 27 of 143 matches
  carry one, and providers publish them shortly before tip-off. That is why the
   broadcast path fetches live data before preparing the first chunk, rather than
   relying on a TTL-based season cache.
- **The tracking parameters are dropped.** The provider appends `utm_*` values
  whose underscores the Markdown mode used by `/today`, `/soon` and the
  broadcast treats as emphasis delimiters, which makes Telegram reject the whole
  message.
- **The link requires a Kinopoisk subscription.** It points at a Yandex SSO wall
  and only opens for paying viewers. That is a provider limitation.

## Known gaps

These are the main known correctness gaps and natural follow-ups.

- `/today`, `/soon`, `/past` filter against the current UTC date while match times
  are Moscow time. A match between 00:00 and 03:00 MSK lands on the previous day.
- A match with a single competitor is skipped silently.
- Team names fall back to `TBA` when the `ru` locale is missing or empty.
