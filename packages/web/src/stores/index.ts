import { defineStore as defineQuasarStore } from "@quasar/app-vite";
import { createPinia } from "pinia";

export default defineQuasarStore(() => createPinia());
