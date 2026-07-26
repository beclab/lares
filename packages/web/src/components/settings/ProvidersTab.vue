<script setup lang="ts">
import type { AuthFlowEvent, ProviderAuthInfo } from "@lares/shared";
import { onMounted, ref } from "vue";
import { type OAuthFlow, startOAuth } from "../../lib/oauth";
import { useSettingsStore } from "../../stores/settings-store";

const settings = useSettingsStore();

const keyDraft = ref<Record<string, string>>({});
const flowProvider = ref<string | null>(null);
const flowEvents = ref<AuthFlowEvent[]>([]);
const flowAnswer = ref("");
let flow: OAuthFlow | null = null;

const pendingPrompt = ref<Extract<AuthFlowEvent, { type: "prompt" }> | null>(null);

onMounted(() => {
	void settings.loadProviders();
});

async function saveKey(provider: ProviderAuthInfo): Promise<void> {
	const value = keyDraft.value[provider.id]?.trim();
	if (!value) return;
	await settings.setApiKey(provider.id, value);
	keyDraft.value[provider.id] = "";
}

function startLogin(provider: ProviderAuthInfo): void {
	flowProvider.value = provider.id;
	flowEvents.value = [];
	pendingPrompt.value = null;
	flowAnswer.value = "";

	flow = startOAuth(provider.id, (event) => {
		if (event.type === "prompt") pendingPrompt.value = event;
		else flowEvents.value.push(event);

		if (event.type === "done") void settings.loadProviders();
	});
}

async function submitAnswer(value: string): Promise<void> {
	const prompt = pendingPrompt.value;
	if (!prompt || !flow) return;
	pendingPrompt.value = null;
	flowAnswer.value = "";
	await flow.answer(prompt.promptId, value);
}

async function closeFlow(): Promise<void> {
	await flow?.cancel();
	flow = null;
	flowProvider.value = null;
}
</script>

<template>
	<div class="providers">
		<p class="providers__hint">
			Credentials are stored in pi's auth file and never sent back to the browser. The Olares gateway provider needs no
			key.
		</p>

		<q-list bordered separator>
			<q-item v-for="provider in settings.providers" :key="provider.id">
				<q-item-section>
					<q-item-label>
						{{ provider.name }}
						<q-badge v-if="provider.configured" color="positive" class="q-ml-sm" label="Signed in" />
						<q-badge v-if="provider.usingOAuth" outline color="primary" class="q-ml-xs" label="OAuth" />
					</q-item-label>
					<q-item-label caption>
						{{ provider.modelCount }} models
						<template v-if="provider.source"> · from {{ provider.source }}</template>
					</q-item-label>

					<div v-if="!provider.configured && provider.supportsApiKey" class="providers__key">
						<q-input
							v-model="keyDraft[provider.id]"
							dense
							outlined
							type="password"
							placeholder="API key"
							@keydown.enter="saveKey(provider)"
						/>
						<q-btn dense flat icon="save" :disable="!keyDraft[provider.id]" @click="saveKey(provider)">
							<q-tooltip>Save key</q-tooltip>
						</q-btn>
					</div>
				</q-item-section>

				<q-item-section side>
					<div class="providers__actions">
						<q-btn
							v-if="provider.supportsOAuth && !provider.configured"
							dense
							flat
							no-caps
							label="Sign in"
							@click="startLogin(provider)"
						/>
						<q-btn
							v-if="provider.configured"
							dense
							flat
							no-caps
							color="negative"
							label="Sign out"
							@click="settings.signOut(provider.id)"
						/>
					</div>
				</q-item-section>
			</q-item>

			<q-item v-if="settings.providers.length === 0">
				<q-item-section class="text-grey-6">No providers are registered yet.</q-item-section>
			</q-item>
		</q-list>

		<q-dialog :model-value="flowProvider !== null" persistent>
			<q-card class="providers__dialog">
				<q-card-section class="text-subtitle1">Signing in to {{ flowProvider }}</q-card-section>

				<q-card-section class="providers__log">
					<div v-for="(event, index) in flowEvents" :key="index" class="providers__event">
						<template v-if="event.type === 'auth_url'">
							<a :href="event.url" target="_blank" rel="noreferrer">Open the login page</a>
							<div v-if="event.instructions" class="providers__muted">{{ event.instructions }}</div>
						</template>
						<template v-else-if="event.type === 'device_code'">
							Enter code <code>{{ event.userCode }}</code> at
							<a :href="event.verificationUri" target="_blank" rel="noreferrer">{{ event.verificationUri }}</a>
						</template>
						<template v-else-if="event.type === 'done'">
							<span class="text-positive">Signed in.</span>
						</template>
						<template v-else-if="event.type === 'error'">
							<span class="text-negative">{{ event.message }}</span>
						</template>
						<template v-else>{{ event.message }}</template>
					</div>
				</q-card-section>

				<q-card-section v-if="pendingPrompt">
					<div class="q-mb-sm">{{ pendingPrompt.message }}</div>

					<div v-if="pendingPrompt.options" class="providers__options">
						<q-btn
							v-for="option in pendingPrompt.options"
							:key="option.id"
							dense
							outline
							no-caps
							:label="option.label"
							@click="submitAnswer(option.id)"
						/>
					</div>

					<q-input
						v-else
						v-model="flowAnswer"
						dense
						outlined
						autofocus
						@keydown.enter="submitAnswer(flowAnswer)"
					/>
				</q-card-section>

				<q-card-actions align="right">
					<q-btn flat no-caps label="Close" @click="closeFlow" />
				</q-card-actions>
			</q-card>
		</q-dialog>
	</div>
</template>

<style scoped lang="scss">
.providers__hint {
	margin: 0 0 12px;
	font-size: 12.5px;
	color: var(--lares-muted);
}

.providers__key {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 8px;
	max-width: 420px;
}

.providers__actions {
	display: flex;
	gap: 4px;
}

.providers__dialog {
	min-width: 420px;
}

.providers__log {
	max-height: 260px;
	overflow-y: auto;
	font-size: 13px;
}

.providers__event + .providers__event {
	margin-top: 6px;
}

.providers__muted {
	color: var(--lares-muted);
}

.providers__options {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
</style>
