# FlowStudio: empty family only

Load this only when the family had **no usable row**: the list was empty, or every same-family row already failed. One stale 404 is not an empty family — go back and try the next row.

Nothing here authorizes calling FlowStudio itself. Whatever this finds, generation still goes through produce.

## Is it installed?

```bash
olares-cli market status flowstudio -o json
```

`running` counts as installed. Missing, uninstalled, or stopped → not a hit; go to [fallback.md](fallback.md), which is where an install is offered.

## Installed, family still empty

A sync replaces the provider's catalog and can delete working rows, so **ask the user first**. Use the provider name the catalog already shows for FlowStudio rows of other families (for example `flowstudio-manual`); use `flowstudio` only when no FlowStudio row is listed at all. `provider register` is only for an installed application with no Router provider yet — never install a second copy.

```bash
olares-cli router provider register <provider>
olares-cli router provider sync-models <provider>
curl -sS "$LARES_LLM_BASE_URL/models?detail=capabilities"
```

Re-list through the shim with `detail=capabilities`, as produce does: pick needs `creative`, `canonical_fields`, and `flowstudio.parameters`, and `olares-cli router list` can fail on the workspace lock and look like a sync that fixed nothing.

After a sync the user approved, return to produce (list → pick → call). Sync once; do not keep repairing modes with `model add` / `model delete`.

## Still nothing

FlowStudio serves published scenes only. If it is running but the re-list still has no row whose output is this family (`image`, `video`, `audio`, `model3d`), say so: publishing or installing a scene is an admin action inside FlowStudio, and authoring a Comfy graph is not the first move. Then [fallback.md](fallback.md).
