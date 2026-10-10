/**
 * Host-owned manual layout for the Workspace registry's global pin set.
 * @module @umialpha/dsh-session-group-registry
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DomainChanged, DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  WorkspaceArchivedSessionPinError,
  WorkspaceUnknownSessionError,
  workspaceDomainState,
} from '@deepseek-ai/dsh-workspace'
import { sessionGroupsDomainSpec } from './spec.ts'
import type { SessionGroupsDomainState } from './spec.ts'
import type {
  SessionGroup,
  SessionGroupAnchorNotFound,
  SessionGroupId as SessionGroupIdBrand,
  SessionGroupNotFound,
  SessionGroupsCreateRequest,
  SessionGroupsCreateResult,
  SessionGroupsDeleteRequest,
  SessionGroupsDeleteResult,
  SessionGroupsFailure,
  SessionGroupsInsertGroupBeforeRequest,
  SessionGroupsInsertGroupBeforeResult,
  SessionGroupsMoveSessionRequest,
  SessionGroupsMoveSessionResult,
  SessionGroupsRejected,
  SessionGroupsRenameRequest,
  SessionGroupsRenameResult,
  SessionGroupsRevision as SessionGroupsRevisionBrand,
  SessionGroupsRevisionConflict,
  SessionGroupsSnapshot,
  SessionGroupsSnapshotRequest,
  SessionGroupsSnapshotResult,
  SessionGroupsSuccess,
} from './types.ts'

export type * from './types.ts'
export {
  SESSION_GROUPS_INITIAL_REVISION,
  sessionGroupIdSchema,
  sessionGroupSchema,
  sessionGroupsDomainSpec,
  sessionGroupsRevisionSchema,
  sessionGroupsStateSchema,
} from './spec.ts'
export type { SessionGroupsDomainState } from './spec.ts'

/** Required deployment policy for group titles. */
export interface Config {
  /** Maximum UTF-8 byte length of a trimmed title. */
  readonly maxTitleBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionGroupRegistry: SessionGroupRegistry
  }
}

/** Lifecycle rejection from a registry that has not opened or has stopped accepting work. */
export class SessionGroupRegistryLifecycleError extends Error {
  /** @param code - Stable lifecycle state for programmatic handling. */
  constructor(readonly code: 'not-initialized' | 'disposing') {
    super(code === 'not-initialized'
      ? 'session-group-registry: durable domain is not initialized'
      : 'session-group-registry: service is disposing')
    this.name = 'SessionGroupRegistryLifecycleError'
  }
}

/**
 * Brand one raw value as a Session group identity.
 * @param value - Raw identity value.
 * @returns the branded Session group identity.
 */
export function SessionGroupId(value: string): SessionGroupIdBrand {
  return value as SessionGroupIdBrand
}

/**
 * Brand one raw value as a registry revision.
 * @param value - Raw revision value.
 * @returns the branded registry revision.
 */
export function SessionGroupsRevision(value: string): SessionGroupsRevisionBrand {
  return value as SessionGroupsRevisionBrand
}

interface SessionGroupsLayout {
  readonly defaultSessionIds: readonly SessionId[]
  readonly groups: readonly SessionGroup[]
}

/** Validate the required deployment title limit. */
function resolveMaxTitleBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `session-group-registry: maxTitleBytes must be a positive safe integer, got ${String(value)}`,
    )
  }
  return value
}

/** Copy and freeze one group before it crosses the service boundary. */
function snapshotGroup(group: SessionGroup): SessionGroup {
  return Object.freeze({
    id: group.id,
    title: group.title,
    sessionIds: Object.freeze([...group.sessionIds]),
  })
}

/** Copy and recursively freeze one complete registry state. */
function immutableSnapshot(state: SessionGroupsDomainState): SessionGroupsSnapshot {
  return Object.freeze({
    revision: state.revision,
    defaultSessionIds: Object.freeze([...state.defaultSessionIds]),
    groups: Object.freeze(state.groups.map(snapshotGroup)),
  })
}

/** Build a frozen success branch. */
function success<T>(value: T): SessionGroupsSuccess<T> {
  return Object.freeze({ ok: true, value })
}

