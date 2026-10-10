/** Browser entry that mounts this package's generated Session groups Remote. */

import type { Context } from '@deepseek-ai/cordis'
import sessionGroupsRemote from '@umialpha/dsh-session-group-registry/remote'
import { mountSessionGroupsRemote } from './mount.ts'

/** Client services required before the generated Remote can be mounted. */
export const inject = ['remote']

/**
 * Mount the package-local generated Remote contribution.
 * @param ctx - Browser Context carrying the API Remote service.
 * @returns an asynchronous disposer that withdraws the namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountSessionGroupsRemote(ctx, sessionGroupsRemote)
}
