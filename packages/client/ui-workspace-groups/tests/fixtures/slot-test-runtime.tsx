import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act, render, type RenderResult } from '@testing-library/react'
import {
  Fragment,
  createElement,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import type {
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  WorkspaceId,
  WorkspaceSnapshot,
  WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { en as commonEn, zh as commonZh } from './common-locales.ts'
import {
  LocaleRuntime,
  SlotRegistry,
  type TestStoredEntry,
} from './client-runtime.ts'

type Observable<T = unknown> = {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

type SelectorHook<T = unknown> = <S>(selector: (snapshot: T) => S) => S

const selectorHooks = new WeakMap<object, SelectorHook>()

function hookOf<T>(source: Observable<T>): SelectorHook<T> {
  const cached = selectorHooks.get(source)
  if (cached !== undefined) return cached as SelectorHook<T>
  const subscribe = (listener: () => void) => source.subscribe(listener)
  const getSnapshot = () => source.getSnapshot()
  const hook: SelectorHook<T> = selector => selector(useSyncExternalStore(subscribe, getSnapshot, getSnapshot))
  selectorHooks.set(source, hook as SelectorHook)
  return hook
}

function hookName(name: string): string {
  return `use${name.slice(0, 1).toUpperCase()}${name.slice(1)}`
}

type SessionFixture = {
  readonly id: string
  readonly summary?: Partial<Omit<SessionSummary, 'id'>>
  readonly session?: Readonly<Record<string, unknown>>
}

type SessionBinding = {
  readonly session: Readonly<Record<string, unknown>> & Observable
}

type SessionReference = {
  readonly sessionId: SessionId
  readonly binding: SessionBinding
  readonly ready: Promise<SessionBinding>
  release(): void
}

class TestSessions {
  readonly list = createSnapshotStore<SessionListState>({
    ids: [],
    byId: {},
    phase: 'ready',
    projectionsBySession: {},
  })
  readonly searchResultLimit = 20
  private readonly bindings = new Map<SessionId, SessionBinding>()

  constructor(private readonly ctx: Context) {}

  async add(fixture: SessionFixture): Promise<SessionId> {
    const id = fixture.id as SessionId
    const sessionSnapshot = createSnapshotStore({ openState: 'open', subagent: null })
    const session = Object.assign(sessionSnapshot, fixture.session ?? {})
    this.bindings.set(id, { session })
    await act(async () => {
      this.list.update((draft) => {
        draft.ids.push(id)
        draft.byId[id] = {
          id,
          displayTitle: fixture.id,
          running: false,
          blank: false,
          updatedAt: draft.ids.length,
          retainedBy: {},
          ...fixture.summary,
        }
      })
    })
    return id
  }

  retainFor(_ctx: Context, id: SessionId, options: { readonly source: string }): SessionReference {
    return this.retain(id, options)
  }

  retain(target: SessionId, options: { readonly source: string }): SessionReference {
    const binding = this.requireBinding(target)
    const summary = this.list.getSnapshot().byId[target]
    if (summary !== undefined) {
      this.list.update((draft) => {
        const row = draft.byId[target]
        if (row !== undefined) row.retainedBy = { ...row.retainedBy, [options.source]: 1 }
      })
    }
    return {
      sessionId: target,
      binding,
      ready: Promise.resolve(binding),
      release: () => {},
    }
  }

  async using<T>(
    target: SessionId,
    options: { readonly source: string },
    operation: (reference: SessionReference) => Promise<T> | T,
  ): Promise<T> {
    const reference = this.retain(target, options)
    try {
      return await operation(reference)
    } finally {
      reference.release()
    }
  }

  binding(id: SessionId): SessionBinding | undefined { return this.bindings.get(id) }

  scope(): Context | undefined { return this.ctx }

  sessionOf(ctx: Context): Readonly<Record<string, unknown>> | undefined {
    if (ctx !== this.ctx) return undefined
    return this.bindings.values().next().value?.session
  }

  subagentAddress(): undefined { return undefined }

  async create(): Promise<SessionId> {
    return this.list.getSnapshot().ids[0] ?? 'test-created-session' as SessionId
  }

  async fork(request: { readonly sessionId: SessionId; readonly onCreated?: (id: SessionId) => void }): Promise<SessionId> {
    const child = `${request.sessionId}-fork` as SessionId
    request.onCreated?.(child)
    return child
  }

  async search(): Promise<{ readonly ok: true; readonly value: { readonly items: readonly []; readonly hasMore: false } }> {
    return { ok: true, value: { items: [], hasMore: false } }
  }

  async refreshProjections(): Promise<void> {}

  async updateSummary(id: SessionId, updates: Partial<SessionSummary>): Promise<void> {
    await act(async () => {
      this.list.update((draft) => {
        const row = draft.byId[id]
        if (row !== undefined) Object.assign(row, updates)
      })
    })
  }

  private requireBinding(id: SessionId): SessionBinding {
    const binding = this.bindings.get(id)
    if (binding === undefined) throw new Error(`test session "${id}" is unavailable`)
    return binding
  }
}

class TestWorkspaces {
  readonly list = createSnapshotStore<WorkspaceSnapshot>({
    items: [],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  })

  async update(mutate: (draft: WorkspaceSnapshot) => void): Promise<void> {
    await act(async () => { this.list.update(mutate) })
  }

  async initializeDefault(): Promise<WorkspaceView | undefined> { return undefined }

  async create(input: { readonly path: string }): Promise<WorkspaceView> {
    return {
      workspaceId: `test-${input.path}` as WorkspaceId,
      path: input.path,
      title: input.path,
      sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }

  async rename(_workspaceId: WorkspaceId, _title: string): Promise<WorkspaceView> {
    return this.list.getSnapshot().items[0]!
  }

  async delete(): Promise<void> {}

  async insertBefore(): Promise<void> {}

  async insertSessionBefore(workspaceId: WorkspaceId): Promise<WorkspaceView> {
    return this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)!
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    await this.update((draft) => { draft.archivedSessionIds.push(sessionId) })
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.update((draft) => {
      draft.archivedSessionIds = draft.archivedSessionIds.filter(id => id !== sessionId)
    })
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    await this.update((draft) => {
      draft.pinnedSessionIds = [sessionId, ...draft.pinnedSessionIds.filter(id => id !== sessionId)]
    })
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    await this.update((draft) => {
      draft.pinnedSessionIds = draft.pinnedSessionIds.filter(id => id !== sessionId)
    })
  }
}

class TestRemote {
  $host: { home: string | undefined; isLoopback: boolean } = { home: undefined, isLoopback: true }
  private readonly subscriptions = new Map<string, Set<(...args: never[]) => void>>()

  constructor(private readonly ctx: Context) { ctx.provide('remote', this as never) }

  provideNamespaces(namespaces: Readonly<Record<string, object>>): void {
    for (const [name, namespace] of Object.entries(namespaces)) {
      Object.assign(this, { [name]: namespace })
      this.ctx.provide(`remote.${name}`, namespace as never)
    }
  }

  $on(event: string, listener: (...args: never[]) => void): () => void {
    const listeners = this.subscriptions.get(event) ?? new Set()
    listeners.add(listener)
    this.subscriptions.set(event, listeners)
    return () => { listeners.delete(listener) }
  }

  $mount(): Promise<never> {
    return Promise.reject(new Error('test remote does not mount generated namespaces'))
  }
}

const NO_SESSION_STATUS = createSnapshotStore(new Map())
const PANEL_INFO = createSnapshotStore({ activePanelId: null })
const NO_RESOURCE = Object.freeze({
  status: 'none' as const,
  value: undefined,
  failure: undefined,
  reload: () => {},
})

const injectCache = new WeakMap<TestStoredEntry, object>()
const storeCache = new WeakMap<object, Observable & { readonly actions?: object }>()

function normalizeHooks(face: object): object {
  const record = face as Record<string, unknown>
  const sources = record['hooks'] as Readonly<Record<string, Observable>> | undefined
  if (sources === undefined) return face
  const { hooks: _hooks, ...rest } = record
  for (const [name, source] of Object.entries(sources)) rest[hookName(name)] = hookOf(source)
  return rest
}

function injected(entry: TestStoredEntry, actions: object | undefined): object {
  const cached = injectCache.get(entry)
  if (cached !== undefined) return cached
  const face = normalizeHooks(entry.inject?.(actions as never) ?? {})
  injectCache.set(entry, face)
  return face
}

function storeOf(entry: TestStoredEntry): (Observable & { readonly actions?: object }) | undefined {
  const declaration = entry.store
  if (declaration === undefined) return undefined
  const cached = storeCache.get(declaration)
  if (cached !== undefined) return cached
  const created = (declaration as { create(): Observable & { readonly actions?: object } }).create()
  storeCache.set(declaration, created)
  return created
}

function standardProps(slots: SlotRegistry): Record<string, unknown> {
  const sessions = slots.rootSource('sessions') as Observable | undefined
  const workspaces = slots.rootSource('workspaces') as Observable | undefined
  return {
    ...(sessions === undefined ? {} : { useSessions: hookOf(sessions) }),
    ...(workspaces === undefined ? {} : { useWorkspaces: hookOf(workspaces) }),
    useSessionStatus: hookOf(NO_SESSION_STATUS),
    usePanelInfo: hookOf(PANEL_INFO),
    useSessionRetainInfo: () => undefined,
    useResource: () => NO_RESOURCE,
  }
}

function commonInjected(
  slots: SlotRegistry,
  name: string,
  standard: Record<string, unknown>,
  hookContext: unknown,
): object {
  const hooks = slots.spec(name)?.inject?.['hooks'] as Readonly<Record<string, unknown>> | undefined
  if (hooks === undefined) return {}
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(hooks)) {
    props[hookName(key)] = typeof value === 'function'
      ? value(standard, hookContext)
      : hookOf(value as Observable)
  }
  return props
}

function SlotEntryView({
  slots,
  name,
  entry,
  owner,
  hookContext,
}: {
  readonly slots: SlotRegistry
  readonly name: string
  readonly entry: TestStoredEntry
  readonly owner: object
  readonly hookContext: unknown
}) {
  const Component = entry.component as ComponentType<Record<string, unknown>>
  const standard = standardProps(slots)
  const store = storeOf(entry)
  const actions = store?.actions
  const kit: Record<string, unknown> = {
    ...standard,
    ...(store === undefined ? {} : { useStore: hookOf(store), actions }),
    ...(entry.locale === undefined ? {} : { t: slots.localeFace()?.bind(entry.locale) }),
    ...(entry.options.children === undefined ? {} : {
      renderSlot: (childName: string, childOwner: object, options?: { readonly hookContext?: unknown }) => (
        <SlotOutlet
          slots={slots}
          name={childName}
          owner={childOwner}
          hookContext={options?.hookContext}
        />
      ),
    }),
  }
  return (
    <Component
      {...kit}
      {...injected(entry, actions)}
      {...commonInjected(slots, name, standard, hookContext)}
      {...owner}
    />
  )
}

function SlotOutlet({
  slots,
  name,
  owner,
  hookContext,
}: {
  readonly slots: SlotRegistry
  readonly name: string
  readonly owner: object
  readonly hookContext?: unknown
}): ReactNode {
  useSyncExternalStore(
    listener => slots.subscribe(name, listener),
    () => slots.version(name),
    () => slots.version(name),
  )
  return (
    <Fragment>
      {slots.entries(name).map((entry, index) => (
        <SlotEntryView
          key={`${entry.options.id ?? name}:${index}`}
          slots={slots}
          name={name}
          entry={entry}
          owner={owner}
          hookContext={hookContext}
        />
      ))}
    </Fragment>
  )
}

class TestRoot {
  constructor(private readonly slots: SlotRegistry) {}

  async declare(children: Readonly<Record<string, object>>, component: unknown): Promise<void> {
    await act(async () => {
      this.slots.register({ name: 'root', children } as never, component)
    })
  }
}

/** Independent source-plane slot runtime for the two mirrored assembly suites. */
export class SlotTestRuntime {
  readonly ctx: Context
  readonly slots: SlotRegistry
  readonly root: TestRoot
  readonly sessions: TestSessions
  readonly remote: TestRemote
  readonly workspaces: TestWorkspaces
  private readonly handles: Fiber[] = []
  private readonly views: RenderResult[] = []
  private readonly releaseInitialWorkspaces: () => void

  private constructor(ctx: Context, slots: SlotRegistry) {
    this.ctx = ctx
    this.slots = slots
    this.root = new TestRoot(slots)
    this.sessions = new TestSessions(ctx)
    this.remote = new TestRemote(ctx)
    this.workspaces = new TestWorkspaces()
    ctx.provide('sessions', this.sessions as never)
    ctx.provide('workspaces', this.workspaces as never)
    this.slots.provideRoot({ hooks: { sessions: this.sessions.list } })
    this.releaseInitialWorkspaces = this.slots.provideRoot({ hooks: { workspaces: this.workspaces.list } })
    const locale = new LocaleRuntime(ctx)
    locale.register('common', { en: commonEn, zh: commonZh })
  }

  static async create(): Promise<SlotTestRuntime> {
    const ctx = new Context()
    const fiber = ctx.plugin(SlotRegistry)
    await fiber.await()
    return new SlotTestRuntime(ctx, ctx.get('slots') as SlotRegistry)
  }

  releaseWorkspaceSource(): void { this.releaseInitialWorkspaces() }

  async mount(plugin: Plugin): Promise<void> {
    const fiber = this.ctx.plugin(plugin)
    await act(async () => { await fiber.await() })
    this.handles.push(fiber)
  }

  renderRoot(): RenderResult {
    const view = render(createElement(SlotOutlet, { slots: this.slots, name: 'root', owner: {} }))
    this.views.push(view)
    return view
  }

  async flush(): Promise<void> { await act(async () => {}) }

  async dispose(): Promise<void> {
    for (const view of this.views.splice(0)) view.unmount()
    for (const fiber of this.handles.splice(0).reverse()) await fiber.dispose()
    await this.ctx.fiber.dispose()
    localStorage.clear()
  }
}

/** Pin browser language for one suite while preserving the environment afterwards. */
export function usePinnedBrowserLanguages(primary: string, ...rest: string[]): void {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { value: [primary, ...rest], configurable: true })
    Object.defineProperty(navigator, 'language', { value: primary, configurable: true })
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
    Reflect.deleteProperty(navigator, 'language')
  })
}

import { afterEach, beforeEach } from 'vitest'

export { RemoteError }