/** Build a frozen business-failure branch. */
function rejected<E extends SessionGroupsFailure>(error: E): SessionGroupsRejected<E> {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Whether two id arrays have the same members in the same order. */
function sameIds<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** Whether two group arrays differ only by object identity. */
function sameGroups(left: readonly SessionGroup[], right: readonly SessionGroup[]): boolean {
  return left.length === right.length && left.every((group, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && group.id === candidate.id
      && group.title === candidate.title
      && sameIds(group.sessionIds, candidate.sessionIds)
  })
}

/** Whether a layout replacement would be material. */
function sameLayout(state: SessionGroupsDomainState, layout: SessionGroupsLayout): boolean {
  return sameIds(state.defaultSessionIds, layout.defaultSessionIds)
    && sameGroups(state.groups, layout.groups)
}

/**
 * Project one layout onto an authoritative pin snapshot. Existing manual
 * positions survive, while newly pinned Sessions append in native pin order.
 */
function reconcileLayout(
  state: SessionGroupsDomainState,
  pinnedSessionIds: readonly SessionId[],
): SessionGroupsLayout {
  const pinned = new Set(pinnedSessionIds)
  const defaultSessionIds = state.defaultSessionIds.filter(sessionId => pinned.has(sessionId))
  const groups = state.groups.map((group) => {
    const sessionIds = group.sessionIds.filter(sessionId => pinned.has(sessionId))
    return sessionIds.length === group.sessionIds.length ? group : { ...group, sessionIds }
  })
  const assigned = new Set<SessionId>([
    ...defaultSessionIds,
    ...groups.flatMap(group => group.sessionIds),
  ])
  for (const sessionId of pinnedSessionIds) {
    if (assigned.has(sessionId)) continue
    assigned.add(sessionId)
    defaultSessionIds.push(sessionId)
  }
  return { defaultSessionIds, groups }
}

/** Generate a UUID group id absent from the current state. */
function nextGroupId(state: SessionGroupsDomainState): SessionGroupIdBrand {
  let candidate: SessionGroupIdBrand
  do candidate = SessionGroupId(randomUUID())
  while (state.groups.some(group => group.id === candidate))
  return candidate
}

/** Generate an opaque UUID distinct from the current revision. */
function nextRevision(current: SessionGroupsRevisionBrand): SessionGroupsRevisionBrand {
  let candidate: SessionGroupsRevisionBrand
  do candidate = SessionGroupsRevision(randomUUID())
  while (candidate === current)
  return candidate
}

/** Validated title or a stable input failure. */
type ResolvedTitle =
  | SessionGroupsSuccess<string>
  | SessionGroupsRejected<
    Extract<SessionGroupsFailure, { readonly code: 'title-blank' | 'title-too-large' }>
  >

/**
 * Global layout sidecar for natively pinned Sessions. The Workspace registry
 * alone owns pin membership; this service stores only manual placement.
 */
export class SessionGroupRegistry extends TypertRemoteService {
  static inject = ['storageDomain', 'workspaceRegistry']

  /** Loader validation for the required title-size policy. */
  static Config: s<Config> = s.object({
    maxTitleBytes: s.number().step(1).min(1).required(),
  })

  private readonly maxTitleBytes: number
  private global?: DomainGlobal<SessionGroupsDomainState>
  private mutationTail: Promise<void> = Promise.resolve()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context carrying Workspace pins and storage-domain.
   * @param config - Required title-size policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionGroupRegistry', { namespace: 'sessionGroups' })
    this.maxTitleBytes = resolveMaxTitleBytes(config.maxTitleBytes)
  }

  /** Open the sidecar, observe Workspace pin commits, and reconcile startup state. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sessionGroupsDomainSpec)
    this.global = domain.global
    const stopWorkspaceObservation = this.ctx.on('domain/changed', (change: DomainChanged) => {
      this.workspaceChanged(change)
    })
    this.ctx.effect(() => async () => {
      stopWorkspaceObservation()
      this.mutationAdmissionOpen = false
      await this.mutationTail
      await domain.close()
    }, 'session-group-registry.domainClose')
    await this.enqueueReconciliation(this.capturePinnedSessionIds())
  }

  /**
   * Read a complete immutable layout reconciled with the pin set captured at
   * this request's mutation-queue position.
   * @param _request - Empty Remote request.
   * @returns the reconciled snapshot after any required durable repair.
   */
  @Remote('snapshot')
  snapshot(_request: SessionGroupsSnapshotRequest): Promise<SessionGroupsSnapshotResult> {
    return this.enqueueReconciled(state => success(immutableSnapshot(state)))
  }

  /**
   * Append one uniquely titled empty group.
   * @param request - Desired title and observed registry revision.
   * @returns the committed snapshot or an explicit business failure.
   */
  @Remote('create')
  create(request: SessionGroupsCreateRequest): Promise<SessionGroupsCreateResult> {
    return this.enqueueReconciled(async (state) => {
      const conflict = this.revisionConflict(state, request.ifRevision)
      if (conflict !== undefined) return conflict
      const title = this.resolveTitle(request.title)
      if (!title.ok) return title
      const duplicate = state.groups.find(group => group.title === title.value)
      if (duplicate !== undefined) {
        return rejected({
          code: 'title-conflict',
          title: title.value,
          existingGroupId: duplicate.id,
        })
      }
      return await this.commit(state, {
        defaultSessionIds: state.defaultSessionIds,
        groups: [
          ...state.groups,
          { id: nextGroupId(state), title: title.value, sessionIds: [] },
        ],
      })
    })
  }

  /**
   * Rename one group. A request that resolves to its current title succeeds
   * without replacing the revision.
   * @param request - Group, desired title, and observed registry revision.
   * @returns the current or committed snapshot, or an explicit failure.
   */
  @Remote('rename')
  rename(request: SessionGroupsRenameRequest): Promise<SessionGroupsRenameResult> {
    return this.enqueueReconciled(async (state) => {
      const conflict = this.revisionConflict(state, request.ifRevision)
      if (conflict !== undefined) return conflict
      const title = this.resolveTitle(request.title)
      if (!title.ok) return title
      const target = state.groups.find(group => group.id === request.groupId)
      if (target === undefined) return rejected(this.groupNotFound(request.groupId))
      const duplicate = state.groups.find(
        group => group.id !== request.groupId && group.title === title.value,
      )
      if (duplicate !== undefined) {
        return rejected({
          code: 'title-conflict',
          title: title.value,
          existingGroupId: duplicate.id,
        })
      }
      if (target.title === title.value) return success(immutableSnapshot(state))
      return await this.commit(state, {
        defaultSessionIds: state.defaultSessionIds,
        groups: state.groups.map(group => group.id === request.groupId
          ? { ...group, title: title.value }
          : group),
      })
    })
  }

  /**
   * Delete one group and append its members to the default level without
   * changing native pin membership.
   * @param request - Group and observed registry revision.
   * @returns the committed snapshot or an explicit failure.
   */
  @Remote('delete')
  delete(request: SessionGroupsDeleteRequest): Promise<SessionGroupsDeleteResult> {
    return this.enqueueReconciled(async (state) => {
      const conflict = this.revisionConflict(state, request.ifRevision)
      if (conflict !== undefined) return conflict
      const target = state.groups.find(group => group.id === request.groupId)
      if (target === undefined) return rejected(this.groupNotFound(request.groupId))
      return await this.commit(state, {
        defaultSessionIds: [...state.defaultSessionIds, ...target.sessionIds],
        groups: state.groups.filter(group => group.id !== request.groupId),
      })
    })
  }

  /**
   * Move one group using DOM `insertBefore` ordering. `null` appends, and
   * moving a group before itself is a no-op.
   * @param request - Source group, nullable anchor, and observed revision.
   * @returns the current or committed snapshot, or an explicit failure.
   */
  @Remote('insertGroupBefore')
  insertGroupBefore(
    request: SessionGroupsInsertGroupBeforeRequest,
  ): Promise<SessionGroupsInsertGroupBeforeResult> {
    return this.enqueueReconciled(async (state) => {
      const conflict = this.revisionConflict(state, request.ifRevision)
      if (conflict !== undefined) return conflict
      if (!state.groups.some(group => group.id === request.groupId)) {
        return rejected(this.groupNotFound(request.groupId))
      }
      if (request.beforeGroupId !== null
        && !state.groups.some(group => group.id === request.beforeGroupId)) {
        return rejected(this.groupNotFound(request.beforeGroupId))
      }
      if (request.beforeGroupId === request.groupId) {
        return success(immutableSnapshot(state))
      }

      const moving = state.groups.find(group => group.id === request.groupId)
      /* v8 ignore next -- source existence was checked above. */
      if (moving === undefined) throw new Error('session-group-registry: checked group disappeared')
      const without = state.groups.filter(group => group.id !== request.groupId)
      const at = request.beforeGroupId === null
        ? without.length
        : without.findIndex(group => group.id === request.beforeGroupId)
      const groups = [...without.slice(0, at), moving, ...without.slice(at)]
      if (sameGroups(groups, state.groups)) return success(immutableSnapshot(state))
      return await this.commit(state, { defaultSessionIds: state.defaultSessionIds, groups })
    })
  }

  /**
   * Pin one Session idempotently, then place it using DOM `insertBefore`
   * ordering. A failed pin changes neither system. If a newly committed pin
   * is followed by a revision, validation, or sidecar-write failure, the
   * authoritative projection treats it as default and queued reconciliation
   * retries persistence. An already pinned Session retains its prior layout.
   * @param request - Session, nullable destination and anchor, and observed revision.
   * @returns the current or committed snapshot, or an explicit failure.
   */
  @Remote('moveSession')
  moveSession(request: SessionGroupsMoveSessionRequest): Promise<SessionGroupsMoveSessionResult> {
    return this.enqueueMutation(async () => {
      this.requireGlobal()
      const state = await this.reconcileStored(this.capturePinnedSessionIds())

      try {
        await this.ctx.workspaceRegistry.pinSession(request.sessionId)
      } catch (error: unknown) {
        if (error instanceof WorkspaceUnknownSessionError) {
          return rejected({ code: 'session-not-found', sessionId: request.sessionId })
        }
        if (error instanceof WorkspaceArchivedSessionPinError) {
          return rejected({ code: 'session-archived', sessionId: request.sessionId })
        }
        throw error
      }

      const conflict = this.revisionConflict(state, request.ifRevision)
      if (conflict !== undefined) return conflict

      const base = reconcileLayout(state, this.capturePinnedSessionIds())
      const target = request.targetGroupId === null
        ? undefined
        : base.groups.find(group => group.id === request.targetGroupId)
      if (request.targetGroupId !== null && target === undefined) {
        return rejected(this.groupNotFound(request.targetGroupId))
      }
      const destinationSessionIds = target?.sessionIds ?? base.defaultSessionIds
      if (request.beforeSessionId === request.sessionId
        && destinationSessionIds.includes(request.sessionId)) {
        if (sameLayout(state, base)) return success(immutableSnapshot(state))
        return await this.commit(state, base)
      }
      if (request.beforeSessionId !== null
        && !destinationSessionIds.includes(request.beforeSessionId)) {
        return rejected(this.anchorNotFound(
          request.targetGroupId,
          request.beforeSessionId,
        ))
      }

      const withoutDefault = base.defaultSessionIds.filter(
        sessionId => sessionId !== request.sessionId,
      )
      const groupsWithout = base.groups.map((group) => {
        const sessionIds = group.sessionIds.filter(sessionId => sessionId !== request.sessionId)
        return sessionIds.length === group.sessionIds.length ? group : { ...group, sessionIds }
      })
      let defaultSessionIds = withoutDefault
      let groups = groupsWithout
      if (request.targetGroupId === null) {
        const at = request.beforeSessionId === null || request.beforeSessionId === request.sessionId
          ? withoutDefault.length
          : withoutDefault.indexOf(request.beforeSessionId)
        defaultSessionIds = [
          ...withoutDefault.slice(0, at),
          request.sessionId,
          ...withoutDefault.slice(at),
        ]
      } else {
        groups = groupsWithout.map((group) => {
          if (group.id !== request.targetGroupId) return group
          const at = request.beforeSessionId === null || request.beforeSessionId === request.sessionId
            ? group.sessionIds.length
            : group.sessionIds.indexOf(request.beforeSessionId)
          return {
            ...group,
            sessionIds: [
              ...group.sessionIds.slice(0, at),
              request.sessionId,
              ...group.sessionIds.slice(at),
            ],
          }
        })
      }
      const layout = { defaultSessionIds, groups }
      if (sameLayout(state, layout)) return success(immutableSnapshot(state))
      return await this.commit(state, layout)
    })
  }

  /** Normalize and bound one caller-supplied title. */
  private resolveTitle(raw: string): ResolvedTitle {
    const title = raw.trim()
    if (title.length === 0) return rejected({ code: 'title-blank' })
    const actualBytes = Buffer.byteLength(title, 'utf8')
    if (actualBytes > this.maxTitleBytes) {
      return rejected({ code: 'title-too-large', maxBytes: this.maxTitleBytes, actualBytes })
    }
    return success(title)
  }

  /** Return a conflict carrying the exact state that defeated the request. */
  private revisionConflict(
    state: SessionGroupsDomainState,
    observed: SessionGroupsRevisionBrand,
  ): SessionGroupsRejected<SessionGroupsRevisionConflict> | undefined {
    return state.revision === observed
      ? undefined
      : rejected({ code: 'revision-conflict', current: immutableSnapshot(state) })
  }

  /** Construct one group lookup failure. */
  private groupNotFound(groupId: SessionGroupIdBrand): SessionGroupNotFound {
    return { code: 'group-not-found', groupId }
  }

  /** Construct one destination anchor failure. */
  private anchorNotFound(
    targetGroupId: SessionGroupIdBrand | null,
    beforeSessionId: SessionId,
  ): SessionGroupAnchorNotFound {
    return { code: 'session-anchor-not-found', targetGroupId, beforeSessionId }
  }

  /** Capture the complete native pin list at one synchronous linearization point. */
  private capturePinnedSessionIds(): readonly SessionId[] {
    return [...this.ctx.workspaceRegistry.pinnedSessionIds]
  }

  /** Queue one ordinary request after reconciling pins captured in its queue slot. */
  private enqueueReconciled<T>(
    operation: (state: SessionGroupsDomainState) => Promise<T> | T,
  ): Promise<T> {
    return this.enqueueMutation(async () => {
      this.requireGlobal()
      const state = await this.reconcileStored(this.capturePinnedSessionIds())
      return await operation(state)
    })
  }

  /** Queue one Workspace-event snapshot without consulting later Workspace state. */
  private enqueueReconciliation(pinnedSessionIds: readonly SessionId[]): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.reconcileStored(pinnedSessionIds)
    })
  }

  /** Reconcile one captured pin set and durably replace material layout changes. */
  private async reconcileStored(
    pinnedSessionIds: readonly SessionId[],
  ): Promise<SessionGroupsDomainState> {
    const state = this.requireGlobal().get()
    const layout = reconcileLayout(state, pinnedSessionIds)
    return sameLayout(state, layout) ? state : await this.persist(state, layout)
  }

  /** Persist one material layout and return its immutable success wrapper. */
  private async commit(
    current: SessionGroupsDomainState,
    layout: SessionGroupsLayout,
  ): Promise<SessionGroupsSuccess<SessionGroupsSnapshot>> {
    const next = await this.persist(current, layout)
    return success(immutableSnapshot(next))
  }

  /** Persist one material whole-state replacement. */
  private async persist(
    current: SessionGroupsDomainState,
    layout: SessionGroupsLayout,
  ): Promise<SessionGroupsDomainState> {
    const next: SessionGroupsDomainState = {
      revision: nextRevision(current.revision),
      defaultSessionIds: [...layout.defaultSessionIds],
      groups: layout.groups.map(group => ({
        id: group.id,
        title: group.title,
        sessionIds: [...group.sessionIds],
      })),
    }
    await this.requireGlobal().set(next)
    return next
  }

  /** Capture and enqueue one committed Workspace pin snapshot in event order. */
  private workspaceChanged(change: DomainChanged): void {
    if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return
    const state = workspaceDomainState.parse(change.value)
    const pinnedSessionIds = [...state.pinnedSessionIds]
    void this.enqueueReconciliation(pinnedSessionIds).catch((error: unknown) => {
      this.ctx.logger.warn(
        'session-group-registry: failed to reconcile committed Workspace pins; '
        + `the next registry request will retry: ${String(error)}`,
      )
    })
  }

  /** Queue a complete compare/read/write operation behind prior mutations. */
  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) {
      return Promise.reject(new SessionGroupRegistryLifecycleError('disposing'))
    }
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Resolve the initialized global state handle. */
  private requireGlobal(): DomainGlobal<SessionGroupsDomainState> {
    if (this.global === undefined) {
      throw new SessionGroupRegistryLifecycleError('not-initialized')
    }
    return this.global
  }
}

export default SessionGroupRegistry
