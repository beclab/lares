<template>
  <section class="lares-voice-keys">
    <h3>{{ t('settings.group.keys') }}</h3>
    <p class="lares-agent__hint">{{ t('settings.keys.hint') }}</p>
    <ul v-if="keys && keys.length" class="lares-voice-keys__list">
      <li v-for="key in keys" :key="key.id">
        <span>{{ key.name }}<small>{{ key.models.join(', ') }}</small></span>
        <button type="button" :disabled="busy" @click="revoking = key">{{ t('settings.keys.revoke') }}</button>
      </li>
    </ul>
    <p v-else-if="keys" class="lares-agent__hint">{{ t('settings.keys.empty') }}</p>
    <label>{{ t('settings.keys.name') }}
      <input v-model="name" type="text" maxlength="64" :placeholder="t('settings.keys.namePlaceholder')" :disabled="busy" />
    </label>
    <fieldset :disabled="busy">
      <legend>{{ t('settings.keys.models') }}</legend>
      <label v-for="model in allModels" :key="model"><input type="checkbox" :checked="models.includes(model)" @change="toggle(model)" />{{ model }}</label>
    </fieldset>
    <p v-if="agentSelected" role="note" data-status="error">{{ t('settings.keys.agentWarning') }}</p>
    <button type="button" :disabled="busy || !name.trim() || !models.length" @click="issue">{{ t(busy ? 'settings.keys.issuing' : 'settings.keys.issue') }}</button>
    <p v-if="error" role="alert" data-status="error">{{ error }}</p>
    <div v-if="issued" class="lares-voice-keys__issued" role="dialog">
      <p>{{ t('settings.keys.issued') }}</p>
      <code>{{ issued.key }}</code>
      <button type="button" @click="copy">{{ t(copied ? 'settings.keys.copied' : 'settings.keys.copy') }}</button>
      <button type="button" @click="issued = null">{{ t('settings.keys.done') }}</button>
    </div>
    <div v-if="revoking" class="lares-voice-keys__confirm" role="dialog">
      <p>{{ t('settings.keys.revokeConfirm', { name: revoking.name }) }}</p>
      <button type="button" :disabled="busy" @click="revoke">{{ t('settings.keys.revoke') }}</button>
      <button type="button" @click="revoking = null">{{ t('settings.keys.done') }}</button>
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
.lares-voice-keys { display: flex; flex-direction: column; gap: 8px; }
.lares-voice-keys__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.lares-voice-keys__list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lares-voice-keys__list small { display: block; opacity: 0.7; }
.lares-voice-keys fieldset { display: flex; flex-wrap: wrap; gap: 12px; border: 0; margin: 0; padding: 0; }
.lares-voice-keys code { overflow-wrap: anywhere; user-select: all; }
.lares-voice-keys [data-status="error"] { color: var(--lares-danger, #d4380d); }
</style>
