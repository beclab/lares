# Write a brief

Input: one topic id. A scheduled reminder names it in its prompt; a batch reminder may name several — write each in turn, one file per topic.

1. **Load the topic.** Read `$BRIEFS/topics.yaml` and take the entry whose `id` matches. No such entry → write nothing and say the topic is not configured.
2. **Date.** `DATE` is today's local date in the topic's zone, `TZ=<zone> date +%F`. The target is `$BRIEFS/$DATE/<id>.md`. If it exists, this run replaces it (a rerun); say so in the reply.
3. **Collect.** For each source: a `query` is one web search; a `url` is one fetch. Follow at most one hop from a result or source page to the article it links. Keep only items that match `focus`, are not in `exclude`, and were published since the previous brief of this topic (read the previous date's file `generated_at`; none → the last 24 hours). Record every source that errored or returned nothing usable.
4. **Select.** Merge duplicates reported by several sources into one item with all their URLs. Rank by importance to `focus`, keep at most `max_items`.
5. **Write** the file below to `$BRIEFS/$DATE/.<id>.md.tmp`, then `mv` it onto `<id>.md`, so a reader never sees a half-written brief. Create `$BRIEFS/$DATE/` first if needed.
6. **Reply** with the title, the status, the item count, and the file path. Do not paste the brief.

## File format

```markdown
---
topic: tech
title: 科技晨报
date: 2026-10-24
generated_at: 2026-10-24T07:00:41+08:00
time_zone: Asia/Shanghai
status: ok
item_count: 6
summary: 一句话概括今天最重要的一到两件事。
failed_sources: []
---

# 科技晨报 · 2026-10-24

## 1. <标题>

<两到四句：发生了什么、为什么和 focus 相关。>

来源：<url>, <url>

## 2. ...
```

- `generated_at` is ISO 8601 with offset, taken from `date -Iseconds` in the topic's zone at the moment of writing.
- `summary` is one sentence; a reader decides from it whether to open the body.
- `failed_sources` lists each failed `query` or `url` verbatim with a short reason. `status` follows the table in SKILL.md.
- Every item has at least one source URL. An item without one is dropped, not written.
- `status: failed` → keep the front matter, `item_count: 0`, and a body that states what failed.
