<template>
  <aside class="desktop-sidebar">
    <button
      type="button"
      class="desktop-sidebar__new"
      :disabled="state.starting"
      @click="$emit('create', defaultWorkspaceId)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.4a7.6 7.6 0 0 1 5.4 13L19.2 20l-3-.7A7.6 7.6 0 1 1 12 4.4Z"/><path d="M12 9v6M9 12h6"/></svg>
      <span>{{ t("desktop.newSession") }}</span>
    </button>

    <header class="desktop-sidebar__section-head">
      <span v-if="!searchOpen">{{ flat ? t("desktop.sessions") : t("desktop.workspaces") }}</span>
      <div v-else class="desktop-sidebar__search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>
        <input ref="search" v-model="query" :placeholder="t('desktop.searchSessions')" @keydown.esc="closeSearch" />
        <button type="button" @click="closeSearch" :aria-label="t('desktop.clearSearch')">×</button>
      </div>
      <div v-if="!searchOpen" class="desktop-sidebar__actions">
        <LaresPcTooltip :label="t('desktop.searchSessions')">
          <button type="button" :aria-label="t('desktop.searchSessions')" @click="openSearch">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>
          </button>
        </LaresPcTooltip>
        <LaresPcPopover v-model="optionsOpen" :width="170">
          <template #trigger="{ toggle }">
            <LaresPcTooltip :label="t('desktop.viewOptions')">
              <button type="button" :aria-label="t('desktop.viewOptions')" @click="toggle">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h9M17 9h3M4 15h3M11 15h9"/><circle cx="15" cy="9" r="2"/><circle cx="9" cy="15" r="2"/></svg>
              </button>
            </LaresPcTooltip>
          </template>
          <div class="desktop-sidebar__options">
            <p>{{ t("desktop.groupBy") }}</p>
            <button type="button" :data-selected="!flat" @click="flat = false; optionsOpen = false">{{ t("desktop.byWorkspace") }}</button>
            <button type="button" :data-selected="flat" @click="flat = true; optionsOpen = false">{{ t("desktop.oneList") }}</button>
            <p>{{ t("desktop.orderBy") }}</p>
            <button type="button" :data-selected="orderBy === 'updated'" @click="orderBy = 'updated'; optionsOpen = false">{{ t("desktop.recent") }}</button>
            <button type="button" :data-selected="orderBy === 'manual'" @click="orderBy = 'manual'; optionsOpen = false">{{ t("desktop.manual") }}</button>
          </div>
        </LaresPcPopover>
        <LaresPcTooltip :label="t('desktop.addWorkspace')">
          <button type="button" :aria-label="t('desktop.addWorkspace')" @click="$emit('browse-workspaces')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5.5H7A2.5 2.5 0 0 0 4.5 8v9A2.5 2.5 0 0 0 7 19.5h8a2.5 2.5 0 0 0 2.5-2.5v-3.5"/><path d="M19 4.5v4M17 6.5h4"/></svg>
          </button>
        </LaresPcTooltip>
      </div>
    </header>

    <div class="desktop-sidebar__list">
      <div v-if="!state.sessionsReady || !state.workspacesReady" class="desktop-sidebar__loading">
        <span v-for="i in 7" :key="i" />
      </div>
      <p v-else-if="state.workspaceError" class="desktop-sidebar__error">
        {{ state.workspaceError }}
        <button type="button" @click.stop="$emit('refresh-workspaces')">{{ t("agent.refresh") }}</button>
      </p>
      <p v-else-if="groups.length === 0" class="desktop-sidebar__empty">{{ t("history.empty") }}</p>
      <section
        v-for="group in groups"
        :key="group.key"
        class="desktop-sidebar__group"
      >
        <div
          v-if="!flat"
          class="desktop-sidebar__group-row"
          :data-open="actionMenu === `workspace:${group.workspaceId}`"
          :data-drop="dropEdge('workspace', group.workspaceId)"
          :draggable="Boolean(group.workspaceId) && orderBy === 'manual'"
          @dragstart="startWorkspaceDrag(group, $event)"
          @dragend="endDrag"
          @dragover.prevent="overWorkspace(group, $event)"
          @dragleave="leaveRow('workspace', group.workspaceId, $event)"
          @drop.prevent="dropWorkspace()"
        >
          <button type="button" class="desktop-sidebar__group-toggle" @click="toggleGroup(group.key)">
            <span
              class="desktop-sidebar__group-icon"
              :data-expanded="isExpanded(group.key)"
              :data-active="holdsCurrent(group)"
            >
              <svg class="desktop-sidebar__folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.6 2H20.5v9H3.5z"/></svg>
              <svg class="desktop-sidebar__caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6 15.5 12l-7 6z"/></svg>
            </span>
            <span>{{ group.title || t("desktop.ungrouped") }}</span>
          </button>
          <div v-if="group.workspaceId" class="desktop-sidebar__row-actions">
            <LaresPcPopover
              :model-value="actionMenu === `workspace:${group.workspaceId}`"
              :width="176"
              @update:model-value="setActionMenu(`workspace:${group.workspaceId}`, $event)"
            >
              <template #trigger="{ toggle }">
                <LaresPcTooltip :label="t('desktop.workspaceActions')">
                  <button
                    type="button"
                    class="desktop-sidebar__row-action"
                    :aria-label="t('desktop.workspaceActions')"
                    @click="toggle"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.35"/><circle cx="12" cy="12" r="1.35"/><circle cx="18" cy="12" r="1.35"/></svg>
                  </button>
                </LaresPcTooltip>
              </template>
              <div class="desktop-sidebar__action-menu">
                <button type="button" @click="openDialog('rename-workspace', group)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h3.2L18.6 8.6a2.05 2.05 0 0 0-2.9-2.9L5 15.8z"/></svg>
                  <span>{{ t("desktop.rename") }}</span>
                </button>
                <button type="button" data-danger="true" @click="openDialog('delete-workspace', group)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 7.5h13M10 7.5V6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M7 7.5l.8 11a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4l.8-11"/></svg>
                  <span>{{ t("desktop.deleteWorkspace") }}</span>
                </button>
              </div>
            </LaresPcPopover>
            <LaresPcTooltip :label="t('desktop.newSession')">
              <button
                type="button"
                class="desktop-sidebar__row-action"
                :aria-label="t('desktop.newSession')"
                @click="$emit('create', group.workspaceId)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </LaresPcTooltip>
          </div>
        </div>
        <div v-show="flat || isExpanded(group.key)" class="desktop-sidebar__sessions">
          <div
            v-for="session in visibleSessions(group)"
            :key="session.sessionId"
            class="desktop-sidebar__session-row"
            :data-current="session.sessionId === state.sessionId"
            :data-open="actionMenu === `session:${session.sessionId}`"
            :data-unseen="Boolean(state.unseen?.[session.sessionId])"
            :data-drop="dropEdge('session', session.sessionId)"
            draggable="true"
            @dragstart="startSessionDrag(group, session, $event)"
            @dragend="endDrag"
            @dragover.prevent.stop="overSession(group, session, $event)"
            @dragleave.stop="leaveRow('session', session.sessionId, $event)"
            @drop.prevent.stop="dropSession(group)"
          >
            <button
              type="button"
              class="desktop-sidebar__session"
              @click="$emit('pick-session', session.sessionId)"
              @contextmenu.prevent="openDialog('rename-session', session)"
            >
              <span class="desktop-sidebar__unseen" aria-hidden="true" />
              <span>{{ session.title || t("history.untitled") }}</span>
              <time>{{ relativeTime(session.updatedAt) }}</time>
            </button>
            <LaresPcPopover
              :model-value="actionMenu === `session:${session.sessionId}`"
              :width="150"
              @update:model-value="setActionMenu(`session:${session.sessionId}`, $event)"
            >
              <template #trigger="{ toggle }">
                <LaresPcTooltip :label="t('desktop.sessionActions')">
                  <button
                    type="button"
                    class="desktop-sidebar__session-action"
                    :aria-label="t('desktop.sessionActions')"
                    @click="toggle"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.35"/><circle cx="12" cy="12" r="1.35"/><circle cx="18" cy="12" r="1.35"/></svg>
                  </button>
                </LaresPcTooltip>
              </template>
              <div class="desktop-sidebar__action-menu">
                <button type="button" @click="openDialog('rename-session', session)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h3.2L18.6 8.6a2.05 2.05 0 0 0-2.9-2.9L5 15.8z"/></svg>
                  <span>{{ t("desktop.rename") }}</span>
                </button>
                <button type="button" @click="forkSession(session)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v5.5a3.5 3.5 0 0 0 3.5 3.5h6"/><path d="m14.5 11.5 3 3-3 3"/></svg>
                  <span>{{ t("desktop.forkSession") }}</span>
                </button>
                <button type="button" @click="openDialog('archive-session', session)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 9.5v8a1.5 1.5 0 0 0 1.5 1.5h11.4a1.5 1.5 0 0 0 1.5-1.5v-8"/><path d="M3.8 5.5h16.4v4H3.8z"/><path d="M10 13h4"/></svg>
                  <span>{{ t("desktop.archiveSession") }}</span>
                </button>
              </div>
            </LaresPcPopover>
          </div>
          <button
            v-if="!flat && overflowCount(group) > 0"
            type="button"
            class="desktop-sidebar__session-overflow"
            :aria-expanded="isSessionsExpanded(group.key)"
            @click="toggleSessions(group.key)"
          >
            {{ isSessionsExpanded(group.key)
              ? t("desktop.showLessSessions")
              : t("desktop.showMoreSessions", { n: overflowCount(group) }) }}
          </button>
        </div>
      </section>
    </div>
    <LaresPcDialog
      :open="Boolean(dialog)"
      :title="dialogTitle"
      :description="dialogDescription"
      :close-label="t('desktop.close')"
      :width="420"
      @close="closeDialog"
    >
      <input
        v-if="isRenameDialog"
        ref="dialogInput"
        v-model="dialogValue"
        class="desktop-sidebar__dialog-input"
        @keydown.enter.prevent="submitDialog"
      />
      <template #footer>
        <button type="button" class="desktop-sidebar__dialog-cancel" @click="closeDialog">{{ t("desktop.cancel") }}</button>
        <button
          type="button"
          class="desktop-sidebar__dialog-confirm"
          :data-danger="dialog?.kind === 'delete-workspace' || dialog?.kind === 'archive-session'"
          :disabled="isRenameDialog && !dialogValue.trim()"
          @click="submitDialog"
        >
          {{ dialogConfirmLabel }}
        </button>
      </template>
    </LaresPcDialog>
  </aside>
