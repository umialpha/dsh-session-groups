import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SessionGroupRegistry, {
  SessionGroupId,
  SessionGroupRegistryLifecycleError,
  SessionGroupsRevision,
  sessionGroupsStateSchema,
  type SessionGroupsFailure,
  type SessionGroupsRejected,
  type SessionGroupsSnapshot,
  type SessionGroupsSuccess,
} from '../src/index.ts'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from './memory-backend.ts'
import { setupHarness, type TestHarness } from './helpers.ts'

const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.dispose()))
})

async function harness(options: Parameters<typeof setupHarness>[0] | number = {}): Promise<TestHarness> {
  const value = await setupHarness(typeof options === 'number' ? { maxTitleBytes: options } : options)
  harnesses.push(value)
  return value
}

/** Narrow one business result and return its immutable snapshot. */
function valueOf(
  result: SessionGroupsSuccess<SessionGroupsSnapshot> | SessionGroupsRejected<SessionGroupsFailure>,
): SessionGroupsSnapshot {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.value
}

/** Read and narrow the current reconciled snapshot. */
async function snapshotOf(testHarness: TestHarness): Promise<SessionGroupsSnapshot> {
  return valueOf(await testHarness.ctx.sessionGroupRegistry.snapshot({}))
}

/** Create a live Session known to Workspace pin validation. */
function live(testHarness: TestHarness, rawId: string): SessionId {
  return testHarness.ctx.sessions.create(SessionId(rawId)).id
}

/** Delay the first pinned-layout global write at an explicit barrier. */
function barrierBackend(
  pool: MemoryMediaPool,
  started: PromiseWithResolvers<undefined>,
  release: Promise<void>,
): StorageBackend {
  const inner = new MemoryStorageBackend(pool)
  let delayed = false
  return {
    kv: {
      async open(descriptor: KvUnitDescriptor) {
        const unit = await inner.kv.open(descriptor)
        return {
          loadAll: () => unit.loadAll(),
          putRecord: (table, key, value) => unit.putRecord(table, key, value),
          deleteRecord: (table, key) => unit.deleteRecord(table, key),
          setGlobal: async (value) => {
            if (descriptor.name === 'pinned_session_groups' && !delayed) {
              delayed = true
              started.resolve(undefined)
              await release
            }
            await unit.setGlobal(value)
          },
          close: () => unit.close(),
        }
      },
    },
    close: () => inner.close(),
  }
}

