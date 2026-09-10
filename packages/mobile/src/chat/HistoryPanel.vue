<template>
  <div
    class="lares-history"
    :data-open="open ? 'true' : 'false'"
    :inert="!open"
    :aria-hidden="!open"
  >
    <div class="lares-history__backdrop" @click="$emit('close')" />
    <aside class="lares-history__sheet" role="dialog" :aria-label="t('bar.history')">
      <header class="lares-history__head">
        <h2 class="lares-history__title">{{ t("bar.history") }}</h2>
      </header>
      <header class="lares-history__toolbar">
        <span v-if="!searchOpen" class="lares-history__section-label">{{ sectionTitle }}</span>
        <div v-else class="lares-history__search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            ref="searchInput"
            v-model="query"
            :placeholder="t('desktop.searchSessions')"
            @keydown.esc="closeSearch"
          />
          <button type="button" :aria-label="t('desktop.clearSearch')" @click="closeSearch">×</button>
        </div>
        <div v-if="!searchOpen" class="lares-history__toolbar-actions">
          <button type="button" :aria-label="t('desktop.searchSessions')" @click="openSearch">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>
          </button>
          <button type="button" :aria-label="t('desktop.viewOptions')" @click="viewSheet = true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9h9M17 9h3M4 15h3M11 15h9" />
              <circle cx="15" cy="9" r="2" />
              <circle cx="9" cy="15" r="2" />
            </svg>
          </button>
          <button type="button" :aria-label="t('desktop.addWorkspace')" @click="$emit('browse-workspaces')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5.5H7A2.5 2.5 0 0 0 4.5 8v9A2.5 2.5 0 0 0 7 19.5h8a2.5 2.5 0 0 0 2.5-2.5v-3.5" />
              <path d="M19 4.5v4M17 6.5h4" />
            </svg>
          </button>
        </div>
      </header>
      <div class="lares-history__list">
        <div
          v-if="pending"
          class="lares-history__skeleton"
          role="status"
          :aria-label="t('history.loading')"
        >
          <section v-for="block in [1, 2]" :key="block" class="lares-history__section">
            <span class="lares-history__bone lares-history__bone--label" />
            <span class="lares-history__bone" />
            <span class="lares-history__bone" />
          </section>
        </div>
        <p v-else-if="workspaceError" class="lares-history__empty">
          {{ workspaceError }}
          <button type="button" @click="$emit('refresh-workspaces')">{{ t("agent.refresh") }}</button>
        </p>
        <p v-else-if="groups.length === 0" class="lares-history__empty">{{ t("history.empty") }}</p>
        <section v-for="group in groups" :key="group.key" class="lares-history__section">
          <div v-if="!flat" class="lares-history__group-head">
            <button
              type="button"
              class="lares-history__group-toggle"
              :data-active="holdsCurrent(group)"
              @click="toggleGroup(group.key)"
            >
              <span class="lares-history__group-icon" :data-expanded="isExpanded(group.key)">
                <svg class="lares-history__folder" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3.5 7.5h6l1.6 2H20.5v9H3.5z" />
                </svg>
                <svg class="lares-history__caret" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.5 6 15.5 12l-7 6z" />
                </svg>
              </span>
              <span>{{ group.title || t("desktop.ungrouped") }}</span>
            </button>
            <button
              v-if="group.workspaceId"
              type="button"
              class="lares-history__group-new"
              :aria-label="t('desktop.newSession')"
              @click="$emit('create', group.workspaceId)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <div v-show="flat || isExpanded(group.key)" class="lares-history__sessions">
            <div
              v-for="row in visibleSessions(group)"
              :key="row.sessionId"
              class="lares-history__session-row"
              :data-current="row.sessionId === sessionId ? 'true' : 'false'"
              :data-unseen="Boolean(unseen?.[row.sessionId])"
            >
              <button
                type="button"
                class="lares-history__item"
                @click="$emit('pick', row.sessionId)"
              >
                <span class="lares-history__unseen" aria-hidden="true" />
                <span>{{ row.title || t("history.untitled") }}</span>
              </button>
              <button
                type="button"
                class="lares-history__more"
                :aria-label="t('desktop.sessionActions')"
                @click="openSessionActions(row, group)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="6" cy="12" r="1.35" />
                  <circle cx="12" cy="12" r="1.35" />
                  <circle cx="18" cy="12" r="1.35" />
                </svg>
              </button>
            </div>
            <button
              v-if="!flat && overflowCount(group) > 0"
              type="button"
              class="lares-history__overflow"
              @click="toggleSessions(group.key)"
            >
              {{
                isSessionsExpanded(group.key)
                  ? t("desktop.showLessSessions")
                  : t("desktop.showMoreSessions", { n: overflowCount(group) })
              }}
            </button>
          </div>
        </section>
      </div>
    </aside>

    <LaresSheet :open="viewSheet" :title="t('desktop.viewOptions')" @close="viewSheet = false">
      <p class="lares-history__sheet-label">{{ t("desktop.groupBy") }}</p>
      <LaresSettingRow
        :label="t('desktop.byWorkspace')"
        :checked="!flat"
        @click="setGroupBy(false)"
      />
      <LaresSettingRow
        :label="t('desktop.oneList')"
        :checked="flat"
        @click="setGroupBy(true)"
      />
      <p class="lares-history__sheet-label">{{ t("desktop.orderBy") }}</p>
      <LaresSettingRow
        :label="t('desktop.recent')"
        :checked="orderBy === 'updated'"
        @click="setOrderBy('updated')"
      />
      <LaresSettingRow
        :label="t('desktop.manual')"
        :checked="orderBy === 'manual'"
        @click="setOrderBy('manual')"
      />
    </LaresSheet>

    <LaresSheet :open="Boolean(sessionSheet)" :title="t('desktop.sessionActions')" @close="sessionSheet = null">
      <LaresSettingRow :label="t('desktop.rename')" @click="beginRenameSession" />
      <LaresSettingRow :label="t('desktop.moveSession')" @click="beginMoveSession" />
      <LaresSettingRow :label="t('desktop.archiveSession')" @click="beginArchiveSession" />
    </LaresSheet>

    <LaresSheet
      :open="Boolean(renameSheet)"
      :title="renameSheet?.kind === 'workspace' ? t('desktop.renameWorkspace') : t('desktop.renameSession')"
      @close="renameSheet = null"
    >
      <input
        ref="renameInput"
        v-model="renameValue"
        class="lares-history__input"
        @keydown.enter.prevent="submitRename"
      />
      <div class="lares-history__sheet-actions">
        <button type="button" class="lares-history__cancel" @click="renameSheet = null">{{ t("desktop.cancel") }}</button>
        <button
          type="button"
          class="lares-history__confirm"
          :disabled="!renameValue.trim()"
          @click="submitRename"
        >
          {{ t("desktop.save") }}
        </button>
      </div>
    </LaresSheet>

    <LaresSheet
      :open="Boolean(confirmSheet)"
      :title="confirmSheet?.title || ''"
      @close="confirmSheet = null"
    >
      <p class="lares-history__confirm-copy">{{ confirmSheet?.description }}</p>
      <div class="lares-history__sheet-actions">
        <button type="button" class="lares-history__cancel" @click="confirmSheet = null">{{ t("desktop.cancel") }}</button>
        <button type="button" class="lares-history__confirm lares-history__confirm--danger" @click="submitConfirm">
          {{ confirmSheet?.confirmLabel }}
        </button>
      </div>
    </LaresSheet>

    <LaresSheet :open="Boolean(moveSheet)" :title="t('desktop.moveSession')" @close="moveSheet = null">
      <p v-if="moveTargets.length === 0" class="lares-history__empty">{{ t("history.noMoveTargets") }}</p>
      <LaresSettingRow
        v-for="workspace in moveTargets"
        :key="workspace.workspaceId"
        :label="workspace.title"
        @click="submitMove(workspace.workspaceId)"
      />
    </LaresSheet>
  </div>
