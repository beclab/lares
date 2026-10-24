<template>
  <section class="mobile-new-session" :aria-label="t('desktop.newSession')">
    <div class="mobile-new-session__brand">
      <div class="mobile-new-session__logo" :style="logoStyle" aria-hidden="true" />
      <h2 class="mobile-new-session__title">{{ t("shell.title") }}</h2>
    </div>

    <div class="mobile-new-session__prompt">
      <div class="mobile-new-session__composer">
        <slot />
      </div>
    </div>
  </section>
</template>

<script>
import { MARK_DATA_URI } from "@olares/lares-core/icons/mark";

export default {
  name: "LaresMobileNewSession",
  props: {
    t: { type: Function, required: true },
  },
  computed: {
    logoStyle() {
      return { backgroundImage: MARK_DATA_URI };
    },
  },
};
</script>

<style scoped>
.mobile-new-session {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: stretch;
}

.mobile-new-session__brand {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.mobile-new-session__logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  box-shadow: inset 0 1.8px 0 rgb(255 255 255 / 50%);
  animation: mobile-brand-in var(--lares-duration-normal, 220ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1));
}

@keyframes mobile-brand-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-new-session__logo {
    animation: none;
  }
}

.mobile-new-session__title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  line-height: 34px;
  letter-spacing: -0.02em;
}

.mobile-new-session__prompt {
  display: flex;
  width: 100%;
  flex-direction: column;
  padding: 8px 16px 12px;
}

.mobile-new-session__composer {
  width: 100%;
}

@media (max-height: 640px) {
  .mobile-new-session__logo {
    width: 48px;
    height: 48px;
  }

  .mobile-new-session__title {
    font-size: 24px;
    line-height: 30px;
  }
}
</style>
