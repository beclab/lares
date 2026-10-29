<template>
  <section class="lares-voice-keys">
    <h3>{{ t('settings.group.keys') }}</h3>
    <p class="lares-voice-keys__purpose">{{ t('settings.keys.purpose') }}</p>
    <div class="lares-voice-keys__block">
      <div v-if="keys" class="lares-voice-keys__status" role="status">
        <ul v-if="keys.length" class="lares-voice-keys__list">
          <li v-for="key in keys" :key="key.id">
            <span class="lares-voice-keys__name">{{ key.name }}<small>{{ keySummary(key) }}</small></span>
            <button type="button" :disabled="busy" @click="revoking = key">{{ t('settings.keys.revoke') }}</button>
          </li>
        </ul>
        <p v-else class="lares-voice-keys__empty"><span class="lares-voice-keys__dot" aria-hidden="true" />{{ t('settings.keys.empty') }}</p>
      </div>
      <label class="lares-voice-keys__field">
        <span>{{ t('settings.keys.name') }}</span>
        <input v-model="name" type="text" maxlength="64" :placeholder="t('settings.keys.namePlaceholder')" :disabled="busy" />
      </label>
      <div class="lares-voice-keys__models" role="group" :aria-label="t('settings.keys.models')">
        <p>{{ t('settings.keys.models') }}</p>
        <label v-for="model in allModels" :key="model">
          <input type="checkbox" :checked="models.includes(model)" :disabled="busy" @change="toggle(model)" />
          <span>{{ model }}</span>
        </label>
        <label class="lares-voice-keys__tools">
          <input type="checkbox" :checked="clientTools && toolsApply" :disabled="busy || !toolsApply" @change="clientTools = !clientTools" />
          <span>
            {{ t('settings.keys.clientTools') }}
            <small>{{ t('settings.keys.clientToolsHint') }}</small>
          </span>
        </label>
      </div>
      <p v-if="agentSelected" role="note">{{ t('settings.keys.agentWarning') }}</p>
      <p class="lares-voice-keys__once">{{ t('settings.keys.once') }}</p>
      <button type="button" class="lares-voice-keys__issue" :disabled="busy || !name.trim() || !models.length" @click="issue">{{ t(busy ? 'settings.keys.issuing' : 'settings.keys.issue') }}</button>
      <p v-if="error" role="alert">{{ error }}</p>
      <div v-if="issued" class="lares-voice-keys__dialog" role="dialog">
        <p>{{ t('settings.keys.issued') }}</p>
        <code>{{ issued.key }}</code>
        <div class="lares-voice-keys__actions">
          <button type="button" @click="copy">{{ t(copied ? 'settings.keys.copied' : 'settings.keys.copy') }}</button>
          <button type="button" class="is-primary" @click="issued = null">{{ t('settings.keys.done') }}</button>
        </div>
      </div>
      <div v-if="revoking" class="lares-voice-keys__dialog" role="dialog">
        <p>{{ t('settings.keys.revokeConfirm', { name: revoking.name }) }}</p>
        <div class="lares-voice-keys__actions">
          <button type="button" :disabled="busy" @click="revoke">{{ t('settings.keys.revoke') }}</button>
          <button type="button" @click="revoking = null">{{ t('settings.keys.done') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>
<script>
import { markRaw } from "vue";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { VOICE_KEY_AGENT_MODELS, VOICE_KEY_DEFAULT_MODELS, VOICE_KEY_MODELS, VOICE_KEY_TOOL_MODELS } from "@olares/lares-core/voice/keys-client";
export default {
  props: { client: { type: Object, required: true }, t: { type: Function, required: true } },
  data() {
    return { keys: null, name: "", models: [...VOICE_KEY_DEFAULT_MODELS], clientTools: false, issued: null, copied: false, revoking: null, busy: false, error: "", allModels: markRaw([...VOICE_KEY_MODELS]) };
  },
  computed: {
    agentSelected() { return this.models.some((model) => VOICE_KEY_AGENT_MODELS.includes(model)); },
    toolsApply() { return this.models.some((model) => VOICE_KEY_TOOL_MODELS.includes(model)); },
  },
  mounted() { void this.load(); },
  methods: {
    fail(err) { this.error = messageFromCode(this.t, err?.message || "", "error.voice_key_failed"); },
    async load() { try { this.keys = await this.client.list(); } catch (err) { this.fail(err); } },
    toggle(model) { this.models = this.models.includes(model) ? this.models.filter((value) => value !== model) : VOICE_KEY_MODELS.filter((value) => value === model || this.models.includes(value)); },
    keySummary(key) {
      const created = key.createdAt ? ` · ${this.t("settings.keys.created", { at: new Date(key.createdAt).toLocaleString() })}` : "";
      return `${key.models.join(", ")}${key.clientTools ? ` · ${this.t("settings.keys.clientToolsTag")}` : ""}${created}`;
    },
    async issue() {
      this.busy = true; this.error = "";
      try { this.issued = await this.client.issue({ name: this.name, models: this.models, clientTools: this.clientTools && this.toolsApply }); this.copied = false; this.name = ""; this.models = [...VOICE_KEY_DEFAULT_MODELS]; this.clientTools = false; await this.load(); }
      catch (err) { this.fail(err); }
      finally { this.busy = false; }
    },
    async revoke() {
      this.busy = true; this.error = "";
      try { await this.client.revoke(this.revoking.id); this.revoking = null; await this.load(); }
      catch (err) { this.fail(err); }
      finally { this.busy = false; }
    },
    async copy() { try { await navigator.clipboard.writeText(this.issued.key); this.copied = true; } catch (err) { this.fail(err); } },
  },
};
</script>
<style scoped>
.lares-voice-keys {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  margin-top: 8px;
  color: var(--q-ink-1);
  font-size: 15px;
  line-height: 22px;
}

.lares-voice-keys h3 {
  margin: 4px 0 0;
  color: var(--q-ink-3);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-voice-keys__purpose {
  margin: 0;
}

.lares-voice-keys p {
  margin: 0;
  color: var(--q-ink-3);
  font-size: 15px;
  line-height: 22px;
}

.lares-voice-keys [role="alert"],
.lares-voice-keys [role="note"] {
  color: var(--q-orange-default);
}

.lares-voice-keys__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.lares-voice-keys__block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  border: 1px solid var(--q-separator);
  border-radius: 16px;
  padding: 16px;
}

.lares-voice-keys__status {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--q-separator);
}

.lares-voice-keys p.lares-voice-keys__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  color: var(--q-ink-2);
}

