/** Slot and injected-face contracts for the optional global Pinned area. */
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionActivity } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@umialpha/dsh-client-ui-workspace-groups/client'
import type { SessionGroupId } from '@umialpha/dsh-session-group-registry/types'
import type {
  SessionGroupsActionResult, SessionGroupsController, SessionGroupsView,
} from './controller.ts'
import type { SessionGroupsNoticeInput } from './notice.tsx'

/** Browser callbacks and observable state contributed by apply. */
export type SessionGroupsInjected = {
  hooks: {
    /** Controller snapshot for loading, authoritative groups, and mutation failures. */
    sessionGroups: SessionGroupsController
  }
  ensure: () => Promise<SessionGroupsActionResult>
  refresh: () => Promise<SessionGroupsActionResult>
  createGroup: (title: string) => Promise<SessionGroupsActionResult>
  renameGroup: (groupId: SessionGroupId, title: string) => Promise<SessionGroupsActionResult>
  deleteGroup: (groupId: SessionGroupId) => Promise<SessionGroupsActionResult>
  insertGroupBefore: (
    groupId: SessionGroupId,
    beforeGroupId: SessionGroupId | null,
  ) => Promise<SessionGroupsActionResult>
  moveSession: (
    sessionId: SessionId,
    targetGroupId: SessionGroupId | null,
    beforeSessionId: SessionId | null,
  ) => Promise<SessionGroupsActionResult>
  open: (sessionId: SessionId) => void
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  forkSession: (sessionId: SessionId) => Promise<'forked' | 'migration-required'>
  archiveSession: (
    sessionId: SessionId,
    options?: { readonly stopActivity?: boolean },
  ) => Promise<SessionArchiveResult>
  unpinSession: (sessionId: SessionId) => Promise<void>
  notify: (notice: SessionGroupsNoticeInput) => void
}

/** Settled native archive result, including the one expected refusal. */
export type SessionArchiveResult =
  | { readonly kind: 'archived' }
  | { readonly kind: 'session-active'; readonly activity: readonly SessionActivity[] }

/** Component-side framework hook bound from the controller observable. */
export type SessionGroupsHooks = {
  useSessionGroups: SnapshotSelectorHook<SessionGroupsView>
}

/** Full root-scoped global Pinned-area props. */
export type SessionGroupsViewProps =
  PropsRuntime<'sidebar.workspaces.sessionGroups'>
  & Omit<SessionGroupsInjected, 'hooks'>
  & SessionGroupsHooks
  & PropsLocale<'sessionGroups'>

/** Session rename dialog target. */
export interface SessionRenameTarget {
  sessionId: SessionId
  currentTitle: string
}
