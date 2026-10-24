# Read briefs

The question usually comes hours later, in a session that did not write the brief. Answer from the files.

1. **Resolve the date.** "今天" is today in the configured `time_zone` of `topics.yaml`; "昨天", "周一", or an explicit date resolve the same way. A range ("这周") is every date folder in it.
2. **Resolve the topic.** Match the user's words to `id` or `title` in `topics.yaml`. No topic named → all topics of that date.
3. **Scan before opening.** For each candidate file read only its front matter (`sed -n '1,/^---$/p' <file>`) and use `status`, `item_count`, and `summary` to decide which bodies to open. Open a body only when the question needs its items.
4. **Missing file.**
   - The folder or file does not exist and the topic's `time` today has not passed → say it has not been generated yet and when it will be.
   - The time has passed → say today's brief is missing, name the latest date that has one, and offer to generate it now (the write protocol), without doing so unasked.
   - `status: failed` or `partial` → say so and list `failed_sources` before answering from what is there.
5. **Answer.**
   - Quote or summarize the items that answer the question, each with its source URL as written in the file.
   - "X 提到了吗" → search the bodies of the resolved files (`grep -il`), then answer yes with the item, or no with the dates and topics checked.
   - Comparisons across days state which date each point comes from.
   - Something not in the brief is said to be not in the brief; a fresh search happens only when the user asks, per SKILL.md.
6. **Do not edit** a brief while reading. Corrections are a rerun of the write protocol.
