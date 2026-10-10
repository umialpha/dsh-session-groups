/** Browser object layer for the global Pinned Session layout registry. */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SessionGroup, SessionGroupId, SessionGroupsFailure, SessionGroupsSnapshot,
} from '@umialpha/dsh-session-group-registry/types'

/** Generated Remote namespace consumed by this plugin. */
export type SessionGroupsRemote = ClientRemote['sessionGroups']

/** Client-only failures added around Host business results. */
export type SessionGroupsClientFailure =
  | SessionGroupsFailure
  | { readonly code: 'transport'; readonly message: string }
  | { readonly code: 'busy'; readonly message: string }
  | { readonly code: 'disposed'; readonly message: string }

/** Settled result returned to UI actions. */
export type SessionGroupsActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SessionGroupsClientFailure }

type SessionGroupsMutationResult =
  | { readonly ok: true; readonly value: SessionGroupsSnapshot }
  | { readonly ok: false; readonly error: SessionGroupsFailure }

/** Immutable controller state published through the framework hook seat. */
export interface SessionGroupsView {
  readonly status: 'cold' | 'loading' | 'ready' | 'error'
  readonly snapshot: SessionGroupsSnapshot | null
  readonly pending: boolean
  /** Last load or mutation failure; a successful operation clears it. */
  readonly error: SessionGroupsClientFailure | null
}

const INITIAL_VIEW: SessionGroupsView = Object.freeze({
  status: 'cold',
  snapshot: null,
  pending: false,
  error: null,
})

const OK: SessionGroupsActionResult = Object.freeze({ ok: true })
const BUSY: SessionGroupsActionResult = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'busy', message: 'another Session group change is pending' }),
})
const DISPOSED: SessionGroupsActionResult = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'Session groups controller is disposed' }),
})

/** Convert a carrier rejection into the controller's visible failure form. */
function carrierFailure(error: { readonly code: string; readonly message: string }): SessionGroupsClientFailure {
  return { code: 'transport', message: `${error.code}: ${error.message}` }
}

/** Move an array member with DOM `insertBefore` semantics. */
function insertBefore<T>(items: readonly T[], item: T, before: T | null): T[] {
  const next = items.filter(candidate => candidate !== item)
  const index = before === null ? next.length : next.indexOf(before)
  next.splice(index < 0 ? next.length : index, 0, item)
  return next
}

/** Replace one group's fields without changing sibling identity. */
function replaceGroup(
  snapshot: SessionGroupsSnapshot,
  id: SessionGroupId,
  update: (group: SessionGroup) => SessionGroup,
): SessionGroupsSnapshot {
  return {
    ...snapshot,
    groups: snapshot.groups.map(group => group.id === id ? update(group) : group),
  }
}

