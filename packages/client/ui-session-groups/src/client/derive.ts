/** Pure projection from runtime Sessions, native pins, and the Pinned-layout sidecar. */
import type {
  SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionGroupId, SessionGroupsSnapshot } from '@umialpha/dsh-session-group-registry/types'

/** Pending interaction kinds with dedicated Pinned-row presentation. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** Session row plus the Workspace context shown in the Pinned area. */
export interface GroupSessionNode extends Pick<
  SessionSummary,
  'id' | 'blank' | 'updatedAt'
> {
  /** Latest durable title, or empty when the Host has not projected one. */
  title: string
  /** Human-facing title, including the Session controller's fallback label. */
  displayTitle: string
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  runningSubagentCount: number
  completed: boolean
  workspace: string
}

/** One named group section in Host order. */
export interface SessionGroupSection {
  id: SessionGroupId
  title: string
  sessions: readonly GroupSessionNode[]
}

/** Complete visible projection of the Pinned root and named groups. */
export interface SessionGroupsProjection {
  /** Pinned Sessions without named-group membership, in manual root order. */
  defaultSessions: readonly GroupSessionNode[]
  groups: readonly SessionGroupSection[]
  /** Session retained by the main view, if any. */
  currentSessionId: SessionId | undefined
}

/** Directory basename used when a Session has no registered Workspace. */
function directoryLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base === undefined || base === '' ? cwd : base
}

/** Top-level Session visibility shared with the built-in Projects view. */
function visible(summary: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return summary.origin !== 'subagent'
    && !archived.has(summary.id)
    && (!summary.blank || summary.id === current)
}

/** Resolve the Session selected by the main navigation owner. */
function mainSessionId(list: SessionListState): SessionId | undefined {
  return Object.values(list.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
}

/** Keep navigation presentation independent from domain-owned interaction objects. */
function visiblePendingKind(kind: string | undefined): SessionPendingInteractionStatus | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

/** Count running direct children from the Controller's subagent projection. */
function runningChildCount(
  list: SessionListState,
  parentId: SessionId,
  statuses: SessionStatusSnapshot,
): number {
  return list.projectionsBySession[parentId]?.values.subagentCatalog?.reduce(
    (count, child) => count + ((statuses.get(child.id)?.running ?? list.byId[child.id]?.running) === true ? 1 : 0),
    0,
  ) ?? 0
}

/**
 * Derive the global Pinned area from the native pin authority and optional layout.
 * @param list - Global Session list projection.
 * @param statuses - Unified live UI status indexed by Session.
 * @param workspaces - Workspace accounts used to label Session rows.
 * @param archivedSessionIds - Sessions omitted from visible grouping rows.
 * @param pinnedSessionIds - Registry-global authority for visible membership.
 * @param snapshot - Authoritative root, named-group membership, and manual order.
 * @returns the complete visible Pinned-area projection.
 */
export function deriveSessionGroups(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[],
  snapshot: SessionGroupsSnapshot,
): SessionGroupsProjection {
  const archived = new Set(archivedSessionIds)
  const pinned = new Set(pinnedSessionIds)
  const current = mainSessionId(list)
  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) {
        workspaceBySession.set(sessionId, workspace.title)
      }
    }
  }
  const toNode = (summary: SessionSummary): GroupSessionNode => {
    const status = statuses.get(summary.id)
    const pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind)
    return {
      id: summary.id,
      title: summary.title ?? '',
      displayTitle: summary.displayTitle,
      blank: summary.blank,
      running: status?.running ?? summary.running,
      runningSubagentCount: runningChildCount(list, summary.id, statuses),
      completed: status?.completionUnread === true,
      updatedAt: summary.updatedAt,
      workspace: workspaceBySession.get(summary.id) ?? directoryLabel(summary.cwd),
      ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
    }
  }

  const toVisibleNodes = (sessionIds: readonly SessionId[]): GroupSessionNode[] => {
    const nodes: GroupSessionNode[] = []
    for (const sessionId of sessionIds) {
      if (!pinned.has(sessionId)) continue
      const summary = list.byId[sessionId]
      if (summary !== undefined && visible(summary, current, archived)) nodes.push(toNode(summary))
    }
    return nodes
  }

  const laidOut = new Set<SessionId>(snapshot.defaultSessionIds)
  for (const group of snapshot.groups) {
    for (const sessionId of group.sessionIds) laidOut.add(sessionId)
  }
  const effectiveDefault = [
    ...snapshot.defaultSessionIds,
    ...pinnedSessionIds.filter(sessionId => !laidOut.has(sessionId)),
  ]
  const groups = snapshot.groups.map((group): SessionGroupSection => {
    return { id: group.id, title: group.title, sessions: toVisibleNodes(group.sessionIds) }
  })
  return {
    defaultSessions: toVisibleNodes(effectiveDefault),
    groups,
    currentSessionId: current,
  }
}
