import { defineConfig } from "@quasar/app-vite";

const API_TARGET = process.env.LARES_API_TARGET ?? "http://127.0.0.1:30141";

export default defineConfig(() => ({
	boot: ["icons"],

	css: ["app.scss"],

	extras: ["roboto-font", "material-symbols-outlined"],

	build: {
		target: {
			browser: ["es2022", "firefox115", "chrome115", "safari16"],
			node: "node22",
		},
		vueRouterMode: "history",
		typescript: {
			strict: true,
			vueShim: true,
		},
		distDir: "dist",
	},

	devServer: {
		port: 9200,
		open: false,
		// The API and the SPA share an origin in production; mirror that in dev
		// so relative fetches and EventSource URLs behave identically.
		proxy: {
			"/api": { target: API_TARGET, changeOrigin: true },
		},
	},

	framework: {
		config: {
			dark: "auto",
		},
		// Must match the font shipped by `extras`, or every component emits
		// `material-icons` class names that no bundled @font-face claims and
		// icons render as their literal ligature names.
		iconSet: "material-symbols-outlined",
		plugins: ["Notify", "Dialog"],
	},

	animations: [],
}));
