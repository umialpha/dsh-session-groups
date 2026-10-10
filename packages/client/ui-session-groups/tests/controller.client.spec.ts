import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SessionGroupsFailure,
  SessionGroupsSnapshot,
} from '@umialpha/dsh-session-group-registry/types'
import {
  SessionGroupsController,
  type SessionGroupsRemote,
} from '../src/client/controller.ts'
import { gid, group, revision, sid, snapshot } from './fixtures.client.ts'
import { RemoteError } from './fixtures/runtime.ts'

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

function carrier(message = 'socket closed'): RemoteResult<never> {
  return { ok: false, error: new RemoteError('gateway/internal', message, {}) }
}

function bench(initial = snapshot([group('work', 'Work', ['one']), group('play', 'Play', ['two'])])) {
  let host = initial
  const remote = {
    snapshot: vi.fn(async () => accepted(host)),
    create: vi.fn(async () => accepted(host)),
    rename: vi.fn(async () => accepted(host)),
    delete: vi.fn(async () => accepted(host)),
    insertGroupBefore: vi.fn(async () => accepted(host)),
    moveSession: vi.fn(async () => accepted(host)),
  } satisfies SessionGroupsRemote
  return {
    remote,
    controller: new SessionGroupsController(remote),
    setHost(next: SessionGroupsSnapshot) { host = next },
  }
}

