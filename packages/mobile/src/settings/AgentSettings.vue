<template>
  <div class="lares-agent" :aria-busy="loading ? 'true' : 'false'">
    <div v-if="loading" class="lares-agent__loading" role="status">
      <span class="lares-agent__spinner" aria-hidden="true" />
      <p>{{ t("agent.loading") }}</p>
    </div>
    <div class="lares-agent__body" :inert="loading || undefined">
    <section class="lares-agent__group">
      <h2>{{ tModel("settings.title") }}</h2>
      <div class="lares-agent__list">
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
    <!-- Voice input parked.
    <section class="lares-agent__group">
      <h2>{{ tVoice("settings.title") }}</h2>
      <div class="lares-agent__list">
        <LaresSettingRow
          :label="tVoice('settings.model.title')"
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
      </div>
      <p v-if="voiceError" class="lares-agent__hint" data-status="error">{{ voiceError }}</p>
    </section>
    -->
    <section class="lares-agent__group">
      <h2>{{ tSearch("settings.title") }}</h2>
      <div class="lares-agent__list">
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
    <LaresSheet :open="Boolean(panel)" :title="sheetTitle" @close="panel = ''">
      <p v-if="sheetEmpty" class="lares-agent__hint lares-agent__hint--sheet">{{ sheetEmpty }}</p>
      <template v-for="section in sheetSections" :key="section.heading || 'main'">
        <p v-if="section.heading" class="lares-agent__heading">{{ section.heading }}</p>
        <LaresSettingRow
          v-for="item in section.items"
          :key="item.id"
          :label="item.label"
          :checked="item.id === sheetCurrent"
          :disabled="busy"
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
import LaresSettingRow from "./SettingRow.vue";
import LaresSheet from "./Sheet.vue";

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
  components: { LaresSettingRow, LaresSheet },
  expose: ["reload"],
  props: {
    locale: { type: String, default: "en" },
    baseUrl: { type: String, default: undefined },
    proxyPrefix: { type: String, default: undefined },
    request: { type: Function, default: undefined },
    env: { type: Object, default: undefined },
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
      modelError: "",
      voiceError: "",
      searchError: "",
    };
  },
  computed: {
    t() {
      return createT(this.locale);
    },
    ports() {
      return {
        baseUrl: this.baseUrl,
        proxyPrefix: this.proxyPrefix,
        request: this.request,
        env: this.env,
      };
    },
    hostKey() {
      return hostSessionKey(this.ports);
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
        none: this.tSearch("settings.default.none"),
        empty: this.tSearch("settings.default.empty"),
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
    voiceModelLabel() {
      if (!this.voice) return "—";
      return itemLabel(this.voiceModels, voiceMenuValue(this.voice.config?.model));
    },
    voiceLangLabel() {
      if (!this.voice) return "—";
      return itemLabel(this.voiceLanguages, voiceMenuValue(this.voice.config?.language));
    },
    searchLabel() {
      if (!this.search) return "—";
      return itemLabel(this.searchItems, searchMenuValue(this.search.defaultSearchModel));
    },
    sheetTitle() {
      if (this.panel === "model") return this.tModel("settings.title");
      if (this.panel === "voiceModel") return this.tVoice("settings.model.title");
      if (this.panel === "voiceLang") return this.tVoice("settings.language.title");
      if (this.panel === "search") return this.tSearch("settings.default");
      return "";
    },
    sheetCurrent() {
      if (this.panel === "model") return this.modelCurrent;
      if (this.panel === "voiceModel") return voiceMenuValue(this.voice?.config?.model);
      if (this.panel === "voiceLang") return voiceMenuValue(this.voice?.config?.language);
      if (this.panel === "search") return searchMenuValue(this.search?.defaultSearchModel);
      return "";
    },
    sheetSections() {
      if (this.panel === "model") {
        return this.modelGroups.map((group) => ({
          heading: group.provider,
          items: group.models.map((model) => ({
            id: this.modelKey(model),
            label: model.name,
            model,
          })),
        }));
      }
      if (this.panel === "voiceModel") {
        return [{ items: this.voiceModels.map((item) => ({ id: item.id, label: item.label })) }];
      }
      if (this.panel === "voiceLang") {
        return [{ items: this.voiceLanguages.map((item) => ({ id: item.id, label: item.label })) }];
      }
      if (this.panel === "search") {
        return [{ items: this.searchItems.map((item) => ({ id: item.id, label: item.label })) }];
      }
      return [];
    },
    sheetEmpty() {
      const count = this.sheetSections.reduce((sum, section) => sum + section.items.length, 0);
      if (count > 0) return "";
      if (this.panel === "model") return this.tModel("settings.empty");
      if (this.panel === "search") return this.tSearch("settings.default.empty");
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
      this.modelError = "";
      this.voiceError = "";
      this.searchError = "";
      this.load(true);
    },
  },
  mounted() {
    this.load(false);
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
    async pick(item) {
      const panel = this.panel;
      if (item.id === this.sheetCurrent) {
        this.panel = "";
        return;
      }
      this.panel = "";
      if (panel === "model") await this.chooseModel(item.model);
      if (panel === "voiceModel") await this.patchVoice("model", voiceValueFromMenu(item.id));
      if (panel === "voiceLang") await this.patchVoice("language", voiceValueFromMenu(item.id));
      if (panel === "search") await this.chooseSearch(item.id);
    },
    reload() {
      return this.load(true);
    },
    async load(force) {
      const remembered = rememberedSettings();
      if (!force) {
        this.models = remembered.models ?? this.models;
        this.voice = remembered.voice ?? this.voice;
        this.search = remembered.search ?? this.search;
        if (this.models && this.voice && this.search) return;
      }
      this.panel = "";
      this.loading = true;
      this.modelError = "";
      this.voiceError = "";
      this.searchError = "";
      const [models, voice, search] = await Promise.allSettled([
        this.settings.models({ force }),
        this.settings.voice(force),
        this.settings.search({ force }),
      ]);
      if (models.status === "fulfilled") this.models = models.value;
      else this.modelError = this.failText(this.tModel, "settings.loadFailed", models.reason);
      if (voice.status === "fulfilled") this.voice = voice.value;
      else this.voiceError = this.tVoice("settings.loadFailed");
      if (search.status === "fulfilled") this.search = search.value;
      else this.searchError = this.failText(this.tSearch, "settings.loadFailed", search.reason);
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
    async patchVoice(key, value) {
      if (!this.voice || this.busy) return;
      const previous = this.voice;
      this.voice = { ...this.voice, config: { ...this.voice.config, [key]: value } };
      this.pending = `voice:${key}`;
      this.voiceError = "";
      try {
        this.voice = await this.settings.saveVoice({ [key]: value });
      } catch {
        this.voice = previous;
        this.voiceError = this.tVoice("settings.saveFailed");
      } finally {
        this.pending = "";
      }
    },
    async chooseSearch(rawId) {
      if (!this.search || this.busy) return;
      const id = searchValueFromMenu(rawId);
      this.pending = "search";
      this.searchError = "";
      try {
        this.search = await this.settings.setSearchDefault(id);
      } catch (err) {
        this.searchError = this.failText(this.tSearch, "settings.saveFailed", err);
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

.lares-agent__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px 20px 32px;
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
  font-size: 14px;
  line-height: 20px;
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

.lares-agent__group h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
}

.lares-agent__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lares-agent__hint {
  margin: 0;
  font-size: 13px;
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
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
}
</style>
