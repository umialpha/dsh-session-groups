import type {
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  WorkspaceId,
  WorkspaceSnapshot,
  WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SessionGroup,
  SessionGroupId,
  SessionGroupsRevision,
  SessionGroupsSnapshot,
} from '@umialpha/dsh-session-group-registry/types'
import type { SessionGroupsView } from '../src/client/controller.ts'

export const sid = (value: string): SessionId => value as SessionId
export const gid = (value: string): SessionGroupId => value as SessionGroupId
export const revision = (value: string): SessionGroupsRevision => value as SessionGroupsRevision
const wid = (value: string): WorkspaceId => value as WorkspaceId

export function group(
  id: string,
  title: string,
  sessionIds: readonly string[] = [],
): SessionGroup {
  return { id: gid(id), title, sessionIds: sessionIds.map(sid) }
}

export function snapshot(
  groups: readonly SessionGroup[] = [],
  value = 'revision-1',
  defaultSessionIds: readonly string[] = [],
): SessionGroupsSnapshot {
  return { revision: revision(value), defaultSessionIds: defaultSessionIds.map(sid), groups }
}

export function summary(
  id: string,
  updatedAt: number,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id: sid(id),
    title: overrides.displayTitle ?? id,
    displayTitle: id,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt,
    ...overrides,
  }
}

export function sessionState(
  items: readonly SessionSummary[],
  overrides: Partial<SessionListState> = {},
): SessionListState {
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    phase: 'ready',
    projectionsBySession: {},
    ...overrides,
  }
}

export function workspace(
  id: string,
  sessionIds: readonly string[],
  title = id,
  path = `/projects/${id}`,
): WorkspaceView {
  return {
    workspaceId: wid(id),
    path,
    title,
    sessionIds: sessionIds.map(sid),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

export function workspaceState(
  items: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[] = [],
  pinnedSessionIds: readonly SessionId[] = [],
): WorkspaceSnapshot {
  return {
    items,
    archivedSessionIds,
    pinnedSessionIds,
    state: 'idle',
    phase: 'ready',
    error: null,
  }
}

export function controllerView(overrides: Partial<SessionGroupsView> = {}): SessionGroupsView {
  return {
    status: 'ready',
    snapshot: snapshot(),
    pending: false,
    error: null,
    ...overrides,
  }
}

export function hook<T>(value: T) {
  return function select<S>(selector: (state: T) => S): S {
    return selector(value)
  }
}
