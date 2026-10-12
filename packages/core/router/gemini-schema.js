/**
 * Gemini's OpenAI-compat endpoint copies each tool's `parameters` onto the
 * Generative Language Schema proto. That proto has no `additionalProperties`,
 * `oneOf`, `const`, or OpenAI `strict`, so a normal tool list 400s before the
 * model speaks. Full JSON Schema stays intact for every other model on the
 * same route.
 *
 * Allowed fields are the Schema message:
 * https://ai.google.dev/api/caching#Schema
 */

const SCHEMA_FIELDS = new Set([
  "anyOf",
  "default",
  "description",
  "enum",
  "example",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "nullable",
  "pattern",
  "properties",
  "propertyOrdering",
  "required",
  "title",
  "type",
]);

/** @param {unknown} model */
export function isGeminiModel(model) {
  return String(model ?? "")
    .split(/[/@]/)
    .some((part) => part.toLowerCase().startsWith("gemini"));
}

/**
 * @param {unknown} schema
 * @returns {unknown}
 */
export function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map((item) => geminiSchema(item));
  if (schema == null || typeof schema !== "object") return schema;

  const source = { ...schema };
  if (source.const !== undefined && source.enum === undefined) {
    source.enum = [source.const];
  }
  if (source.oneOf !== undefined && source.anyOf === undefined) {
    source.anyOf = source.oneOf;
  }
  if (Array.isArray(source.type)) {
    const types = source.type.filter((item) => item !== "null");
    if (source.type.includes("null")) source.nullable = true;
    if (types.length === 1) source.type = types[0];
    else if (types.length > 1 && source.anyOf === undefined) {
      source.anyOf = types.map((type) => ({ type }));
      delete source.type;
    } else {
      delete source.type;
    }
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SCHEMA_FIELDS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      /** @type {Record<string, unknown>} */
      const properties = {};
      for (const [name, property] of Object.entries(value)) properties[name] = geminiSchema(property);
      out.properties = properties;
      continue;
    }
    if (key === "items") {
      out.items = geminiSchema(value);
      continue;
    }
    if (key === "anyOf" && Array.isArray(value)) {
      out.anyOf = value.map((item) => geminiSchema(item));
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {unknown} payload
 * @returns {unknown}
 */
export function adaptGeminiChatBody(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (!isGeminiModel(payload.model) || !Array.isArray(payload.tools)) return payload;
  return {
    ...payload,
    tools: payload.tools.map((tool) => {
      if (!tool || tool.type !== "function" || !tool.function || typeof tool.function !== "object") return tool;
      const fn = { ...tool.function };
      delete fn.strict;
      if (fn.parameters && typeof fn.parameters === "object") fn.parameters = geminiSchema(fn.parameters);
      return { ...tool, function: fn };
    }),
  };
}

/** @param {Buffer} body @returns {Buffer} */
export function adaptGeminiChatBuffer(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  const next = adaptGeminiChatBody(payload);
  if (next === payload) return body;
  return Buffer.from(JSON.stringify(next));
}
