<template>
  <section class="lares-voice-keys">
    <h3>{{ t('settings.group.keys') }}</h3>
    <p>{{ t('settings.keys.hint') }}</p>
    <ul v-if="keys && keys.length" class="lares-voice-keys__list">
      <li v-for="key in keys" :key="key.id">
        <span class="lares-voice-keys__name">{{ key.name }}<small>{{ key.models.join(', ') }}</small></span>
        <button type="button" :disabled="busy" @click="revoking = key">{{ t('settings.keys.revoke') }}</button>
      </li>
    </ul>
    <p v-else-if="keys">{{ t('settings.keys.empty') }}</p>
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
    </div>
    <p v-if="agentSelected" role="note">{{ t('settings.keys.agentWarning') }}</p>
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
  </section>
</template>
<script>
import { markRaw } from "vue";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { VOICE_KEY_AGENT_MODELS, VOICE_KEY_DEFAULT_MODELS, VOICE_KEY_MODELS } from "@olares/lares-core/voice/keys-client";
export default {
  props: { client: { type: Object, required: true }, t: { type: Function, required: true } },
  data() {
    return { keys: null, name: "", models: [...VOICE_KEY_DEFAULT_MODELS], issued: null, copied: false, revoking: null, busy: false, error: "", allModels: markRaw([...VOICE_KEY_MODELS]) };
  },
  computed: { agentSelected() { return this.models.some((model) => VOICE_KEY_AGENT_MODELS.includes(model)); } },
  mounted() { void this.load(); },
  methods: {
    fail(err) { this.error = messageFromCode(this.t, err?.message || "", "error.voice_key_failed"); },
    async load() { try { this.keys = await this.client.list(); } catch (err) { this.fail(err); } },
    toggle(model) { this.models = this.models.includes(model) ? this.models.filter((value) => value !== model) : VOICE_KEY_MODELS.filter((value) => value === model || this.models.includes(value)); },
    async issue() {
      this.busy = true; this.error = "";
      try { this.issued = await this.client.issue({ name: this.name, models: this.models }); this.copied = false; this.name = ""; this.models = [...VOICE_KEY_DEFAULT_MODELS]; await this.load(); }
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

.lares-voice-keys__list li,
.lares-voice-keys__dialog {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  box-sizing: border-box;
  border: 1px solid var(--q-separator);
  border-radius: 20px;
  padding: 12px 16px;
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
  overflow: hidden;
  border: 1px solid var(--q-separator);
  border-radius: 20px;
}

.lares-voice-keys__models > p {
  margin: 0;
  padding: 12px 16px 4px;
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-voice-keys__models label {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 16px;
  border-top: 1px solid var(--q-separator);
  font-size: 16px;
  line-height: 22px;
}

.lares-voice-keys__models input {
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

.lares-voice-keys__dialog {
  flex-direction: column;
  align-items: stretch;
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
