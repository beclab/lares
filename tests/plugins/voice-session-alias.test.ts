import assert from "node:assert/strict";
import test from "node:test";
import { bindRouterSession } from "@olares/lares-core/router/session-alias";
import { shimRequestHeaders } from "@olares/lares-core/router/shim";

test("the shim forwards a Realtime session id for a bound dsh session and leaves others alone", () => {
  const unbind = bindRouterSession("dsh-1", "rtc_9");
  try {
    assert.equal(shimRequestHeaders({ "x-session-id": "dsh-1" }, {})["x-session-id"], "rtc_9");
    assert.equal(shimRequestHeaders({ "x-session-id": "dsh-2" }, {})["x-session-id"], "dsh-2");
  } finally { unbind(); }
  assert.equal(shimRequestHeaders({ "x-session-id": "dsh-1" }, {})["x-session-id"], "dsh-1");
});
