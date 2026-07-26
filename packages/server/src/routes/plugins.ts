import { basename } from "node:path";
import {
	DefaultPackageManager,
	DefaultResourceLoader,
	type PackageSource,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PackageInfo, PluginsResponse } from "@lares/shared";
import { Hono } from "hono";

/** Every resource list empty is how pi expresses "installed but switched off". */
const DISABLED: Omit<Extract<PackageSource, { source: string }>, "source"> = {
	extensions: [],
	skills: [],
	prompts: [],
	themes: [],
};

function sourceOf(entry: PackageSource): string {
	return typeof entry === "string" ? entry : entry.source;
}

function isDisabled(entry: PackageSource): boolean {
	if (typeof entry === "string") return false;
	const lists = [entry.extensions, entry.skills, entry.prompts, entry.themes];
	return lists.every((list) => Array.isArray(list) && list.length === 0);
}

export function createPluginRoutes(agentDir: string, workspace: string): Hono {
	const app = new Hono();

	const context = () => {
		const settings = SettingsManager.create(workspace, agentDir);
		return { settings, packages: new DefaultPackageManager({ cwd: workspace, agentDir, settingsManager: settings }) };
	};

	async function list(): Promise<PluginsResponse> {
		const { settings, packages } = context();
		const configured = settings.getPackages();
		const disabled = new Set(configured.filter(isDisabled).map(sourceOf));

		const resolved = await packages.resolve(async () => "skip");
		const counts = new Map<string, PackageInfo>();

		for (const [kind, list] of Object.entries(resolved) as [keyof typeof resolved, typeof resolved.skills][]) {
			for (const resource of list) {
				if (resource.metadata.origin !== "package") continue;
				const source = resource.metadata.source;
				const info = counts.get(source) ?? {
					source,
					enabled: !disabled.has(source),
					scope: resource.metadata.scope === "project" ? "project" : "global",
					extensions: 0,
					skills: 0,
					prompts: 0,
					themes: 0,
				};
				info[kind] += 1;
				counts.set(source, info);
			}
		}

		// A package whose resources are all switched off contributes nothing to
		// the resolved lists, so it has to be added back from settings.
		for (const entry of configured) {
			const source = sourceOf(entry);
			if (counts.has(source)) continue;
			counts.set(source, {
				source,
				enabled: !disabled.has(source),
				scope: "global",
				extensions: 0,
				skills: 0,
				prompts: 0,
				themes: 0,
			});
		}

		const loader = new DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager: settings });
		await loader.reload();
		const extensions = loader.getExtensions();

		return {
			packages: [...counts.values()].sort((a, b) => a.source.localeCompare(b.source)),
			extensions: extensions.extensions.map((extension) => ({
				name: basename(extension.path).replace(/\.[cm]?[jt]s$/, ""),
				path: extension.path,
			})),
			errors: extensions.errors.map((error) => `${error.path}: ${error.error}`),
		};
	}

	app.get("/", async (c) => c.json(await list()));

	app.post("/", async (c) => {
		const body = (await c.req.json().catch(() => null)) as { action?: unknown; source?: unknown } | null;
		const action = typeof body?.action === "string" ? body.action : "";
		const source = typeof body?.source === "string" ? body.source.trim() : "";

		if (action !== "update" && !source) return c.json({ error: "source is required" }, 400);

		const { settings, packages } = context();

		try {
			switch (action) {
				case "install":
					await packages.installAndPersist(source);
					break;
				case "remove":
					await packages.removeAndPersist(source);
					break;
				case "update":
					await packages.update(source || undefined);
					break;
				case "disable":
				case "enable": {
					const next = settings.getPackages().map((entry) => {
						if (sourceOf(entry) !== source) return entry;
						return action === "disable" ? { source, ...DISABLED } : source;
					});
					settings.setPackages(next);
					await settings.flush();
					break;
				}
				default:
					return c.json({ error: `Unknown action ${JSON.stringify(action)}` }, 400);
			}
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
		}

		return c.json(await list());
	});

	return app;
}
