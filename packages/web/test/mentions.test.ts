import { describe, expect, it } from "vitest";
import { applyMention, mentionAt } from "../src/lib/mentions";

describe("mentionAt", () => {
	it("finds a token at the start of the input", () => {
		expect(mentionAt("@src/ma", 7)).toEqual({ start: 0, end: 7, query: "src/ma", quoted: false });
	});

	it("finds a token after whitespace", () => {
		const token = mentionAt("look at @src/main.ts", 20);
		expect(token?.query).toBe("src/main.ts");
		expect(token?.start).toBe(8);
	});

	it("ignores an @ inside a word, so email addresses do not open the picker", () => {
		expect(mentionAt("mail me@example.com", 19)).toBeNull();
	});

	it("ends the token at whitespace", () => {
		expect(mentionAt("@src/main.ts and then", 21)).toBeNull();
	});

	it("keeps a quoted token open across spaces", () => {
		const token = mentionAt('@"my folder/some fi', 19);
		expect(token?.query).toBe("my folder/some fi");
		expect(token?.quoted).toBe(true);
	});

	it("closes a quoted token at the closing quote", () => {
		expect(mentionAt('@"my file.ts" now', 17)).toBeNull();
	});

	it("reopens on a token the caret moved back into, using only the text before it", () => {
		const token = mentionAt("@src/main.ts trailing text", 5);
		expect(token?.query).toBe("src/");
		expect(token?.end).toBe(5);
	});
});

describe("applyMention", () => {
	it("replaces the token and leaves a trailing space", () => {
		const token = mentionAt("look at @src/ma", 15);
		const result = applyMention("look at @src/ma", token as NonNullable<typeof token>, "src/main.ts", false);

		expect(result.text).toBe("look at @src/main.ts ");
		expect(result.caret).toBe(result.text.length);
	});

	it("preserves text after the caret", () => {
		const token = mentionAt("@src/ma please", 7);
		const result = applyMention("@src/ma please", token as NonNullable<typeof token>, "src/main.ts", false);
		expect(result.text).toBe("@src/main.ts  please");
	});

	it("quotes a path containing a space", () => {
		const token = mentionAt("@my", 3);
		const result = applyMention("@my", token as NonNullable<typeof token>, "my folder/a b.ts", false);
		expect(result.text).toBe('@"my folder/a b.ts" ');
	});

	it("leaves a directory open for drilling in", () => {
		const token = mentionAt("@sr", 3);
		const result = applyMention("@sr", token as NonNullable<typeof token>, "src", true);

		expect(result.text).toBe("@src/");
		expect(result.caret).toBe(5);
	});

	it("puts the caret inside the quotes of an open directory", () => {
		const token = mentionAt("@my", 3);
		const result = applyMention("@my", token as NonNullable<typeof token>, "my folder", true);

		expect(result.text).toBe('@"my folder/"');
		expect(result.text[result.caret]).toBe('"');
	});
});