</template>

<script>
import {
  collapsedSessions,
  groupWorkspaceSessions,
  hiddenSessionCount,
  workspaceForSession,
} from "@olares/lares-core/larepass/workspace";
import LaresSheet from "../settings/Sheet.vue";
import LaresSettingRow from "../settings/SettingRow.vue";
import {
  loadWorkspaceView,
  saveWorkspaceView,
  syncWorkspaceViewOrders,
} from "../desktop/workspace-view.js";

export default {
  name: "LaresHistoryPanel",
  components: { LaresSheet, LaresSettingRow },
  props: {
    open: { type: Boolean, default: false },
    sessions: { type: Array, default: () => [] },
    workspaces: { type: Array, default: () => [] },
    workspacesReady: { type: Boolean, default: false },
    workspaceError: { type: String, default: "" },
    archivedSessionIds: { type: Array, default: () => [] },
    sessionId: { type: String, default: "" },
    ready: { type: Boolean, default: false },
    unseen: { type: Object, default: null },
    t: { type: Function, required: true },
  },
  emits: [
    "close", "pick", "create", "browse-workspaces", "refresh-workspaces",
    "rename-session", "archive-session", "move-session",
  ],
  data() {
    const view = loadWorkspaceView();
    return {
      query: "",
      searchOpen: false,
      viewSheet: false,
      flat: view.groupBy === "flat",
      orderBy: view.orderBy,
      expanded: view.groupExpansion,
      sessionOrderByAccount: view.sessionOrderByAccount,
      sessionUpdatedAtByAccount: view.sessionUpdatedAtByAccount,
      sessionsExpanded: {},
      sessionSheet: null,
      renameSheet: null,
      renameValue: "",
      confirmSheet: null,
      moveSheet: null,
    };
  },
  computed: {
    pending() {
      return (!this.ready || !this.workspacesReady) && this.groups.length === 0;
    },
    sectionTitle() {
      return this.flat ? this.t("desktop.sessions") : this.t("desktop.workspaces");
    },
    groups() {
      return groupWorkspaceSessions(
        this.sessions,
        this.workspaces,
        this.archivedSessionIds,
        {
          query: this.query,
          orderBy: this.orderBy,
          flat: this.flat,
          currentSessionId: this.sessionId,
          sessionOrderByAccount: this.sessionOrderByAccount,
        },
      );
    },
    orderRevision() {
      return JSON.stringify({
        current: this.sessionId,
        sessions: this.sessions.map((row) => [row.sessionId, row.updatedAt, row.blank]),
        workspaces: this.workspaces.map((row) => [row.workspaceId, row.sessionIds]),
      });
    },
    moveTargets() {
      const current = this.moveSheet?.workspaceId;
      return (this.workspaces ?? []).filter((row) => row.workspaceId && row.workspaceId !== current);
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
    workspaces: {
      immediate: true,
      handler(workspaces) {
        const next = { ...this.expanded };
        for (const workspace of workspaces ?? []) {
          if (!(workspace.workspaceId in next)) next[workspace.workspaceId] = true;
        }
        if (!("" in next)) next[""] = true;
        this.expanded = next;
        this.persistView();
      },
    },
    renameSheet(open) {
      if (!open) return;
      this.$nextTick(() => {
        this.$refs.renameInput?.focus();
        this.$refs.renameInput?.select();
      });
    },
  },
  methods: {
    openSearch() {
      this.searchOpen = true;
      this.$nextTick(() => this.$refs.searchInput?.focus());
    },
    closeSearch() {
      this.query = "";
      this.searchOpen = false;
    },
    setGroupBy(flat) {
      this.flat = flat;
      this.viewSheet = false;
    },
    setOrderBy(orderBy) {
      this.orderBy = orderBy;
      this.viewSheet = false;
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
    holdsCurrent(group) {
      return group.sessions.some((row) => row.sessionId === this.sessionId);
    },
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
        sessions: this.sessions,
        workspaces: this.workspaces,
        currentSessionId: this.sessionId,
        sortByRecency,
      });
      this.sessionOrderByAccount = next.sessionOrderByAccount;
      this.sessionUpdatedAtByAccount = next.sessionUpdatedAtByAccount;
      this.persistView();
    },
    openSessionActions(session, group) {
      this.sessionSheet = {
        session,
        workspaceId: group.workspaceId || workspaceForSession(this.workspaces, session.sessionId)?.workspaceId || "",
        groupKey: group.key,
      };
    },
    beginRenameSession() {
      const row = this.sessionSheet?.session;
      if (!row) return;
      this.sessionSheet = null;
      this.renameSheet = { kind: "session", sessionId: row.sessionId };
      this.renameValue = row.title || "";
    },
    beginArchiveSession() {
      const row = this.sessionSheet?.session;
      if (!row) return;
      this.sessionSheet = null;
      this.confirmSheet = {
        kind: "archive-session",
        sessionId: row.sessionId,
        title: this.t("desktop.archiveSession"),
        description: this.t("desktop.archiveSessionConfirm"),
        confirmLabel: this.t("desktop.archiveSession"),
      };
    },
    beginMoveSession() {
      const sheet = this.sessionSheet;
      if (!sheet) return;
      this.sessionSheet = null;
      this.moveSheet = {
        sessionId: sheet.session.sessionId,
        workspaceId: sheet.workspaceId,
      };
    },
    submitRename() {
      if (!this.renameSheet || !this.renameValue.trim()) return;
      if (this.renameSheet.kind === "session") {
        this.$emit("rename-session", this.renameSheet.sessionId, this.renameValue.trim());
      }
      this.renameSheet = null;
      this.renameValue = "";
    },
    submitConfirm() {
      if (!this.confirmSheet) return;
      if (this.confirmSheet.kind === "archive-session") {
        this.$emit("archive-session", this.confirmSheet.sessionId);
      }
      this.confirmSheet = null;
    },
    submitMove(targetWorkspaceId) {
      if (!this.moveSheet || !targetWorkspaceId) return;
      this.$emit("move-session", targetWorkspaceId, this.moveSheet.sessionId, "");
      this.moveSheet = null;
    },
  },
};
</script>

