<template>
  <section class="lares-voice-page" :data-device="layoutDevice">
    <h2 v-if="heading">{{ tVoice("settings.title") }}</h2>
    <div v-if="isDesktop" class="lares-voice-page__list">
      <label class="lares-voice-page__field">
        <span>{{ tVoice("settings.stt.model") }}</span>
        <LaresSelect
          :value="voiceModelId"
          :sections="voiceModelSections"
          :disabled="busy || !voice"
          @select="chooseVoiceModel"
        />
      </label>
      <label class="lares-voice-page__field">
        <span>{{ tVoice("settings.language.title") }}</span>
        <LaresSelect
          :value="voiceLangId"
          :sections="voiceLanguageSections"
          :disabled="busy || !voice"
          @select="chooseVoiceLanguage"
        />
      </label>
    </div>
    <VoicePreferences
      :key="hostKey"
      ref="voicePreferences"
      :settings="settings"
      :tts-fetch="ttsFetch"
      :snapshot="voice"
      :device="device"
      :t="tVoice"
      :bind-before-leave="bindBeforeLeave"
      @change="voice = $event"
    >
      <template v-if="!isDesktop" #lead>
        <LaresSettingRow
          :label="tVoice('settings.stt.model')"
          :value="voiceModelLabel"
          chevron
          :disabled="Boolean(pending)"
          @click="openSheet('voiceModel')"
        />
        <LaresSettingRow
          :label="tVoice('settings.language.title')"
          :value="voiceLangLabel"
          chevron
          :disabled="Boolean(pending)"
          @click="openSheet('voiceLang')"
        />
      </template>
    </VoicePreferences>
    <h3>{{ tVoice("settings.conversation") }}</h3>
    <div v-if="isDesktop" class="lares-voice-page__list">
      <label class="lares-voice-page__field">
        <span>{{ tVoice("settings.mobileMode") }}</span>
        <LaresSelect
          :value="voice?.config?.mobileMode || 'continuous'"
          :sections="mobileModeSections"
          :disabled="busy || !voice"
          @select="(item) => patchVoice('mobileMode', item.id)"
        />
      </label>
      <label class="lares-voice-page__field">
        <span>{{ tVoice("settings.device") }}</span>
        <LaresSelect
          :value="voice?.config?.device || 'auto'"
          :sections="deviceSections"
          :disabled="busy || !voice"
          @select="(item) => patchVoice('device', item.id)"
        />
      </label>
      <label class="lares-voice-page__field">
        <span>{{ tVoice("settings.mode.title") }}</span>
        <LaresSelect
          :value="voice?.config?.streaming ? 'streaming' : 'turns'"
          :sections="readingSections"
          :disabled="busy || !voice || !reading"
          @select="(item) => chooseReading(item.id)"
        />
      </label>
    </div>
    <div v-else class="lares-set-block">
      <LaresSettingRow
        :label="tVoice('settings.mobileMode')"
        :value="voiceChoiceLabel('mobileMode')"
        chevron
        :disabled="Boolean(pending) || !voice"
        @click="openSheet('voiceMobileMode')"
      />
      <LaresSettingRow
        :label="tVoice('settings.device')"
        :value="voiceChoiceLabel('device')"
        chevron
        :disabled="Boolean(pending) || !voice"
        @click="openSheet('voiceDevice')"
      />
      <LaresSettingRow
        :label="tVoice('settings.mode.title')"
        :value="voiceChoiceLabel('reading')"
        :hint="readingHint"
        chevron
        :disabled="Boolean(pending) || !voice || !reading"
        @click="openSheet('voiceReading')"
      />
    </div>
    <p v-if="isDesktop" class="lares-voice-page__hint">{{ readingHint }}</p>
    <p v-if="voiceError" class="lares-voice-page__hint" data-status="error">{{ voiceError }}</p>
    <VoiceKeys :key="`keys-${hostKey}`" :client="voiceKeys" :t="tVoice" />
    <LaresSheet v-if="!isDesktop" :open="Boolean(panel)" :title="sheetTitle" @close="panel = ''">
      <template v-for="section in sheetSections" :key="section.heading || 'main'">
        <p v-if="section.heading" class="lares-voice-page__heading">{{ section.heading }}</p>
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
  </section>
</template>

<script>
import { t as translate } from "@olares/lares-core/i18n/t";
import { EN as VOICE_EN, ZH as VOICE_ZH } from "@olares/lares-core/i18n/voice";
import {
  voiceLanguageItems,
  voiceMenuValue,
  voiceModelItems,
  voiceValueFromMenu,
} from "@olares/lares-core/voice/languages";
import { rememberedSettings } from "@olares/lares-core/larepass/settings";
import { hostKey as hostSessionKey } from "@olares/lares-core/larepass/host";
import { createHostClient } from "../host.js";
import { chatDevice, DEVICE_DESKTOP } from "../layout.js";
import VoicePreferences from "./VoicePreferences.vue";
import VoiceKeys from "./VoiceKeys.vue";
import LaresSettingRow from "./SettingRow.vue";
import LaresSheet from "./Sheet.vue";
import LaresSelect from "./Select.vue";

const catalogs = { voice: { zh: VOICE_ZH, en: VOICE_EN } };

function itemLabel(items, id) {
  return items.find((item) => item.id === id)?.label || "—";
}

