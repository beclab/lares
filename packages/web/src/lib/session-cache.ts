import type { AgentMessage } from "@lares/shared";

export interface CachedSession {
	cwd: string;
	messages: AgentMessage[];
}

/**
 * Transcripts of recently viewed sessions, so switching back paints before the
 * network answers.
 *
 * Kept in memory rather than in storage: a transcript can run to megabytes of
 * tool output and base64 images, which is both too big for a storage quota and
 * not worth persisting past a reload, when the server is authoritative anyway.
 */
const LIMIT = 10;

const cache = new Map<string, CachedSession>();

export function readSession(id: string): CachedSession | undefined {
	const entry = cache.get(id);
	if (!entry) return undefined;
	// Re-insert so the least recently opened session is the one evicted.
	cache.delete(id);
	cache.set(id, entry);
	return entry;
}

export function writeSession(id: string, entry: CachedSession): void {
	cache.delete(id);
	cache.set(id, entry);
	for (const oldest of cache.keys()) {
		if (cache.size <= LIMIT) break;
		cache.delete(oldest);
	}
}

export function forgetSession(id: string): void {
	cache.delete(id);
}

export function clearSessionCache(): void {
	cache.clear();
}