<style scoped>
.lares-history {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  visibility: hidden;
  transition: visibility 0s linear var(--lares-duration-sheet, 280ms);
}

.lares-history[data-open="true"] {
  pointer-events: auto;
  visibility: visible;
  transition: visibility 0s linear 0s;
}

.lares-history__backdrop {
  position: absolute;
  inset: 0;
  background: var(--q-background-alpha);
  opacity: 0;
  transition: opacity var(--lares-duration-sheet, 280ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1));
}

.lares-history[data-open="true"] .lares-history__backdrop {
  opacity: 1;
}

.lares-history__sheet {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  width: min(80vw, 320px);
  height: 100%;
  flex-direction: column;
  min-height: 0;
  background: var(--q-background-1);
  box-shadow: 8px 0 32px rgb(0 0 0 / 8%);
  transform: translate3d(-100%, 0, 0);
  transition: transform var(--lares-duration-sheet, 280ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1));
  backface-visibility: hidden;
  contain: layout style paint;
}

.lares-history[data-open="true"] .lares-history__sheet {
  transform: translate3d(0, 0, 0);
  will-change: transform;
}

.lares-history__head {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 56px;
  padding: 0 20px;
}

.lares-history__title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 26px;
}

.lares-history__toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px 8px 20px;
  color: var(--q-ink-3);
  font-size: 15px;
}

