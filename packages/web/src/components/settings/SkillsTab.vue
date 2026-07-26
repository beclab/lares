<script setup lang="ts">
import { onMounted } from "vue";
import { useSettingsStore } from "../../stores/settings-store";

const settings = useSettingsStore();

onMounted(() => {
	void settings.loadSkills();
});
</script>

<template>
	<div class="skills">
		<p class="skills__hint">
			A skill the model cannot invoke stays available to you as <code>/skill:name</code>. Turning one off narrows the
			system prompt, which is worth doing when a workspace ships many skills.
		</p>

		<q-banner v-for="diagnostic in settings.skillDiagnostics" :key="diagnostic" dense class="bg-grey-9 text-white">
			{{ diagnostic }}
		</q-banner>

		<q-list bordered separator>
			<q-item v-for="skill in settings.skills" :key="skill.filePath">
				<q-item-section>
					<q-item-label>{{ skill.name }}</q-item-label>
					<q-item-label caption lines="2">{{ skill.description }}</q-item-label>
					<q-item-label caption class="skills__path">{{ skill.source }}</q-item-label>
				</q-item-section>

				<q-item-section side>
					<q-toggle
						:model-value="!skill.disableModelInvocation"
						@update:model-value="settings.setSkillModelInvocation(skill.name, !$event)"
					>
						<q-tooltip>Let the model invoke this skill on its own</q-tooltip>
					</q-toggle>
				</q-item-section>
			</q-item>

			<q-item v-if="settings.skills.length === 0">
				<q-item-section class="text-grey-6">No skills are installed.</q-item-section>
			</q-item>
		</q-list>
	</div>
</template>

<style scoped lang="scss">
.skills {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.skills__hint {
	margin: 0;
	font-size: 12.5px;
	color: var(--lares-muted);
}

.skills__path {
	font-family: var(--lares-mono);
	font-size: 11.5px;
}
</style>
