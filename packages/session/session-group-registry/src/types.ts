/**
 * Wire-safe types for the global Session grouping registry.
 * @module @umialpha/dsh-session-group-registry/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one user-defined Session group. */
export type SessionGroupId = Branded<'SessionGroupId'>

/** Equality-only token for one exact registry state. */
export type SessionGroupsRevision = Branded<'SessionGroupsRevision'>

/** One named group and its manually ordered Session membership. */
export interface SessionGroup {
  /** Stable UUID assigned by the Host. */
  readonly id: SessionGroupId
  /** Trimmed, registry-unique display title. */
  readonly title: string
  /** Session ids in manual display order. */
  readonly sessionIds: readonly SessionId[]
}

/** Complete committed registry state in manual group order. */
export interface SessionGroupsSnapshot {
  /** Opaque token replaced by every material mutation. */
  readonly revision: SessionGroupsRevision
  /** Pinned Sessions outside named groups, in manual display order. */
  readonly defaultSessionIds: readonly SessionId[]
  /** User-defined groups in manual display order. */
  readonly groups: readonly SessionGroup[]
}

/** Empty request used to read the global registry. */
export type SessionGroupsSnapshotRequest = Readonly<Record<string, never>>

/** Create one group at the end of the manual group order. */
export interface SessionGroupsCreateRequest {
  /** Human-entered title; the Host trims it before validation and storage. */
  readonly title: string
  /** Revision observed by the caller. */
  readonly ifRevision: SessionGroupsRevision
}

/** Rename one existing group without changing its order or members. */
export interface SessionGroupsRenameRequest {
  /** Group to rename. */
  readonly groupId: SessionGroupId
  /** Human-entered title; the Host trims it before validation and storage. */
  readonly title: string
  /** Revision observed by the caller. */
  readonly ifRevision: SessionGroupsRevision
}

/** Delete one group while retaining every Session. */
export interface SessionGroupsDeleteRequest {
  /** Group to remove. */
  readonly groupId: SessionGroupId
  /** Revision observed by the caller. */
  readonly ifRevision: SessionGroupsRevision
}

/** Move one group using DOM `insertBefore` ordering. */
export interface SessionGroupsInsertGroupBeforeRequest {
  /** Existing group to move. */
  readonly groupId: SessionGroupId
  /** Existing anchor, or `null` to append. */
  readonly beforeGroupId: SessionGroupId | null
  /** Revision observed by the caller. */
  readonly ifRevision: SessionGroupsRevision
}

/** Move one Session into or within the default level or one named group. */
export interface SessionGroupsMoveSessionRequest {
  /** Session to pin idempotently and move. */
  readonly sessionId: SessionId
  /** Destination group, or `null` for the directly rendered default level. */
  readonly targetGroupId: SessionGroupId | null
  /** Session anchor in the destination level, or `null` to append. */
  readonly beforeSessionId: SessionId | null
  /** Revision observed by the caller. */
  readonly ifRevision: SessionGroupsRevision
}

/** The caller mutated an obsolete registry revision. */
export interface SessionGroupsRevisionConflict {
  readonly code: 'revision-conflict'
  /** Authoritative immutable state for immediate reconciliation. */
  readonly current: SessionGroupsSnapshot
}

/** A supplied title is empty after trimming. */
export interface SessionGroupTitleBlank {
  readonly code: 'title-blank'
}

/** A trimmed title exceeds the configured UTF-8 byte limit. */
export interface SessionGroupTitleTooLarge {
  readonly code: 'title-too-large'
  readonly maxBytes: number
  readonly actualBytes: number
}

/** Another group already owns the normalized title. */
export interface SessionGroupTitleConflict {
  readonly code: 'title-conflict'
  readonly title: string
  readonly existingGroupId: SessionGroupId
}

/** A request names a group absent from the current registry. */
export interface SessionGroupNotFound {
  readonly code: 'group-not-found'
  readonly groupId: SessionGroupId
}

/** A move names no live or catalogued Session. */
export interface SessionGroupSessionNotFound {
  readonly code: 'session-not-found'
  readonly sessionId: SessionId
}

/** A move cannot pin a Session while the Workspace registry archives it. */
export interface SessionGroupSessionArchived {
  readonly code: 'session-archived'
  readonly sessionId: SessionId
}

/** A Session-order anchor is absent from the destination level. */
export interface SessionGroupAnchorNotFound {
  readonly code: 'session-anchor-not-found'
  readonly targetGroupId: SessionGroupId | null
  readonly beforeSessionId: SessionId
}

/** Every stable business failure returned by the registry. */
export type SessionGroupsFailure =
  | SessionGroupsRevisionConflict
  | SessionGroupTitleBlank
  | SessionGroupTitleTooLarge
  | SessionGroupTitleConflict
  | SessionGroupNotFound
  | SessionGroupSessionNotFound
  | SessionGroupSessionArchived
  | SessionGroupAnchorNotFound

/** Successful registry operation. */
export interface SessionGroupsSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected registry operation with a stable business failure. */
export interface SessionGroupsRejected<E extends SessionGroupsFailure> {
  readonly ok: false
  readonly error: E
}

/** Result returned by `snapshot`. */
export type SessionGroupsSnapshotResult = SessionGroupsSuccess<SessionGroupsSnapshot>

/** Result returned by `create`. */
export type SessionGroupsCreateResult =
  | SessionGroupsSuccess<SessionGroupsSnapshot>
  | SessionGroupsRejected<
    | SessionGroupsRevisionConflict
    | SessionGroupTitleBlank
    | SessionGroupTitleTooLarge
    | SessionGroupTitleConflict
  >

/** Result returned by `rename`. */
export type SessionGroupsRenameResult =
  | SessionGroupsSuccess<SessionGroupsSnapshot>
  | SessionGroupsRejected<
    | SessionGroupsRevisionConflict
    | SessionGroupTitleBlank
    | SessionGroupTitleTooLarge
    | SessionGroupTitleConflict
    | SessionGroupNotFound
  >

/** Result returned by `delete`. */
export type SessionGroupsDeleteResult =
  | SessionGroupsSuccess<SessionGroupsSnapshot>
  | SessionGroupsRejected<SessionGroupsRevisionConflict | SessionGroupNotFound>

/** Result returned by `insertGroupBefore`. */
export type SessionGroupsInsertGroupBeforeResult =
  | SessionGroupsSuccess<SessionGroupsSnapshot>
  | SessionGroupsRejected<SessionGroupsRevisionConflict | SessionGroupNotFound>

/** Result returned by `moveSession`. */
export type SessionGroupsMoveSessionResult =
  | SessionGroupsSuccess<SessionGroupsSnapshot>
  | SessionGroupsRejected<
    | SessionGroupsRevisionConflict
    | SessionGroupNotFound
    | SessionGroupSessionNotFound
    | SessionGroupSessionArchived
    | SessionGroupAnchorNotFound
  >
