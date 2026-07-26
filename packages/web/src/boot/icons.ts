import { defineBoot } from "#q-app";

/** Bare Material ligature names, the form every call site in this app uses. */
const BARE_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Route bare icon names to Material Symbols.
 *
 * QIcon derives an icon's CSS class from its name, not from `framework.iconSet`:
 * anything without a known prefix becomes `material-icons`, a font this app does
 * not bundle, and the icon renders as its literal ligature name. Prefixing with
 * `sym_o_` selects the `material-symbols-outlined` class that matches the font
 * in `extras`, and keeps call sites writing plain `icon="menu"`.
 */
export default defineBoot(({ app }) => {
	app.config.globalProperties.$q.iconMapFn = (name: string) =>
		BARE_NAME.test(name) ? { icon: `sym_o_${name}` } : undefined;
});
