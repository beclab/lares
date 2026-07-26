import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * A cached view of every session on disk.
 *
 * `SessionManager.listAll()` parses every line of every transcript, so its cost
 * grows with everything the agent has ever written. Resolving an id to a path
 * went through it on every session detail, tree, rename, delete, fork, and
 * event-stream request, which turned a lookup into a full scan of the corpus.
 */
const TTL_MS = 30_000;

interface Snapshot {
	at: number;
	sessions: SessionInfo[];
}

let snapshot: Snapshot | undefined;
let inFlight: Promise<SessionInfo[]> | undefined;
/** Distinguishes a scan started before an invalidation from one started after. */
let generation = 0;

function isFresh(candidate: Snapshot | undefined): candidate is Snapshot {
	return candidate !== undefined && Date.now() - candidate.at < TTL_MS;
}

async function scan(): Promise<SessionInfo[]> {
	const startedAt = generation;
	const sessions = await SessionManager.listAll();
	// An invalidation while the scan was running means these results already
	// describe a past state, so they must not be cached as the present one.
	if (startedAt === generation) snapshot = { at: Date.now(), sessions };
	return sessions;
}

export async function listSessions(): Promise<SessionInfo[]> {
	if (isFresh(snapshot)) return snapshot.sessions;
	// Concurrent callers share one scan rather than each starting their own.
	if (!inFlight) {
		inFlight = scan().finally(() => {
			inFlight = undefined;
		});
	}
	return inFlight;
}

/**
 * A miss is rescanned once, because a session written outside this process, or
 * one whose file pi only just created, would otherwise 404 until the entry
 * expired.
 */
export async function findSession(id: string): Promise<SessionInfo | undefined> {
	// A miss on a scan that just ran is a genuine miss; only a remembered one is
	// worth doubting.
	const answeredFromCache = isFresh(snapshot);
	const hit = (await listSessions()).find((session) => session.id === id);
	if (hit || !answeredFromCache) return hit;

	invalidateSessions();
	return (await listSessions()).find((session) => session.id === id);
}

export function invalidateSessions(): void {
	generation += 1;
	snapshot = undefined;
}
