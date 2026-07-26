import { readFile, writeFile } from "node:fs/promises";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SkillInfo } from "@lares/shared";
import { Hono } from "hono";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const FLAG = /^disable-model-invocation:.*$/m;

/**
 * Flips `disable-model-invocation` in a SKILL.md front matter block.
 *
 * The flag is edited in place rather than by re-serialising the document,
 * because the rest of the front matter is the author's and round-tripping YAML
 * would quietly reformat it.
 */
export function toggleModelInvocation(source: string, disabled: boolean): string {
	const match = FRONTMATTER.exec(source);
	if (!match) throw new Error("Skill file has no front matter block");

	const block = match[1] as string;
	const line = `disable-model-invocation: ${disabled}`;
	const updated = FLAG.test(block) ? block.replace(FLAG, line) : `${block}\n${line}`;

	return `${source.slice(0, match.index)}---\n${updated}\n---${source.slice(match.index + match[0].length)}`;
}

export function createSkillRoutes(agentDir: string, workspace: string): Hono {
	const app = new Hono();

	async function list(): Promise<{ skills: SkillInfo[]; diagnostics: string[] }> {
		const loader = new DefaultResourceLoader({
			cwd: workspace,
			agentDir,
			settingsManager: SettingsManager.create(workspace, agentDir),
		});
		await loader.reload();

		const { skills, diagnostics } = loader.getSkills();
		return {
			skills: skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				filePath: skill.filePath,
				disableModelInvocation: skill.disableModelInvocation,
				source: skill.sourceInfo.source,
			})),
			diagnostics: diagnostics.map((entry) => entry.message),
		};
	}

	app.get("/", async (c) => c.json(await list()));

	/**
	 * Turning a skill "off" hides it from the model but keeps it callable as
	 * /skill:name, which is what pi's own flag means. Uninstalling is a package
	 * operation, not a toggle.
	 */
	app.patch("/:name", async (c) => {
		const name = c.req.param("name");
		const body = (await c.req.json().catch(() => null)) as { disableModelInvocation?: unknown } | null;
		if (typeof body?.disableModelInvocation !== "boolean") {
			return c.json({ error: "disableModelInvocation must be a boolean" }, 400);
		}

		const { skills } = await list();
		const skill = skills.find((entry) => entry.name === name);
		if (!skill) return c.json({ error: `Unknown skill ${name}` }, 404);

		const source = await readFile(skill.filePath, "utf8");
		await writeFile(skill.filePath, toggleModelInvocation(source, body.disableModelInvocation), "utf8");

		return c.json(await list());
	});

	return app;
}
