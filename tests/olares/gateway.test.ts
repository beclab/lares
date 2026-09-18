import assert from "node:assert/strict";
import test from "node:test";
import {
  routerAuthHeaders,
  routerEndUser,
  routerHeaders,
} from "@olares/lares-core/router/gateway";
import { rememberRequestIdentity } from "@olares/lares-core/olares/session-identity";

test("routerAuthHeaders stamps the logged-in user, not only the app id", () => {
  const headers = routerAuthHeaders(null, "lares", "demo1002@olares.com");
  assert.equal(headers["x-caller-appid"], "lares");
  assert.equal(headers["x-bfl-user"], "demo1002");
  assert.equal(headers["remote-user"], "demo1002");
});

test("routerEndUser prefers the request user over the chart install user", () => {
  const user = routerEndUser(
    { OLARES_USERNAME: "demo1001" },
    { "x-bfl-user": "demo1002@olares.com" },
  );
  assert.equal(user, "demo1002");
});

test("routerEndUser falls back to the chart install user", () => {
  assert.equal(routerEndUser({ OLARES_USERNAME: "demo1002" }, {}), "demo1002");
});

test("routerHeaders uses session identity when no request user is present", () => {
  const previousUser = process.env.OLARES_USERNAME;
  delete process.env.OLARES_USERNAME;
  rememberRequestIdentity({
    user: "demo1002@olares.com",
    token: "",
    terminus: "",
  });
  try {
    const headers = routerHeaders({ OLARES_APP_ID: "lares" });
    assert.equal(headers["x-bfl-user"], "demo1002");
  } finally {
    rememberRequestIdentity({ user: "", token: "", terminus: "" });
    if (previousUser === undefined) delete process.env.OLARES_USERNAME;
    else process.env.OLARES_USERNAME = previousUser;
  }
});
