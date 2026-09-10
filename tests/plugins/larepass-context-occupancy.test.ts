import assert from "node:assert/strict";
import test from "node:test";
import {
  compactTokens,
  occupancyBreakdown,
  occupancyFromPressure,
} from "@olares/lares-core/larepass/context-occupancy";

test("occupancy is absent until both used tokens and a window exist", () => {
  assert.equal(occupancyFromPressure(null), null);
  assert.equal(occupancyFromPressure({ projectedTokens: 12 }), null);
  assert.equal(occupancyFromPressure({ contextWindow: 1000 }), null);
  assert.equal(occupancyFromPressure({ projectedTokens: -1, contextWindow: 1000 }), null);
  assert.deepEqual(occupancyFromPressure({ projectedTokens: 0, contextWindow: 1000 }), {
    percent: 0,
    used: "0",
    total: "1K",
  });
});

test("occupancy prefers the projected count and clamps the ring to 0–100", () => {
  assert.equal(
    occupancyFromPressure({ projectedTokens: 250, pressureTokens: 10, contextWindow: 1000 }).percent,
    25,
  );
  assert.equal(occupancyFromPressure({ projectedTokens: 0, contextWindow: 1 }).percent, 0);
  assert.equal(occupancyFromPressure({ projectedTokens: 9, contextWindow: 1 }).percent, 100);
});

test("token compacting matches the composer meter labels", () => {
  assert.equal(compactTokens(12), "12");
  assert.equal(compactTokens(1500), "1.5K");
  assert.equal(compactTokens(2_300_000), "2.3M");
});

test("breakdown rows stay in the meter order even when a field is missing", () => {
  assert.deepEqual(occupancyBreakdown(null), [
    { key: "system", compact: "0" },
    { key: "tools", compact: "0" },
    { key: "conversation", compact: "0" },
  ]);
  assert.deepEqual(
    occupancyBreakdown({ systemTokens: 1200, toolsTokens: 80, messageTokens: 3400 }),
    [
      { key: "system", compact: "1.2K" },
      { key: "tools", compact: "80" },
      { key: "conversation", compact: "3.4K" },
    ],
  );
});
