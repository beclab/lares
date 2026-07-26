import type { AgentMessage } from "@lares/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { clearSessionCache, forgetSession, readSession, writeSession } from "../src/lib/session-cache";

function transcript(text: string): AgentMessage[] {
	return [{ role: "user", content: text, timestamp: 0 }];
}

function store(id: string): void {
	writeSession(id, { cwd: "/workspace", messages: transcript(id) });
}

beforeEach(() => {
	clearSessionCache();
});

describe("session cache", () => {
	it("returns what was stored", () => {
		store("a");
		expect(readSession("a")?.messages).toEqual(transcript("a"));
	});

	it("has nothing for a session never opened", () => {
		expect(readSession("a")).toBeUndefined();
	});

	it("replaces an entry rather than keeping both", () => {
		store("a");
		writeSession("a", { cwd: "/workspace", messages: transcript("newer") });
		expect(readSession("a")?.messages).toEqual(transcript("newer"));
	});

	it("drops the least recently opened session once full", () => {
		for (let index = 0; index < 11; index += 1) store(`s${index}`);

		expect(readSession("s0")).toBeUndefined();
		expect(readSession("s1")).toBeDefined();
		expect(readSession("s10")).toBeDefined();
	});

	it("counts reading as use, so a revisited session outlives an untouched one", () => {
		for (let index = 0; index < 10; index += 1) store(`s${index}`);
		readSession("s0");
		store("s10");

		expect(readSession("s0")).toBeDefined();
		expect(readSession("s1")).toBeUndefined();
	});

	it("forgets a session that was deleted", () => {
		store("a");
		forgetSession("a");
		expect(readSession("a")).toBeUndefined();
	});
});
