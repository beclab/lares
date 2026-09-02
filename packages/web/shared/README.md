# Shared PC UI foundations

Only dsh Web UI helpers used by more than one client plugin belong here:
dsh locale binding, React lifecycle, plugin CSS injection, settings controls,
and the catalog EventSource helper.

Business rules belong in `packages/core`. This directory must not grow Host
HTTP handlers, Router policy, or file/media logic.
