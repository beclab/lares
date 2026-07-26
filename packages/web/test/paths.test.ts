import { describe, expect, it } from "vitest";
import { toWorkspaceRelative } from "../src/lib/paths";

const ROOT = "/data/workspace";

describe("toWorkspaceRelative", () => {
	it("maps the root itself to the root marker", () => {
		expect(toWorkspaceRelative(ROOT, ROOT)).toBe(".");
	});

	it("strips the root from a nested path", () => {
		expect(toWorkspaceRelative(ROOT, `${ROOT}/repo`)).toBe("repo");
		expect(toWorkspaceRelative(ROOT, `${ROOT}/.worktrees/repo/feature-a`)).toBe(".worktrees/repo/feature-a");
	});

	it("falls back to the root when nothing is selected yet", () => {
		expect(toWorkspaceRelative(ROOT, null)).toBe(".");
		expect(toWorkspaceRelative(undefined, `${ROOT}/repo`)).toBe(".");
	});

	it("falls back to the root for a path outside it", () => {
		expect(toWorkspaceRelative(ROOT, "/etc/passwd")).toBe(".");
	});

	it("does not treat a sibling with a shared prefix as inside", () => {
		expect(toWorkspaceRelative(ROOT, "/data/workspace-other/repo")).toBe(".");
	});
});
