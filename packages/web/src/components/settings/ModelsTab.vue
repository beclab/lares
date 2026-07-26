<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";

const settings = useSettingsStore();
const app = useAppStore();

const draft = ref("");
const dirty = computed(() => draft.value !== settings.modelsConfig);
const saved = ref(false);

onMounted(async () => {
	await settings.loadModels();
	draft.value = settings.modelsConfig;
});

watch(
	() => settings.modelsConfig,
	(value) => {
		if (!dirty.value) draft.value = value;
	},
);

async function save(): Promise<void> {
	saved.value = await settings.saveModelsConfig(draft.value);
	if (saved.value) draft.value = settings.modelsConfig;
}

function revert(): void {
	draft.value = settings.modelsConfig;
}

/**
 * The gateway decides which models exist, and pi caches what it read at
 * startup, so re-reading has to touch both before the picker agrees with
 * either.
 */
async function syncGateway(): Promise<void> {
	await app.loadGatewayStatus();
	await settings.loadModels(true);
	draft.value = settings.modelsConfig;
}

const defaultModel = computed({
	get: () => {
		const current = settings.settings;
		return current?.defaultProvider && current.defaultModel ? `${current.defaultProvider}/${current.defaultModel}` : null;
	},
	set: (value: string | null) => {
		if (!value) return;
		const slash = value.indexOf("/");
		void settings.patch({ defaultProvider: value.slice(0, slash), defaultModel: value.slice(slash + 1) });
	},
});

const modelOptions = computed(() =>
	settings.models.map((model) => ({
		label: `${model.provider}/${model.modelId}`,
		value: `${model.provider}/${model.modelId}`,
		caption: `${Math.round(model.contextWindow / 1000)}K context${model.input.includes("image") ? " · images" : ""}`,
	})),
);
</script>

<template>
	<div class="models">
		<q-select
			v-model="defaultModel"
			:options="modelOptions"
			emit-value
			map-options
			dense
			outlined
			label="Default model for new sessions"
		>
			<template #option="scope">
				<q-item v-bind="scope.itemProps">
					<q-item-section>
						<q-item-label>{{ scope.opt.label }}</q-item-label>
						<q-item-label caption>{{ scope.opt.caption }}</q-item-label>
					</q-item-section>
				</q-item>
			</template>
		</q-select>

		<div class="models__gateway">
			<span>
				Gateway
				<q-badge
					:color="app.gateway?.reachable ? 'positive' : 'negative'"
					:label="app.gateway?.reachable ? 'reachable' : 'unreachable'"
				/>
			</span>
			<q-btn dense flat no-caps icon="sync" label="Re-read gateway models" @click="syncGateway" />
		</div>

		<div class="models__header">
			<span class="models__path">{{ settings.modelsPath }}</span>
			<q-space />
			<q-btn dense flat no-caps label="Revert" :disable="!dirty" @click="revert" />
			<q-btn dense unelevated no-caps color="primary" label="Save" :disable="!dirty" @click="save" />
		</div>

		<q-input
			v-model="draft"
			type="textarea"
			outlined
			dense
			input-class="models__editor"
			:input-style="{ minHeight: '320px' }"
		/>

		<p class="models__hint">
			Editing this file adds providers and overrides model metadata such as context window and pricing. The bundled
			Olares provider is regenerated at startup if you remove it.
		</p>
	</div>
</template>

<style scoped lang="scss">
.models {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.models__gateway {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 13px;
}

.models__header {
	display: flex;
	align-items: center;
	gap: 6px;
}

.models__path {
	font-family: var(--lares-mono);
	font-size: 12px;
	color: var(--lares-muted);
}

.models__hint {
	margin: 0;
	font-size: 12.5px;
	color: var(--lares-muted);
}

:deep(.models__editor) {
	font-family: var(--lares-mono);
	font-size: 12.5px;
}
</style>
