import assert from "node:assert/strict";
import test from "node:test";
import { presentApproval } from "@olares/lares-core/larepass/approval";
import { classifyMuxEnvelope, classifyRemoteEvent } from "@olares/lares-core/larepass/mux";

const command = "touch /data/home/.local/share/olares-cli/master.key && chmod 600 /data/home/.local/share/olares-cli/master.key";

test("an approval card shows the localized reason and the tool command", () => {
  const card = presentApproval({
    toolName: "bash",
    callId: "call-1",
    reason: "audit",
    displayReason: {
      en: "Allow this action with danger-full-access",
      zh: "允许此次操作使用 danger-full-access 权限：创建 Olares 认证所需的密钥文件以完成应用程序安装",
    },
  }, [
    { type: "tool", callId: "call-1", argsRaw: JSON.stringify({ command }) },
  ], "zh-CN");

  assert.equal(card.reason, "允许此次操作使用 danger-full-access 权限：创建 Olares 认证所需的密钥文件以完成应用程序安装");
  assert.equal(card.command, command);
  assert.equal(presentApproval({ toolName: "bash", reason: "rm" }, [], "en").command, "");
  assert.equal(presentApproval(null, [], "zh"), null);
});

test("approval requests keep the localized display copy beside the audit reason", () => {
  const displayReason = { en: "Allow once", zh: "允许此次操作" };
  assert.deepEqual(
    classifyRemoteEvent({
      type: "waterfall",
      event: "approval/request",
      eventId: "e3",
      agentId: "s1",
      request: { toolName: "bash", callId: "call2", reason: "rm", displayReason },
    }),
    {
      kind: "approval",
      eventId: "e3",
      sessionId: "s1",
      toolName: "bash",
      callId: "call2",
      reason: "rm",
      displayReason,
    },
  );
  assert.equal(classifyMuxEnvelope({
    type: "server-request",
    rpcId: "a1",
    payload: { type: "approval/requested", sessionId: "s1", approvalId: "ap1", toolName: "bash", reason: "run ls" },
  }).displayReason, undefined);
});
