# tg_bot

Telegram bot that publishes the VTB League basketball schedule and broadcasts each
match to subscribers 15 minutes before tip-off.

Originally Python on Yandex Cloud Functions. Now TypeScript on Cloudflare Workers
with D1 and Queues.

## Architecture

| Concern | Implementation |
| --- | --- |
| Telegram commands | Worker `fetch` handler, webhook |
| Subscribers | D1 `users` table |
| Delayed broadcast | Cloudflare Queue with `delaySeconds` |
| Schedule polling | Wrangler cron, hourly at :05 |
| Season schedule cache | D1 `schedule_cache` table, 6 h TTL, 30 min for broadcasts |

```
scheduled (hourly)  ->  download season schedule  ->  queue message per match
                                                          delay = start - 15 min
queue (consumer)    ->  load subscribers in chunks of 20  ->  send broadcast
```

An hourly cron runs `downloadGames()` (cached in D1 for 6 hours) and publishes a
queue message for every match whose broadcast instant falls inside the next 24
hours, which is the maximum `delaySeconds`. Later hourly runs pick up the matches
that were still out of range, so the 24-hour cap never causes a missed match.
`enqueued_matches` keys on `(match_id, fire_at)` so repeated runs are idempotent
and a rescheduled match gets a fresh message.

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
| Subrequests per invocation | 50 | Broadcasts are chunked to 32 recipients |
| Simultaneous connections | 6 | `sendMessage` concurrency capped at 6 |
| Cron triggers per account | 5 | One cron |
| Queue `delaySeconds` | 86400 | Hourly cron re-queues the remainder |
| Queue message retention (Free) | 24 h | Enqueued messages are always delivered inside a day |
| CPU per invocation | 10 ms | Season download is cached in D1 |

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

5. CI deploys on every push to `master` and needs two repository secrets:
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Broadcast links

The Python version asked `GET /v2/matches/{id}/info?fields=broadcast` for an iframe
URL. That endpoint now answers `{"data":{}}` for every match, so the lookup could
never succeed; Python additionally crashed on the missing key, because
`data["broadcast"]` is `None` and `None["iframeUrl"]` raises `TypeError` while only
`KeyError` is caught.

The link is now read straight from the matches response at
`customValues.externalBroadcast.url`, which also removes one request per match.
Three things are worth knowing:

- **Most matches have no link yet.** In the current 2027 season 27 of 143 matches
  carry one, and providers publish them shortly before tip-off. That is why the
  broadcast path refreshes the schedule with a 30 minute tolerance instead of the
  six hour window the commands use.
- **The tracking parameters are dropped.** The provider appends `utm_*` values
  whose underscores the legacy Markdown parse mode used by `/today`, `/soon` and
  the broadcast treats as emphasis delimiters, which makes Telegram reject the
  whole message.
- **The link requires a Kinopoisk subscription.** It points at a Yandex SSO wall
  and only opens for paying viewers. That is a provider limitation.

This is the one deliberate divergence from the Python output: Python always
printed "Отсутствует".

## Known gaps carried over from the Python version

Apart from broadcast links above, these are intentionally left as they are so the
TypeScript output keeps matching the Python output byte for byte. They are the
obvious follow-ups.

- `/today`, `/soon`, `/past` filter against `date.today()` in UTC while match times
  are Moscow time. A match between 00:00 and 03:00 MSK lands on the previous day.
- A match with a single competitor is skipped silently.
- Team names fall back to `TBA` when the `ru` locale is missing or empty.