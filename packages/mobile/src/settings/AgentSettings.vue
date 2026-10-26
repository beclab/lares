<template>
  <div class="lares-agent" :data-device="layoutDevice" :aria-busy="loading ? 'true' : 'false'">
    <div v-if="loading" class="lares-agent__loading" role="status">
      <span class="lares-agent__spinner" aria-hidden="true" />
      <p>{{ t("agent.loading") }}</p>
    </div>
    <div v-if="page === 'voice'" class="lares-agent__body" :inert="loading || undefined">
      <VoiceSettings ref="voicePage" v-bind="voiceBind" :heading="false" />
    </div>
    <div v-else class="lares-agent__body" :inert="loading || undefined">
    <section class="lares-agent__group">
      <h2>{{ tModel("settings.title") }}</h2>
      <LaresSelect
        v-if="isDesktop"
        :value="modelCurrent"
        :sections="modelSelectSections"
        :disabled="busy || !models"
        :empty="tModel('settings.empty')"
        @select="(item) => pick(item, 'model')"
      />
      <div v-else class="lares-agent__list">
        <LaresSettingRow
          :label="tModel('settings.default')"
          :value="modelLabel"
          chevron
          boxed
          :disabled="Boolean(pending)"
          @click="openSheet('model')"
        />
      </div>
      <p v-for="entry in modelFailures" :key="entry.provider" class="lares-agent__hint" data-status="error">
        {{ tModel("settings.providerFailed", { name: entry.name || entry.provider, msg: entry.message }) }}
      </p>
      <p v-if="modelError" class="lares-agent__hint" data-status="error">{{ modelError }}</p>
    </section>
    <section v-if="isDesktop" class="lares-agent__group">
      <h2>{{ t("settings.input.title") }}</h2>
      <LaresSelect
        :value="conversation?.busyEnter || 'queue'"
        :sections="busyEnterSections"
        :disabled="busy || !conversation?.writable"
        @select="chooseBusyEnter"
      />
      <p class="lares-agent__hint">{{ t("settings.input.busyEnter.hint") }}</p>
      <p v-if="conversationError" class="lares-agent__hint" data-status="error">{{ conversationError }}</p>
    </section>
    <section class="lares-agent__group">
      <h2>{{ tSearch("settings.title") }}</h2>
      <LaresSelect
        v-if="isDesktop"
        :value="searchMenuId"
        :sections="searchSelectSections"
        :disabled="busy || !search"
        @select="(item) => pick(item, 'search')"
      />
      <div v-else class="lares-agent__list">
        <LaresSettingRow
          :label="tSearch('settings.default')"
          :value="searchLabel"
          chevron
          boxed
          :disabled="Boolean(pending)"
          @click="openSheet('search')"
        />
      </div>
      <p v-if="searchError" class="lares-agent__hint" data-status="error">{{ searchError }}</p>
    </section>
    <section v-if="permission?.options?.length || permissionError" class="lares-agent__group">
      <h2>{{ t("permission.default") }}</h2>
      <LaresSelect
        v-if="isDesktop && permission?.options?.length"
        :value="permission.current"
        :sections="permissionSections"
        :disabled="busy || !permission?.writable"
        @select="choosePermission"
      />
      <div v-else-if="permission?.options?.length" class="lares-agent__list">
        <LaresSettingRow
          :label="permissionLabel"
          :hint="permissionHint"
          chevron
          boxed
          :disabled="Boolean(pending) || !permission.writable"
          @click="openSheet('permission')"
        />
      </div>
      <div v-if="isDesktop && accessConfirm" class="lares-agent__access">
        <p>{{ t("access.confirm.description") }}</p>
        <label>
          <input v-model="accessAcknowledged" type="checkbox" />
          <span>{{ t("access.confirm.acknowledge") }}</span>
        </label>
        <div class="lares-agent__access-actions">
          <button type="button" @click="cancelAccess">{{ t("access.confirm.cancel") }}</button>
          <button type="button" :disabled="!accessAcknowledged || busy" @click="confirmAccess">{{ t("access.confirm.enable") }}</button>
        </div>
      </div>
      <p v-if="permissionError" class="lares-agent__hint" data-status="error">{{ permissionError }}</p>
    </section>
    <section class="lares-agent__group">
      <h2>{{ tVoice("settings.title") }}</h2>
      <VoiceSettings ref="voicePage" v-bind="voiceBind" :heading="false" />
    </section>
    <PluginsSettings :key="`plugins-${hostKey}`" :client="plugins" :locale="locale" :device="layoutDevice" />
    <LaresSheet v-if="!isDesktop" :open="Boolean(panel)" :title="sheetTitle" @close="closeSheet">
      <p v-if="sheetEmpty" class="lares-agent__hint lares-agent__hint--sheet">{{ sheetEmpty }}</p>
      <template v-for="section in sheetSections" :key="section.heading || 'main'">
        <p v-if="section.heading" class="lares-agent__heading">{{ section.heading }}</p>
        <LaresSettingRow
          v-for="item in section.items"
          :key="item.id"
          :label="item.label"
          :hint="item.hint"
          :checked="item.id === sheetCurrent"
          :disabled="busy || item.disabled"
          @click="pick(item)"
        />
      </template>
      <div v-if="panel === 'permission' && accessConfirm" class="lares-agent__access">
        <p>{{ t("access.confirm.description") }}</p>
        <label>
          <input v-model="accessAcknowledged" type="checkbox" />
          <span>{{ t("access.confirm.acknowledge") }}</span>
        </label>
        <div class="lares-agent__access-actions">
          <button type="button" @click="cancelAccess">{{ t("access.confirm.cancel") }}</button>
          <button type="button" :disabled="!accessAcknowledged || busy" @click="confirmAccess">{{ t("access.confirm.enable") }}</button>
        </div>
      </div>
    </LaresSheet>
    </div>
  </div>
