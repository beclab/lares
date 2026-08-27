<template>
  <section class="lares-turn-deliverables" :aria-label="t('produced')">
    <p v-if="group.loading" class="lares-turn-media-loading">{{ t("mediaLoading") }}</p>
    <div v-if="group.media.length" class="lares-turn-media-list">
      <figure v-for="item in group.media" :key="item.path" class="lares-turn-media">
        <figcaption class="lares-turn-media-caption">
          <span :title="item.path">{{ item.name }}</span>
          <button type="button" class="lares-turn-open" @click="$emit('open', item.path)">{{ t("openInTab") }}</button>
        </figcaption>
        <img
          v-if="item.kind === 'image'"
          class="lares-turn-media-image"
          :src="mediaUrl(item)"
          :alt="item.name"
          @load="$emit('media')"
          @click="$emit('open', item.path)"
        />
        <video
          v-else-if="item.kind === 'video'"
          class="lares-turn-media-video"
          :src="mediaUrl(item)"
          controls
          playsinline
        />
        <audio
          v-else
          class="lares-turn-media-audio"
          :src="mediaUrl(item)"
          controls
        />
      </figure>
    </div>
    <div v-if="group.files.length" class="lares-turn-files">
      <span class="lares-turn-files-label">{{ t("produced") }}</span>
      <div class="lares-turn-files-row">
        <button
          v-for="path in group.files"
          :key="path"
          type="button"
          class="lares-turn-file"
          :title="path"
          @click="$emit('open', path)"
        >
          {{ fileName(path) }}
        </button>
      </div>
    </div>
  </section>
</template>

<script>
import { fileName } from "@olares/lares-core/files/preview-workspace";

export default {
  name: "LaresDeliverables",
  props: {
    group: { type: Object, required: true },
    mediaUrl: { type: Function, required: true },
    t: { type: Function, required: true },
  },
  emits: ["open", "media"],
  methods: { fileName },
};
</script>

<style scoped>
.lares-turn-deliverables {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.lares-turn-media-loading {
  margin: 0;
  color: var(--q-ink-3);
  font-size: 13px;
}

.lares-turn-media-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lares-turn-media {
  display: flex;
  width: fit-content;
  max-width: 100%;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 10px;
  overflow: hidden;
  border: 1px solid var(--q-separator);
  border-radius: 14px;
  background: var(--q-background-1);
}

.lares-turn-media-caption {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--q-ink-2);
  font-size: 12px;
}

.lares-turn-media-caption > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-turn-open,
.lares-turn-file {
  border: 0;
  background: transparent;
  color: var(--q-blue-default);
}

.lares-turn-media-image,
.lares-turn-media-video {
  display: block;
  max-width: min(100%, 640px);
  max-height: 420px;
  border-radius: 10px;
  object-fit: contain;
}

.lares-turn-media-audio {
  display: block;
  width: min(520px, 100%);
}

.lares-turn-files {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.lares-turn-files-label {
  color: var(--q-ink-3);
}

.lares-turn-files-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.lares-turn-file {
  max-width: 320px;
  padding: 4px 8px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--q-background-hover);
  color: var(--q-ink-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
