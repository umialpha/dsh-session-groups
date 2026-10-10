/** Optional global Pinned Session groups area, browser half. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionForkError } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, SessionActivity, WorkspaceArchiveError,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@umialpha/dsh-session-group-registry/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { UiWorkspace } from '@umialpha/dsh-client-ui-workspace-groups/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionGroupsController } from './controller.ts'
import { SessionGroupsView } from './SessionGroupsView.tsx'
import {
  SessionGroupsNoticeController,
  SessionGroupsToast,
  type SessionGroupsNoticeInjected,
} from './notice.tsx'
import type { SessionGroupsInjected } from './slots.ts'
import { en, zh, type SessionGroupsKey } from './locales.ts'

export type { SessionGroupsInjected, SessionGroupsViewProps } from './slots.ts'
export type { SessionGroupsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Pinned Session group view copy. */
    sessionGroups: SessionGroupsKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** One Session retained while a Pinned-area action addresses it. */
    sessionGroupsOperation: unknown
  }
}

const NS = 'sessionGroups'

/** Services used by the Pinned area and its Host actions. */
export const inject = [
  'slots', 'remote', 'remote.sessionGroups', 'sessions', 'workspaces', 'uiWorkspace', 'locale',
]

/** Register the optional Pinned area, root-scoped controller, and Toast host. */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspace
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-groups: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new SessionGroupsController(ctx.remote.sessionGroups)
  const notices = new SessionGroupsNoticeController()
  const openSession = (sessionId: SessionId): void => {
    if (workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
      notices.show({ text: t('error.openArchived'), tone: 'warning' })
      return
    }
    uiWorkspace.openSession(sessionId)
  }
  ctx.effect(() => () => {
    notices.dispose()
    controller.dispose()
  }, 'ui-session-groups: controllers')
  ctx.on('connection/reset', () => {
    if (controller.getSnapshot().status !== 'cold') void controller.refresh()
  })

  const injected: SessionGroupsInjected = {
    hooks: { sessionGroups: controller },
    ensure: () => controller.ensure(),
    refresh: () => controller.refresh(),
    createGroup: title => controller.create(title),
    renameGroup: (groupId, title) => controller.rename(groupId, title),
    deleteGroup: groupId => controller.delete(groupId),
    insertGroupBefore: (groupId, beforeGroupId) => controller.insertGroupBefore(groupId, beforeGroupId),
    moveSession: (sessionId, targetGroupId, beforeSessionId) =>
      controller.moveSession(sessionId, targetGroupId, beforeSessionId),
    open: openSession,
    renameSession: async (sessionId, title) => {
      const result = await sessions.using(
        sessionId,
        { source: 'sessionGroupsOperation' },
        reference => reference.binding.session.rename(title),
      )
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: async (sessionId) => {
      try {
        await uiWorkspace.forkSession(sessionId, undefined, { allowMigration: false })
        return 'forked'
      } catch (error) {
        if (error instanceof Error && error.name === 'SessionForkError'
          && (error as SessionForkError).rpcError.code === 'session/migration-required') {
          notices.show({
            text: t('error.forkMigrationRequired'),
            tone: 'warning',
            holdMs: 6000,
            action: { label: t('session.openSource'), onClick: () => { openSession(sessionId) } },
          })
          return 'migration-required'
        }
        throw error
      }
    },
    archiveSession: async (sessionId, options) => {
      try {
        if (options === undefined) await uiWorkspace.archiveSession(sessionId)
        else await uiWorkspace.archiveSession(sessionId, options)
        return { kind: 'archived' }
      } catch (error) {
        const activity = activeSessionRefusal(error)
        if (activity !== undefined) return { kind: 'session-active', activity }
        throw error
      }
    },
    unpinSession: async (sessionId) => { await uiWorkspace.unpinSession(sessionId) },
    notify: (notice) => { notices.show(notice) },
  }

  const noticeInjected: SessionGroupsNoticeInjected = {
    hooks: { sessionGroupsNotice: notices },
    notify: (notice) => { notices.show(notice) },
    dismissNotice: (sequence) => { notices.dismiss(sequence) },
  }

  ctx.slots.inject('sidebar.workspaces.sessionGroups', () => ctx.slots.register({
    name: 'sidebar.workspaces.sessionGroups',
    locale: NS,
    inject: () => injected,
  }, SessionGroupsView))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'session-groups-toast', inject: () => noticeInjected,
  }, SessionGroupsToast))
}

/** Extract the expected active-work refusal without relying on bundle class identity. */
function activeSessionRefusal(
  reason: unknown,
): readonly SessionActivity[] | undefined {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined
  const { rpcError } = reason as WorkspaceArchiveError
  return rpcError.code === 'workspace/session-active' ? rpcError.details.activity : undefined
}
