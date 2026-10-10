// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SessionGroupsFailure, SessionGroupsSnapshot,
} from '@umialpha/dsh-session-group-registry/types'
import { apply, inject } from '../src/client/index.ts'
import { SessionGroupsToast, type SessionGroupsNoticeInjected } from '../src/client/notice.tsx'
import { SessionGroupsView } from '../src/client/SessionGroupsView.tsx'
import type { SessionGroupsRemote } from '../src/client/controller.ts'
import type { SessionGroupsInjected } from '../src/client/slots.ts'
import { gid, group, sid, snapshot, workspaceState } from './fixtures.client.ts'
import { TestLocaleRuntime } from './fixtures/locale-runtime.ts'
import { RemoteError, usePinnedBrowserLanguages } from './fixtures/runtime.ts'
import { TestSlotRegistry } from './fixtures/slot-registry.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () =>
  import('./fixtures/ui-primitives.tsx'))

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

function accepted(value: SessionGroupsSnapshot): RemoteResult<{
  readonly ok: true
  readonly value: SessionGroupsSnapshot
}> {
  return { ok: true, value: { ok: true, value } }
}

function rejected(error: SessionGroupsFailure): RemoteResult<{
  readonly ok: false
  readonly error: SessionGroupsFailure
}> {
  return { ok: true, value: { ok: false, error } }
}

function unknownMutation(): RemoteResult<never> {
  return { ok: false, error: new RemoteError('gateway/internal', 'socket closed', {}) }
}

async function bench() {
  const ctx = new Context()
  new TestSlotRegistry(ctx)
  const slots = ctx.get('slots') as TestSlotRegistry
  const locale = new TestLocaleRuntime()
  ctx.provide('locale', locale as never)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const state = snapshot([group('work', 'Work', ['one'])])
  const remote = {
    snapshot: vi.fn(async () => accepted(state)),
    create: vi.fn(async () => accepted(state)),
    rename: vi.fn(async () => accepted(state)),
    delete: vi.fn(async () => accepted(state)),
    insertGroupBefore: vi.fn(async () => accepted(state)),
    moveSession: vi.fn(async () => accepted(state)),
  } satisfies SessionGroupsRemote
  ctx.provide('remote.sessionGroups', remote)

  const rename = vi.fn(async () => ({ ok: true as const, value: { title: 'renamed', seq: 1 } }))
  const using = vi.fn<ISessions['using']>(async (_target, _options, operation) =>
    operation({ binding: { session: { rename } } } as never))
  const openSession = vi.fn()
  const forkSession = vi.fn(async () => sid('forked'))
  const archiveSession = vi.fn(async () => ({}))
  const unpinSession = vi.fn(async () => {})
  let currentWorkspaces: WorkspaceSnapshot = workspaceState([])
  const workspaceListeners = new Set<() => void>()
  ctx.provide('sessions', { using } as never)
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => currentWorkspaces,
      subscribe: (listener: () => void) => {
        workspaceListeners.add(listener)
        return () => { workspaceListeners.delete(listener) }
      },
    },
  } as never)
  ctx.provide('uiWorkspace', { openSession, forkSession, archiveSession, unpinSession } as never)
  return {
    ctx, slots, locale, remote, rename, using, openSession, forkSession, archiveSession, unpinSession,
    setArchived(ids: readonly string[]) {
      currentWorkspaces = workspaceState([], ids.map(sid))
      for (const listener of workspaceListeners) listener()
    },
  }
}

function declare(slots: TestSlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.workspaces.sessionGroups': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'multiple', scope: 'root' },
    },
  } as never, (() => null) as never)
}

function entry(slots: TestSlotRegistry) {
  return slots.entries('sidebar.workspaces.sessionGroups')[0]
}

function face(slots: TestSlotRegistry): SessionGroupsInjected {
  const registered = entry(slots)
  if (registered?.inject === undefined) throw new Error('Session groups entry is unavailable')
  const injected: object = registered.inject()
  return injected as SessionGroupsInjected
}

function noticeFace(slots: TestSlotRegistry): SessionGroupsNoticeInjected {
  const overlay = slots.entries('shell.overlay').find(item => item.options.id === 'session-groups-toast')
  if (overlay?.inject === undefined) throw new Error('Session groups Toast entry is unavailable')
  const injected: object = overlay.inject()
  return injected as SessionGroupsNoticeInjected
}

