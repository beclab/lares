import { SessionManager } from "@earendil-works/pi-coding-agent";

const PLACEHOLDER = "{{SESSION_DATA}}";

/**
 * Repairs an HTML export whose transcript never made it into the page.
 *
 * pi's exporter base64-encodes the session and substitutes it into
 * `template.html`. In pi-coding-agent 0.82.1 the compiled exporter looks for
 * `{{n}}` while the shipped template still says `{{SESSION_DATA}}`, so the
 * placeholder survives and the viewer opens empty. Filling it in here keeps
 * exports usable, and the check is a no-op once the upstream build is fixed.
 */
export function repairHtmlExport(html: string, sessionFile: string): string {
	if (!html.includes(PLACEHOLDER)) return html;

	const manager = SessionManager.open(sessionFile);
	const payload = {
		header: manager.getHeader(),
		entries: manager.getEntries(),
		leafId: manager.getLeafId(),
	};

	return html.replace(PLACEHOLDER, Buffer.from(JSON.stringify(payload)).toString("base64"));
}
