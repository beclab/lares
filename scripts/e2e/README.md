# Machine 1 end-to-end regression

The live suite targets the active Olares profile and performs real mutations.
Every created resource uses a `lares-e2e-*` prefix. Cleanup runs in reverse
order from a journal even when an assertion fails; a cleanup failure fails the
suite and remains in the JSON report.

Browser jobs (`test:e2e:browser`, `test:e2e:plugins`, `test:e2e:media`) call
global `olares-browser-login` `session.mjs --machine 1`. That prepares the
Mac/machine-1 Wi-Fi /24 and uses the remembered `*.olares.local` entrance
(`.cache/olares-browser/entrance.json`), not `*.olares.com`. `OLARES_NO_DIALOG=1`
requires that file to already exist.

```bash
npm run test:e2e:cli
npm run test:e2e:media
npm run test:e2e:browser
```

Defaults:

- profile: `luolong01@olares.com`
- lightweight Market fixture: `jsonhero`
- report: `/tmp/lares-e2e-<timestamp>-report.json`

Override with `LARES_E2E_PROFILE`, `LARES_E2E_MARKET_APP`, and
`LARES_E2E_REPORT`. The suite refuses to reuse an already-installed Market
fixture because uninstalling a pre-existing app would destroy user state.

External-resource branches (NFS, SMB mounts, VPN routes, backup repositories,
GPU assignment) require explicit fixtures. They are reported as skipped when
the machine has no suitable fixture rather than being counted as passing.
