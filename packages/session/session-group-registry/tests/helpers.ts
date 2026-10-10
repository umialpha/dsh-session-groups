import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import Storage from '@deepseek-ai/dsh-storage'
import type { StorageBackend } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from './memory-backend.ts'
import SessionGroupRegistry from '../src/index.ts'

/** Services and controls exposed by one registry test composition. */
export interface TestHarness {
  readonly ctx: Context
  readonly pool: MemoryMediaPool
  readonly catalog: Map<SessionId, SessionHeader>
  readonly registryFiber: { dispose(): Promise<void> }
  addCataloguedSession(rawId: string): SessionId
  dispose(): Promise<void>
}

/** Compose the registry over the real Session store and storage-domain form. */
export async function setupHarness(options: {
  readonly maxTitleBytes?: number
  readonly pool?: MemoryMediaPool
  readonly catalog?: Map<SessionId, SessionHeader>
  readonly backend?: StorageBackend
} = {}): Promise<TestHarness> {
  const pool = options.pool ?? new MemoryMediaPool()
  const catalog = options.catalog ?? new Map<SessionId, SessionHeader>()
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', options.backend ?? new MemoryStorageBackend(pool))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.effect(() => ctx.storage.mount('domain', facility))
    ctx.provide('storageDomain', facility)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([...catalog.values()].map((header, index) => ({
        header,
        revision: SessionPersistenceRevision(`test:${String(index)}`),
      }))),
    } as never)
    await ctx.plugin(WorkspaceRegistry)
    const registryFiber = await ctx.plugin(SessionGroupRegistry, {
      maxTitleBytes: options.maxTitleBytes ?? 64,
    })
    return {
      ctx,
      pool,
      catalog,
      registryFiber,
      addCataloguedSession(rawId: string): SessionId {
        const id = SessionId(rawId)
        catalog.set(id, {
          version: SESSION_FORMAT_VERSION,
          id,
          createdAt: 1_700_000_000_000 + catalog.size,
          isSeeded: false,
          delegationDepth: 0,
        })
        return id
      },
      async dispose() {
        await ctx.fiber.dispose()
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}
