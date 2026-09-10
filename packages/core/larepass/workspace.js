import { visibleHistorySessions } from "./chat.js";

export const UNGROUPED_WORKSPACE = "";

/** Rows a workspace group shows before the "show more" cut (Lares app parity). */
export const COLLAPSED_SESSION_LIMIT = 5;

export function collapsedSessions(sessions, expanded) {
  const rows = Array.isArray(sessions) ? sessions : [];
  return expanded ? rows : rows.slice(0, COLLAPSED_SESSION_LIMIT);
}

export function hiddenSessionCount(sessions) {
  return Math.max(0, (Array.isArray(sessions) ? sessions.length : 0) - COLLAPSED_SESSION_LIMIT);
}

export const FLAT_SESSION_ORDER_KEY = "__flat_session_order__";

export function reconciledSessionOrder(sessionIds, stored) {
  if (!Array.isArray(stored)) return [...sessionIds];
  const available = new Set(sessionIds);
  const included = new Set();
  const ordered = [];
  for (const id of stored) {
    if (!available.has(id) || included.has(id)) continue;
    ordered.push(id);
    included.add(id);
  }
  for (const id of sessionIds) {
    if (!included.has(id)) ordered.push(id);
  }
  return ordered;
}

function compareSessionRecency(leftId, rightId, byId) {
  const left = Number(byId.get(leftId)?.updatedAt) || 0;
  const right = Number(byId.get(rightId)?.updatedAt) || 0;
  if (left !== right) return right - left;
  return leftId < rightId ? -1 : 1;
}

function sessionIdsByRecency(rows) {
  const byId = new Map(rows.map((row) => [row.sessionId, row]));
  return rows
    .map((row) => row.sessionId)
    .sort((left, right) => compareSessionRecency(left, right, byId));
}

export function nextSessionOrderAccount({
  sessionIds,
  previousOrder,
  previousUpdatedAt = {},
  sessions,
  orderBy,
  sortByRecency = false,
}) {
  const byId = new Map((Array.isArray(sessions) ? sessions : []).map((row) => [row.sessionId, row]));
  let order = reconciledSessionOrder(sessionIds, previousOrder);
  if (sortByRecency) {
    order.sort((left, right) => compareSessionRecency(left, right, byId));
  } else if (orderBy === "updated") {
    const promoted = sessionIds
      .filter((id) => {
        const row = byId.get(id);
        return row && (previousUpdatedAt[id] === undefined || Number(row.updatedAt) > previousUpdatedAt[id]);
      })
      .sort((left, right) => compareSessionRecency(left, right, byId));
    if (promoted.length) {
      const ids = new Set(promoted);
      order = [...promoted, ...order.filter((id) => !ids.has(id))];
    }
  }
  return {
    order,
    updatedAt: Object.fromEntries(sessionIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [[id, Number(row.updatedAt) || 0]] : [];
    })),
  };
}

export function workspaceForSession(workspaces, sessionId) {
  if (!sessionId) return undefined;
  return (Array.isArray(workspaces) ? workspaces : []).find(
    (workspace) => Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId),
  );
}

export function normalizeWorkspaceList(value) {
  return {
    items: Array.isArray(value?.items) ? value.items.filter((row) => row?.workspaceId) : [],
    archivedSessionIds: Array.isArray(value?.archivedSessionIds) ? value.archivedSessionIds : [],
  };
}

export function groupWorkspaceSessions(
  sessions,
  workspaces,
  archivedSessionIds = [],
  { query = "", flat = false, currentSessionId = "", sessionOrderByAccount = {} } = {},
) {
  const archived = new Set(archivedSessionIds);
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  // Same visibility cut as the Lares app: archived rows never show, and a blank
  // session is only ever the selected provisional one.
  const visible = visibleHistorySessions(sessions, currentSessionId).filter((row) => {
    if (archived.has(row.sessionId)) return false;
    if (!normalizedQuery) return true;
    return String(row.title || "").toLocaleLowerCase().includes(normalizedQuery);
  });
  const byId = new Map(visible.map((row) => [row.sessionId, row]));

  if (flat) {
    const baseIds = sessionIdsByRecency(visible);
    const ids = reconciledSessionOrder(
      baseIds,
      sessionOrderByAccount[FLAT_SESSION_ORDER_KEY],
    );
    return [{
      key: "__all__",
      workspaceId: undefined,
      title: "",
      sessions: ids.map((id) => byId.get(id)).filter(Boolean),
    }];
  }

  const accounted = new Set();
  const groups = (Array.isArray(workspaces) ? workspaces : []).map((workspace) => {
    const rows = [];
    const ids = reconciledSessionOrder(
      workspace.sessionIds ?? [],
      sessionOrderByAccount[workspace.workspaceId],
    );
    for (const sessionId of ids) {
      accounted.add(sessionId);
      const row = byId.get(sessionId);
      if (row) rows.push(row);
    }
    return {
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      path: workspace.path,
      sessions: rows,
    };
  });
  const ungroupedRows = visible.filter((row) => !accounted.has(row.sessionId));
  const ungrouped = reconciledSessionOrder(
    sessionIdsByRecency(ungroupedRows),
    sessionOrderByAccount[UNGROUPED_WORKSPACE],
  ).map((id) => byId.get(id)).filter(Boolean);
  if (ungrouped.length) {
    groups.push({
      key: UNGROUPED_WORKSPACE,
      workspaceId: undefined,
      title: "",
      sessions: ungrouped,
    });
  }
  return groups.filter((group) => !normalizedQuery || group.sessions.length > 0);
}
