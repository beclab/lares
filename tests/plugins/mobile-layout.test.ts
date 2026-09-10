import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chatDevice, DESKTOP_CHAT_WIDTH_PX, DEVICE_DESKTOP, DEVICE_MOBILE } from "../../packages/mobile/src/layout.js";
import { placePanel } from "../../packages/mobile/src/desktop/ui/place.js";

test("chatDevice keeps the phone column unless the host passes desktop", () => {
  assert.equal(chatDevice("mobile"), DEVICE_MOBILE);
  assert.equal(chatDevice(undefined), DEVICE_MOBILE);
  assert.equal(chatDevice(""), DEVICE_MOBILE);
  assert.equal(chatDevice("tablet"), DEVICE_MOBILE);
  assert.equal(chatDevice("desktop"), DEVICE_DESKTOP);
  assert.equal(DESKTOP_CHAT_WIDTH_PX, 748);
});

test("LaresApp routes devices to separate shells while mobile keeps its surfaces", () => {
  const app = readFileSync(new URL("../../packages/mobile/src/App.vue", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../../packages/mobile/src/mobile/MobileShell.vue", import.meta.url), "utf8");
  assert.match(app, /v-if="chatDevice === 'desktop'"/);
  assert.match(app, /<LaresDesktopShell/);
  assert.match(app, /<LaresMobileShell/);
  for (const surface of [
    "LaresChatBar",
    "LaresHistoryPanel",
    "LaresTranscript",
    "LaresComposer",
    "LaresSheet",
    "LaresPreview",
    "LaresMobileDirectorySheet",
    "LaresMobileNewSession",
  ]) {
    assert.match(mobile, new RegExp(`<${surface}`));
  }
});

test("mobile new session uses a centered hero with workspace and model pickers", () => {
  const mobile = readFileSync(new URL("../../packages/mobile/src/mobile/MobileShell.vue", import.meta.url), "utf8");
  const hero = readFileSync(new URL("../../packages/mobile/src/mobile/MobileNewSession.vue", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../../packages/mobile/src/chat/Composer.vue", import.meta.url), "utf8");

  assert.match(mobile, /newSessionHero/);
  assert.match(mobile, /<LaresMobileNewSession/);
  assert.match(mobile, /\$emit\("pick-workspace"/);
  assert.match(hero, /@click="\$emit\('workspace'\)"/);
  assert.match(hero, /@click="\$emit\('model'\)"/);
  assert.match(composer, /chat\.placeholderNewSession/);
  assert.match(composer, /data-hero/);
});

test("mobile history groups sessions by workspace and exposes session actions", () => {
  const history = readFileSync(new URL("../../packages/mobile/src/chat/HistoryPanel.vue", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../../packages/mobile/src/mobile/MobileShell.vue", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../packages/mobile/src/App.vue", import.meta.url), "utf8");

  assert.match(history, /groupWorkspaceSessions/);
  assert.doesNotMatch(history, /groupSessionsByRecency/);
  assert.match(history, /browse-workspaces/);
  assert.match(history, /desktop\.searchSessions/);
  assert.match(history, /desktop\.viewOptions/);
  assert.match(history, /setGroupBy/);
  assert.match(history, /\$emit\("move-session"/);
  assert.match(mobile, /:workspaces="state\.workspaces"/);
  assert.match(mobile, /:archived-session-ids="state\.archivedSessionIds"/);
  assert.match(mobile, /@move-session="/);
  assert.match(mobile, /@rename-session="/);
  assert.match(mobile, /@archive-session="/);
  assert.match(app, /<LaresMobileShell[\s\S]*@refresh-workspaces="refreshWorkspaces"/);
  assert.match(app, /toggleHistory\(\)[\s\S]*refreshWorkspaces/);
});

test("desktop overlays use shared PC surfaces instead of browser dialogs", () => {
  const sidebar = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopSidebar.vue", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopComposer.vue", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../../packages/mobile/src/desktop/DirectoryBrowser.vue", import.meta.url), "utf8");
  const select = readFileSync(new URL("../../packages/mobile/src/settings/Select.vue", import.meta.url), "utf8");

  assert.doesNotMatch(sidebar, /\b(?:prompt|confirm)\s*\(/);
  assert.match(sidebar, /<LaresPcPopover/);
  assert.match(sidebar, /\$emit\('create', group.workspaceId\)/);
  assert.match(sidebar, /<LaresPcDialog/);
  assert.match(composer, /<LaresPcPopover/);
  assert.match(directory, /<LaresPcDialog/);
  assert.match(select, /<LaresPcPopover/);
});

test("icon-only buttons carry a PC tooltip instead of a native title", () => {
  const actions = readFileSync(new URL("../../packages/mobile/src/chat/MessageActions.vue", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopSidebar.vue", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopComposer.vue", import.meta.url), "utf8");

  for (const source of [actions, sidebar, composer]) {
    assert.match(source, /<LaresPcTooltip/);
    assert.doesNotMatch(source, /\stitle="/);
  }
});

test("the composer chip and the plus button are wired to the host, not to fixed copy", () => {
  const composer = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopComposer.vue", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../packages/mobile/src/App.vue", import.meta.url), "utf8");

  assert.match(composer, /state\.permissionRows/);
  assert.match(composer, /state\.permissionCurrent/);
  assert.match(composer, /state\.commands/);
  assert.match(composer, /t\('desktop\.commands'\)/);
  // The preset label now comes from the projection, so the old fixed key is gone.
  assert.doesNotMatch(composer, /desktop\.workspaceWrite/);
  assert.match(app, /@choose-permission="choosePermission"/);
  assert.match(app, /@open-commands="loadCommands"/);
  assert.match(app, /@pick-command="pickCommand"/);
});

test("the mobile composer offers @ references and slash commands from the host", () => {
  const composer = readFileSync(new URL("../../packages/mobile/src/chat/Composer.vue", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../../packages/mobile/src/mobile/MobileShell.vue", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../packages/mobile/src/App.vue", import.meta.url), "utf8");

  assert.match(composer, /open-references/);
  assert.match(composer, /open-commands/);
  assert.match(composer, /pick-command/);
  assert.match(composer, /activeReference/);
  assert.match(composer, /lares-composer__attachments/);
  assert.match(composer, /draftImages/);
  assert.match(shell, /:draft-images="state\.draftImages"/);
  assert.match(shell, /:references="state\.references"/);
  assert.match(shell, /:commands="state\.commands"/);
  assert.match(shell, /@open-references="\$emit\('open-references', \$event\)"/);
  assert.match(app, /<LaresMobileShell[\s\S]*@open-references="loadReferences"/);
});

test("a session that moved on unwatched shows a dot", () => {
  const sidebar = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopSidebar.vue", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../packages/mobile/src/App.vue", import.meta.url), "utf8");

  assert.match(sidebar, /:data-unseen="Boolean\(state\.unseen\?\.\[session\.sessionId\]\)"/);
  assert.match(sidebar, /desktop-sidebar__unseen/);
  assert.match(app, /unseenSessions\(this\.sessions, this\.seen, this\.sessionId\)/);
  assert.match(app, /this\.noteSeen\(snap\.sessionId\)/);
});

test("reply icons take pointer chrome and hover reveals the run readings", () => {
  const actions = readFileSync(new URL("../../packages/mobile/src/chat/MessageActions.vue", import.meta.url), "utf8");
  const transcript = readFileSync(new URL("../../packages/mobile/src/chat/Transcript.vue", import.meta.url), "utf8");

  assert.match(actions, /@media \(hover: hover\)/);
  assert.match(actions, /cursor: pointer/);
  assert.match(actions, /\.lares-actions button:hover \{\s*background: var\(--q-background-hover\)/);
  assert.match(actions, /\.lares-actions:hover \.lares-actions__stats/);
  // A touch reply keeps the bare row of icons it has today.
  assert.match(actions, /\.lares-actions__stats \{\s*display: none;\s*\}/);
  assert.match(transcript, /:metrics="row\.metrics \|\| null"/);
});

test("a workspace row trades its folder for a disclosure caret under the pointer", () => {
  const sidebar = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopSidebar.vue", import.meta.url), "utf8");

  assert.match(sidebar, /:data-expanded="isExpanded\(group\.key\)"/);
  // The group holding the open session keeps a blue folder, folded or not.
  assert.match(sidebar, /:data-active="holdsCurrent\(group\)"/);
  assert.match(sidebar, /\[data-active="true"\] \.desktop-sidebar__folder \{ color:var\(--q-blue-default\)/);
  assert.match(sidebar, /\.desktop-sidebar__group-row:hover \.desktop-sidebar__folder/);
  assert.match(sidebar, /\.desktop-sidebar__group-row:hover \.desktop-sidebar__caret/);
  assert.match(sidebar, /\[data-expanded="true"\] \.desktop-sidebar__caret \{ transform:rotate\(90deg\)/);
  // Both icons share one grid cell, so swapping them cannot move the title.
  assert.match(sidebar, /\.desktop-sidebar__group-icon svg \{ grid-area:1\/1; \}/);
});

test("dragging a row in the sidebar marks the slot it lands in", () => {
  const sidebar = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopSidebar.vue", import.meta.url), "utf8");

  assert.match(sidebar, /:data-drop="dropEdge\('workspace', group\.workspaceId\)"/);
  assert.match(sidebar, /:data-drop="dropEdge\('session', session\.sessionId\)"/);
  assert.match(sidebar, /\[data-drop="before"\]::after.+top:-1px/);
  assert.match(sidebar, /\[data-drop="after"\]::after.+bottom:-1px/);
  assert.match(sidebar, /\[data-drop\]::after \{[^}]*background:var\(--q-blue-default\)/);
  // The marker has to die with the drag, or it outlives every gesture.
  for (const handler of ["@dragend=\"endDrag\"", "@dragleave", "endDrag();"]) {
    assert.ok(sidebar.includes(handler), `sidebar is missing ${handler}`);
  }
});

test("the desktop transcript and composer share one reading column", () => {
  const shell = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopShell.vue", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopComposer.vue", import.meta.url), "utf8");

  assert.match(shell, /--lares-column:/);
  assert.match(shell, /width:var\(--lares-column\)/);
  assert.match(composer, /var\(--lares-column/);
});

test("the desktop composer exposes the host conversation controls", () => {
  const composer = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopComposer.vue", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopShell.vue", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../packages/mobile/src/App.vue", import.meta.url), "utf8");

  assert.match(composer, /state\.running \? t\('chat\.stop'\)/);
  assert.match(composer, /resolveSubmitMode\(/);
  assert.match(composer, /data-composer-card/);
  assert.match(composer, /data-dropping/);
  assert.match(composer, /row\.hint/);
  assert.match(composer, /@drop\.prevent="onDrop"/);
  assert.match(composer, /@paste="onPaste"/);
  assert.match(composer, /danger-full-access/);
  assert.match(composer, /permissionAcknowledged/);
  assert.match(composer, /<LaresDesktopQueue/);
  assert.match(composer, /<LaresDesktopContextMeter/);
  assert.match(shell, /@steer-queue="\$emit\('steer-queue'\)"/);
  assert.match(app, /runtime\.selectModel/);
  assert.match(app, /runtime\.cancel/);
  assert.match(app, /draftBySession/);
});

test("composer menus open upward and only flip when the space runs out", () => {
  const composer = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopComposer.vue", import.meta.url), "utf8");
  // Both chips sit right above the input box, so a downward menu covers it.
  assert.match(composer, /v-model="modelOpen" :width="260" placement="top-end"/);
  assert.match(composer, /v-model="effortOpen" :width="180" placement="top-end"/);

  const box = { top: 600, bottom: 632, left: 300, right: 560 };
  const viewport = { width: 1440, height: 900 };
  const upward = placePanel({ box, viewport, width: 260, placement: "top-end" });
  assert.equal(upward.top, "");
  assert.equal(upward.bottom, `${viewport.height - box.top + 5}px`);
  assert.equal(upward.left, `${box.right - 260}px`);
  assert.equal(upward.maxHeight, "595px");

  const cramped = placePanel({
    box: { top: 40, bottom: 72, left: 300, right: 560 },
    viewport,
    width: 260,
    placement: "top-end",
  });
  assert.equal(cramped.top, "77px");
  assert.equal(cramped.bottom, "");

  const downward = placePanel({ box, viewport, width: 260, placement: "bottom-start" });
  assert.equal(downward.top, `${box.bottom + 5}px`);
  assert.equal(downward.bottom, "");
  assert.equal(downward.left, `${box.left}px`);
});
