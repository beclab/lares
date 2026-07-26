import { defineRouter } from "@quasar/app-vite";
import { createRouter, createWebHistory } from "vue-router";
import routes from "./routes";

export default defineRouter(() => {
	return createRouter({
		scrollBehavior: () => ({ left: 0, top: 0 }),
		routes,
		history: createWebHistory(process.env.VUE_ROUTER_BASE),
	});
});
