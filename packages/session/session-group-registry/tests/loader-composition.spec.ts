import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import SessionGroupRegistry, {
  type SessionGroupsSnapshot,
  type SessionGroupsSnapshotResult,
} from '../src/index.ts'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Load the test cordis.yml through the production Loader entry path. */
async function loadComposition(configPath: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root as string).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@umialpha/dsh-session-group-registry', SessionGroupRegistry],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as never
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

/** Narrow the read-only Remote result. */
function snapshotOf(result: SessionGroupsSnapshotResult): SessionGroupsSnapshot {
  expect(result.ok).toBe(true)
  return result.value
}

describe('Session groups through a real Loader composition', () => {
  it('persists cross-project membership and accepts a cold catalogued Session after restart', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-session-groups-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'sessions'))}`,
      '    compression: none',
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storage'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: '@deepseek-ai/dsh-workspace'",
      "- name: '@umialpha/dsh-session-group-registry'",
      '  config:',
      '    maxTitleBytes: 32',
      '',
    ].join('\n'))

    const first = await loadComposition(configPath)
    expect(first.sessionGroupRegistry.typertRemote.namespace).toBe('sessionGroups')
    expect(remoteMethods(first.sessionGroupRegistry).map(marker => marker.method)).toEqual([
      'snapshot',
      'create',
      'rename',
      'delete',
      'insertGroupBefore',
      'moveSession',
    ])

    const session = first.sessions.create(SessionId('loader-grouped'), {
      meta: { cwd: join(root, 'project-a') },
    })
    const writeHandle = await first.sessionPersistence.create(session.header)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await writeHandle.close()
    const initial = snapshotOf(await first.sessionGroupRegistry.snapshot({}))
    const created = await first.sessionGroupRegistry.create({
      title: 'Current work',
      ifRevision: initial.revision,
    })
    if (!created.ok) throw new Error(`expected create success, got ${created.error.code}`)
    const group = created.value.groups[0]
    if (group === undefined) throw new Error('expected created group')
    const moved = await first.sessionGroupRegistry.moveSession({
      sessionId: session.id,
      targetGroupId: group.id,
      beforeSessionId: null,
      ifRevision: created.value.revision,
    })
    if (!moved.ok) throw new Error(`expected move success, got ${moved.error.code}`)

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await loadComposition(configPath)
    expect(second.sessions.get(session.id)).toBeUndefined()
    expect(snapshotOf(await second.sessionGroupRegistry.snapshot({}))).toEqual(moved.value)
    const ungrouped = await second.sessionGroupRegistry.moveSession({
      sessionId: session.id,
      targetGroupId: null,
      beforeSessionId: null,
      ifRevision: moved.value.revision,
    })
    expect(ungrouped).toMatchObject({
      ok: true,
      value: {
        defaultSessionIds: [session.id],
        groups: [{ title: 'Current work', sessionIds: [] }],
      },
    })
  })
})
