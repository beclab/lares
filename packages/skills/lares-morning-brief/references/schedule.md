# Schedule briefs

Each topic runs at its own `time` in its own zone. The scheduled prompt only names the topic; everything else comes from `topics.yaml` when it runs, so editing a topic's focus or sources needs no schedule change.

## With the schedule tool

Use this when `schedule_create` is in your tool list. A reminder is bound to the session that creates it and is delivered back into that same session, so create it from a session the user keeps for briefs, not from an unrelated chat. Say this when creating it.

One reminder per topic:

```json
{
  "title": "晨报 · tech",
  "prompt": "按 lares-morning-brief 的写入流程生成 tech 晨报。",
  "daily": { "time": "07:00:00", "time_zone": "Asia/Shanghai" }
}
```

- `title` is always `晨报 · <id>`. That is how an existing reminder is found again: `schedule_list`, match the title, then `schedule_update` it for a time change or `schedule_delete` it for a removed topic. Never create a second reminder with the same title.
- Topics on the same minute in the same session arrive as one batch message. Keep them a few minutes apart, as the example config does, so each run has the session to itself.
- The reminder only fires while Lares is running. A missed morning delivers once when it next starts, not once per missed day.

## Without the schedule tool

`schedule_create` missing means the experimental schedule plugin is off. Tell the user to enable **自动化任务 / Automation tasks** under Settings → Plugins (Official group) and start a new session, then come back. Do not substitute a shell loop or a container cron job.

## A fresh session per run

The schedule tool reuses one session, which keeps every past run in its context. When the user wants each run in a new session, the alternative is an external scheduler — for example an Olares cron job — that POSTs to the Lares webhook entrance:

```bash
curl -sS -X POST "<webhook entrance>/" -H 'content-type: application/json' \
  -d '{"prompt":"按 lares-morning-brief 的写入流程生成 tech 晨报。"}'
```

The webhook must be enabled under Settings → Webhook with a workspace path. It has no caller authentication, so only point a scheduler on the same node at it. Setting up that scheduler is the user's step; describe it, do not run it from here.