</template>

<script>
import {
  collapsedSessions,
  FLAT_SESSION_ORDER_KEY,
  groupWorkspaceSessions,
  hiddenSessionCount,
} from "@olares/lares-core/larepass/workspace";
import LaresPcDialog from "./ui/PcDialog.vue";
import LaresPcPopover from "./ui/PcPopover.vue";
import LaresPcTooltip from "./ui/PcTooltip.vue";
import {
  dropAnchor,
  insertSessionBefore,
  loadWorkspaceView,
  saveWorkspaceView,
  syncWorkspaceViewOrders,
} from "./workspace-view.js";

export default {
  name: "LaresDesktopSidebar",
  components: { LaresPcDialog, LaresPcPopover, LaresPcTooltip },
  props: {
    state: { type: Object, required: true },
    t: { type: Function, required: true },
  },
  emits: [
    "create", "pick-session", "browse-workspaces", "refresh-workspaces",
    "rename-workspace", "delete-workspace", "move-workspace", "move-session",
    "rename-session", "fork-session", "archive-session",
  ],
  data() {
    const view = loadWorkspaceView();
    return {
      query: "",
      searchOpen: false,
      optionsOpen: false,
      flat: view.groupBy === "flat",
      orderBy: view.orderBy,
      expanded: view.groupExpansion,
      sessionOrderByAccount: view.sessionOrderByAccount,
      sessionUpdatedAtByAccount: view.sessionUpdatedAtByAccount,
      sessionsExpanded: {},
      workspaceDrag: null,
      sessionDrag: null,
      dropHint: null,
      actionMenu: "",
      dialog: null,
      dialogValue: "",
    };
  },
  computed: {
    defaultWorkspaceId() {
      return this.state.currentWorkspaceId || this.state.workspaces[0]?.workspaceId || "";
    },
    groups() {
      return groupWorkspaceSessions(
        this.state.sessions,
        this.state.workspaces,
        this.state.archivedSessionIds,
        {
          query: this.query,
          orderBy: this.orderBy,
          flat: this.flat,
          currentSessionId: this.state.sessionId,
          sessionOrderByAccount: this.sessionOrderByAccount,
        },
      );
    },
    orderRevision() {
      return JSON.stringify({
        current: this.state.sessionId,
        sessions: this.state.sessions.map((row) => [row.sessionId, row.updatedAt, row.blank]),
        workspaces: this.state.workspaces.map((row) => [row.workspaceId, row.sessionIds]),
      });
    },
    isRenameDialog() {
      return this.dialog?.kind === "rename-workspace" || this.dialog?.kind === "rename-session";
    },
    dialogTitle() {
      if (this.dialog?.kind === "rename-workspace") return this.t("desktop.renameWorkspace");
      if (this.dialog?.kind === "delete-workspace") return this.t("desktop.deleteWorkspace");
      if (this.dialog?.kind === "rename-session") return this.t("desktop.renameSession");
      if (this.dialog?.kind === "archive-session") return this.t("desktop.archiveSession");
      return "";
    },
    dialogDescription() {
      if (this.dialog?.kind === "delete-workspace") {
        return this.t("desktop.deleteWorkspaceConfirm", { name: this.dialog.target.title });
      }
      if (this.dialog?.kind === "archive-session") return this.t("desktop.archiveSessionConfirm");
      return "";
    },
    dialogConfirmLabel() {
      if (this.dialog?.kind === "delete-workspace") return this.t("desktop.deleteWorkspace");
      if (this.dialog?.kind === "archive-session") return this.t("desktop.archiveSession");
      return this.t("desktop.save");
    },
  },
  watch: {
    orderRevision: {
      immediate: true,
      handler() {
        this.syncOrders();
      },
    },
    flat() {
      this.persistView();
    },
    orderBy(next, previous) {
      this.syncOrders(next === "updated" && previous !== "updated");
    },
    "state.workspaces": {
      immediate: true,
      handler(workspaces) {
        const next = { ...this.expanded };
        for (const workspace of workspaces ?? []) {
          if (!(workspace.workspaceId in next)) next[workspace.workspaceId] = true;
        }
        this.expanded = next;
        this.persistView();
      },
    },
  },
  methods: {
    openSearch() {
      this.searchOpen = true;
      this.$nextTick(() => this.$refs.search?.focus());
    },
    closeSearch() {
      this.query = "";
      this.searchOpen = false;
    },
    isExpanded(key) {
      return this.expanded[key] !== false;
    },
    toggleGroup(key) {
      this.expanded = { ...this.expanded, [key]: !this.isExpanded(key) };
      this.persistView();
    },
    isSessionsExpanded(key) {
      return this.sessionsExpanded[key] === true;
    },
    toggleSessions(key) {
      this.sessionsExpanded = { ...this.sessionsExpanded, [key]: !this.isSessionsExpanded(key) };
    },
    /** Colours the folder, so a folded group still says where the open session lives. */
    holdsCurrent(group) {
      return group.sessions.some((row) => row.sessionId === this.state.sessionId);
    },
    /** Folded groups cut to the same five rows the Lares app shows. */
    visibleSessions(group) {
      if (this.flat) return group.sessions;
      return collapsedSessions(group.sessions, this.isSessionsExpanded(group.key));
    },
    overflowCount(group) {
      return hiddenSessionCount(group.sessions);
    },
    viewState() {
      return {
        groupBy: this.flat ? "flat" : "workspace",
        orderBy: this.orderBy,
        groupExpansion: this.expanded,
        sessionOrderByAccount: this.sessionOrderByAccount,
        sessionUpdatedAtByAccount: this.sessionUpdatedAtByAccount,
      };
    },
    persistView() {
      saveWorkspaceView(this.viewState());
    },
    syncOrders(sortByRecency = false) {
      const next = syncWorkspaceViewOrders(this.viewState(), {
        sessions: this.state.sessions,
        workspaces: this.state.workspaces,
        currentSessionId: this.state.sessionId,
        sortByRecency,
      });
      this.sessionOrderByAccount = next.sessionOrderByAccount;
      this.sessionUpdatedAtByAccount = next.sessionUpdatedAtByAccount;
      this.persistView();
    },
    setActionMenu(key, open) {
      this.actionMenu = open ? key : "";
    },
    forkSession(session) {
      this.actionMenu = "";
      this.$emit("fork-session", session.sessionId);
    },
    openDialog(kind, target) {
      this.actionMenu = "";
      this.dialog = { kind, target };
      this.dialogValue = kind === "rename-workspace" ? target.title : kind === "rename-session" ? target.title || "" : "";
      if (this.isRenameDialog) this.$nextTick(() => {
        this.$refs.dialogInput?.focus();
        this.$refs.dialogInput?.select();
      });
    },
    closeDialog() {
      this.dialog = null;
      this.dialogValue = "";
    },
    submitDialog() {
      if (!this.dialog) return;
      const { kind, target } = this.dialog;
      if (kind === "rename-workspace" && this.dialogValue.trim()) {
        this.$emit("rename-workspace", target.workspaceId, this.dialogValue.trim());
      } else if (kind === "delete-workspace") {
        this.$emit("delete-workspace", target.workspaceId);
      } else if (kind === "rename-session" && this.dialogValue.trim()) {
        this.$emit("rename-session", target.sessionId, this.dialogValue.trim());
      } else if (kind === "archive-session") {
        this.$emit("archive-session", target.sessionId);
      } else {
        return;
      }
      this.closeDialog();
    },
    relativeTime(value) {
      if (!Number(value)) return "";
      const diff = Math.max(0, Date.now() - (Number(value) || 0));
      const days = Math.floor(diff / 86400000);
      if (days > 0) return this.t("desktop.daysAgo", { n: days });
      const hours = Math.floor(diff / 3600000);
      if (hours > 0) return this.t("desktop.hoursAgo", { n: hours });
      const minutes = Math.max(1, Math.floor(diff / 60000));
      return this.t("desktop.minutesAgo", { n: minutes });
    },
    /** Which half of the hovered row the pointer is in, i.e. which edge the row lands on. */
    edgeOf(event) {
      const box = event.currentTarget.getBoundingClientRect();
      return event.clientY - box.top < box.height / 2 ? "before" : "after";
    },
    /** The rule the marker draws and the drop follows: land on this side of `key`. */
    dropEdge(kind, key) {
      if (!key || this.dropHint?.kind !== kind || this.dropHint.key !== key) return undefined;
      return this.dropHint.edge;
    },
    /** Dragging off a row drops its marker, but moving onto its own children does not. */
    leaveRow(kind, key, event) {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      if (this.dropHint?.kind === kind && this.dropHint.key === key) this.dropHint = null;
    },
    endDrag() {
      this.workspaceDrag = null;
      this.sessionDrag = null;
      this.dropHint = null;
    },
    startWorkspaceDrag(group, event) {
      if (!group.workspaceId || this.orderBy !== "manual") return event.preventDefault();
      this.workspaceDrag = group.workspaceId;
      event.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag whose transfer carries nothing.
      event.dataTransfer.setData("text/plain", group.workspaceId);
    },
    overWorkspace(group, event) {
      if (!this.workspaceDrag || !group.workspaceId) {
        this.dropHint = null;
        return;
      }
      event.dataTransfer.dropEffect = "move";
      this.dropHint = { kind: "workspace", key: group.workspaceId, edge: this.edgeOf(event) };
    },
    dropWorkspace() {
      const dragged = this.workspaceDrag;
      const anchor = this.dropHint?.kind === "workspace"
        ? dropAnchor(this.groups.map((group) => group.workspaceId).filter(Boolean), this.dropHint)
        : null;
      this.endDrag();
      if (!dragged || anchor === null || anchor === dragged) return;
      this.$emit("move-workspace", dragged, anchor);
    },
    startSessionDrag(group, session, event) {
      this.sessionDrag = {
        accountKey: this.flat ? FLAT_SESSION_ORDER_KEY : group.key,
        workspaceId: group.workspaceId,
        sessionId: session.sessionId,
      };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", session.sessionId);
    },
    overSession(group, session, event) {
      const accountKey = this.flat ? FLAT_SESSION_ORDER_KEY : group.key;
      if (accountKey !== this.sessionDrag?.accountKey) return;
      event.dataTransfer.dropEffect = "move";
      this.dropHint = { kind: "session", key: session.sessionId, edge: this.edgeOf(event) };
    },
    dropSession(group) {
      const drag = this.sessionDrag;
      const accountKey = this.flat ? FLAT_SESSION_ORDER_KEY : group.key;
      // The full list, not the collapsed one: dropping past the last visible row
      // lands before the first folded session, which is where the marker sits.
      const rows = group.sessions.map((row) => row.sessionId);
      const anchor = this.dropHint?.kind === "session" ? dropAnchor(rows, this.dropHint) : null;
      this.endDrag();
      if (!drag || anchor === null || accountKey !== drag.accountKey) return;
      const sessionId = drag.sessionId;
      if (anchor === sessionId) return;
      const current = this.sessionOrderByAccount[accountKey] ?? group.sessions.map((row) => row.sessionId);
      this.sessionOrderByAccount = {
        ...this.sessionOrderByAccount,
        [accountKey]: insertSessionBefore(current, sessionId, anchor),
      };
      this.persistView();
      if (this.orderBy === "manual" && group.workspaceId) {
        this.$emit("move-session", group.workspaceId, sessionId, anchor);
      }
    },
  },
};
</script>