</template>

<script>
import { t as translate } from "@olares/lares-core/i18n/t";
import { EN as MODEL_EN, ZH as MODEL_ZH } from "@olares/lares-core/i18n/chat-model";
import { EN as VOICE_EN, ZH as VOICE_ZH } from "@olares/lares-core/i18n/voice";
import { EN as SEARCH_EN, ZH as SEARCH_ZH } from "@olares/lares-core/i18n/search";
import { groupModelsByProvider, selectionKey } from "@olares/lares-core/router/session-model";
import {
  searchMenuValue,
  searchSelectorItems,
  searchValueFromMenu,
} from "@olares/lares-core/search/menu";
import { presetDescription, presetLabel } from "@olares/lares-core/larepass/permissions";
import { rememberedSettings } from "@olares/lares-core/larepass/settings";
import { hostKey as hostSessionKey } from "@olares/lares-core/larepass/host";
import { createHostClient } from "../host.js";
import { adoptHost } from "../runtime.js";
import { createT } from "../i18n.js";
import { chatDevice, DEVICE_DESKTOP } from "../layout.js";
import PluginsSettings from "./PluginsSettings.vue";
import VoiceSettings from "./VoiceSettings.vue";
import LaresSettingRow from "./SettingRow.vue";
import LaresSheet from "./Sheet.vue";
import LaresSelect from "./Select.vue";

const catalogs = {
  model: { zh: MODEL_ZH, en: MODEL_EN },
  voice: { zh: VOICE_ZH, en: VOICE_EN },
  search: { zh: SEARCH_ZH, en: SEARCH_EN },
};

function itemLabel(items, id) {
  return items.find((item) => item.id === id)?.label || "—";
}