describe('SessionGroupRegistry', () => {
  it('publishes the Remote namespace and starts from the new empty storage identity', async () => {
    const pool = new MemoryMediaPool()
    pool.versions.set('session_groups', 0)
    pool.media.set('session_groups', {
      tables: new Map(),
      global: { revision: 'initial', groups: [{ id: 'legacy', title: 'Legacy', sessionIds: [] }] },
    })
    const testHarness = await harness({ pool })

    expect(testHarness.ctx.sessionGroupRegistry.typertRemote.namespace).toBe('sessionGroups')
    expect(remoteMethods(testHarness.ctx.sessionGroupRegistry).map(marker => marker.method)).toEqual([
      'snapshot',
      'create',
      'rename',
      'delete',
      'insertGroupBefore',
      'moveSession',
    ])
    expect(await snapshotOf(testHarness)).toEqual({
      revision: 'initial',
      defaultSessionIds: [],
      groups: [],
    })
    expect(pool.versions.get('pinned_session_groups')).toBe(0)
    expect(pool.versions.get('session_groups')).toBe(0)
  })

  it('requires a positive safe-integer title limit and returns typed lifecycle rejections', async () => {
    expect(() => new SessionGroupRegistry(new Context(), { maxTitleBytes: 0 }))
      .toThrow(/maxTitleBytes must be a positive safe integer/u)
    expect(() => new SessionGroupRegistry(new Context(), { maxTitleBytes: 1.5 }))
      .toThrow(/maxTitleBytes must be a positive safe integer/u)

    const rawCtx = new Context()
    const registry = new SessionGroupRegistry(rawCtx, { maxTitleBytes: 64 })
    await expect(registry.snapshot({})).rejects.toEqual(
      expect.objectContaining<Partial<SessionGroupRegistryLifecycleError>>({
        name: 'SessionGroupRegistryLifecycleError',
        code: 'not-initialized',
      }),
    )
    await rawCtx.fiber.dispose()
  })

  it('normalizes titles, rejects duplicates and UTF-8 overflow, and preserves no-op revisions', async () => {
    const testHarness = await harness(6)
    const { ctx } = testHarness
    const initial = await snapshotOf(testHarness)

    await expect(ctx.sessionGroupRegistry.create({
      title: '   ',
      ifRevision: initial.revision,
    })).resolves.toEqual({ ok: false, error: { code: 'title-blank' } })
    await expect(ctx.sessionGroupRegistry.create({
      title: '中文中',
      ifRevision: initial.revision,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'title-too-large', maxBytes: 6, actualBytes: 9 },
    })

    const created = valueOf(await ctx.sessionGroupRegistry.create({
      title: ' Work ',
      ifRevision: initial.revision,
    }))
    expect(created.groups[0]?.title).toBe('Work')
    const renamedNoop = valueOf(await ctx.sessionGroupRegistry.rename({
      groupId: created.groups[0]!.id,
      title: '  Work  ',
      ifRevision: created.revision,
    }))
    expect(renamedNoop.revision).toBe(created.revision)
    await expect(ctx.sessionGroupRegistry.create({
      title: 'Work',
      ifRevision: created.revision,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'title-conflict',
        title: 'Work',
        existingGroupId: created.groups[0]!.id,
      },
    })
  })

  it('serializes compare-and-set mutations and returns the immutable winning snapshot', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const initial = await snapshotOf(testHarness)
    const [first, second] = await Promise.all([
      ctx.sessionGroupRegistry.create({ title: 'One', ifRevision: initial.revision }),
      ctx.sessionGroupRegistry.create({ title: 'Two', ifRevision: initial.revision }),
    ])
    const accepted = first.ok ? first : second
    const conflicted = first.ok ? second : first
    if (!accepted.ok) throw new Error(`expected one success, got ${accepted.error.code}`)
    if (conflicted.ok || conflicted.error.code !== 'revision-conflict') {
      throw new Error('expected one revision conflict')
    }
    expect(conflicted.error.current).toEqual(accepted.value)
    expect(Object.isFrozen(conflicted.error.current)).toBe(true)
    expect(Object.isFrozen(conflicted.error.current.defaultSessionIds)).toBe(true)
    expect(Object.isFrozen(conflicted.error.current.groups)).toBe(true)
  })

  it('renames, reorders, and rejects stale or missing group mutations', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const initial = await snapshotOf(testHarness)
    let snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Work', ifRevision: initial.revision,
    }))
    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Personal', ifRevision: snapshot.revision,
    }))
    const [work, personal] = snapshot.groups
    if (work === undefined || personal === undefined) throw new Error('expected two groups')

    await expect(ctx.sessionGroupRegistry.rename({
      groupId: work.id, title: 'Focus', ifRevision: initial.revision,
    })).resolves.toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
    await expect(ctx.sessionGroupRegistry.rename({
      groupId: work.id, title: ' ', ifRevision: snapshot.revision,
    })).resolves.toEqual({ ok: false, error: { code: 'title-blank' } })
    await expect(ctx.sessionGroupRegistry.rename({
      groupId: SessionGroupId('missing'), title: 'Focus', ifRevision: snapshot.revision,
    })).resolves.toEqual({
      ok: false, error: { code: 'group-not-found', groupId: 'missing' },
    })
    await expect(ctx.sessionGroupRegistry.rename({
      groupId: personal.id, title: work.title, ifRevision: snapshot.revision,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'title-conflict', title: work.title, existingGroupId: work.id },
    })
    snapshot = valueOf(await ctx.sessionGroupRegistry.rename({
      groupId: work.id, title: 'Focus', ifRevision: snapshot.revision,
    }))
    expect(snapshot.groups.map(group => group.title)).toEqual(['Focus', 'Personal'])

    await expect(ctx.sessionGroupRegistry.insertGroupBefore({
      groupId: personal.id, beforeGroupId: work.id, ifRevision: initial.revision,
    })).resolves.toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
    await expect(ctx.sessionGroupRegistry.insertGroupBefore({
      groupId: SessionGroupId('missing'), beforeGroupId: null, ifRevision: snapshot.revision,
    })).resolves.toEqual({
      ok: false, error: { code: 'group-not-found', groupId: 'missing' },
    })
    await expect(ctx.sessionGroupRegistry.insertGroupBefore({
      groupId: personal.id,
      beforeGroupId: SessionGroupId('missing-anchor'),
      ifRevision: snapshot.revision,
    })).resolves.toEqual({
      ok: false, error: { code: 'group-not-found', groupId: 'missing-anchor' },
    })
    const selfNoop = valueOf(await ctx.sessionGroupRegistry.insertGroupBefore({
      groupId: work.id, beforeGroupId: work.id, ifRevision: snapshot.revision,
    }))
    expect(selfNoop.revision).toBe(snapshot.revision)
    const appendNoop = valueOf(await ctx.sessionGroupRegistry.insertGroupBefore({
      groupId: personal.id, beforeGroupId: null, ifRevision: snapshot.revision,
    }))
    expect(appendNoop.revision).toBe(snapshot.revision)
    await expect(ctx.sessionGroupRegistry.delete({
      groupId: SessionGroupId('missing'), ifRevision: snapshot.revision,
    })).resolves.toEqual({
      ok: false, error: { code: 'group-not-found', groupId: 'missing' },
    })
    await expect(ctx.sessionGroupRegistry.delete({
      groupId: work.id, ifRevision: initial.revision,
    })).resolves.toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
  })

  it('reconciles native pin, unpin, and re-pin events without changing native order', async () => {
    const testHarness = await harness()
    const first = live(testHarness, 'first')
    const second = live(testHarness, 'second')

    await testHarness.ctx.workspaceRegistry.pinSession(first)
    await testHarness.ctx.workspaceRegistry.pinSession(second)
    expect(testHarness.ctx.workspaceRegistry.pinnedSessionIds).toEqual([second, first])
    expect((await snapshotOf(testHarness)).defaultSessionIds).toEqual([first, second])

    await testHarness.ctx.workspaceRegistry.unpinSession(first)
    expect((await snapshotOf(testHarness)).defaultSessionIds).toEqual([second])
    await testHarness.ctx.workspaceRegistry.pinSession(first)
    const repinned = await snapshotOf(testHarness)
    expect(repinned.defaultSessionIds).toEqual([second, first])
    expect(testHarness.ctx.workspaceRegistry.pinnedSessionIds).toEqual([first, second])
  })

  it('removes a natively unpinned Session from a named group', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const sessionId = live(testHarness, 'grouped-unpin')
    let snapshot = await snapshotOf(testHarness)
    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Work', ifRevision: snapshot.revision,
    }))
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: snapshot.groups[0]!.id,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    await ctx.workspaceRegistry.unpinSession(sessionId)
    snapshot = await snapshotOf(testHarness)
    expect(snapshot.groups[0]?.sessionIds).toEqual([])
  })

  it('auto-pins and manually orders the default level and named groups', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const first = live(testHarness, 'first')
    const second = live(testHarness, 'second')
    let snapshot = await snapshotOf(testHarness)

    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId: first,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId: second,
      targetGroupId: null,
      beforeSessionId: first,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.defaultSessionIds).toEqual([second, first])
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([second, first])

    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Work',
      ifRevision: snapshot.revision,
    }))
    const group = snapshot.groups[0]!
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId: first,
      targetGroupId: group.id,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId: second,
      targetGroupId: group.id,
      beforeSessionId: first,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.defaultSessionIds).toEqual([])
    expect(snapshot.groups[0]?.sessionIds).toEqual([second, first])
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([second, first])

    const beforeSelf = snapshot.revision
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId: second,
      targetGroupId: group.id,
      beforeSessionId: second,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.revision).toBe(beforeSelf)
    expect(snapshot.groups[0]?.sessionIds).toEqual([second, first])

    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId: first,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.defaultSessionIds).toEqual([first])
    expect(snapshot.groups[0]?.sessionIds).toEqual([second])
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([second, first])
  })

  it('reorders groups and appends deleted-group members to default in relative order', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const defaultSession = live(testHarness, 'default')
    const first = live(testHarness, 'group-first')
    const second = live(testHarness, 'group-second')
    let snapshot = await snapshotOf(testHarness)
    for (const sessionId of [defaultSession, first, second]) {
      snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
        sessionId,
        targetGroupId: null,
        beforeSessionId: null,
        ifRevision: snapshot.revision,
      }))
    }
    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Work', ifRevision: snapshot.revision,
    }))
    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Personal', ifRevision: snapshot.revision,
    }))
    const [work, personal] = snapshot.groups
    if (work === undefined || personal === undefined) throw new Error('expected two groups')
    for (const sessionId of [first, second]) {
      snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
        sessionId,
        targetGroupId: work.id,
        beforeSessionId: null,
        ifRevision: snapshot.revision,
      }))
    }
    snapshot = valueOf(await ctx.sessionGroupRegistry.insertGroupBefore({
      groupId: personal.id,
      beforeGroupId: work.id,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.groups.map(group => group.title)).toEqual(['Personal', 'Work'])
    snapshot = valueOf(await ctx.sessionGroupRegistry.delete({
      groupId: work.id,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.defaultSessionIds).toEqual([defaultSession, first, second])
    expect(snapshot.groups.map(group => group.title)).toEqual(['Personal'])
  })

  it('maps unknown and archived Workspace pin failures to business results', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const initial = await snapshotOf(testHarness)
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId: SessionId('unknown'),
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: initial.revision,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId: 'unknown' },
    })

    const archived = live(testHarness, 'archived')
    await ctx.workspaceRegistry.archiveSession(archived)
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId: archived,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: initial.revision,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'session-archived', sessionId: archived },
    })
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([])
    expect(await snapshotOf(testHarness)).toEqual(initial)
  })

  it('leaves a newly pinned Session at default after destination validation fails', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const sessionId = live(testHarness, 'newly-pinned-invalid')
    const initial = await snapshotOf(testHarness)
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: SessionGroupId('missing'),
      beforeSessionId: null,
      ifRevision: initial.revision,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'group-not-found', groupId: 'missing' },
    })
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([sessionId])
    expect((await snapshotOf(testHarness)).defaultSessionIds).toEqual([sessionId])
  })

  it('pins before reporting a revision conflict and reconciles the Session to default', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const sessionId = live(testHarness, 'newly-pinned-stale')
    const initial = await snapshotOf(testHarness)
    const current = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Current', ifRevision: initial.revision,
    }))
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: current.groups[0]!.id,
      beforeSessionId: null,
      ifRevision: initial.revision,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'revision-conflict', current },
    })
    expect((await snapshotOf(testHarness)).defaultSessionIds).toEqual([sessionId])
  })

  it('commits a newly pinned self-anchor at default and preserves repeated default moves', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const sessionId = live(testHarness, 'self-anchor-new')
    let snapshot = await snapshotOf(testHarness)
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: null,
      beforeSessionId: sessionId,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.defaultSessionIds).toEqual([sessionId])
    const revision = snapshot.revision
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    expect(snapshot.revision).toBe(revision)
  })

  it('propagates unexpected Workspace pin failures without changing either state', async () => {
    const testHarness = await harness()
    const { ctx, pool } = testHarness
    const sessionId = live(testHarness, 'workspace-write-failure')
    const initial = await snapshotOf(testHarness)
    pool.failNextWrites = 1
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: initial.revision,
    })).rejects.toThrow('injected write failure')
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([])
    expect(await snapshotOf(testHarness)).toEqual(initial)
  })

  it('supports anchors in default and returns nullable-target anchor failures', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const first = live(testHarness, 'anchor-first')
    const second = live(testHarness, 'anchor-second')
    let snapshot = await snapshotOf(testHarness)
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId: first,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId: second,
      targetGroupId: null,
      beforeSessionId: SessionId('missing-anchor'),
      ifRevision: snapshot.revision,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'session-anchor-not-found',
        targetGroupId: null,
        beforeSessionId: 'missing-anchor',
      },
    })
    expect((await snapshotOf(testHarness)).defaultSessionIds).toEqual([first, second])
  })

  it('reconciles a newly pinned Session to default after its target write fails', async () => {
    const testHarness = await harness()
    const { ctx, pool } = testHarness
    const sessionId = live(testHarness, 'partial-new')
    let snapshot = await snapshotOf(testHarness)
    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Work', ifRevision: snapshot.revision,
    }))
    const group = snapshot.groups[0]!
    let armed = true
    const stop = ctx.on('domain/changed', (change) => {
      if (!armed || change.domain !== 'workspace' || change.table !== '') return
      armed = false
      pool.failNextWrites = 1
    })
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: group.id,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    })).rejects.toThrow('injected write failure')
    stop()

    const recovered = await snapshotOf(testHarness)
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([sessionId])
    expect(recovered.defaultSessionIds).toEqual([sessionId])
    expect(recovered.groups[0]?.sessionIds).toEqual([])
  })

  it('reports a failed event reconciliation and retries it on the next request', async () => {
    const testHarness = await harness()
    const { ctx, pool } = testHarness
    const sessionId = live(testHarness, 'event-retry')
    const warn = vi.spyOn(ctx.logger, 'warn')
    let armed = true
    const stop = ctx.on('domain/changed', (change) => {
      if (!armed || change.domain !== 'workspace' || change.table !== '') return
      armed = false
      pool.failNextWrites = 1
    })
    await ctx.workspaceRegistry.pinSession(sessionId)
    const recovered = await snapshotOf(testHarness)
    stop()
    expect(recovered.defaultSessionIds).toEqual([sessionId])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the next registry request will retry'))
  })

  it('retains an already pinned layout when its target write fails', async () => {
    const testHarness = await harness()
    const { ctx, pool } = testHarness
    const sessionId = live(testHarness, 'partial-existing')
    let snapshot = await snapshotOf(testHarness)
    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Work', ifRevision: snapshot.revision,
    }))
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: snapshot.groups[0]!.id,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    const before = snapshot
    pool.failNextWrites = 1
    await expect(ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    })).rejects.toThrow('injected write failure')
    expect(await snapshotOf(testHarness)).toEqual(before)
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([sessionId])
  })

  it('captures Workspace pin events in commit order while the mutation queue is blocked', async () => {
    const pool = new MemoryMediaPool()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const testHarness = await harness({
      pool,
      backend: barrierBackend(pool, started, release.promise),
    })
    const { ctx } = testHarness
    const first = live(testHarness, 'ordered-first')
    const second = live(testHarness, 'ordered-second')
    const initial = await snapshotOf(testHarness)
    const creating = ctx.sessionGroupRegistry.create({
      title: 'Blocked', ifRevision: initial.revision,
    })
    await started.promise

    await ctx.workspaceRegistry.pinSession(first)
    await ctx.workspaceRegistry.pinSession(second)
    let snapshotSettled = false
    const pendingSnapshot = ctx.sessionGroupRegistry.snapshot({}).then((result) => {
      snapshotSettled = true
      return result
    })
    await Promise.resolve()
    expect(snapshotSettled).toBe(false)
    release.resolve(undefined)
    await creating
    const final = valueOf(await pendingSnapshot)
    expect(ctx.workspaceRegistry.pinnedSessionIds).toEqual([second, first])
    expect(final.defaultSessionIds).toEqual([first, second])
  })

  it('stops observation and admission, then drains an accepted move before domain close', async () => {
    const testHarness = await harness()
    const { ctx, registryFiber } = testHarness
    const registry = ctx.sessionGroupRegistry
    const sessionId = testHarness.addCataloguedSession('pending-catalog-pin')
    const initial = await snapshotOf(testHarness)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const originalList = ctx.sessionPersistence.list.bind(ctx.sessionPersistence)
    vi.spyOn(ctx.sessionPersistence, 'list').mockImplementation(async () => {
      started.resolve(undefined)
      await release.promise
      return await originalList()
    })

    const pending = registry.moveSession({
      sessionId,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: initial.revision,
    })
    await started.promise
    const disposal = registryFiber.dispose()
    await vi.waitFor(() => {
      const admissionOpen: unknown = Reflect.get(registry, 'mutationAdmissionOpen')
      expect(admissionOpen).toBe(false)
    })
    await expect(registry.create({
      title: 'Too late', ifRevision: initial.revision,
    })).rejects.toEqual(expect.objectContaining({
      name: 'SessionGroupRegistryLifecycleError',
      code: 'disposing',
    }))
    release.resolve(undefined)
    await expect(pending).resolves.toMatchObject({
      ok: true,
      value: { defaultSessionIds: [sessionId] },
    })
    await disposal
  })

  it('persists layout across service restart and reconciles the current native pin set', async () => {
    const testHarness = await harness()
    const { ctx } = testHarness
    const sessionId = live(testHarness, 'durable')
    let snapshot = await snapshotOf(testHarness)
    snapshot = valueOf(await ctx.sessionGroupRegistry.create({
      title: 'Durable', ifRevision: snapshot.revision,
    }))
    snapshot = valueOf(await ctx.sessionGroupRegistry.moveSession({
      sessionId,
      targetGroupId: snapshot.groups[0]!.id,
      beforeSessionId: null,
      ifRevision: snapshot.revision,
    }))
    await testHarness.registryFiber.dispose()

    const fiber = await ctx.plugin(SessionGroupRegistry, { maxTitleBytes: 64 })
    expect(valueOf(await ctx.sessionGroupRegistry.snapshot({}))).toEqual(snapshot)
    await fiber.dispose()
  })
})