.lares-history__section-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-history__toolbar-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
}

.lares-history__toolbar-actions button,
.lares-history__search button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--q-ink-3);
}

.lares-history__toolbar-actions button:active,
.lares-history__search button:active {
  background: var(--q-background-hover);
  color: var(--q-ink-1);
}

.lares-history__toolbar-actions svg,
.lares-history__search > svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-history__search {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  padding: 0 4px 0 8px;
  background: var(--q-background-3);
}

.lares-history__search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 8px 0;
  background: transparent;
  color: var(--q-ink-1);
  font: inherit;
  font-size: 15px;
}

.lares-history__search button {
  width: 32px;
  height: 32px;
  font-size: 20px;
  line-height: 1;
}

.lares-history__sheet-label {
  margin: 0;
  padding: 8px 16px 4px;
  color: var(--q-ink-3);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-history__list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 12px 24px;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.lares-history__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lares-history__group-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
}

.lares-history__group-toggle {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 10px;
  padding: 8px 6px;
  background: transparent;
  color: var(--q-ink-2);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
}

.lares-history__group-toggle[data-active="true"] .lares-history__folder {
  color: var(--q-blue-default);
}

.lares-history__group-icon {
  display: grid;
  width: 18px;
  height: 18px;
  flex: none;
  place-items: center;
}