export default {
  name: "LaresAgentSettings",
  components: { PluginsSettings, VoiceSettings, LaresSettingRow, LaresSheet, LaresSelect },
  expose: ["reload", "beforeLeave", "closePage"],
  emits: ["page"],
  props: {
    locale: { type: String, default: "en" },
    device: { type: String, default: "mobile" },
    baseUrl: { type: String, default: undefined },
    proxyPrefix: { type: String, default: undefined },
    request: { type: Function, default: undefined },
    env: { type: Object, default: undefined },
    missing: { type: Boolean, default: false },
    bindBeforeLeave: { type: Function, default: undefined },
  },
  data() {
    const remembered = rememberedSettings();
    return {
      loading: !(remembered.models && remembered.search && remembered.conversation),
      pending: "",
      panel: "",
      page: "",
      models: remembered.models,
      search: remembered.search,
      conversation: remembered.conversation,
      permission: remembered.permission,
      modelError: "",
      searchError: "",
      conversationError: "",
      permissionError: "",
      accessConfirm: false,
      accessAcknowledged: false,
    };
  },
  computed: {
    t() {
      return createT(this.locale);
    },
    layoutDevice() {
      return chatDevice(this.device);
    },
    isDesktop() {
      return this.layoutDevice === DEVICE_DESKTOP;
    },
    ports() {
      return {
        baseUrl: this.baseUrl,
        proxyPrefix: this.proxyPrefix,
        request: this.request,
        env: this.env,
        missing: this.missing,
      };
    },
    hostKey() {
      return hostSessionKey(this.ports);
    },
    plugins() { return createHostClient(this.ports).plugins; },
    voiceBind() {
      return {
        locale: this.locale,
        device: this.device,
        baseUrl: this.baseUrl,
        proxyPrefix: this.proxyPrefix,
        request: this.request,
        env: this.env,
        missing: this.missing,
        bindBeforeLeave: this.bindBeforeLeave,
      };
    },
    settings() {
      return createHostClient(this.ports).settings;
    },
    busy() {
      return this.loading || Boolean(this.pending);
    },
    modelGroups() {
      return groupModelsByProvider(this.models?.models ?? []);
    },
    modelCurrent() {
      return this.models?.default ? selectionKey(this.models.default) : "";
    },
    modelFailures() {
      return this.models?.failures ?? [];
    },
    searchModels() {
      return Array.isArray(this.search?.searchModels) ? this.search.searchModels : [];
    },
    searchItems() {
      return searchSelectorItems(this.searchModels, {
        routerDefault: this.tSearch("settings.default.router"),
        off: this.tSearch("settings.default.off"),
      });
    },
    modelLabel() {
      if (!this.models) return "—";
      for (const group of this.modelGroups) {
        for (const model of group.models) {
          if (this.modelKey(model) === this.modelCurrent) return model.name;
        }
      }
      return this.models.default?.model || "—";
    },
    permissionOption() {
      return this.permission?.options?.find((option) => option.value === this.permission.current) || null;
    },
    permissionLabel() {
      return presetLabel(this.t, this.permissionOption) || "—";
    },
    permissionHint() {
      return presetDescription(this.t, this.permissionOption) || this.t("permission.default.hint");
    },
    permissionSections() {
      return [{
        items: (this.permission?.options || []).map((option) => ({
          id: option.value,
          label: presetLabel(this.t, option),
          hint: presetDescription(this.t, option),
        })),
      }];
    },
    searchMenuId() {
      return searchMenuValue(this.search);
    },
    searchLabel() {
      if (!this.search) return "—";
      return itemLabel(this.searchItems, this.searchMenuId);
    },
    modelSelectSections() {
      return this.modelGroups.map((group) => ({
        heading: group.provider,
        items: group.models.map((model) => ({
          id: this.modelKey(model),
          label: model.name,
          model,
        })),
      }));
    },
    searchSelectSections() {
      return [{ items: this.searchItems.map((item) => ({ id: item.id, label: item.label })) }];
    },
    busyEnterSections() {
      return [{
        items: [
          { id: "queue", label: this.t("settings.input.busyEnter.queue") },
          { id: "steer", label: this.t("settings.input.busyEnter.steer") },
        ],
      }];
    },
    sheetTitle() {
      if (this.panel === "model") return this.tModel("settings.title");
      if (this.panel === "search") return this.tSearch("settings.default");
      if (this.panel === "permission") return this.t("permission.default");
      return "";
    },
    sheetCurrent() {
      return this.sheetCurrentFor(this.panel);
    },
    sheetSections() {
      if (this.panel === "model") return this.modelSelectSections;
      if (this.panel === "search") return this.searchSelectSections;
      if (this.panel === "permission") return this.permissionSections;
      return [];
    },
    sheetEmpty() {
      const count = this.sheetSections.reduce((sum, section) => sum + section.items.length, 0);
      if (count > 0) return "";
      if (this.panel === "model") return this.tModel("settings.empty");
      return "";
    },
  },
  watch: {
    hostKey() {
      adoptHost(this.ports);
      this.panel = "";
      this.page = "";
      this.$emit("page", "");
      this.models = null;
      this.search = null;
      this.conversation = null;
      this.permission = null;
      this.modelError = "";
      this.searchError = "";
      this.conversationError = "";
      this.permissionError = "";
      this.load(true);
    },
  },
  mounted() {
    this.load(false);
    // LarePass has no catalog-revision stream, so returning to the panel is
    // the only moment a Router change can still be picked up.
    this.onVisible = () => {
      if (document.visibilityState === "visible" && !this.busy) this.reload();
    };
    document.addEventListener("visibilitychange", this.onVisible);
  },
  beforeUnmount() {
    if (this.onVisible) document.removeEventListener("visibilitychange", this.onVisible);
  },
  methods: {
    tModel(key, params) {
      return translate(catalogs.model, this.locale, key, params);
    },
    tVoice(key, params) {
      return translate(catalogs.voice, this.locale, key, params);
    },
    tSearch(key, params) {
      return translate(catalogs.search, this.locale, key, params);
    },
    modelKey(model) {
      return selectionKey({ provider: model.provider, model: model.id });
    },
    failText(catalogT, key, err) {
      return catalogT(key, { msg: err instanceof Error ? err.message : String(err) });
    },
    openSheet(panel) {
      if (this.loading) return;
      const ready = panel === "model" ? this.models : panel === "search" ? this.search : this.permission?.options?.length;
      if (!ready) return;
      this.accessConfirm = false;
      this.accessAcknowledged = false;
      this.panel = panel;
    },
    openVoice() {
      this.panel = "";
      this.page = "voice";
      this.$emit("page", "voice");
    },
    closePage() {
      if (this.page !== "voice") return false;
      this.page = "";
      this.$emit("page", "");
      return true;
    },
    closeSheet() {
      this.panel = "";
      this.cancelAccess();
    },
    cancelAccess() {
      this.accessConfirm = false;
      this.accessAcknowledged = false;
    },
    confirmAccess() {
      if (!this.accessAcknowledged) return;
      this.panel = "";
      this.accessConfirm = false;
      return this.savePermission("danger-full-access");
    },
    choosePermission(item) {
      const id = item?.id;
      if (!id || id === this.permission?.current || this.busy) return;
      if (id === "danger-full-access") {
        this.accessConfirm = true;
        this.accessAcknowledged = false;
        return;
      }
      this.cancelAccess();
      return this.savePermission(id);
    },
    async pick(item, panel = this.panel) {
      if (item.disabled) return;
      if (panel === "permission") {
        if (item.id === this.permission?.current) {
          this.closeSheet();
          return;
        }
        this.choosePermission(item);
        if (item.id !== "danger-full-access") this.panel = "";
        return;
      }
      if (item.id === this.sheetCurrentFor(panel)) {
        this.panel = "";
        return;
      }
      this.panel = "";
      if (panel === "model") await this.chooseModel(item.model);
      if (panel === "search") await this.chooseSearch(item.id);
    },
    sheetCurrentFor(panel) {
      if (panel === "model") return this.modelCurrent;
      if (panel === "search") return searchMenuValue(this.search);
      if (panel === "permission") return this.permission?.current || "";
      return "";
    },
    beforeLeave() { return this.$refs.voicePage?.beforeLeave() ?? Promise.resolve(true); },
    reload() {
      void this.$refs.voicePage?.reload()?.catch(() => {});
      return this.load(true);
    },
    async load(force) {
      const remembered = rememberedSettings();
      if (!force) {
        this.models = remembered.models ?? this.models;
        this.search = remembered.search ?? this.search;
        this.conversation = remembered.conversation ?? this.conversation;
        this.permission = remembered.permission ?? this.permission;
        if (this.models && this.search && this.conversation && this.permission) return;
      }
      this.panel = "";
      this.loading = true;
      this.modelError = "";
      this.searchError = "";
      this.conversationError = "";
      this.permissionError = "";
      const [models, search, conversation, permission] = await Promise.allSettled([
        this.settings.models({ force }),
        this.settings.search({ force }),
        this.settings.conversation({ force }),
        this.settings.permission({ force }),
      ]);
      if (models.status === "fulfilled") this.models = models.value;
      else this.modelError = this.failText(this.tModel, "settings.loadFailed", models.reason);
      if (search.status === "fulfilled") this.search = search.value;
      else this.searchError = this.failText(this.tSearch, "settings.loadFailed", search.reason);
      if (conversation.status === "fulfilled") this.conversation = conversation.value;
      else this.conversationError = conversation.reason instanceof Error ? conversation.reason.message : String(conversation.reason);
      if (permission.status === "fulfilled") this.permission = permission.value;
      else this.permissionError = permission.reason instanceof Error ? permission.reason.message : String(permission.reason);
      this.loading = false;
    },
    async chooseModel(model) {
      const selection = { provider: model.provider, model: model.id };
      const key = selectionKey(selection);
      if (key === this.modelCurrent || this.busy) return;
      this.pending = key;
      this.modelError = "";
      try {
        this.models = await this.settings.setDefaultModel(selection);
      } catch (err) {
        this.modelError = this.failText(this.tModel, "settings.saveFailed", err);
      } finally {
        this.pending = "";
      }
    },
    async savePermission(preset) {
      if (!this.permission?.writable || this.busy) return;
      if (preset === this.permission.current) return;
      this.pending = "permission";
      this.permissionError = "";
      try {
        this.permission = await this.settings.setDefaultPermission(preset);
      } catch (err) {
        this.permissionError = err instanceof Error ? err.message : String(err);
      } finally {
        this.pending = "";
        this.accessAcknowledged = false;
      }
    },
    async chooseSearch(rawId) {
      if (!this.search || this.busy) return;
      this.pending = "search";
      this.searchError = "";
      try {
        this.search = await this.settings.setSearchDefault(searchValueFromMenu(rawId));
      } catch (err) {
        this.searchError = this.failText(this.tSearch, "settings.saveFailed", err);
      } finally {
        this.pending = "";
      }
    },
    async chooseBusyEnter(item) {
      if (!item?.id || item.id === this.conversation?.busyEnter || this.busy) return;
      this.pending = "busyEnter";
      this.conversationError = "";
      try {
        this.conversation = await this.settings.setBusyEnter(item.id);
      } catch (err) {
        this.conversationError = err instanceof Error ? err.message : String(err);
      } finally {
        this.pending = "";
      }
    },
  },
};
</script>

