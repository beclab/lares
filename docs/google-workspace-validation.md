# Google Workspace plugin validation

Validation date: 2026-10-24. Implementation uses gogcli v0.46.0.

## Automated checks

- Typecheck: passed.
- PC plugin, Vue, and server production builds: passed. Vite reports its existing
  bundle-size advisory; the build succeeds.
- Full repository suite with `LARES_TEST_GOG_BIN` pointing at the pinned binary:
  **1,073 passed, 0 failed, 0 skipped**.
- Focused Google Workspace and HA tests: **21 passed**. This includes real CLI
  encrypted client import, remote PKCE URL generation, launcher execution, and
  recreation without changing its persistent keyring password.
- Full installation against the upstream release: passed binary SHA-256 checking,
  extraction of all seven matching skills, and execution through the installed
  launcher without a configured Google account.

## Actual UI checks

Tests used the full local dsh Host and actual Vue components with a separate data
and workspace directory. An initial occupied test port was rejected as evidence;
checks were repeated against a newly isolated Host whose API returned both plugin
IDs. The preview displayed build ID
`8200cc9-dc226e2c1852-1b791e6e715e-9b5e0376ee60` (working tree included the plugin).
The final build additionally changes the enable/disable action labels.

| Surface | Viewport | Observed result | Remaining work |
| --- | --- | --- | --- |
| Official dsh PC | Initial desktop default; later DOM viewport 1280×900 | Plugins navigation, HA/Google cards, actual download and enable, invalid JSON rejection, encrypted synthetic Desktop JSON import, and remote authorization form passed | Final-build reload and enable/disable UI check blocked by expired local Router debug identity; desktop screenshot capture did not reliably follow the viewport override and is not layout acceptance evidence |
| Vue mobile settings | 390×844 confirmed in the real preview | Shared Host state, Google installation/configuration, authorization status, and connection inputs loaded; narrow-layout screenshot retained locally | Complete authorization, final-build reload, and new chat task remain blocked |
| Vue mobile chat | Not executed this run | Blocked | Existing debug Router identity returned HTTP 401; no simulated reply substituted |
| Vue desktop chat/settings | Not executed this run | Blocked | Existing debug Router identity expired before the final restart |

The isolated Host's Router catalog reported HTTP 401 and zero usable models;
voice capability reads returned `voice_model_unavailable`. The local debug key
subsequently reached its recorded expiration. The isolated processes were stopped.
No replacement key was created, permissions expanded, or authentication disabled.
A renewal request was left for the user as required by local debugging rules.

Screenshots and sanitized local notes are retained outside tracked source. The
mobile screenshot shows the tested pre-final label text; it does not prove the
final build was reloaded. Unusable desktop screenshot output is excluded from
layout acceptance.

## Google-account verification still required

The client JSON used in tests is synthetic and cannot authorize a real account.
The following are **blocked by missing dedicated test credentials**, not passed:

- Complete Google browser consent and store a real account refresh token.
- Refresh a real token after restart and reconnect after revocation.
- Read Gmail, Calendar, Drive, Docs, Sheets, and Slides with that account.
- Complete a real Agent task that reads Google data through the launcher.

No Google account was connected and no user Google data was read during this run.
