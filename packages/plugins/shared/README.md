# Shared plugin foundations

Only infrastructure used by multiple Dina plugins belongs here.

- `client/`: dsh primitive compositions, locale/lifecycle helpers, and shared settings CSS.
- `host/`: bounded HTTP handling, atomic JSON files, and normalized Router catalog rows.

Feature rules stay with their owner:

- model/default-selection policy → `plugins/models`
- search-provider behavior → `plugins/web-search`
- recording/transcription behavior → `plugins/voice-input`

Shared modules must not import a feature plugin. Feature plugins may import shared modules with a relative source import so client builds inline them and Host plugins use the same authoritative implementation.