<style scoped>
.lares-agent {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 280px;
  color: var(--q-ink-1);
}

.lares-agent[data-device="desktop"] {
  min-height: 0;
  width: 100%;
}

.lares-agent__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px 20px 32px;
}

.lares-agent[data-device="desktop"] .lares-agent__body {
  gap: 16px;
  padding: 0;
}

.lares-agent[data-device="desktop"] .lares-agent__group h2 {
  font-size: 16px;
}

.lares-agent__loading {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: color-mix(in srgb, var(--q-background-1) 88%, transparent);
  color: var(--q-ink-2);
}

.lares-agent__loading p {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
}

.lares-agent__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--q-separator);
  border-top-color: var(--q-ink-1);
  border-radius: 50%;
  animation: lares-agent-spin 0.8s linear infinite;
}

@keyframes lares-agent-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .lares-agent__spinner {
    animation: none;
  }
}

.lares-agent__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lares-agent__group h2,
.lares-agent__group h3 {
  margin: 0;
  font-weight: 500;
  color: var(--q-ink-1);
}

.lares-agent__group h2 {
  font-size: 18px;
  line-height: 24px;
}

.lares-agent__group h3 {
  margin-top: 8px;
  color: var(--q-ink-3);
  font-size: 14px;
  line-height: 18px;
}