<style scoped>
.desktop-sidebar { position:relative; display:flex; width:210px; min-width:180px; max-width:240px; flex:0 0 21%; min-height:0; flex-direction:column; border-right:1px solid var(--q-separator); background:var(--q-background-2, var(--q-background-1)); color:var(--q-ink-1); }
.desktop-sidebar svg { width:16px; height:16px; flex-shrink:0; fill:none; stroke:currentColor; stroke-width:1.65; stroke-linecap:round; stroke-linejoin:round; }
.desktop-sidebar button { font:inherit; }
.desktop-sidebar__new { display:flex; height:36px; flex-shrink:0; align-items:center; justify-content:center; gap:8px; margin:12px 10px 15px; border:0; border-radius:999px; background:var(--q-background-3); color:var(--q-ink-1); font-size:15px; cursor:pointer; }
.desktop-sidebar__new svg { width:18px; height:18px; }
.desktop-sidebar__new:hover { background:var(--q-background-hover); }
.desktop-sidebar__section-head { position:relative; display:flex; height:34px; flex-shrink:0; align-items:center; gap:6px; padding:0 10px; color:var(--q-ink-3); font-size:15px; }
.desktop-sidebar__section-head > span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.desktop-sidebar__actions { display:flex; flex-shrink:0; align-items:center; gap:1px; }
.desktop-sidebar__actions svg { width:19px; height:19px; }
.desktop-sidebar__actions button,
.desktop-sidebar__search button { display:grid; width:28px; height:28px; place-items:center; border:0; border-radius:6px; background:transparent; color:var(--q-ink-3); cursor:pointer; }
.desktop-sidebar__actions button:hover { background:var(--q-background-hover); color:var(--q-ink-1); }
.desktop-sidebar__search { display:flex; width:100%; align-items:center; gap:5px; border-radius:6px; padding-left:6px; background:var(--q-background-3); }
.desktop-sidebar__search input { min-width:0; flex:1; border:0; outline:0; padding:5px 0; background:transparent; color:var(--q-ink-1); font-size:14px; }
.desktop-sidebar__options { margin:-2px; }
.desktop-sidebar__options p { margin:0; padding:6px 7px 3px; color:var(--q-ink-3); font-size:12px; }
.desktop-sidebar__options button { display:block; width:100%; border:0; border-radius:5px; padding:6px 7px; background:transparent; color:var(--q-ink-2); font-size:13px; text-align:left; }
.desktop-sidebar__options button:hover { background:var(--q-background-hover); }
.desktop-sidebar__options button[data-selected="true"] { color:var(--q-blue-default); }
.desktop-sidebar__list { flex:1; min-height:0; overflow:auto; padding:2px 7px 14px; }
.desktop-sidebar__group { margin-bottom:5px; }
.desktop-sidebar__group-row { display:flex; min-height:28px; align-items:center; border-radius:6px; }
.desktop-sidebar__group-row:hover,
.desktop-sidebar__group-row[data-open="true"] { background:var(--q-background-hover); }
.desktop-sidebar__group-toggle { display:flex; min-width:0; width:100%; align-items:center; gap:6px; overflow:hidden; border:0; border-radius:6px; padding:5px 4px; background:transparent; color:var(--q-ink-2); text-align:left; cursor:pointer; }
.desktop-sidebar__group-toggle span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* At rest the folder names the group; pointing at the row turns the same slot
   into the control that opens it, so the caret must not shift the title. */
