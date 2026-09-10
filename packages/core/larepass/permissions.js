/**
 * The session's permission preset: which sandbox and approval policy its tools
 * run under.
 *
 * The host publishes the effective preset and the offered options as the
 * `permissions` session projection, and switching is the `/permission <name>`
 * command — there is no dedicated RPC. Preset names arrive as the kebab keys
 * the deployment declares (`workspace-write`), never as display copy, because
 * the wire carries no locale; the dictionary below the `permission.` prefix
 * owns the words and this module falls back to title case for a preset the
 * client has never heard of.
 */

/**
 * @param {unknown} row - a session summary or a raw `projections` block owner.
 * @returns {{ options: Array<{ value: string, name?: string, description?: string }>, currentValue: string } | null}
 */
export function permissionSelect(row) {
  const select = row?.permissions ?? row?.projections?.values?.permissions;
  const options = (Array.isArray(select?.options) ? select.options : []).filter((option) => option?.value);
  if (options.length === 0) return null;
  return { options, currentValue: String(select?.currentValue || "") };
}

export function permissionOption(select, value = select?.currentValue) {
  return select?.options.find((option) => option.value === value) ?? null;
}

function titleCase(name) {
  return String(name)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function presetLabel(t, option) {
  const value = option?.value || "";
  if (!value) return "";
  const key = `permission.${value}`;
  const text = t(key);
  return text === key ? titleCase(option.name || value) : text;
}

export function presetDescription(t, option) {
  const value = option?.value || "";
  if (!value) return "";
  const key = `permission.${value}.hint`;
  const text = t(key);
  return text === key ? String(option.description || "") : text;
}

/** The line the host parses as a preset switch. */
export function permissionLine(value) {
  return `/permission ${value}`;
}