export default {
  name: "LaresVoiceSettings",
  components: { VoicePreferences, VoiceKeys, LaresSettingRow, LaresSheet, LaresSelect },
  expose: ["reload", "beforeLeave"],
  props: {
    locale: { type: String, default: "en" },
    device: { type: String, default: "mobile" },
    heading: { type: Boolean, default: true },
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
      pending: "",
      panel: "",
      voice: remembered.voice,
      voiceError: "",
      reading: null,
    };
  },
  computed: {
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
    voiceKeys() { return createHostClient(this.ports).voiceKeys; },
    settings() { return createHostClient(this.ports).settings; },
    busy() { return Boolean(this.pending); },
    voiceModels() {
      return voiceModelItems(this.voice?.sttModels ?? [], this.tVoice("settings.model.auto"));
    },
    voiceLanguages() {
      return voiceLanguageItems(this.tVoice("lang.auto"));
    },
    voiceModelId() { return voiceMenuValue(this.voice?.config?.model); },
    voiceLangId() { return voiceMenuValue(this.voice?.config?.language); },
    voiceModelSections() { return [{ items: this.voiceModels }]; },
    voiceLanguageSections() { return [{ items: this.voiceLanguages }]; },
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
      if (this.panel === "voiceModel") return this.tVoice("settings.stt.model");
      if (this.panel === "voiceLang") return this.tVoice("settings.language.title");
      if (this.panel === "voiceMobileMode") return this.tVoice("settings.mobileMode");
      if (this.panel === "voiceDevice") return this.tVoice("settings.device");
      if (this.panel === "voiceReading") return this.tVoice("settings.mode.title");
      return "";
    },
    sheetCurrent() { return this.sheetCurrentFor(this.panel); },
    sheetSections() {
      if (this.panel === "voiceModel") return [{ items: this.voiceModels.map((item) => ({ id: item.id, label: item.label })) }];
      if (this.panel === "voiceLang") return [{ items: this.voiceLanguages.map((item) => ({ id: item.id, label: item.label })) }];
      if (this.panel === "voiceMobileMode") return this.mobileModeSections;
      if (this.panel === "voiceDevice") return this.deviceSections;
      if (this.panel === "voiceReading") return this.readingSections;
      return [];
    },
  },
  watch: {
    hostKey() {
      this.panel = "";
      this.voice = null;
      this.voiceError = "";
      this.load(true);
    },
  },
  mounted() {
    this.load(false);
  },
  methods: {
    tVoice(key, params) {
      return translate(catalogs.voice, this.locale, key, params);
    },
    openSheet(panel) {
      if (panel !== "voiceReading" && !this.voice) return;
      if (panel === "voiceReading" && !this.reading) return;
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
    async pick(item) {
      if (item.disabled) return;
      const panel = this.panel;
      if (item.id === this.sheetCurrentFor(panel)) {
        this.panel = "";
        return;
      }
      this.panel = "";
      if (panel === "voiceModel") await this.patchVoice("model", voiceValueFromMenu(item.id));
      if (panel === "voiceLang") await this.patchVoice("language", voiceValueFromMenu(item.id));
      if (panel === "voiceMobileMode") await this.patchVoice("mobileMode", item.id);
      if (panel === "voiceDevice") await this.patchVoice("device", item.id);
      if (panel === "voiceReading") this.chooseReading(item.id);
    },
    sheetCurrentFor(panel) {
      if (panel === "voiceModel") return voiceMenuValue(this.voice?.config?.model);
      if (panel === "voiceLang") return voiceMenuValue(this.voice?.config?.language);
      if (panel === "voiceMobileMode") return this.voice?.config?.mobileMode || "continuous";
      if (panel === "voiceDevice") return this.voice?.config?.device || "auto";
      if (panel === "voiceReading") return this.voice?.config?.streaming ? "streaming" : "turns";
      return "";
    },
    beforeLeave() { return this.$refs.voicePreferences?.beforeLeave() ?? Promise.resolve(true); },
    reload() {
      void this.$refs.voicePreferences?.reload().catch(() => {});
      return this.load(true);
    },
    async load(force) {
      if (!force && this.voice) {
        void this.loadReading();
        return;
      }
      this.panel = "";
      this.voiceError = "";
      try {
        this.voice = await this.settings.voice(force, { diagnostics: false });
      } catch {
        this.voiceError = this.tVoice("settings.loadFailed");
      }
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
  },
};
</script>

<style scoped>
.lares-voice-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.lares-voice-page h2,
.lares-voice-page h3 {
  margin: 0;
  font-weight: 500;
}

.lares-voice-page h2 {
  color: var(--q-ink-1);
  font-size: 18px;
  line-height: 24px;
}

.lares-voice-page[data-device="desktop"] h2 {
  font-size: 16px;
}

.lares-voice-page h3 {
  margin-top: 8px;
  color: var(--q-ink-3);
  font-size: 14px;
  line-height: 18px;
}

.lares-voice-page__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lares-voice-page__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  color: var(--q-ink-1);
  font-size: 15px;
  line-height: 22px;
}

.lares-set-block {
  border: 1px solid var(--q-separator);
  border-radius: 20px;
  overflow: hidden;
}

.lares-set-block :deep(.lares-set-row) {
  min-height: 64px;
}

.lares-voice-page__hint {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  color: var(--q-ink-3);
}

.lares-voice-page__hint[data-status="error"] {
  color: var(--q-orange-default);
}

.lares-voice-page__heading {
  margin: 0;
  padding: 12px 16px 4px;
  color: var(--q-ink-3);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}
</style>