.desktop-sidebar__group-toggle > .desktop-sidebar__group-icon { display:grid; width:16px; height:16px; flex:0 0 16px; place-items:center; }
.desktop-sidebar__group-icon svg { grid-area:1/1; }
.desktop-sidebar__folder { color:var(--q-ink-3); }
.desktop-sidebar__group-icon[data-active="true"] .desktop-sidebar__folder { color:var(--q-blue-default); }
.desktop-sidebar__caret { color:var(--q-ink-3); fill:currentColor; stroke:none; opacity:0; transition:transform 120ms ease; }
.desktop-sidebar__group-icon[data-expanded="true"] .desktop-sidebar__caret { transform:rotate(90deg); }
.desktop-sidebar__group-row:hover .desktop-sidebar__folder,
.desktop-sidebar__group-row[data-open="true"] .desktop-sidebar__folder,
.desktop-sidebar__group-toggle:focus-visible .desktop-sidebar__folder { opacity:0; }
.desktop-sidebar__group-row:hover .desktop-sidebar__caret,
.desktop-sidebar__group-row[data-open="true"] .desktop-sidebar__caret,
.desktop-sidebar__group-toggle:focus-visible .desktop-sidebar__caret { opacity:1; }
.desktop-sidebar__row-actions { display:flex; flex-shrink:0; align-items:center; }
.desktop-sidebar__row-action { display:grid; width:22px; height:22px; place-items:center; border:0; border-radius:5px; background:transparent; color:var(--q-ink-3); cursor:pointer; opacity:0; pointer-events:none; }
.desktop-sidebar__group-row:hover .desktop-sidebar__row-action,
.desktop-sidebar__group-row[data-open="true"] .desktop-sidebar__row-action { opacity:1; pointer-events:auto; }
.desktop-sidebar__row-action:hover { color:var(--q-ink-1); }
.desktop-sidebar__row-action svg circle { fill:currentColor; stroke:none; }
.desktop-sidebar__sessions { display:flex; flex-direction:column; gap:1px; }
/* Reorder marker: the bar sits on the edge the dragged row lands on. */
.desktop-sidebar__group-row[data-drop],
.desktop-sidebar__session-row[data-drop] { position:relative; }
.desktop-sidebar__group-row[data-drop]::after,
.desktop-sidebar__session-row[data-drop]::after { content:""; position:absolute; right:2px; left:2px; height:2px; border-radius:2px; background:var(--q-blue-default); pointer-events:none; }
.desktop-sidebar__group-row[data-drop="before"]::after,
.desktop-sidebar__session-row[data-drop="before"]::after { top:-1px; }
.desktop-sidebar__group-row[data-drop="after"]::after,
.desktop-sidebar__session-row[data-drop="after"]::after { bottom:-1px; }
.desktop-sidebar__session-row { display:flex; width:100%; align-items:center; border-radius:7px; padding-right:4px; }
.desktop-sidebar__session-row:hover,
.desktop-sidebar__session-row[data-open="true"] { background:var(--q-background-hover); }
.desktop-sidebar__session-row[data-current="true"] { background:var(--q-background-3); }
.desktop-sidebar__session { display:flex; min-width:0; flex:1; height:30px; align-items:center; gap:6px; border:0; border-radius:7px; padding:0 4px 0 10px; background:transparent; color:var(--q-ink-2); font-size:13px; text-align:left; cursor:pointer; }
.desktop-sidebar__session > span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* Always laid out, so a session's title sits in the same place with or without
   the dot; the host sends no read state, the shell decides (see larepass/unread). */
