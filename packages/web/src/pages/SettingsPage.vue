<script setup lang="ts">
import { ref } from "vue";
import BehaviourTab from "../components/settings/BehaviourTab.vue";
import ModelsTab from "../components/settings/ModelsTab.vue";
import PluginsTab from "../components/settings/PluginsTab.vue";
import ProvidersTab from "../components/settings/ProvidersTab.vue";
import SkillsTab from "../components/settings/SkillsTab.vue";
import ToolsTab from "../components/settings/ToolsTab.vue";
import { useSettingsStore } from "../stores/settings-store";

const settings = useSettingsStore();
const tab = ref("models");
</script>

<template>
	<q-page class="settings">
		<q-banner v-if="settings.error" dense class="bg-negative text-white">
			{{ settings.error }}
			<template #action>
				<q-btn flat dense label="Dismiss" @click="settings.error = null" />
			</template>
		</q-banner>

		<q-tabs v-model="tab" dense align="left" no-caps class="settings__tabs">
			<q-tab name="models" label="Models" />
			<q-tab name="providers" label="Providers" />
			<q-tab name="behaviour" label="Behaviour" />
			<q-tab name="skills" label="Skills" />
			<q-tab name="plugins" label="Plugins" />
			<q-tab name="tools" label="Tools" />
		</q-tabs>

		<q-separator />

		<q-tab-panels v-model="tab" animated keep-alive class="settings__panels">
			<q-tab-panel name="models"><ModelsTab /></q-tab-panel>
			<q-tab-panel name="providers"><ProvidersTab /></q-tab-panel>
			<q-tab-panel name="behaviour"><BehaviourTab /></q-tab-panel>
			<q-tab-panel name="skills"><SkillsTab /></q-tab-panel>
			<q-tab-panel name="plugins"><PluginsTab /></q-tab-panel>
			<q-tab-panel name="tools"><ToolsTab /></q-tab-panel>
		</q-tab-panels>
	</q-page>
</template>

<style scoped lang="scss">
.settings {
	display: flex;
	flex-direction: column;
	height: calc(100vh - 50px);
	min-height: 0;
}

.settings__panels {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	background: transparent;
}
</style>
