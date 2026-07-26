import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// The rendering helpers touch DOMPurify and URL, which need a document.
		environment: "jsdom",
		include: ["test/**/*.test.ts"],
	},
});
