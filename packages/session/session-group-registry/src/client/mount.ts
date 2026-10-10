/** Source-safe generated Remote mount used by the browser entry and tests. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Mount one generated Session groups contribution.
 * @param ctx - Browser Context carrying the API Remote service.
 * @param contribution - Generated descriptors for this package.
 * @returns the generated namespace disposer.
 */
export async function mountSessionGroupsRemote(
  ctx: Context,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  return await ctx.remote.$mount(contribution)
}
