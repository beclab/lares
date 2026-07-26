<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSettingsStore } from "../../stores/settings-store";

const settings = useSettingsStore();
const source = ref("");

onMounted(() => {
	void settings.loadPlugins();
});

async function install(): Promise<void> {
	const value = source.value.trim();
	if (!value) return;
	await settings.pluginAction("install", value);
	source.value = "";
}
</script>

<template>
	<div class="plugins">
		<div class="plugins__install">
			<q-input
				v-model="source"
				dense
				outlined
				class="col"
				placeholder="npm package or git URL"
				:disable="settings.busy"
				@keydown.enter="install"
			/>
			<q-btn
				dense
				unelevated
				no-caps
				color="primary"
				label="Install"
				:loading="settings.busy"
				:disable="!source.trim()"
				@click="install"
			/>
			<q-btn dense flat no-caps icon="update" label="Update all" @click="settings.pluginAction('update', '')" />
		</div>

		<q-banner v-for="err in settings.pluginErrors" :key="err" dense class="bg-negative text-white">{{ err }}</q-banner>

		<q-list bordered separator>
			<q-item v-for="entry in settings.packages" :key="entry.source">
				<q-item-section>
					<q-item-label class="plugins__source">{{ entry.source }}</q-item-label>
					<q-item-label caption>
						{{ entry.scope }} ·
						{{ entry.extensions }} extensions, {{ entry.skills }} skills, {{ entry.prompts }} prompts,
						{{ entry.themes }} themes
					</q-item-label>
				</q-item-section>

				<q-item-section side>
					<div class="plugins__actions">
						<q-toggle
							:model-value="entry.enabled"
							@update:model-value="settings.pluginAction($event ? 'enable' : 'disable', entry.source)"
						>
							<q-tooltip>{{ entry.enabled ? "Disable without uninstalling" : "Enable" }}</q-tooltip>
						</q-toggle>
						<q-btn dense flat size="sm" icon="update" @click="settings.pluginAction('update', entry.source)">
							<q-tooltip>Update</q-tooltip>
						</q-btn>
						<q-btn
							dense
							flat
							size="sm"
							icon="delete"
							color="negative"
							@click="settings.pluginAction('remove', entry.source)"
						>
							<q-tooltip>Uninstall</q-tooltip>
						</q-btn>
					</div>
				</q-item-section>
			</q-item>

			<q-item v-if="settings.packages.length === 0">
				<q-item-section class="text-grey-6">No packages are installed.</q-item-section>
			</q-item>
		</q-list>

		<template v-if="settings.extensions.length > 0">
			<div class="plugins__heading">Loaded extensions</div>
			<ul class="plugins__extensions">
				<li v-for="extension in settings.extensions" :key="extension.path">
					{{ extension.name }}
					<span class="plugins__path">{{ extension.path }}</span>
				</li>
			</ul>
		</template>
	</div>
</template>

<style scoped lang="scss">
.plugins {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.plugins__install {
	display: flex;
	align-items: center;
	gap: 6px;
}

.plugins__actions {
	display: flex;
	align-items: center;
	gap: 2px;
}

.plugins__source,
.plugins__path {
	font-family: var(--lares-mono);
	font-size: 12.5px;
}

.plugins__heading {
	font-size: 13px;
	font-weight: 600;
}

.plugins__extensions {
	margin: 0;
	padding-left: 18px;
	font-size: 12.5px;

	.plugins__path {
		margin-left: 8px;
		color: var(--lares-muted);
		font-size: 11.5px;
	}
}
</style>