describe('SessionGroupsController', () => {
  it('loads lazily, collapses concurrent reads, and preserves immutable publications', async () => {
    const b = bench()
    const deferred = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.snapshot = vi.fn(() => deferred.promise)
    const listener = vi.fn()
    const unsubscribe = b.controller.subscribe(listener)

    const first = b.controller.ensure()
    const loading = b.controller.getSnapshot()
    const second = b.controller.refresh()
    expect(loading).toBe(b.controller.getSnapshot())
    expect(loading).toEqual({ status: 'loading', snapshot: null, pending: false, error: null })
    expect(b.remote.snapshot).toHaveBeenCalledOnce()

    deferred.resolve(accepted(snapshot([group('work', 'Work')], 'revision-2')))
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(b.controller.getSnapshot()).toMatchObject({ status: 'ready', pending: false, error: null })
    expect(listener).toHaveBeenCalledTimes(2)

    await b.controller.ensure()
    expect(b.remote.snapshot).toHaveBeenCalledOnce()
    unsubscribe()
    await b.controller.refresh()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('contains throwing subscribers and continues notifying healthy subscribers', async () => {
    const b = bench()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.controller.subscribe(() => { throw new Error('subscriber exploded') })
    const healthy = vi.fn()
    b.controller.subscribe(healthy)

    await expect(b.controller.ensure()).resolves.toEqual({ ok: true })
    expect(healthy).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledTimes(2)
    report.mockRestore()
  })

  it('routes every mutation with the committed revision and installs Host results', async () => {
    const b = bench()
    await b.controller.ensure()

    const created = snapshot([
      group('work', 'Work', ['one']),
      group('play', 'Play', ['two']),
      group('ideas', 'Ideas'),
    ], 'revision-2')
    b.remote.create = vi.fn(async () => accepted(created))
    await expect(b.controller.create(' Ideas ')).resolves.toEqual({ ok: true })
    expect(b.remote.create).toHaveBeenCalledWith({ title: ' Ideas ', ifRevision: revision('revision-1') })
    expect(b.controller.getSnapshot().snapshot).toBe(created)

    const renamed = snapshot([
      group('work', 'Focused work', ['one']),
      group('play', 'Play', ['two']),
      group('ideas', 'Ideas'),
    ], 'revision-3')
    const renameGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.rename = vi.fn(() => renameGate.promise)
    const renaming = b.controller.rename(gid('work'), '  Focused work  ')
    await Promise.resolve()
    expect(b.controller.getSnapshot()).toMatchObject({ pending: true })
    expect(b.controller.getSnapshot().snapshot?.groups[0]?.title).toBe('Focused work')
    renameGate.resolve(accepted(renamed))
    await expect(renaming).resolves.toEqual({ ok: true })
    expect(b.remote.rename).toHaveBeenCalledWith({
      groupId: gid('work'), title: '  Focused work  ', ifRevision: revision('revision-2'),
    })

    const deleted = snapshot([group('work', 'Focused work', ['one']), group('ideas', 'Ideas')], 'revision-4')
    b.remote.delete = vi.fn(async () => accepted(deleted))
    await b.controller.delete(gid('play'))
    expect(b.remote.delete).toHaveBeenCalledWith({ groupId: gid('play'), ifRevision: revision('revision-3') })

    const reordered = snapshot([group('ideas', 'Ideas'), group('work', 'Focused work', ['one'])], 'revision-5')
    b.remote.insertGroupBefore = vi.fn(async () => accepted(reordered))
    await b.controller.insertGroupBefore(gid('ideas'), gid('work'))
    expect(b.remote.insertGroupBefore).toHaveBeenCalledWith({
      groupId: gid('ideas'), beforeGroupId: gid('work'), ifRevision: revision('revision-4'),
    })

    const moved = snapshot([group('ideas', 'Ideas', ['one']), group('work', 'Focused work')], 'revision-6')
    b.remote.moveSession = vi.fn(async () => accepted(moved))
    await b.controller.moveSession(sid('one'), gid('ideas'), null)
    expect(b.remote.moveSession).toHaveBeenCalledWith({
      sessionId: sid('one'), targetGroupId: gid('ideas'), beforeSessionId: null,
      ifRevision: revision('revision-5'),
    })

    const ungrouped = snapshot(
      [group('ideas', 'Ideas'), group('work', 'Focused work')],
      'revision-7',
      ['one'],
    )
    b.remote.moveSession = vi.fn(async () => accepted(ungrouped))
    await b.controller.moveSession(sid('one'), null, null)
    expect(b.controller.getSnapshot().snapshot).toBe(ungrouped)
  })

  it('optimistically orders the root and returns deleted-group members to it', async () => {
    const b = bench(snapshot(
      [group('work', 'Work', ['one', 'two']), group('play', 'Play', ['three'])],
      'r1',
      ['root'],
    ))
    await b.controller.ensure()

    const moveGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.moveSession = vi.fn(() => moveGate.promise)
    const moving = b.controller.moveSession(sid('two'), null, sid('root'))
    await Promise.resolve()
    expect(b.controller.getSnapshot().snapshot).toEqual(snapshot(
      [group('work', 'Work', ['one']), group('play', 'Play', ['three'])],
      'r1',
      ['two', 'root'],
    ))
    const moved = snapshot(
      [group('work', 'Work', ['one']), group('play', 'Play', ['three'])],
      'r2',
      ['two', 'root'],
    )
    moveGate.resolve(accepted(moved))
    await moving

    const deleteGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.delete = vi.fn(() => deleteGate.promise)
    const deleting = b.controller.delete(gid('play'))
    await Promise.resolve()
    expect(b.controller.getSnapshot().snapshot).toEqual(snapshot(
      [group('work', 'Work', ['one'])],
      'r2',
      ['two', 'root', 'three'],
    ))
    const deleted = snapshot([group('work', 'Work', ['one'])], 'r3', ['two', 'root', 'three'])
    deleteGate.resolve(accepted(deleted))
    await deleting
  })

  it('projects missing reorder targets as append/no-op without corrupting the optimistic view', async () => {
    const b = bench(snapshot([
      group('a', 'A', ['one', 'two']),
      group('b', 'B', ['three']),
    ]))
    await b.controller.ensure()

    const groupGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.insertGroupBefore = vi.fn(() => groupGate.promise)
    const moving = b.controller.insertGroupBefore(gid('a'), gid('missing'))
    await Promise.resolve()
    expect(b.controller.getSnapshot().snapshot?.groups.map(item => item.id)).toEqual([gid('b'), gid('a')])
    groupGate.resolve(accepted(snapshot([group('b', 'B', ['three']), group('a', 'A', ['one', 'two'])], 'r2')))
    await moving

    const missingGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.insertGroupBefore = vi.fn(() => missingGate.promise)
    const missing = b.controller.insertGroupBefore(gid('missing'), null)
    await Promise.resolve()
    expect(b.controller.getSnapshot().snapshot?.groups.map(item => item.id)).toEqual([gid('b'), gid('a')])
    missingGate.resolve(accepted(snapshot([group('b', 'B', ['three']), group('a', 'A', ['one', 'two'])], 'r3')))
    await missing

    const sessionGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.moveSession = vi.fn(() => sessionGate.promise)
    const session = b.controller.moveSession(sid('three'), gid('a'), sid('missing'))
    await Promise.resolve()
    expect(b.controller.getSnapshot().snapshot?.groups).toEqual([
      group('b', 'B'),
      group('a', 'A', ['one', 'two', 'three']),
    ])
    sessionGate.resolve(accepted(snapshot([group('b', 'B'), group('a', 'A', ['one', 'two', 'three'])], 'r4')))
    await session
  })

  it('rolls back business failures but reconciles revision conflicts to the authoritative state', async () => {
    const b = bench()
    await b.controller.ensure()
    const committed = b.controller.getSnapshot().snapshot

    b.remote.rename = vi.fn(async () => rejected({
      code: 'title-conflict', title: 'Play', existingGroupId: gid('play'),
    }) as never)
    await expect(b.controller.rename(gid('work'), 'Play')).resolves.toMatchObject({
      ok: false,
      error: { code: 'title-conflict' },
    })
    expect(b.controller.getSnapshot()).toMatchObject({ snapshot: committed, pending: false })

    const current = snapshot([group('other', 'Elsewhere')], 'revision-current')
    b.remote.delete = vi.fn(async () => rejected({ code: 'revision-conflict', current }) as never)
    await expect(b.controller.delete(gid('work'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision-conflict' },
    })
    expect(b.controller.getSnapshot()).toMatchObject({ snapshot: current, pending: false })
  })

  it('runs one queued authoritative refresh after a rejected mutation', async () => {
    const b = bench()
    await b.controller.ensure()
    const mutationGate = Promise.withResolvers<ReturnType<typeof rejected>>()
    b.remote.rename = vi.fn(() => mutationGate.promise as never)
    const mutation = b.controller.rename(gid('work'), 'Play')
    await Promise.resolve()

    const authoritative = snapshot([group('server', 'Server state')], 'server-revision')
    b.setHost(authoritative)
    const refresh = b.controller.refresh()
    expect(b.controller.refresh()).toBe(refresh)
    expect(b.remote.snapshot).toHaveBeenCalledOnce()

    mutationGate.resolve(rejected({
      code: 'title-conflict', title: 'Play', existingGroupId: gid('play'),
    }))
    await expect(mutation).resolves.toMatchObject({ ok: false, error: { code: 'title-conflict' } })
    await expect(refresh).resolves.toEqual({ ok: true })
    expect(b.remote.snapshot).toHaveBeenCalledTimes(2)
    expect(b.controller.getSnapshot()).toEqual({
      status: 'ready', snapshot: authoritative, pending: false, error: null,
    })
  })

  it('runs a queued authoritative refresh after an unknown mutation outcome', async () => {
    const b = bench()
    await b.controller.ensure()
    const mutationGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.delete = vi.fn(() => mutationGate.promise)
    const mutation = b.controller.delete(gid('work'))
    await Promise.resolve()

    const authoritative = snapshot([group('play', 'Play', ['two'])], 'server-revision')
    b.setHost(authoritative)
    const refresh = b.controller.refresh()
    mutationGate.reject('write outcome unknown')

    await expect(mutation).resolves.toMatchObject({
      ok: false, error: { code: 'transport', message: 'Session group mutation failed' },
    })
    await expect(refresh).resolves.toEqual({ ok: true })
    expect(b.remote.snapshot).toHaveBeenCalledTimes(2)
    expect(b.controller.getSnapshot()).toEqual({
      status: 'ready', snapshot: authoritative, pending: false, error: null,
    })
  })

  it('folds carrier and thrown read failures into retryable transport errors', async () => {
    const carried = bench()
    carried.remote.snapshot = vi.fn(async () => carrier('offline') as never)
    await expect(carried.controller.ensure()).resolves.toEqual({
      ok: false,
      error: { code: 'transport', message: 'gateway/internal: offline' },
    })
    expect(carried.controller.getSnapshot()).toMatchObject({ status: 'error', snapshot: null })

    carried.remote.snapshot = vi.fn(async () => accepted(snapshot()))
    await expect(carried.controller.ensure()).resolves.toEqual({ ok: true })

    const thrown = bench()
    thrown.remote.snapshot = vi.fn(async () => { throw new Error('network down') })
    await expect(thrown.controller.ensure()).resolves.toMatchObject({
      ok: false, error: { code: 'transport', message: 'network down' },
    })

    const unknown = bench()
    unknown.remote.snapshot = vi.fn(async () => { throw 'offline' })
    await expect(unknown.controller.ensure()).resolves.toMatchObject({
      ok: false, error: { message: 'Session group snapshot failed' },
    })
  })

  it('rolls back carrier and thrown mutation failures', async () => {
    const b = bench()
    await b.controller.ensure()
    const committed = b.controller.getSnapshot().snapshot

    b.remote.create = vi.fn(async () => carrier() as never)
    await expect(b.controller.create('New')).resolves.toEqual({
      ok: false,
      error: { code: 'transport', message: 'gateway/internal: socket closed' },
    })
    expect(b.controller.getSnapshot()).toMatchObject({
      snapshot: committed,
      pending: false,
      error: { code: 'transport', message: 'gateway/internal: socket closed' },
    })

    b.remote.create = vi.fn(async () => { throw new Error('write failed') })
    await expect(b.controller.create('New')).resolves.toMatchObject({
      ok: false, error: { code: 'transport', message: 'write failed' },
    })
    b.remote.create = vi.fn(async () => { throw 'unknown' })
    await expect(b.controller.create('New')).resolves.toMatchObject({
      ok: false, error: { message: 'Session group mutation failed' },
    })
  })

  it('queues refreshes, rejects overlapping mutations as busy, and rejects work after disposal', async () => {
    const b = bench()
    await b.controller.ensure()
    const gate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.rename = vi.fn(() => gate.promise)
    const mutation = b.controller.rename(gid('work'), 'Focused')
    await Promise.resolve()

    const refresh = b.controller.refresh()
    expect(b.controller.refresh()).toBe(refresh)
    await expect(b.controller.delete(gid('play'))).resolves.toMatchObject({ ok: false, error: { code: 'busy' } })
    gate.resolve(accepted(snapshot([group('work', 'Focused'), group('play', 'Play')], 'r2')))
    await mutation
    await expect(refresh).resolves.toEqual({ ok: true })
    expect(b.remote.snapshot).toHaveBeenCalledTimes(2)

    const listener = vi.fn()
    b.controller.subscribe(listener)
    b.controller.dispose()
    await expect(b.controller.ensure()).resolves.toEqual({ ok: true })
    await expect(b.controller.refresh()).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    await expect(b.controller.create('Nope')).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(listener).not.toHaveBeenCalled()
  })

  it('suppresses late read and mutation settlement after disposal', async () => {
    const loading = bench()
    const loadGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    loading.remote.snapshot = vi.fn(() => loadGate.promise)
    const read = loading.controller.ensure()
    loading.controller.dispose()
    loadGate.resolve(accepted(snapshot()))
    await expect(read).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })

    const rejectedRead = bench()
    const failedLoad = Promise.withResolvers<ReturnType<typeof accepted>>()
    rejectedRead.remote.snapshot = vi.fn(() => failedLoad.promise)
    const failed = rejectedRead.controller.ensure()
    rejectedRead.controller.dispose()
    failedLoad.reject(new Error('late read failure'))
    await expect(failed).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })

    const mutating = bench()
    await mutating.controller.ensure()
    const mutationGate = Promise.withResolvers<ReturnType<typeof accepted>>()
    mutating.remote.delete = vi.fn(() => mutationGate.promise)
    const mutation = mutating.controller.delete(gid('work'))
    await Promise.resolve()
    const queuedRefresh = mutating.controller.refresh()
    mutating.controller.dispose()
    await expect(queuedRefresh).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    mutationGate.resolve(accepted(snapshot()))
    await expect(mutation).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })

    const rejectedMutation = bench()
    await rejectedMutation.controller.ensure()
    const failedMutation = Promise.withResolvers<ReturnType<typeof accepted>>()
    rejectedMutation.remote.delete = vi.fn(() => failedMutation.promise)
    const write = rejectedMutation.controller.delete(gid('work'))
    await Promise.resolve()
    rejectedMutation.controller.dispose()
    failedMutation.reject(new Error('late write failure'))
    await expect(write).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
  })

  it('stops a mutation disposed while its seeding read is in flight', async () => {
    const b = bench()
    const gate = Promise.withResolvers<ReturnType<typeof accepted>>()
    b.remote.snapshot = vi.fn(() => gate.promise)
    const creating = b.controller.create('New')
    b.controller.dispose()
    gate.resolve(accepted(snapshot()))
    await expect(creating).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(b.remote.create).not.toHaveBeenCalled()
  })

  it('rechecks disposal and mutation admission after an already-ready seed yields', async () => {
    const disposed = bench()
    await disposed.controller.ensure()
    const creating = disposed.controller.create('New')
    disposed.controller.dispose()
    await expect(creating).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(disposed.remote.create).not.toHaveBeenCalled()

    const competing = bench()
    await competing.controller.ensure()
    const gate = Promise.withResolvers<ReturnType<typeof accepted>>()
    competing.remote.create = vi.fn(() => gate.promise)
    const first = competing.controller.create('First')
    const second = competing.controller.delete(gid('work'))
    await expect(second).resolves.toMatchObject({ ok: false, error: { code: 'busy' } })
    gate.resolve(accepted(snapshot([group('work', 'Work')], 'r2')))
    await expect(first).resolves.toEqual({ ok: true })
    expect(competing.remote.delete).not.toHaveBeenCalled()
  })
})