describe('ui-session-groups browser plugin', () => {
  it('declares the exact services used by the root-scoped Pinned section', () => {
    expect(inject).toEqual([
      'slots', 'remote', 'remote.sessionGroups', 'sessions', 'workspaces', 'uiWorkspace', 'locale',
    ])
  })

  it('registers lazily in the additive section and routes every group action', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(entry(b.slots)?.component).toBe(SessionGroupsView)
    expect(entry(b.slots)?.options.id).toBeUndefined()
    expect(entry(b.slots)?.locale).toBe('sessionGroups')
    expect(b.remote.snapshot).not.toHaveBeenCalled()

    const groups = face(b.slots)
    expect(groups.hooks.sessionGroups.getSnapshot().status).toBe('cold')
    await expect(groups.ensure()).resolves.toEqual({ ok: true })
    await groups.createGroup('Ideas')
    await groups.renameGroup(gid('work'), 'Focused')
    await groups.deleteGroup(gid('work'))
    await groups.insertGroupBefore(gid('work'), null)
    await groups.moveSession(sid('one'), gid('work'), null)
    expect(b.remote.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ideas' }))
    expect(b.remote.rename).toHaveBeenCalledWith(expect.objectContaining({ groupId: gid('work') }))
    expect(b.remote.delete).toHaveBeenCalledWith(expect.objectContaining({ groupId: gid('work') }))
    expect(b.remote.insertGroupBefore).toHaveBeenCalledWith(expect.objectContaining({ beforeGroupId: null }))
    expect(b.remote.moveSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sid('one') }))

    groups.open(sid('one'))
    expect(b.openSession).toHaveBeenCalledWith(sid('one'))
    await groups.renameSession(sid('one'), 'Renamed')
    expect(b.using).toHaveBeenCalledWith(
      sid('one'),
      { source: 'sessionGroupsOperation' },
      expect.any(Function),
    )
    expect(b.rename).toHaveBeenCalledWith('Renamed')
    await groups.archiveSession(sid('one'))
    expect(b.archiveSession).toHaveBeenCalledWith(sid('one'))
    await groups.unpinSession(sid('one'))
    expect(b.unpinSession).toHaveBeenCalledWith(sid('one'))

    const overlay = b.slots.entries('shell.overlay').find(item => item.options.id === 'session-groups-toast')
    expect(overlay?.component).toBe(SessionGroupsToast)
    const notices = noticeFace(b.slots)
    notices.notify({ text: 'Saved', tone: 'success' })
    expect(notices.hooks.sessionGroupsNotice.getSnapshot()).toMatchObject({ text: 'Saved', tone: 'success' })

    await groups.forkSession(sid('one'))
    await vi.waitFor(() => {
      expect(b.forkSession).toHaveBeenCalledWith(sid('one'), undefined, { allowMigration: false })
    })
    expect(b.openSession).toHaveBeenCalledOnce()

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('reads the live archive set before every open, including the fork-recovery action', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const groups = face(b.slots)
    const notices = noticeFace(b.slots)

    groups.open(sid('one'))
    expect(b.openSession).toHaveBeenCalledWith(sid('one'))
    b.openSession.mockClear()
    b.setArchived(['one'])
    groups.open(sid('one'))
    expect(b.openSession).not.toHaveBeenCalled()
    expect(notices.hooks.sessionGroupsNotice.getSnapshot()).toMatchObject({
      text: '该会话已归档，无法打开', tone: 'warning',
    })

    b.setArchived([])
    b.forkSession.mockRejectedValueOnce(Object.assign(new Error('migration required'), {
      name: 'SessionForkError',
      rpcError: { code: 'session/migration-required' },
    }))
    await expect(groups.forkSession(sid('one'))).resolves.toBe('migration-required')
    const recovery = notices.hooks.sessionGroupsNotice.getSnapshot()
    expect(recovery).toMatchObject({
      text: '分叉前需要先打开并迁移源会话', tone: 'warning', holdMs: 6000,
      action: { label: '打开源会话' },
    })
    recovery?.action?.onClick()
    expect(b.openSession).toHaveBeenCalledWith(sid('one'))

    b.openSession.mockClear()
    b.setArchived(['one'])
    recovery?.action?.onClick()
    expect(b.openSession).not.toHaveBeenCalled()
    expect(notices.hooks.sessionGroupsNotice.getSnapshot()).toMatchObject({
      text: '该会话已归档，无法打开', tone: 'warning',
    })

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('adapts active archive refusals and passes stopActivity only on confirmation', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const groups = face(b.slots)
    const activity = [{ kind: 'turn' as never }]
    b.archiveSession.mockRejectedValueOnce(Object.assign(new Error('active'), {
      name: 'WorkspaceArchiveError',
      rpcError: { code: 'workspace/session-active', details: { activity } },
    }))

    await expect(groups.archiveSession(sid('one'))).resolves.toEqual({
      kind: 'session-active', activity,
    })
    expect(b.archiveSession).toHaveBeenNthCalledWith(1, sid('one'))
    await expect(groups.archiveSession(sid('one'), { stopActivity: true })).resolves.toEqual({
      kind: 'archived',
    })
    expect(b.archiveSession).toHaveBeenNthCalledWith(2, sid('one'), { stopActivity: true })

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('surfaces rename failures while a rejected fork keeps the current Session selected', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const groups = face(b.slots)

    b.using.mockRejectedValueOnce(new Error('unknown session "missing"'))
    await expect(groups.renameSession(sid('missing'), 'Name')).rejects.toThrow('unknown session "missing"')
    b.rename.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'rename failed' } } as never)
    await expect(groups.renameSession(sid('one'), 'Name')).rejects.toThrow('rename failed')

    b.forkSession.mockRejectedValueOnce(new Error('fork rejected'))
    const opened = b.openSession.mock.calls.length
    await expect(groups.forkSession(sid('one'))).rejects.toThrow('fork rejected')
    expect(b.openSession).toHaveBeenCalledTimes(opened)

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('follows late declaration and unregisters the section, locale, and controller on unload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(entry(b.slots)).toBeUndefined()

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(entry(b.slots)?.component).toBe(SessionGroupsView) })
    const first = face(b.slots)
    await first.ensure()

    stop()
    expect(entry(b.slots)).toBeUndefined()
    declare(b.slots)
    await vi.waitFor(() => { expect(entry(b.slots)?.component).toBe(SessionGroupsView) })
    expect(face(b.slots).hooks.sessionGroups).toBe(first.hooks.sessionGroups)

    await fiber.dispose()
    expect(entry(b.slots)).toBeUndefined()
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(() => b.locale.register('sessionGroups', 'zh', {})).not.toThrow()
    await expect(first.createGroup('After unload')).resolves.toMatchObject({
      ok: false, error: { code: 'disposed' },
    })
    await b.ctx.fiber.dispose()
  })

  it('refreshes on reconnect only after the Groups registry has been read', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const groups = face(b.slots)

    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.remote.snapshot).not.toHaveBeenCalled()

    await groups.ensure()
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.remote.snapshot).toHaveBeenCalledTimes(2) })

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('queues a reconnect refresh until a rejected mutation settles', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const groups = face(b.slots)
    await groups.ensure()

    const mutationGate = Promise.withResolvers<ReturnType<typeof rejected>>()
    b.remote.rename.mockImplementationOnce(() => mutationGate.promise as never)
    const mutation = groups.renameGroup(gid('work'), 'Work')
    await Promise.resolve()
    const authoritative = snapshot([group('server', 'Server state')], 'server-revision')
    b.remote.snapshot.mockResolvedValueOnce(accepted(authoritative))

    b.ctx.emit('connection/reset')
    expect(b.remote.snapshot).toHaveBeenCalledOnce()
    mutationGate.resolve(rejected({
      code: 'title-conflict', title: 'Work', existingGroupId: gid('work'),
    }))
    await expect(mutation).resolves.toMatchObject({ ok: false, error: { code: 'title-conflict' } })
    await vi.waitFor(() => {
      expect(groups.hooks.sessionGroups.getSnapshot().snapshot).toBe(authoritative)
    })
    expect(b.remote.snapshot).toHaveBeenCalledTimes(2)

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('queues a reconnect refresh until an unknown mutation outcome settles', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const groups = face(b.slots)
    await groups.ensure()

    const mutationGate = Promise.withResolvers<ReturnType<typeof unknownMutation>>()
    b.remote.delete.mockImplementationOnce(() => mutationGate.promise as never)
    const mutation = groups.deleteGroup(gid('work'))
    await Promise.resolve()
    const authoritative = snapshot([group('server', 'Server state')], 'server-revision')
    b.remote.snapshot.mockResolvedValueOnce(accepted(authoritative))

    b.ctx.emit('connection/reset')
    expect(b.remote.snapshot).toHaveBeenCalledOnce()
    mutationGate.resolve(unknownMutation())
    await expect(mutation).resolves.toMatchObject({ ok: false, error: { code: 'transport' } })
    await vi.waitFor(() => {
      expect(groups.hooks.sessionGroups.getSnapshot().snapshot).toBe(authoritative)
    })
    expect(b.remote.snapshot).toHaveBeenCalledTimes(2)

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })
})
