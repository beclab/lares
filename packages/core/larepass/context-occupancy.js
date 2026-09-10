const BREAKDOWN = [
  ["system", "systemTokens"],
  ["tools", "toolsTokens"],
  ["conversation", "messageTokens"],
];

export function compactTokens(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}K`;
  return String(Math.round(n));
}

export function occupancyFromPressure(pressure) {
  const used = Number(pressure?.projectedTokens ?? pressure?.pressureTokens);
  const total = Number(pressure?.contextWindow);
  if (!(used >= 0) || !(total > 0)) return null;
  return {
    percent: Math.min(100, Math.max(0, Math.round((used / total) * 100))),
    used: compactTokens(used),
    total: compactTokens(total),
  };
}

export function occupancyBreakdown(breakdown) {
  return BREAKDOWN.map(([key, field]) => ({
    key,
    compact: compactTokens(Number(breakdown?.[field]) || 0),
  }));
}
