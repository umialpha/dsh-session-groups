/** Browser registration for the global Pinned Session area. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@umialpha/dsh-client-ui-workspace-groups/client'
import type {} from '@umialpha/dsh-session-group-registry/remote'
import { PinnedSlice, type PinnedSliceProps } from './PinnedSlice.tsx'
import { en, zh, type SessionGroupsKey } from './locales.ts'

export type { PinnedSliceProps, SessionGroupsKey }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Pinned Session group view copy. */
    sessionGroups: SessionGroupsKey
  }
}

const NS = 'sessionGroups'

/** Services required by the Pinned vertical slice. */
export const inject = ['slots', 'remote.sessionGroups', 'locale']

/** Register one Host-backed Pinned header into the replacement Workspace slot. */
export async function apply(ctx: Context): Promise<void> {
  const result = await ctx.remote.sessionGroups.snapshot({})
  if (!result.ok) {
    throw new Error(`ui-session-groups: failed to load the Pinned layout (${result.error.code})`)
  }
  const snapshot = result.value.value
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-groups: dictionaries')
  ctx.slots.inject('sidebar.workspaces.sessionGroups', () => ctx.slots.register({
    name: 'sidebar.workspaces.sessionGroups',
    locale: NS,
    inject: (): Pick<PinnedSliceProps, 'snapshot'> => ({ snapshot }),
  }, PinnedSlice))
}
