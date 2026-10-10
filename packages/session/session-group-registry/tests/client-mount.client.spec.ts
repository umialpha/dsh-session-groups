/** Generated Remote mounting owned by the Registry Client half. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'

const contribution: TypertRemoteContribution = {
  package: '@umialpha/dsh-session-group-registry',
  descriptors: [],
}

describe('registry Client Remote mount', () => {
  it('mounts the package contribution and returns its disposer', async () => {
    const ctx = new Context()
    const disposeRemote = vi.fn(async () => {})
    const mount = vi.fn(async (value: TypertRemoteContribution) => {
      expect(value).toBe(contribution)
      return disposeRemote
    })
    class Remote extends Service {
      constructor() { super(ctx, 'remote') }
      $mount = mount
    }
    new Remote()

    const { mountSessionGroupsRemote } = await import('../src/client/mount.ts')
    const dispose = await mountSessionGroupsRemote(ctx, contribution)
    expect(mount).toHaveBeenCalledOnce()
    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('does not manufacture a namespace when mounting fails', async () => {
    const ctx = new Context()
    class Remote extends Service {
      constructor() { super(ctx, 'remote') }
      $mount(): Promise<never> { return Promise.reject(new Error('mount failed')) }
    }
    new Remote()
    const { mountSessionGroupsRemote } = await import('../src/client/mount.ts')
    await expect(mountSessionGroupsRemote(ctx, contribution)).rejects.toThrow('mount failed')
    expect(ctx.get('remote.sessionGroups')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
