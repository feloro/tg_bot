---
name: telegram-bot-scheduling
description: Helps maintain and troubleshoot this TypeScript Telegram bot, including Cloudflare Worker webhooks, D1 state, Queue-delayed match broadcasts, schedule caching, and Telegram delivery failures.
---

# Telegram bot: scheduled match notifications

## Project context

The project publishes VTB League schedules and sends each subscriber a Telegram
notification 15 minutes before a match. It runs on Cloudflare Workers and uses:

- the Worker `fetch` handler for Telegram webhooks;
- an hourly Cron Trigger to discover upcoming matches;
- Cloudflare Queues with `delaySeconds` for delayed delivery;
- D1 for subscribers, schedule cache, enqueue state, and sent-chunk state;
- the Telegram Bot API for commands and outbound messages;
- the VTB API as the schedule and broadcast-link source.

Read `README.md`, `wrangler.jsonc`, and the relevant source before changing the
architecture. Cloudflare limits and provider responses can change.

## Runtime flow

### Commands

1. Telegram sends an update to the Worker webhook.
2. `src/index.ts` validates the optional webhook secret and parses the update.
3. `src/services/commands.ts` dispatches the command.
4. Schedule commands read through `src/db/schedule.ts` and
   `src/api/vtb.ts`.
5. `src/api/telegram.ts` sends the response.

### Scheduled broadcasts

1. The hourly cron invokes `enqueueUpcomingMatches()`.
2. Matches due within the Queue delay limit are enqueued for 15 minutes before
   tip-off.
3. `(match_id, fire_at)` in D1 prevents duplicate scheduling while allowing a
   rescheduled match to produce a new message.
4. The queue consumer reloads the match with a shorter cache tolerance, claims a
   subscriber chunk, and sends messages with bounded concurrency.
5. `(match_id, chunk_index)` prevents a retried queue message from resending an
   already completed chunk.

## Change guidelines

- Preserve the `fetch`, `scheduled`, and `queue` entry points in `src/index.ts`.
- Keep command handling independent from scheduled broadcast processing.
- Account for the Workers subrequest, CPU, and simultaneous-connection limits.
- Keep subscriber chunks small enough for all D1 and Telegram subrequests in one
  invocation.
- Treat Queue delivery as at least once and make each processing step idempotent.
- Store durable state in D1 rather than process memory.
- Keep tokens and webhook secrets in Worker secrets or local `.dev.vars`; never
  commit or log them.

## Correctness concerns

### Time zones

- VTB match values use an explicit Moscow offset.
- Queue delays must be calculated from the absolute match instant.
- Date-based commands currently use the UTC calendar date; check boundary
  behavior for matches between 00:00 and 03:00 MSK before changing it.
- Preserve offsets when parsing provider timestamps.

### Schedule freshness

- Providers can publish links shortly before tip-off.
- General command reads may use the six-hour D1 cache.
- Broadcast delivery uses a shorter cache tolerance to pick up late links.
- A changed start time must enqueue a new `(match_id, fire_at)` pair.
- Before changing cache policy, consider VTB requests, Worker CPU, and stale-link
  behavior together.

### Queue delivery

- Queue messages can be retried after ambiguous failures.
- Claiming work before Telegram delivery avoids duplicates but can lose a chunk
  if the invocation fails after the claim. Any change to claim timing must state
  which failure mode it prefers.
- Do not acknowledge a message until its processing path has completed.
- Keep dead-letter queue behavior and retention limits in mind.

### Telegram delivery

- Respect rate limits and `retry_after` on `429` responses.
- Handle blocked bots, deactivated users, invalid chat IDs, and malformed
  Markdown without failing unrelated recipients.
- Keep concurrency bounded and chunk large subscriber lists.
- Escape dynamic text according to the selected Telegram parse mode.
- Telegram messages have a length limit; split expanded schedule output safely.
- Log actionable errors without tokens or unnecessary personal data.

### Webhook security

- If `TELEGRAM_WEBHOOK_SECRET` is configured, register the same value with
  Telegram and reject mismatched requests.
- Confirm `getWebhookInfo.result.url` points to the deployed Worker.
- A successful webhook HTTP response only confirms acceptance; inspect Worker
  logs for asynchronous processing failures.

## Development workflow

1. Apply local D1 migrations with `npm run db:init`.
2. Run the Worker with `npm run dev`.
3. Run `npm run typecheck` after source changes.
4. Run `npm run e2e` for command, routing, parse-mode, and D1 coverage.
5. Trigger the local scheduled handler explicitly when testing cron behavior.
6. Use a separate Telegram bot when running `npm run poll`; polling conflicts
   with an active webhook.

The E2E scenario mocks Telegram but schedule commands still contact the VTB API,
so it requires outbound network access.

## Troubleshooting checklist

### A command receives no reply

- Check Worker logs for `webhook failed` and Telegram API errors.
- Verify the webhook URL and secret.
- Check Telegram Markdown parsing and message length.
- Confirm the update contains a supported command and expected message fields.

### A broadcast is missing

- Confirm the hourly cron ran.
- Inspect `enqueued_matches` for the match and expected `fire_at`.
- Check queue and dead-letter queue metrics.
- Inspect `sent_chunks` and the subscriber count.
- Verify the current match start time and status from the VTB API.

### A broadcast link is missing

- Inspect `customValues.externalBroadcast.url` in the current matches response.
- Compare the D1 cache age with the command or broadcast cache tolerance.
- Remember that many matches do not receive a link until shortly before tip-off.
- Check whether Telegram rejected the complete message because of formatting.

## Deployment checks

1. Apply remote D1 migrations.
2. Confirm both configured queues exist.
3. Store `BOT_TOKEN` and, when used, `TELEGRAM_WEBHOOK_SECRET` as secrets.
4. Run typechecking and E2E verification.
5. Deploy the Worker.
6. Register and verify the Telegram webhook.
7. Check Worker logs, cron executions, queue metrics, and D1 state.

Do not claim that the service will always remain free. Re-check current
Cloudflare quotas using the actual cron frequency, queue traffic, subscriber
count, D1 operations, Worker CPU, and outbound Telegram requests.