describe('sessionGroupsStateSchema', () => {
  const id = SessionGroupId('5a86d0b0-e7d1-4fb6-8785-95dcb1084b0e')
  const other = SessionGroupId('2b64d550-3b20-45e8-b444-653318335cab')
  const revision = SessionGroupsRevision('61d06ef7-6c86-4e69-975e-cc9a9252ecdf')

  it.each([
    {
      name: 'group ids',
      defaultSessionIds: [],
      groups: [
        { id, title: 'One', sessionIds: [] },
        { id, title: 'Two', sessionIds: [] },
      ],
    },
    {
      name: 'titles',
      defaultSessionIds: [],
      groups: [
        { id, title: 'Same', sessionIds: [] },
        { id: other, title: 'Same', sessionIds: [] },
      ],
    },
    {
      name: 'default duplicates',
      defaultSessionIds: [SessionId('shared'), SessionId('shared')],
      groups: [],
    },
    {
      name: 'default and named membership overlap',
      defaultSessionIds: [SessionId('shared')],
      groups: [{ id, title: 'One', sessionIds: [SessionId('shared')] }],
    },
    {
      name: 'named membership overlap',
      defaultSessionIds: [],
      groups: [
        { id, title: 'One', sessionIds: [SessionId('shared')] },
        { id: other, title: 'Two', sessionIds: [SessionId('shared')] },
      ],
    },
  ])('rejects duplicate $name', ({ defaultSessionIds, groups }) => {
    expect(() => sessionGroupsStateSchema.parse({ revision, defaultSessionIds, groups })).toThrow()
  })
})
