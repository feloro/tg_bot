---
name: telegram-bot-scheduling
description: Helps design, deploy, and troubleshoot a Telegram bot that fetches a daily event schedule and sends notifications 15 minutes before each event, especially using AWS Lambda, EventBridge Scheduler, DynamoDB, Google Cloud Run/Tasks, or Cloudflare Workers.
---

# Telegram bot: scheduled event notifications

## Project context

The reference project is https://github.com/feloro/tg_bot.

The target behavior discussed:
- Fetch the event (basketball match) schedule once at the beginning of each day.
- For every event, send a Telegram broadcast 15 minutes before its start.
- Usually there are around 2–3 events/notifications per day.
- Keep operating costs within provider free tiers where possible.
- The existing project was described in the conversation as Python-based, using `pyTelegramBotAPI`/`telebot`, a `bot.py` polling entry point, separate request/database modules, and DynamoDB-compatible storage via `boto3`. Verify the current repository before relying on these details; repository contents and provider terms can change.

## Recommended architecture

For an existing Python project with DynamoDB-compatible storage, consider:

1. A daily scheduler starts a short-lived schedule-fetcher.
2. The fetcher retrieves the day's events and calculates `notification_time = event_start - 15 minutes`.
3. It creates one delayed invocation per event.
4. At the scheduled time, a short-lived handler loads the current subscriber list and sends the Telegram messages.
5. The handler records completion/idempotency state and handles API errors/retries.
6. A separate webhook handler (or another always-available mechanism) handles `/register`, `/unregister`, and other interactive commands if users need those commands at any time.

Do not run an infinite `infinity_polling()` loop inside a scheduled job or short-lived serverless invocation.

## Platform options

### AWS Lambda + EventBridge Scheduler + DynamoDB

Often the least disruptive serverless option for a Python/DynamoDB-oriented project.

- Use EventBridge Scheduler for the daily schedule-fetching invocation.
- The fetcher creates one-time schedules for each event, targeting a notification Lambda.
- The notification Lambda reads subscribers and calls Telegram Bot API.
- Use DynamoDB for subscribers and notification state.
- Delete or expire one-time schedules after execution; consider lifecycle cleanup.
- Configure IAM roles with least privilege.
- Use a stable event identifier and idempotency record to prevent duplicate broadcasts.
- Check the AWS account's current Free Tier terms. Free-tier eligibility and credits can depend on account creation date and current pricing.

### Google Cloud Run Jobs + Cloud Scheduler + Cloud Tasks + Cloud Run Service

- Cloud Scheduler starts a daily Cloud Run Job.
- The job fetches the schedule and creates Cloud Tasks with `schedule_time` set to 15 minutes before each event.
- Cloud Tasks calls an authenticated Cloud Run Service endpoint that performs the broadcast.
- This avoids keeping a process alive.
- Cloud Tasks may retry delivery; make the handler idempotent.
- Check current free quotas, networking, image storage, logging, and billing details.

### Cloudflare Workers

Possible, but likely requires more adaptation if the current project is Python and uses `boto3`/`pyTelegramBotAPI`.

- Cron Triggers can run the daily schedule fetch.
- Workflows, Queues, or Durable Objects can coordinate delayed work, depending on requirements and current plan limits.
- D1 can store subscriber data, or another supported storage service can be used.
- A Worker can receive Telegram webhooks and call Telegram Bot API over HTTP.
- Verify Python compatibility and package support before choosing a Python Worker; a TypeScript implementation may be more straightforward.
- Check current plan limits, including CPU duration, Workflow limits, storage, and request quotas.

## Important correctness concerns

### Time zones and daylight saving time
- Store event times with explicit timezone information, preferably normalized to UTC.
- Calculate the notification instant as 15 minutes before the event.
- Configure daily schedule timezone intentionally.
- Handle daylight-saving transitions and events whose source timezone differs from the deployment timezone.

### Late schedule discovery
If the schedule is fetched less than 15 minutes before an event, define policy:
- skip the notification;
- send immediately if the event has not started; or
- apply a configurable lateness threshold.

### Changed or cancelled events
A daily fetch alone may become stale. If event times can change during the day:
- refresh the schedule periodically or consume updates;
- cancel/reschedule pending tasks when event times change;
- avoid notifying for cancelled events.

### Duplicate delivery
Serverless schedulers and task queues generally provide at-least-once delivery semantics or can retry after ambiguous failures. Use an idempotency key such as `(event_id, notification_type)` and persist a sent/in-progress state. Account for the tradeoff between marking before sending (possible lost message) and after sending (possible duplicate if the process crashes after Telegram accepted the message).

### Telegram limits and failures
- Respect Telegram Bot API rate limits.
- Handle `429` responses and `retry_after`.
- Handle blocked bots, deactivated users, and invalid chat IDs.
- For large subscriber lists, send in bounded batches and persist progress.
- Log per-recipient failures without leaking bot tokens or personal data.

### Security
- Store bot tokens and cloud credentials in managed secrets, not source code.
- Authenticate internal task endpoints.
- Use least-privilege IAM/service-account permissions.
- Never log secrets.

## Cost estimation approach

Do not promise that a deployment is always free. Estimate using actual:
- daily fetch count and execution duration;
- event count and delayed-task invocations;
- subscriber count and messages sent;
- memory/CPU configuration;
- database reads/writes;
- logs, network egress, image storage, and any API costs.

At 2–3 events per day, scheduling overhead is likely small, but subscriber volume and delivery duration can dominate. Confirm current provider pricing and the user's account-specific Free Tier before claiming zero cost. Billing budgets/alerts are useful but do not automatically stop spending.

## Practical implementation plan

1. Inspect the current repository and identify the exact schedule source, event identifiers, database schema, and command handlers.
2. Separate pure logic into functions:
   - `fetch_events(date)`
   - `compute_notification_time(event)`
   - `schedule_notification(event)`
   - `load_subscribers()`
   - `send_broadcast(event, subscribers)`
3. Keep the daily schedule-fetcher and notification handler as separate entry points.
4. Add durable task state and idempotency.
5. Add handling for time changes, cancellations, late discoveries, and retries.
6. Test with a small set of synthetic events scheduled a few minutes ahead.
7. Deploy to the selected platform and inspect logs and billing metrics.
8. If interactive bot commands are required, deploy a webhook handler separately from scheduled notification execution.

## Default recommendation

For a Python project already using DynamoDB-compatible storage, start by evaluating AWS Lambda + EventBridge Scheduler + DynamoDB because it can preserve more of the existing Python code and data model. Choose Google Cloud Run/Tasks if the project is already aligned with Google Cloud or its operational model is preferred. Choose Cloudflare Workers if willing to adapt the code and the Cloudflare runtime/storage model fits.

This is an architecture starting point, not a verified deployment recipe. Re-check the repository and current provider documentation before implementation.