/** Root-scoped controller for the Host-owned Pinned Session layout registry. */
export class SessionGroupsController implements HostObservable<SessionGroupsView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private loadPromise: Promise<SessionGroupsActionResult> | null = null
  private queuedRefresh: {
    readonly promise: Promise<SessionGroupsActionResult>
    readonly resolve: (result: SessionGroupsActionResult) => void
  } | null = null
  private mutationPending = false
  private disposed = false

  /** @param remote - generated `sessionGroups` Remote namespace. */
  constructor(private readonly remote: SessionGroupsRemote) {}

  /** Return the cached immutable view. */
  getSnapshot = (): SessionGroupsView => this.view

  /** Subscribe to immutable view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load the registry once, retrying after a failed read.
   * @returns the settled load result.
   */
  ensure(): Promise<SessionGroupsActionResult> {
    if (this.view.status === 'ready') return Promise.resolve(OK)
    return this.refresh()
  }

  /**
   * Replace local state from the authoritative Host snapshot.
   * @returns the settled refresh result.
   */
  refresh(): Promise<SessionGroupsActionResult> {
    if (this.disposed) return Promise.resolve(DISPOSED)
    if (this.mutationPending) return this.queueRefresh()
    if (this.loadPromise !== null) return this.loadPromise
    this.publish({ ...this.view, status: 'loading', error: null })
    const pending = this.load()
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }

  /**
   * Create a named group at the end of the group list.
   * @param title - User-entered group title.
   * @returns the settled mutation result.
   */
  create(title: string): Promise<SessionGroupsActionResult> {
    return this.mutate(
      snapshot => snapshot,
      snapshot => this.remote.create({ title, ifRevision: snapshot.revision }),
    )
  }

  /**
   * Rename one named group optimistically.
   * @param groupId - Group to rename.
   * @param title - User-entered replacement title.
   * @returns the settled mutation result.
   */
  rename(groupId: SessionGroupId, title: string): Promise<SessionGroupsActionResult> {
    return this.mutate(
      snapshot => replaceGroup(snapshot, groupId, group => ({ ...group, title: title.trim() })),
      snapshot => this.remote.rename({ groupId, title, ifRevision: snapshot.revision }),
    )
  }

  /**
   * Delete one group optimistically and append its still-pinned Sessions to the root.
   * @param groupId - Group to delete.
   * @returns the settled mutation result.
   */
  delete(groupId: SessionGroupId): Promise<SessionGroupsActionResult> {
    return this.mutate(
      (snapshot) => {
        const removed = snapshot.groups.find(group => group.id === groupId)
        if (removed === undefined) return snapshot
        return {
          ...snapshot,
          defaultSessionIds: [...snapshot.defaultSessionIds, ...removed.sessionIds],
          groups: snapshot.groups.filter(group => group.id !== groupId),
        }
      },
      snapshot => this.remote.delete({ groupId, ifRevision: snapshot.revision }),
    )
  }

  /**
   * Reorder one named group optimistically.
   * @param groupId - Group to move.
   * @param beforeGroupId - Destination anchor, or `null` to append.
   * @returns the settled mutation result.
   */
  insertGroupBefore(
    groupId: SessionGroupId,
    beforeGroupId: SessionGroupId | null,
  ): Promise<SessionGroupsActionResult> {
    return this.mutate(
      (snapshot) => {
        const group = snapshot.groups.find(candidate => candidate.id === groupId)
        if (group === undefined) return snapshot
        return { ...snapshot, groups: insertBefore(snapshot.groups, group, snapshot.groups.find(g => g.id === beforeGroupId) ?? null) }
      },
      snapshot => this.remote.insertGroupBefore({ groupId, beforeGroupId, ifRevision: snapshot.revision }),
    )
  }

  /**
   * Move one Session across the root and named groups.
   * @param sessionId - Session to move.
   * @param targetGroupId - Destination group, or `null` for the Pinned root.
   * @param beforeSessionId - Destination anchor in that list, or `null` to append.
   * @returns the settled mutation result.
   */
  moveSession(
    sessionId: SessionId,
    targetGroupId: SessionGroupId | null,
    beforeSessionId: SessionId | null,
  ): Promise<SessionGroupsActionResult> {
    return this.mutate(
      (snapshot) => {
        const defaultSessionIds = snapshot.defaultSessionIds.filter(id => id !== sessionId)
        const withoutSession = snapshot.groups.map(group => ({
          ...group,
          sessionIds: group.sessionIds.filter(id => id !== sessionId),
        }))
        if (targetGroupId === null) {
          return {
            ...snapshot,
            defaultSessionIds: insertBefore(defaultSessionIds, sessionId, beforeSessionId),
            groups: withoutSession,
          }
        }
        return {
          ...snapshot,
          defaultSessionIds,
          groups: withoutSession.map(group => group.id !== targetGroupId
            ? group
            : { ...group, sessionIds: insertBefore(group.sessionIds, sessionId, beforeSessionId) }),
        }
      },
      snapshot => this.remote.moveSession({
        sessionId,
        targetGroupId,
        beforeSessionId,
        ifRevision: snapshot.revision,
      }),
    )
  }

  /** Stop publishing and reject future work after plugin unload. */
  dispose(): void {
    this.disposed = true
    this.queuedRefresh?.resolve(DISPOSED)
    this.queuedRefresh = null
    this.listeners.clear()
  }

  /** Execute the first authoritative registry read. */
  private async load(): Promise<SessionGroupsActionResult> {
    try {
      const carried = await this.remote.snapshot({})
      if (this.disposed) return DISPOSED
      if (!carried.ok) {
        const error = carrierFailure(carried.error)
        this.publish({ status: 'error', snapshot: this.view.snapshot, pending: false, error })
        return { ok: false, error }
      }
      this.publish({ status: 'ready', snapshot: carried.value.value, pending: false, error: null })
      return OK
    } catch (reason) {
      if (this.disposed) return DISPOSED
      const error: SessionGroupsClientFailure = {
        code: 'transport',
        message: reason instanceof Error ? reason.message : 'Session group snapshot failed',
      }
      this.publish({ status: 'error', snapshot: this.view.snapshot, pending: false, error })
      return { ok: false, error }
    }
  }

  /** Apply one optimistic projection and replace it with the settled Host snapshot. */
  private async mutate(
    project: (snapshot: SessionGroupsSnapshot) => SessionGroupsSnapshot,
    invoke: (snapshot: SessionGroupsSnapshot) => Promise<RemoteResult<SessionGroupsMutationResult>>,
  ): Promise<SessionGroupsActionResult> {
    if (this.disposed) return DISPOSED
    if (this.mutationPending) return BUSY
    const seeded = await this.ensure()
    if (!seeded.ok) return seeded
    // Plugin disposal can run while ensure() is awaited.
    if (this.isDisposed()) return DISPOSED
    // Another mutation can claim the loaded snapshot while ensure() is awaited.
    if (this.hasPendingMutation()) return BUSY
    const committed = this.view.snapshot
    /* v8 ignore next -- ready state is published only with a snapshot. */
    if (committed === null) return { ok: false, error: { code: 'transport', message: 'Session groups snapshot is unavailable' } }

    this.mutationPending = true
    this.publish({ status: 'ready', snapshot: project(committed), pending: true, error: null })
    try {
      const carried = await invoke(committed)
      // Plugin disposal can run while the Remote mutation is awaited.
      if (this.isDisposed()) return DISPOSED
      if (!carried.ok) {
        const error = carrierFailure(carried.error)
        this.publish({ status: 'ready', snapshot: committed, pending: false, error })
        return { ok: false, error }
      }
      const result = carried.value
      if (result.ok) {
        this.publish({ status: 'ready', snapshot: result.value, pending: false, error: null })
        return OK
      }
      if (result.error.code === 'revision-conflict') {
        this.publish({ status: 'ready', snapshot: result.error.current, pending: false, error: result.error })
      } else {
        this.publish({ status: 'ready', snapshot: committed, pending: false, error: result.error })
      }
      return { ok: false, error: result.error }
    } catch (reason) {
      // Plugin disposal can run while the Remote mutation is awaited.
      if (this.isDisposed()) return DISPOSED
      const error: SessionGroupsClientFailure = {
        code: 'transport',
        message: reason instanceof Error ? reason.message : 'Session group mutation failed',
      }
      this.publish({ status: 'ready', snapshot: committed, pending: false, error })
      return { ok: false, error }
    } finally {
      this.mutationPending = false
      this.flushQueuedRefresh()
    }
  }

  /** Collapse refresh requests received during a mutation into one later read. */
  private queueRefresh(): Promise<SessionGroupsActionResult> {
    if (this.queuedRefresh !== null) return this.queuedRefresh.promise
    const queued = Promise.withResolvers<SessionGroupsActionResult>()
    this.queuedRefresh = { promise: queued.promise, resolve: queued.resolve }
    return queued.promise
  }

  /** Start the authoritative read requested while the mutation was pending. */
  private flushQueuedRefresh(): void {
    const queued = this.queuedRefresh
    if (queued === null) return
    this.queuedRefresh = null
    void this.refresh().then(queued.resolve)
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private hasPendingMutation(): boolean {
    return this.mutationPending
  }

  /** Publish one immutable view and contain subscriber failures. */
  private publish(view: SessionGroupsView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-session-groups] subscriber threw:', error)
      }
    }
  }
}
