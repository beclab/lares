import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSession, invalidateSessions, listSessions } from "../src/sessions/catalog.ts";

function info(id: string): SessionInfo {
	return {
		id,
		path: `/sessions/${id}.jsonl`,
		cwd: "/workspace",
		created: new Date(0),
		modified: new Date(0),
		messageCount: 1,
		firstMessage: id,
	} as SessionInfo;
}

let scans: number;
let onDisk: SessionInfo[];
/** Resolved by the test to hold a scan open, when it cares about overlap. */
let gate: Promise<void> | undefined;

beforeEach(() => {
	scans = 0;
	onDisk = [info("a"), info("b")];
	gate = undefined;
	invalidateSessions();

	vi.spyOn(SessionManager, "listAll").mockImplementation(async () => {
		scans += 1;
		if (gate) await gate;
		return onDisk;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	invalidateSessions();
});

describe("session catalog", () => {
	it("scans once and answers the next call from memory", async () => {
		expect((await listSessions()).map((entry) => entry.id)).toEqual(["a", "b"]);
		await listSessions();
		expect(scans).toBe(1);
	});

	it("shares one scan between callers that arrive together", async () => {
		let open = () => {};
		gate = new Promise<void>((resolve) => {
			open = resolve;
		});

		const both = Promise.all([listSessions(), listSessions()]);
		open();
		await both;

		expect(scans).toBe(1);
	});

	it("scans again after an invalidation", async () => {
		await listSessions();
		invalidateSessions();
		await listSessions();
		expect(scans).toBe(2);
	});

	it("discards a scan that was already running when the cache was invalidated", async () => {
		let open = () => {};
		gate = new Promise<void>((resolve) => {
			open = resolve;
		});

		const stale = listSessions();
		invalidateSessions();
		onDisk = [info("a"), info("b"), info("c")];
		open();
		await stale;

		gate = undefined;
		// Serving the in-flight result here would hide the session added while it
		// was running until the entry expired.
		expect((await listSessions()).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
	});

	it("finds a session without rescanning", async () => {
		await listSessions();
		expect((await findSession("b"))?.id).toBe("b");
		expect(scans).toBe(1);
	});

	it("rescans when a remembered list does not have the session", async () => {
		await listSessions();
		onDisk = [...onDisk, info("c")];

		expect((await findSession("c"))?.id).toBe("c");
		expect(scans).toBe(2);
	});

	it("does not rescan when the list it just built has no such session", async () => {
		expect(await findSession("nope")).toBeUndefined();
		expect(scans).toBe(1);
	});
});
