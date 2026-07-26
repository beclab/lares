import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
	{
		path: "/",
		component: () => import("../layouts/MainLayout.vue"),
		children: [
			{ path: "", name: "chat", component: () => import("../pages/ChatPage.vue") },
			{ path: "session/:id", name: "session", component: () => import("../pages/ChatPage.vue") },
			{ path: "settings", name: "settings", component: () => import("../pages/SettingsPage.vue") },
		],
	},
	{
		path: "/:catchAll(.*)*",
		component: () => import("../pages/ErrorNotFound.vue"),
	},
];

export default routes;
