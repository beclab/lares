# topics.yaml

One file, `$BRIEFS/topics.yaml`. If it does not exist, copy [topics.example.yaml](../assets/topics.example.yaml) there and edit the copy; never edit the example.

```yaml
version: 1
time_zone: Asia/Shanghai      # default IANA zone for every topic
language: zh-CN               # default language of the brief body
topics:
  - id: tech                  # [a-z0-9-], unique; becomes <id>.md
    title: 科技晨报
    time: "07:00"             # local HH:mm the brief is generated
    time_zone: Asia/Shanghai  # optional, overrides the default
    focus: >-
      AI 模型与推理框架发布、开源基础设施、芯片与算力。
    sources:
      - query: "AI model release"            # a web search
      - url: https://news.ycombinator.com/   # a page to read directly
    exclude: [融资传闻, 营销软文]
    max_items: 8
```

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Lowercase letters, digits, `-`. Unique. Renaming an id starts a new file series; old dates keep the old name. |
| `title` | yes | Shown as the brief's heading. |
| `time` | yes | `HH:mm`, 24-hour, local to the topic's zone. |
| `time_zone` | no | IANA name. Falls back to the top-level `time_zone`. |
| `language` | no | Falls back to the top-level `language`. |
| `focus` | yes | What counts as news for this topic, in the user's words. |
| `sources` | yes | Each entry is exactly one of `query` (search) or `url` (fetch). At least one. |
| `exclude` | no | Subjects to leave out even if a source has them. |
| `max_items` | no | Default 8. |

## Changing topics

- Edit the YAML in place and keep the user's comments. Validate before saving: `id` pattern and uniqueness, `time` format, one of `query`/`url` per source.
- A changed `time` or `time_zone`, an added topic, or a removed topic also changes its schedule — follow [schedule.md](schedule.md) in the same turn and tell the user what is now scheduled.
- Removing a topic never deletes its past briefs.
