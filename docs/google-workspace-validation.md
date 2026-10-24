# Google Workspace plugin validation

Validation date: 2026-10-24. Implementation uses gogcli v0.46.0.

## Automated checks

- Typecheck: passed.
- PC plugin, Vue, and server production builds: passed. Vite reports its existing
  bundle-size advisory; the build succeeds.
- Full repository suite with `LARES_TEST_GOG_BIN` pointing at the pinned binary:
  **1,082 passed, 0 failed, 0 skipped**.
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
IDs. The final preview displayed build ID
`e3d0dff-13d8267dfa66-891d656eec57-9b5e0376ee60`.

| Surface | Viewport | Observed result | Remaining work |
| --- | --- | --- | --- |
| Official dsh PC | 1280×900 | Plugins navigation, HA/Google cards, actual download and auto-enable, invalid JSON rejection, encrypted synthetic Desktop JSON import, remote authorization form, disable/re-enable, and persistence after reload and Host restart passed | Real Google authorization and Agent task require test credentials and an available chat model |
| Vue mobile settings | 390×844 | Shared Host state, installed/enabled Google plugin, saved OAuth configuration, account input, enabled Connect action, and narrow layout passed | Real Google authorization requires test credentials |
| Vue mobile chat | 390×844 | Real chat component loaded and displayed no available chat model | Real task blocked by empty authorized chat catalog |
| Vue desktop settings | 1280×900 | Shared plugin state, HA configuration form, Google setup guide, saved configuration and connection form passed | Real Google authorization requires test credentials |
| Vue desktop chat | 1280×900 | Real chat component loaded; model-unavailable state disabled composer and Send | Real task blocked by empty authorized chat catalog |

After explicit user approval, a seven-day dedicated Router test key was renewed
within the original model permission scope. The Router model catalog returned
HTTP 200 with zero chat models and no authorization failures. Missing models were
not replaced with placeholders or accessed through an administrator identity.
Settings and chat-shell checks above use that renewed identity; no successful
model task is claimed.

PC, mobile, and desktop screenshots plus sanitized local notes are retained
outside tracked source. The PC screenshot shows the final plugin action labels;
the mobile screenshot verifies the Google connection form at the narrow viewport.

## Google-account verification still required

The client JSON used in tests is synthetic and cannot authorize a real account.
The following are **blocked by missing dedicated test credentials**, not passed:

- Complete Google browser consent and store a real account refresh token.
- Refresh a real token after restart and reconnect after revocation.
- Read Gmail, Calendar, Drive, Docs, Sheets, and Slides with that account.
- Complete a real Agent task that reads Google data through the launcher.

No Google account was connected and no user Google data was read during this run.
