import type { AuthFlowEvent } from "@lares/shared";
import { api } from "./api";

export interface OAuthFlow {
	/** Answers the question the server is currently waiting on. */
	answer(promptId: string, value: string): Promise<void>;
	cancel(): Promise<void>;
}

/**
 * Runs a provider login over SSE.
 *
 * The stream is the login: it stays open until pi either finishes or fails, and
 * every device code, callback URL, and question arrives on it. `EventSource`
 * would reconnect on close and start a second login, so the stream is read
 * manually and closed for good once `done` or `error` arrives.
 */
export function startOAuth(provider: string, onEvent: (event: AuthFlowEvent) => void): OAuthFlow {
	const source = new EventSource(`/api/auth/oauth/${encodeURIComponent(provider)}`);
	let loginId = "";
	let finished = false;

	const close = () => {
		finished = true;
		source.close();
	};

	source.addEventListener("login-id", (event) => {
		loginId = (JSON.parse((event as MessageEvent<string>).data) as { message: string }).message;
	});

	source.onmessage = (event: MessageEvent<string>) => {
		const parsed = JSON.parse(event.data) as AuthFlowEvent;
		onEvent(parsed);
		if (parsed.type === "done" || parsed.type === "error") close();
	};

	source.onerror = () => {
		if (finished) return;
		onEvent({ type: "error", message: "The login stream was interrupted" });
		close();
	};

	return {
		answer: async (promptId, value) => {
			if (loginId) await api.answerOAuth(provider, loginId, promptId, value);
		},
		cancel: async () => {
			if (loginId && !finished) await api.cancelOAuth(provider, loginId);
			close();
		},
	};
}
