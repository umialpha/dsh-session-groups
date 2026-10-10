import { describe, expect, it } from 'vitest'
import type {
  SessionPendingInteractionBase, SessionStatus, SessionStatusSnapshot,
} from '@deepseek-ai/dsh-client-ui-session/client'
import { deriveSessionGroups } from '../src/client/derive.ts'
import { group, sessionState, sid, snapshot, summary, workspace } from './fixtures.client.ts'

const noStatus: SessionStatusSnapshot = new Map()

describe('deriveSessionGroups', () => {
  it('keeps named groups in manual order and resolves Workspace or directory labels', () => {
    const sessions = sessionState([
      summary('manual-old', 1, { cwd: '/outside/manual' }),
      summary('manual-new', 20, { cwd: '/outside/manual-new' }),
    ])
    const projection = deriveSessionGroups(
      sessions,
      noStatus,
      [
        workspace('first', ['manual-old'], 'First workspace'),
        workspace('duplicate', ['manual-old'], 'Second workspace'),
      ],
      'Default workspace',
      [],
      [sid('manual-old'), sid('manual-new'), sid('missing')],
      snapshot([
        group('work', 'Work', ['manual-old', 'manual-new']),
        group('empty', 'Empty', ['missing']),
      ]),
    )

    expect(projection.groups.map(item => [item.title, item.sessions.map(session => session.id)])).toEqual([
      ['Work', [sid('manual-old'), sid('manual-new')]],
      ['Empty', []],
    ])
    expect(projection.groups[0]?.sessions[0]?.workspace).toBe('First workspace')
    expect(projection.groups[0]?.sessions[1]?.workspace).toBe('manual-new')
  })

  it('shares Projects visibility while retaining hidden group membership', () => {
    const current = summary('blank-current', 8, {
      blank: true, displayTitle: 'ignored', retainedBy: { mainView: 1 },
    })
    delete current.title
    const hiddenBlank = summary('blank-hidden', 7, { blank: true })
    const archived = summary('archived', 6)
    const subagent = summary('subagent', 5, {
      origin: 'subagent', parentId: sid('owner'), running: true,
    })
    const owner = summary('owner', 4)
    const sessions = sessionState([current, hiddenBlank, archived, subagent, owner], {
      projectionsBySession: {
        [owner.id]: {
          values: { subagentCatalog: [{ id: subagent.id, mode: 'continuable', label: 'child', createdAt: 1 }] },
          state: 'ready',
          error: null,
        },
      },
    })
    const ownerStatus: SessionStatus = {
      running: undefined,
      pendingInteraction: ({
        key: 'question-1', kind: 'question', sessionId: owner.id,
      } satisfies SessionPendingInteractionBase) as NonNullable<SessionStatus['pendingInteraction']>,
      completionUnread: true,
    }
    const projection = deriveSessionGroups(
      sessions,
      new Map([[owner.id, ownerStatus]]),
      [],
      'Default workspace',
      [archived.id],
      [current.id, hiddenBlank.id, archived.id, subagent.id, owner.id],
      snapshot([group('grouped', 'Grouped', [
        'blank-current', 'blank-hidden', 'archived', 'subagent', 'owner',
      ])]),
    )

    expect(projection.groups[0]?.sessions).toEqual([
      {
        id: sid('blank-current'),
        title: '',
        displayTitle: 'ignored',
        blank: true,
        running: false,
        runningSubagentCount: 0,
        completed: false,
        updatedAt: 8,
        workspace: '',
      },
      {
        id: sid('owner'),
        title: 'owner',
        displayTitle: 'owner',
        blank: false,
        running: false,
        runningSubagentCount: 1,
        completed: true,
        updatedAt: 4,
        workspace: '',
        pendingInteraction: 'question',
      },
    ])
    expect(projection.groups[0]?.sessions.some(item => item.id === hiddenBlank.id)).toBe(false)
    expect(projection.groups[0]?.sessions.some(item => item.id === archived.id)).toBe(false)
  })

  it('handles missing list rows, empty paths, and separator-only directory labels', () => {
    const noCwd = summary('no-cwd', 1)
    const emptyCwd = summary('empty-cwd', 2, { cwd: '' })
    const rootCwd = summary('root-cwd', 3, { cwd: '////' })
    const sessions = sessionState([noCwd, emptyCwd, rootCwd], {
      ids: [sid('absent'), noCwd.id, emptyCwd.id, rootCwd.id],
    })

    const projection = deriveSessionGroups(
      sessions,
      noStatus,
      [],
      'Default workspace',
      [],
      [noCwd.id, emptyCwd.id, rootCwd.id, sid('absent')],
      snapshot([group('paths', 'Paths', ['absent', 'no-cwd', 'empty-cwd', 'root-cwd'])]),
    )

    expect(projection.groups[0]?.sessions.map(item => [item.id, item.workspace])).toEqual([
      [sid('no-cwd'), ''],
      [sid('empty-cwd'), ''],
      [sid('root-cwd'), '////'],
    ])
  })

  it('uses native pins as membership authority and projects missing layout ids at the root', () => {
    const sessions = sessionState([
      summary('root', 3),
      summary('grouped', 2),
      summary('new-pin', 1),
      summary('stale', 0),
    ])

    const projection = deriveSessionGroups(
      sessions,
      noStatus,
      [],
      'Default workspace',
      [],
      [sid('new-pin'), sid('grouped'), sid('root')],
      snapshot([group('work', 'Work', ['grouped', 'stale'])], 'r1', ['root', 'stale']),
    )

    expect(projection.defaultSessions.map(item => item.id)).toEqual([sid('root'), sid('new-pin')])
    expect(projection.groups[0]?.sessions.map(item => item.id)).toEqual([sid('grouped')])
  })

  it('localizes the default Workspace sentinel through the shared display helper', () => {
    const sessions = sessionState([summary('default-session', 1)])
    const projection = deriveSessionGroups(
      sessions,
      noStatus,
      [workspace('default', ['default-session'], 'default-workspace')],
      'Default workspace',
      [],
      [sid('default-session')],
      snapshot([], 'r1', ['default-session']),
    )

    expect(projection.defaultSessions[0]?.workspace).toBe('Default workspace')
  })

  it('keeps a fallback display title separate from an absent durable rename title', () => {
    const fallback = summary('fallback', 1, { displayTitle: 'Fallback project' })
    delete fallback.title
    const sessions = sessionState([fallback])
    const projection = deriveSessionGroups(
      sessions,
      noStatus,
      [],
      'Default workspace',
      [],
      [sid('fallback')],
      snapshot([], 'r1', ['fallback']),
    )

    expect(projection.defaultSessions[0]).toMatchObject({
      title: '',
      displayTitle: 'Fallback project',
    })
  })
})
