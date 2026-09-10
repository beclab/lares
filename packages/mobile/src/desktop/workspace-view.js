import {
  FLAT_SESSION_ORDER_KEY,
  nextSessionOrderAccount,
} from "@olares/lares-core/larepass/workspace";

const STORAGE_KEY = "lares.larepass.workspace.view.v1";

const initialView = () => ({
  groupBy: "workspace",
  orderBy: "updated",
  groupExpansion: {},
  sessionOrderByAccount: {},
  sessionUpdatedAtByAccount: {},
});

export function loadWorkspaceView(storage = globalThis.localStorage) {
  if (!storage) return initialView();
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    return {
      groupBy: saved.groupBy === "flat" ? "flat" : "workspace",
      orderBy: saved.orderBy === "manual" ? "manual" : "updated",
      groupExpansion: saved.groupExpansion && typeof saved.groupExpansion === "object"
        ? saved.groupExpansion
        : {},
      sessionOrderByAccount: saved.sessionOrderByAccount && typeof saved.sessionOrderByAccount === "object"
        ? saved.sessionOrderByAccount
        : {},
      sessionUpdatedAtByAccount: saved.sessionUpdatedAtByAccount && typeof saved.sessionUpdatedAtByAccount === "object"
        ? saved.sessionUpdatedAtByAccount
        : {},
    };
  } catch {
    return initialView();
  }
}

export function saveWorkspaceView(view, storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Browser storage can be unavailable in private or embedded contexts.
  }
}

function accountSessionIds(sessions, workspaces) {
  const known = new Set(sessions.map((row) => row.sessionId));
  const accounted = new Set();
  const accounts = workspaces.map((workspace) => {
    const ids = (workspace.sessionIds ?? []).filter((id) => known.has(id));
    ids.forEach((id) => accounted.add(id));
    return [workspace.workspaceId, ids];
  });
  accounts.push(["", sessions.map((row) => row.sessionId).filter((id) => !accounted.has(id))]);
  accounts.push([FLAT_SESSION_ORDER_KEY, sessions.map((row) => row.sessionId)]);
  return accounts;
}

function promote(order, sessionId) {
  return [sessionId, ...order.filter((id) => id !== sessionId)];
}

export function syncWorkspaceViewOrders(view, {
  sessions = [],
  workspaces = [],
  currentSessionId = "",
  sortByRecency = false,
} = {}) {
  const nextOrder = {};
  const nextUpdatedAt = {};
  for (const [key, sessionIds] of accountSessionIds(sessions, workspaces)) {
    const next = nextSessionOrderAccount({
      sessionIds,
      previousOrder: view.sessionOrderByAccount[key],
      previousUpdatedAt: view.sessionUpdatedAtByAccount[key],
      sessions,
      orderBy: view.orderBy,
      sortByRecency: view.orderBy === "updated"
        && (sortByRecency || view.sessionOrderByAccount[key] === undefined),
    });
    nextOrder[key] = next.order;
    nextUpdatedAt[key] = next.updatedAt;
  }

  const current = sessions.find((row) => row.sessionId === currentSessionId);
  if (current?.blank) {
    const account = workspaces.find((workspace) => (
      workspace.sessionIds?.includes(currentSessionId)
    ))?.workspaceId ?? "";
    nextOrder[account] = promote(nextOrder[account] ?? [], currentSessionId);
    nextOrder[FLAT_SESSION_ORDER_KEY] = promote(
      nextOrder[FLAT_SESSION_ORDER_KEY] ?? [],
      currentSessionId,
    );
  }

  return {
    ...view,
    sessionOrderByAccount: nextOrder,
    sessionUpdatedAtByAccount: nextUpdatedAt,
  };
}

/**
 * Reordering is expressed as "insert before X", while a pointer lands on an edge
 * of a row. Translate the hovered row plus edge into that anchor; "" is the end
 * of the list, which every insert-before call reads as an append.
 */
export function dropAnchor(ids, hint) {
  const at = ids.indexOf(hint?.key);
  if (at === -1) return "";
  return hint.edge === "after" ? ids[at + 1] ?? "" : hint.key;
}

export function insertSessionBefore(order, sessionId, beforeSessionId) {
  const next = order.filter((id) => id !== sessionId);
  const index = beforeSessionId ? next.indexOf(beforeSessionId) : -1;
  next.splice(index === -1 ? next.length : index, 0, sessionId);
  return next;
}