.lares-history__group-icon svg {
  grid-area: 1 / 1;
}

.lares-history__folder {
  fill: none;
  stroke: var(--q-ink-3);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-history__caret {
  fill: currentColor;
  stroke: none;
  color: var(--q-ink-3);
  transform: rotate(0deg);
  transition: transform 120ms ease;
}

.lares-history__group-icon[data-expanded="true"] .lares-history__caret {
  transform: rotate(90deg);
}

.lares-history__group-toggle > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-history__group-new {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--q-ink-3);
}

.lares-history__group-new svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.lares-history__sessions {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lares-history__session-row {
  display: flex;
  align-items: center;
  border-radius: 12px;
  padding-right: 4px;
}

.lares-history__session-row[data-current="true"] {
  background: var(--q-background-3);
}

.lares-history__item {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  padding: 12px 8px 12px 16px;
  text-align: left;
  background: transparent;
  color: var(--q-ink-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-history__unseen {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: transparent;
}

.lares-history__session-row[data-unseen="true"] .lares-history__unseen {
  background: var(--q-positive, var(--q-green-default, #21c55d));
}

.lares-history__more {
  display: grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--q-ink-3);
}

.lares-history__more svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
  stroke: none;
}

.lares-history__more:active {
  background: var(--q-background-hover);
  color: var(--q-ink-2);
}

.lares-history__overflow {
  width: 100%;
  border: 0;
  border-radius: 10px;
  padding: 8px 8px 8px 24px;
  background: transparent;
  color: var(--q-ink-3);
  font-size: 14px;
  text-align: left;
}

.lares-history__empty {
  margin: 12px 8px;
  font-size: 15px;
  color: var(--q-ink-3);
}

.lares-history__empty button {
  display: block;
  margin-top: 8px;
  border: 0;
  background: transparent;
  color: var(--q-blue-default);
  font: inherit;
}

.lares-history__skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lares-history__bone {
  display: block;
  height: 44px;
  border-radius: 12px;
  background: var(--q-background-3);
  animation: lares-history-pulse 1.2s ease-in-out infinite;
}

.lares-history__bone--label {
  width: 72px;
  height: 12px;
  margin: 8px 16px 4px;
  border-radius: 6px;
}

.lares-history__section .lares-history__bone:nth-child(2) { width: 88%; }
.lares-history__section .lares-history__bone:nth-child(3) { width: 72%; }

@keyframes lares-history-pulse {
  50% { opacity: 0.45; }
}

.lares-history__input {
  box-sizing: border-box;
  width: calc(100% - 40px);
  height: 44px;
  margin: 0 20px 12px;
  border: 1px solid var(--q-separator);
  border-radius: 12px;
  padding: 0 12px;
  outline: none;
  background: var(--q-background-2, transparent);
  color: var(--q-ink-1);
  font: inherit;
  font-size: 16px;
}

.lares-history__sheet-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 12px;
}

.lares-history__cancel,
.lares-history__confirm {
  min-height: 40px;
  border-radius: 10px;
  padding: 0 14px;
  font: inherit;
}

.lares-history__cancel {
  border: 1px solid var(--q-separator);
  background: transparent;
  color: var(--q-ink-2);
}

.lares-history__confirm {
  border: 0;
  background: var(--q-blue-default);
  color: var(--q-ink-on-brand);
}

.lares-history__confirm--danger {
  background: var(--q-orange-default);
}

.lares-history__confirm:disabled {
  opacity: 0.5;
}

.lares-history__confirm-copy {
  margin: 0;
  padding: 0 20px 16px;
  color: var(--q-ink-2);
  font-size: 15px;
  line-height: 22px;
}

@media (prefers-reduced-motion: reduce) {
  .lares-history__backdrop,
  .lares-history__sheet,
  .lares-history__bone {
    animation: none;
    transition: none;
  }
}
</style>