.desktop-sidebar__session > .desktop-sidebar__unseen { width:6px; height:6px; flex:0 0 6px; border-radius:50%; background:transparent; }
.desktop-sidebar__session-row[data-unseen="true"] .desktop-sidebar__unseen { background:var(--q-positive, var(--q-green-default, #21c55d)); }
.desktop-sidebar__session time { flex-shrink:0; color:var(--q-ink-3); font-size:9px; }
.desktop-sidebar__session-row[data-current="true"] .desktop-sidebar__session { color:var(--q-ink-1); }
.desktop-sidebar__session-row:hover time,
.desktop-sidebar__session-row[data-open="true"] time { display:none; }
.desktop-sidebar__session-action { display:none; width:22px; height:22px; flex-shrink:0; place-items:center; border:0; border-radius:5px; background:transparent; color:var(--q-ink-3); cursor:pointer; }
.desktop-sidebar__session-row:hover .desktop-sidebar__session-action,
.desktop-sidebar__session-row[data-open="true"] .desktop-sidebar__session-action { display:grid; }
.desktop-sidebar__session-action:hover { color:var(--q-ink-1); }
.desktop-sidebar__session-action svg circle { fill:currentColor; stroke:none; }
/* Lares app parity: a plain text row, never a filled control. */
.desktop-sidebar__session-overflow { width:100%; height:26px; border:0; border-radius:7px; padding:0 8px 0 24px; background:transparent; color:var(--q-ink-3); font-size:13px; text-align:left; cursor:pointer; }
.desktop-sidebar__session-overflow:hover { color:var(--q-ink-2); }
.desktop-sidebar__action-menu { margin:-2px; }
.desktop-sidebar__action-menu button { display:flex; width:100%; align-items:center; gap:8px; border:0; border-radius:5px; padding:7px 8px; background:transparent; color:var(--q-ink-2); font-size:13px; text-align:left; cursor:pointer; }
/* Teleported out of `.desktop-sidebar`, so the sidebar's own icon rule misses these. */
.desktop-sidebar__action-menu svg { width:15px; height:15px; flex-shrink:0; fill:none; stroke:currentColor; stroke-width:1.65; stroke-linecap:round; stroke-linejoin:round; }
.desktop-sidebar__action-menu span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.desktop-sidebar__action-menu button:hover { background:var(--q-background-hover); }
.desktop-sidebar__action-menu button[data-danger="true"] { color:var(--q-red-default, #ef4444); }
.desktop-sidebar__dialog-input { box-sizing:border-box; width:100%; height:36px; border:1px solid var(--q-input-stroke, var(--q-separator)); border-radius:8px; padding:0 10px; outline:none; background:var(--q-background-2, transparent); color:var(--q-ink-1); font:inherit; font-size:15px; }
.desktop-sidebar__dialog-input:focus { border-color:var(--q-blue-default); }
.desktop-sidebar__dialog-cancel,
.desktop-sidebar__dialog-confirm { min-width:76px; height:32px; border-radius:7px; padding:0 12px; font:inherit; cursor:pointer; }
.desktop-sidebar__dialog-cancel { border:1px solid var(--q-separator); background:transparent; color:var(--q-ink-2); }
.desktop-sidebar__dialog-confirm { border:0; background:var(--q-blue-default); color:var(--q-ink-on-brand); }
.desktop-sidebar__dialog-confirm[data-danger="true"] { background:var(--q-orange-default); }
.desktop-sidebar__dialog-confirm:disabled { opacity:.5; cursor:default; }
.desktop-sidebar__loading { display:flex; flex-direction:column; gap:8px; padding:7px; }
.desktop-sidebar__loading span { height:24px; border-radius:6px; background:var(--q-background-3); animation:sidebar-pulse 1.2s ease-in-out infinite; }
.desktop-sidebar__empty,
.desktop-sidebar__error { margin:14px 8px; color:var(--q-ink-3); font-size:13px; }
.desktop-sidebar__error button { display:block; margin-top:7px; border:0; background:transparent; color:var(--q-blue-default); }
@keyframes sidebar-pulse { 50% { opacity:.45; } }
@media (prefers-reduced-motion: reduce) { .desktop-sidebar__loading span { animation:none; } }
</style>
