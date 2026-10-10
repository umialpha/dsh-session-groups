/**
 * Durable global-state declaration for user-defined Session groups.
 * @module @umialpha/dsh-session-group-registry/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type {
  SessionGroup,
  SessionGroupId,
  SessionGroupsRevision,
} from './types.ts'

/** Stable pre-mutation token shared by every empty registry. */
export const SESSION_GROUPS_INITIAL_REVISION = 'initial' as SessionGroupsRevision

/** Runtime schema for one group identity stored on disk. */
export const sessionGroupIdSchema = z.uuid().transform(value => value as SessionGroupId)

/** Runtime schema for the initial token or a material-mutation UUID. */
export const sessionGroupsRevisionSchema = z.union([
  z.literal(SESSION_GROUPS_INITIAL_REVISION),
  z.uuid().transform(value => value as SessionGroupsRevision),
]) as z.ZodType<SessionGroupsRevision>

/** Runtime schema for one named group and its manual Session order. */
export const sessionGroupSchema = z.object({
  id: sessionGroupIdSchema,
  title: z.string().min(1).refine(title => title === title.trim(), {
    message: 'session group title must be trimmed',
  }),
  sessionIds: z.array(z.string().min(1).transform(SessionId)),
}) as z.ZodType<SessionGroup>

/**
 * Whole-registry state. Group ids and titles are unique, and a Session id can
 * occur only once across the default level and all groups.
 */
export const sessionGroupsStateSchema = z.object({
  revision: sessionGroupsRevisionSchema,
  defaultSessionIds: z.array(z.string().min(1).transform(SessionId)),
  groups: z.array(sessionGroupSchema),
}).superRefine((state, ctx) => {
  const groupIds = new Set<string>()
  const titles = new Set<string>()
  const sessionOwners = new Map<string, string>()
  state.defaultSessionIds.forEach((sessionId, sessionIndex) => {
    const owner = sessionOwners.get(sessionId)
    if (owner !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultSessionIds', sessionIndex],
        message: `session '${sessionId}' also belongs to ${owner}`,
      })
    } else {
      sessionOwners.set(sessionId, 'the default level')
    }
  })
  state.groups.forEach((group, groupIndex) => {
    if (groupIds.has(group.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups', groupIndex, 'id'],
        message: `duplicate session group id '${group.id}'`,
      })
    }
    groupIds.add(group.id)

    if (titles.has(group.title)) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups', groupIndex, 'title'],
        message: `duplicate session group title '${group.title}'`,
      })
    }
    titles.add(group.title)

    group.sessionIds.forEach((sessionId, sessionIndex) => {
      const owner = sessionOwners.get(sessionId)
      if (owner !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'sessionIds', sessionIndex],
          message: `session '${sessionId}' also belongs to ${owner}`,
        })
      } else {
        sessionOwners.set(sessionId, `group at index ${groupIndex}`)
      }
    })
  })
})

/** Durable global state inferred from {@link sessionGroupsStateSchema}. */
export type SessionGroupsDomainState = z.infer<typeof sessionGroupsStateSchema>

/** One atomic global value; no per-group table can diverge from its order. */
export const sessionGroupsDomainSpec = defineDomain({
  name: 'pinned_session_groups',
  version: 0,
  global: {
    schema: sessionGroupsStateSchema,
    initial: { revision: SESSION_GROUPS_INITIAL_REVISION, defaultSessionIds: [], groups: [] },
  },
  tables: {},
})
