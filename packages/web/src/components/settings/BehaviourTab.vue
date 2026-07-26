<script setup lang="ts">
import { THINKING_LEVELS, type ThinkingLevel } from "@lares/shared";
import { computed, onMounted } from "vue";
import { useSettingsStore } from "../../stores/settings-store";

const settings = useSettingsStore();

onMounted(() => {
	void settings.loadSettings();
});

const thinking = computed<ThinkingLevel>({
	get: () => settings.settings?.defaultThinkingLevel ?? "off",
	set: (level) => void settings.setThinkingLevel(level),
});

function toggle(key: "autoCompaction" | "autoRetry" | "enableSkillCommands", value: boolean): void {
	void settings.patch({ [key]: value });
}
</script>

<template>
	<div v-if="settings.settings" class="behaviour">
		<div class="behaviour__field">
			<div>
				<div>Thinking level</div>
				<div class="behaviour__caption">
					How much reasoning budget new sessions ask for. Models that do not support thinking ignore it.
				</div>
			</div>
			<q-select v-model="thinking" :options="THINKING_LEVELS" dense outlined class="behaviour__control" />
		</div>

		<q-separator />

		<q-toggle
			:model-value="settings.settings.autoCompaction"
			label="Compact automatically when the context fills up"
			@update:model-value="toggle('autoCompaction', $event)"
		/>
		<q-toggle
			:model-value="settings.settings.autoRetry"
			label="Retry automatically after a transient provider error"
			@update:model-value="toggle('autoRetry', $event)"
		/>
		<q-toggle
			:model-value="settings.settings.enableSkillCommands"
			label="Expose skills as /skill:name commands"
			@update:model-value="toggle('enableSkillCommands', $event)"
		/>

		<q-separator />

		<p class="behaviour__caption">
			Stored in <code>{{ settings.settingsPath }}</code
			>. Settings the platform manages at startup are rewritten on restart.
		</p>
	</div>
</template>

<style scoped lang="scss">
.behaviour {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.behaviour__field {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
}

.behaviour__control {
	min-width: 160px;
}

.behaviour__caption {
	margin: 0;
	font-size: 12.5px;
	color: var(--lares-muted);
}
</style>