.lares-voice-keys__dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--q-ink-3);
}

.lares-voice-keys p.lares-voice-keys__once {
  font-size: 13px;
  line-height: 18px;
}

.lares-voice-keys__list li,
.lares-voice-keys__dialog {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  box-sizing: border-box;
}

.lares-voice-keys__list li {
  border-bottom: 1px solid var(--q-separator);
  padding: 8px 0;
}

.lares-voice-keys__dialog {
  flex-direction: column;
  align-items: stretch;
  border-top: 1px solid var(--q-separator);
  padding-top: 12px;
}

.lares-voice-keys__name {
  min-width: 0;
  flex: 1;
  font-size: 16px;
  line-height: 22px;
}

.lares-voice-keys__name small {
  display: block;
  overflow: hidden;
  color: var(--q-ink-3);
  font-size: 13px;
  line-height: 18px;
  text-overflow: ellipsis;
}

.lares-voice-keys__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lares-voice-keys__field span,
.lares-voice-keys__models > p {
  color: var(--q-ink-2);
}

.lares-voice-keys input[type="text"] {
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  border: 1px solid var(--q-separator);
  border-radius: 16px;
  padding: 0 16px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 16px;
}

.lares-voice-keys input[type="text"]:focus-visible {
  outline: 2px solid var(--q-blue-default);
  outline-offset: 2px;
}

.lares-voice-keys__models {
  display: flex;
  flex-direction: column;
}

.lares-voice-keys__models > p {
  margin: 0;
  padding: 4px 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-voice-keys__models label,
.lares-voice-keys__tools {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  border-top: 1px solid var(--q-separator);
  font-size: 16px;
  line-height: 22px;
}

.lares-voice-keys__tools {
  align-items: flex-start;
  padding-top: 12px;
}

.lares-voice-keys__tools small {
  display: block;
  margin-top: 2px;
  color: var(--q-ink-3);
  font-size: 13px;
  line-height: 18px;
}

.lares-voice-keys__models input,
.lares-voice-keys__tools input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--q-blue-default);
}

.lares-voice-keys button {
  flex: none;
  min-height: 36px;
  border: 1px solid var(--q-separator);
  border-radius: 12px;
  padding: 0 14px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.lares-voice-keys button:disabled {
  cursor: default;
  opacity: 0.45;
}

.lares-voice-keys button:focus-visible {
  outline: 2px solid var(--q-blue-default);
  outline-offset: 2px;
}

.lares-voice-keys__issue,
.lares-voice-keys button.is-primary {
  border: 0;
  background: var(--q-blue-alpha);
  color: var(--q-blue-default);
  font-weight: 500;
}

.lares-voice-keys__issue {
  min-height: 48px;
  border-radius: 16px;
  font-size: 16px;
}

.lares-voice-keys__dialog p {
  color: var(--q-ink-1);
}

.lares-voice-keys code {
  overflow-wrap: anywhere;
  border-radius: 12px;
  padding: 12px;
  background: var(--q-background-3);
  font-size: 13px;
  line-height: 18px;
  user-select: all;
}

.lares-voice-keys__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
</style>
