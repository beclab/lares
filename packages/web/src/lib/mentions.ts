export interface MentionToken {
	/** Index of the `@` itself. */
	start: number;
	/** Index just past the token, which is where the caret sits. */
	end: number;
	/** The text between the `@` and the caret, unquoted. */
	query: string;
	quoted: boolean;
}

/**
 * Finds the `@path` token the caret is inside, if any.
 *
 * A mention only starts at the beginning of a line or after whitespace, so an
 * email address in prose never opens the picker. Quoting with `@"..."` is what
 * makes paths containing spaces expressible.
 */
export function mentionAt(text: string, caret: number): MentionToken | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf("@");
	if (at === -1) return null;

	const preceding = at === 0 ? "" : (before[at - 1] as string);
	if (preceding !== "" && !/\s/.test(preceding)) return null;

	const rest = before.slice(at + 1);
	if (rest.startsWith('"')) {
		const body = rest.slice(1);
		// A closing quote ends the token, so the caret is no longer inside it.
		if (body.includes('"')) return null;
		return { start: at, end: caret, query: body, quoted: true };
	}

	if (/\s/.test(rest)) return null;
	return { start: at, end: caret, query: rest, quoted: false };
}

/**
 * Replaces the token with the chosen path. Directories keep the token open so
 * the next keystroke drills into them instead of starting over.
 */
export function applyMention(
	text: string,
	token: MentionToken,
	path: string,
	isDir: boolean,
): { text: string; caret: number } {
	const needsQuotes = /\s/.test(path);
	const body = isDir ? `${path}/` : path;
	const inserted = needsQuotes ? `@"${body}"` : `@${body}`;
	const trailing = isDir ? "" : " ";

	const head = text.slice(0, token.start);
	const tail = text.slice(token.end);
	// The caret goes before the closing quote of an open directory so typing
	// continues the path rather than landing after it.
	const caret = head.length + inserted.length - (isDir && needsQuotes ? 1 : 0) + trailing.length;

	return { text: `${head}${inserted}${trailing}${tail}`, caret };
}