.lares-agent__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lares-agent__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  color: var(--q-ink-1);
  font-size: 15px;
  line-height: 22px;
}

.lares-agent__hint {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  color: var(--q-ink-3);
}

.lares-agent__hint[data-status="error"] {
  color: var(--q-orange-default);
}

.lares-agent__hint--sheet {
  padding: 8px 20px 16px;
}

.lares-agent__heading {
  margin: 0;
  padding: 12px 16px 4px;
  color: var(--q-ink-3);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-agent__access {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 8px 16px 16px;
  padding: 12px;
  border-radius: 12px;
  background: var(--q-background-3);
  color: var(--q-ink-2);
  font-size: 14px;
  line-height: 20px;
}

.lares-agent[data-device="desktop"] .lares-agent__access {
  margin: 0;
}

.lares-agent__access p {
  margin: 0;
}

.lares-agent__access label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.lares-agent__access input {
  width: 18px;
  height: 18px;
  flex: none;
  margin: 1px 0 0;
}

.lares-agent__access-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.lares-agent__access-actions button {
  border: 0;
  border-radius: 8px;
  padding: 8px 12px;
  background: transparent;
  color: var(--q-ink-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
}

.lares-agent__access-actions button:last-child {
  background: var(--q-blue-alpha);
  color: var(--q-blue-default);
}

.lares-agent__access-actions button:disabled {
  opacity: 0.45;
}
</style>
