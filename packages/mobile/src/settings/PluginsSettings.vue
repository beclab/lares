<template>
  <section class="lares-plugins" :aria-busy="busy">
    <h2>{{ t('settings.nav') }}</h2>
    <article v-for="pack in packs" :key="pack.id" class="lares-plugins__card">
      <h3>{{ t(`pack.${pack.id}.title`) }}</h3>
      <p>{{ t(`pack.${pack.id}.intro`) }}</p>
      <button type="button" :disabled="busy || !state" @click="toggle(pack)">{{ t(busy === pack.id ? 'plugin.pending' : !status(pack.id).downloaded ? 'settings.download' : status(pack.id).enabled ? 'settings.disable' : 'settings.enable') }}</button>
      <template v-if="pack.id === 'ha'">
        <p>{{ status('ha').connection?.server || t('settings.tokenHint') }}</p>
        <label>{{ t('settings.server') }}<input v-model="server" type="url" :disabled="Boolean(busy)" autocomplete="off" /></label>
        <label>{{ t('settings.tokenLabel') }}<input v-model="token" type="password" :disabled="Boolean(busy)" autocomplete="off" /></label>
        <button type="button" :disabled="Boolean(busy) || !server || !token" @click="saveHa">{{ t('settings.tokenSave') }}</button>
      </template>
      <template v-else-if="pack.id === 'google-workspace'">
        <p v-if="!status(pack.id).downloaded">{{ t('google.installFirst') }}</p>
        <template v-else>
          <p role="status">{{ t(`google.status.${google.status || 'unconfigured'}`, { email: google.email || '' }) }}</p>
          <template v-if="!google.email">
            <p>{{ t('google.setup') }}</p>
            <p><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">{{ t('google.console') }}</a> · <a href="https://gogcli.sh/quickstart.html" target="_blank" rel="noopener noreferrer">{{ t('google.docs') }}</a></p>
            <label>{{ t('google.import') }}<input type="file" accept=".json,application/json" :disabled="Boolean(busy)" @change="importClient" /></label>
            <p v-if="google.configured">{{ t('google.configured') }}</p>
          </template>
          <template v-if="google.configured">
            <label v-if="!google.email">{{ t('google.email') }}<input v-model="email" type="email" :disabled="Boolean(busy)" autocomplete="off" /></label>
            <p>{{ t('google.permissions') }}</p>
            <div class="lares-plugins__actions">
              <button type="button" :disabled="Boolean(busy) || !(google.email || email.trim())" @click="start">{{ t(google.email ? 'google.reconnect' : 'google.connect') }}</button>
              <button v-if="google.email" type="button" :disabled="Boolean(busy)" @click="run('google', () => client.checkGoogle())">{{ t('google.check') }}</button>
              <button v-if="google.email" type="button" :disabled="Boolean(busy)" @click="disconnect">{{ t('google.disconnect') }}</button>
            </div>
            <p v-if="google.email">{{ t('google.disconnectHint') }}</p>
          </template>
          <div v-if="authorization">
            <a :href="authorization.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{{ t('google.open') }}</a>
            <p>{{ t('google.returnHint') }}</p>
            <label>{{ t('google.callback') }}<input v-model="callback" :disabled="Boolean(busy)" autocomplete="off" spellcheck="false" /></label>
            <button type="button" :disabled="Boolean(busy) || !callback.trim()" @click="complete">{{ t('google.complete') }}</button>
          </div>
        </template>
      </template>
    </article>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<script>
import { markRaw } from 'vue';
import { OFFICIAL_PACKS } from '@olares/lares-core/skills/packs';
import { googleClientFile } from '@olares/lares-core/skills/client';
import { EN, ZH } from '@olares/lares-core/i18n/skills';
import { t as translate } from '@olares/lares-core/i18n/t';
export default {
  props: { client: { type: Object, required: true }, locale: { type: String, default: 'en' } },
  data() { return { packs: markRaw(OFFICIAL_PACKS), state: null, busy: '', error: '', server: '', token: '', email: '', callback: '', authorization: null }; },
  computed: {
    google() { return this.status('google-workspace').connection || {}; },
  },
  mounted() { void this.load(); },
  methods: {
    t(key, params) { return translate({ en: EN, zh: ZH }, this.locale, key, params); },
    status(id) { return this.state?.packs?.find((pack) => pack.id === id) || {}; },
    async load() {
      try { this.state = await this.client.list(); this.server = this.status('ha').connection?.server || ''; }
      catch (err) { this.error = this.t('settings.loadFailed', { msg: err.message }); }
    },
    async run(id, action) {
      if (this.busy) return null;
      this.busy = id; this.error = '';
      try { const result = await action(); this.state = { packs: result.packs }; return result; }
      catch (err) { this.error = this.t('settings.saveFailed', { msg: err.message }); try { this.state = await this.client.list(); } catch {} return null; }
      finally { this.busy = ''; }
    },
    toggle(pack) { const row = this.status(pack.id); return this.run(pack.id, () => !row.downloaded ? this.client.download(pack.id) : row.enabled ? this.client.disable(pack.id) : this.client.enable(pack.id)); },
    async saveHa() { const token = this.token; this.token = ''; await this.run('ha', () => this.client.saveToken('ha', this.server, token)); },
    async importClient(event) {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      try { const raw = await googleClientFile(file); if (await this.run('google', () => this.client.importGoogle(raw))) { this.authorization = null; this.callback = ''; } }
      catch (err) { this.error = this.t('google.error', { msg: err.message }); }
    },
    async start() { this.authorization = null; this.callback = ''; const result = await this.run('google', () => this.client.startGoogle(this.google.email || this.email)); if (result) this.authorization = result.authorization; },
    async complete() { const callback = this.callback; this.callback = ''; if (await this.run('google', () => this.client.completeGoogle(callback))) this.authorization = null; },
    async disconnect() { if (await this.run('google', () => this.client.disconnectGoogle())) { this.authorization = null; this.callback = ''; this.email = ''; } },
  },
};
</script>
<style scoped>
.lares-plugins { display: grid; gap: 16px; min-width: 0; }
.lares-plugins__card { display: grid; gap: 12px; border: 1px solid var(--lares-border, #ddd); border-radius: 12px; padding: 16px; min-width: 0; overflow-wrap: anywhere; }
.lares-plugins p { font-size: 14px; line-height: 1.5; }
.lares-plugins label { display: grid; gap: 6px; margin: 8px 0; }
.lares-plugins input { min-width: 0; width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--lares-border, #ccc); border-radius: 8px; color: inherit; background: transparent; }
.lares-plugins button { width: fit-content; padding: 10px 14px; border: 1px solid var(--lares-border, #ccc); border-radius: 8px; color: inherit; background: transparent; cursor: pointer; }
.lares-plugins button:disabled { opacity: .5; cursor: default; }
.lares-plugins__actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
