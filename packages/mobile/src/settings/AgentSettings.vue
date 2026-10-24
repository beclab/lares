<template>
  <div class="lares-agent" :data-device="layoutDevice" :aria-busy="loading ? 'true' : 'false'">
    <div v-if="loading" class="lares-agent__loading" role="status">
      <span class="lares-agent__spinner" aria-hidden="true" />
      <p>{{ t("agent.loading") }}</p>
    </div>
    <div class="lares-agent__body" :inert="loading || undefined">
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
      <h2>{{ tVoice("settings.title") }}</h2>
      <div class="lares-agent__list">
        <template v-if="isDesktop">
          <label class="lares-agent__field">
            <span>{{ tVoice('settings.stt.model') }}</span>
            <LaresSelect
              :value="voiceModelId"
              :sections="voiceModelSections"
              :disabled="busy || !voice"
              @select="chooseVoiceModel"
            />
          </label>
          <label class="lares-agent__field">
            <span>{{ tVoice('settings.language.title') }}</span>
            <LaresSelect
              :value="voiceLangId"
              :sections="voiceLanguageSections"
              :disabled="busy || !voice"
              @select="chooseVoiceLanguage"
            />
          </label>
        </template>
        <template v-else>
          <LaresSettingRow
            :label="tVoice('settings.stt.model')"
            :value="voiceModelLabel"
            chevron
            boxed
            :disabled="Boolean(pending)"
            @click="openSheet('voiceModel')"
          />
          <LaresSettingRow
            :label="tVoice('settings.language.title')"
            :value="voiceLangLabel"
            chevron
            boxed
            :disabled="Boolean(pending)"
            @click="openSheet('voiceLang')"
          />
        </template>
      </div>
      <VoicePreferences :key="hostKey" ref="voicePreferences" :settings="settings" :tts-fetch="ttsFetch" :snapshot="voice" :device="device" :t="tVoice" :bind-before-leave="bindBeforeLeave" @change="voice = $event" />
      <h3>{{ tVoice("settings.conversation") }}</h3>
      <div class="lares-agent__list">
        <template v-if="isDesktop">
          <label class="lares-agent__field">
            <span>{{ tVoice('settings.mobileMode') }}</span>
            <LaresSelect
              :value="voice?.config?.mobileMode || 'continuous'"
              :sections="mobileModeSections"
              :disabled="busy || !voice"
              @select="(item) => patchVoice('mobileMode', item.id)"
            />
          </label>
          <label class="lares-agent__field">
            <span>{{ tVoice('settings.device') }}</span>
            <LaresSelect
              :value="voice?.config?.device || 'auto'"
              :sections="deviceSections"
              :disabled="busy || !voice"
              @select="(item) => patchVoice('device', item.id)"
            />
          </label>
          <label class="lares-agent__field">
            <span>{{ tVoice('settings.mode.title') }}</span>
            <LaresSelect
              :value="voice?.config?.streaming ? 'streaming' : 'turns'"
              :sections="readingSections"
              :disabled="busy || !voice || !reading"
              @select="(item) => chooseReading(item.id)"
            />
          </label>
        </template>
        <template v-else>
          <LaresSettingRow
            :label="tVoice('settings.mobileMode')"
            :value="voiceChoiceLabel('mobileMode')"
            chevron
            boxed
            :disabled="Boolean(pending) || !voice"
            @click="openSheet('voiceMobileMode')"
          />
          <LaresSettingRow
            :label="tVoice('settings.device')"
            :value="voiceChoiceLabel('device')"
            chevron
            boxed
            :disabled="Boolean(pending) || !voice"
            @click="openSheet('voiceDevice')"
          />
          <LaresSettingRow
            :label="tVoice('settings.mode.title')"
            :value="voiceChoiceLabel('reading')"
            chevron
            boxed
            :disabled="Boolean(pending) || !voice || !reading"
            @click="openSheet('voiceReading')"
          />
        </template>
      </div>
      <p class="lares-agent__hint">{{ readingHint }}</p>
      <p v-if="voiceError" class="lares-agent__hint" data-status="error">{{ voiceError }}</p>
      <VoiceKeys :key="`keys-${hostKey}`" :client="voiceKeys" :t="tVoice" />
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
    <PluginsSettings :key="`plugins-${hostKey}`" :client="plugins" :locale="locale" />
    <LaresSheet v-if="!isDesktop" :open="Boolean(panel)" :title="sheetTitle" @close="panel = ''">
      <p v-if="sheetEmpty" class="lares-agent__hint lares-agent__hint--sheet">{{ sheetEmpty }}</p>
      <template v-for="section in sheetSections" :key="section.heading || 'main'">
        <p v-if="section.heading" class="lares-agent__heading">{{ section.heading }}</p>
        <LaresSettingRow
          v-for="item in section.items"
          :key="item.id"
          :label="item.label"
          :checked="item.id === sheetCurrent"
          :disabled="busy || item.disabled"
          @click="pick(item)"
        />
      </template>
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
  voiceLanguageItems,
  voiceMenuValue,
  voiceModelItems,
  voiceValueFromMenu,
} from "@olares/lares-core/voice/languages";
import {
  searchMenuValue,
  searchSelectorItems,
  searchValueFromMenu,
} from "@olares/lares-core/search/menu";
import { rememberedSettings } from "@olares/lares-core/larepass/settings";
import { hostKey as hostSessionKey } from "@olares/lares-core/larepass/host";
import { createHostClient } from "../host.js";
import { adoptHost } from "../runtime.js";
import { createT } from "../i18n.js";
import { chatDevice, DEVICE_DESKTOP } from "../layout.js";
import PluginsSettings from "./PluginsSettings.vue";
import VoicePreferences from "./VoicePreferences.vue";
import VoiceKeys from "./VoiceKeys.vue";
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
  components: { PluginsSettings, VoicePreferences, VoiceKeys, LaresSettingRow, LaresSheet, LaresSelect },
  expose: ["reload", "beforeLeave"],
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
      loading: !(remembered.models && remembered.voice && remembered.search),
      pending: "",
      panel: "",
      models: remembered.models,
      voice: remembered.voice,
      search: remembered.search,
      conversation: remembered.conversation,
      modelError: "",
      voiceError: "",
      searchError: "",
      conversationError: "",
      reading: null,
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
    ttsFetch() { return createHostClient(this.ports).ttsFetch; },
    plugins() { return createHostClient(this.ports).plugins; },
    voiceKeys() { return createHostClient(this.ports).voiceKeys; },
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
    voiceModels() {
      return voiceModelItems(this.voice?.sttModels ?? [], this.tVoice("settings.model.auto"));
    },
    voiceLanguages() {
      return voiceLanguageItems(this.tVoice("lang.auto"));
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
    voiceModelId() {
      return voiceMenuValue(this.voice?.config?.model);
    },
    voiceLangId() {
      return voiceMenuValue(this.voice?.config?.language);
    },
    voiceModelSections() {
      return [{ items: this.voiceModels }];
    },
    voiceLanguageSections() {
      return [{ items: this.voiceLanguages }];
    },
    voiceModelLabel() {
      if (!this.voice) return "—";
      return itemLabel(this.voiceModels, this.voiceModelId);
    },
    voiceLangLabel() {
      if (!this.voice) return "—";
      return itemLabel(this.voiceLanguages, this.voiceLangId);
    },
    readingHint() {
      if (this.reading && !this.reading.allowed) return this.tVoice("settings.mode.hint");
      const type = this.reading?.gpu?.type;
      if (type) return this.tVoice("settings.mode.gpu", { type: this.tVoice(`settings.gpu.${type}`) });
      return this.tVoice("settings.mode.hint");
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
    mobileModeSections() {
      return [{ items: ["single", "continuous"].map((id) => ({ id, label: this.tVoice(`settings.mode.${id}`) })) }];
    },
    deviceSections() {
      return [{ items: ["auto", "device", "headset"].map((id) => ({ id, label: this.tVoice(`settings.device.${id}`) })) }];
    },
    readingSections() {
      return [{
        items: [
          { id: "turns", label: this.tVoice("settings.mode.turns") },
          { id: "streaming", label: this.tVoice("settings.mode.streaming"), disabled: !this.reading?.allowed },
        ],
      }];
    },
    sheetTitle() {
      if (this.panel === "model") return this.tModel("settings.title");
      if (this.panel === "voiceModel") return this.tVoice("settings.stt.model");
      if (this.panel === "voiceLang") return this.tVoice("settings.language.title");
      if (this.panel === "voiceMobileMode") return this.tVoice("settings.mobileMode");
      if (this.panel === "voiceDevice") return this.tVoice("settings.device");
      if (this.panel === "voiceReading") return this.tVoice("settings.mode.title");
      if (this.panel === "search") return this.tSearch("settings.default");
      return "";
    },
    sheetCurrent() {
      return this.sheetCurrentFor(this.panel);
    },
    sheetSections() {
      if (this.panel === "model") return this.modelSelectSections;
      if (this.panel === "voiceModel") {
        return [{ items: this.voiceModels.map((item) => ({ id: item.id, label: item.label })) }];
      }
      if (this.panel === "voiceLang") {
        return [{ items: this.voiceLanguages.map((item) => ({ id: item.id, label: item.label })) }];
      }
      if (this.panel === "voiceMobileMode") return this.mobileModeSections;
      if (this.panel === "voiceDevice") return this.deviceSections;
      if (this.panel === "voiceReading") return this.readingSections;
      if (this.panel === "search") return this.searchSelectSections;
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
      this.models = null;
      this.voice = null;
      this.search = null;
      this.conversation = null;
      this.modelError = "";
      this.voiceError = "";
      this.searchError = "";
      this.conversationError = "";
      this.load(true);
    },
  },
  mounted() {
    this.load(false);
    // LarePass has no catalog-revision stream, so returning to the panel is
    // the only moment a Router change can still be picked up.
    this.onVisible = () => {
      if (document.visibilityState === "visible" && !this.busy) this.load(true);
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
      const ready = panel === "model" ? this.models : panel === "search" ? this.search : this.voice;
      if (!ready) return;
      this.panel = panel;
    },
    chooseVoiceModel(item) { return this.patchVoice("model", voiceValueFromMenu(item.id)); },
    chooseVoiceLanguage(item) { return this.patchVoice("language", voiceValueFromMenu(item.id)); },
    voiceChoiceLabel(kind) {
      if (!this.voice) return "—";
      if (kind === "mobileMode") return this.tVoice(`settings.mode.${this.voice.config?.mobileMode || "continuous"}`);
      if (kind === "device") return this.tVoice(`settings.device.${this.voice.config?.device || "auto"}`);
      return this.tVoice(`settings.mode.${this.voice.config?.streaming ? "streaming" : "turns"}`);
    },
    async pick(item, panel = this.panel) {
      if (item.disabled) return;
      if (item.id === this.sheetCurrentFor(panel)) {
        this.panel = "";
        return;
      }
      this.panel = "";
      if (panel === "model") await this.chooseModel(item.model);
      if (panel === "voiceModel") await this.patchVoice("model", voiceValueFromMenu(item.id));
      if (panel === "voiceLang") await this.patchVoice("language", voiceValueFromMenu(item.id));
      if (panel === "voiceMobileMode") await this.patchVoice("mobileMode", item.id);
      if (panel === "voiceDevice") await this.patchVoice("device", item.id);
      if (panel === "voiceReading") this.chooseReading(item.id);
      if (panel === "search") await this.chooseSearch(item.id);
    },
    sheetCurrentFor(panel) {
      if (panel === "model") return this.modelCurrent;
      if (panel === "voiceModel") return voiceMenuValue(this.voice?.config?.model);
      if (panel === "voiceLang") return voiceMenuValue(this.voice?.config?.language);
      if (panel === "voiceMobileMode") return this.voice?.config?.mobileMode || "continuous";
      if (panel === "voiceDevice") return this.voice?.config?.device || "auto";
      if (panel === "voiceReading") return this.voice?.config?.streaming ? "streaming" : "turns";
      if (panel === "search") return searchMenuValue(this.search);
      return "";
    },
    beforeLeave() { return this.$refs.voicePreferences?.beforeLeave() ?? Promise.resolve(true); },
    reload() {
      void this.$refs.voicePreferences?.reload().catch(() => {});
      return this.load(true);
    },
    async load(force) {
      const remembered = rememberedSettings();
      if (!force) {
        this.models = remembered.models ?? this.models;
        this.voice = remembered.voice ?? this.voice;
        this.search = remembered.search ?? this.search;
        this.conversation = remembered.conversation ?? this.conversation;
        if (this.models && this.voice && this.search && this.conversation) {
          void this.loadReading();
          return;
        }
      }
      this.panel = "";
      this.loading = true;
      this.modelError = "";
      this.voiceError = "";
      this.searchError = "";
      this.conversationError = "";
      const [models, voice, search, conversation] = await Promise.allSettled([
        this.settings.models({ force }),
        this.settings.voice(force, { diagnostics: false }),
        this.settings.search({ force }),
        this.settings.conversation({ force }),
      ]);
      if (models.status === "fulfilled") this.models = models.value;
      else this.modelError = this.failText(this.tModel, "settings.loadFailed", models.reason);
      if (voice.status === "fulfilled") this.voice = voice.value;
      else this.voiceError = this.tVoice("settings.loadFailed");
      if (search.status === "fulfilled") this.search = search.value;
      else this.searchError = this.failText(this.tSearch, "settings.loadFailed", search.reason);
      if (conversation.status === "fulfilled") this.conversation = conversation.value;
      else this.conversationError = conversation.reason instanceof Error ? conversation.reason.message : String(conversation.reason);
      this.loading = false;
      void this.loadReading();
    },
    async loadReading() {
      try {
        this.reading = await this.settings.readingMode();
      } catch {
        this.reading = { streaming: false, allowed: false, gpu: null };
      }
    },
    chooseReading(value) {
      if (value === "streaming" && !this.reading?.allowed) {
        this.voiceError = this.tVoice("error.voice_streaming_time_slice");
        return;
      }
      void this.patchVoice("streaming", value === "streaming");
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
    async patchVoice(key, value) {
      if (!this.voice || this.busy) return;
      this.pending = `voice:${key}`;
      this.voiceError = "";
      try {
        this.voice = await this.$refs.voicePreferences.patch({ [key]: value });
      } catch (err) {
        const code = err?.code;
        const text = code ? this.tVoice(`error.${code}`) : "";
        this.voiceError = text && text !== `error.${code}` ? text : this.tVoice("settings.saveFailed");
      } finally {
        this.pending = "";
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
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 280px;
  background: color-mix(in srgb, var(--q-background-1) 88%, transparent);
  color: var(--q-ink-2);
}

.lares-agent__loading p {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
}

.lares-agent[data-device="desktop"] .lares-agent__loading {
  min-height: 96px;
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
</style>
