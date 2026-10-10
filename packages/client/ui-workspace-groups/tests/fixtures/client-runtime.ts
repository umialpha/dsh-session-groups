import { Service, type Context } from '@deepseek-ai/cordis'

type LocaleDictionary = Readonly<Record<string, string>>

/** Source-plane locale face used when the published browser bundle is unavailable to Vitest. */
export class LocaleRuntime {
  private readonly dictionaries = new Map<string, Map<string, LocaleDictionary>>()
  private readonly listeners = new Set<() => void>()
  private active = typeof navigator === 'undefined' || !navigator.language.toLowerCase().startsWith('zh') ? 'en' : 'zh'
  private revision = 0

  constructor(_ctx: Context) {}

  register(namespace: string, dictionaries: Readonly<Record<string, LocaleDictionary>>): () => void {
    const target = this.dictionaries.get(namespace) ?? new Map<string, LocaleDictionary>()
    const additions = Object.entries(dictionaries)
    for (const [locale, dictionary] of additions) target.set(locale, dictionary)
    this.dictionaries.set(namespace, target)
    this.publish()
    return () => {
      for (const [locale, dictionary] of additions) {
        if (target.get(locale) === dictionary) target.delete(locale)
      }
      if (target.size === 0) this.dictionaries.delete(namespace)
      this.publish()
    }
  }

  setLocale(locale: string): void {
    if (this.active === locale) return
    this.active = locale
    this.publish()
  }

  bind(namespace: string): (key: string, params?: Readonly<Record<string, unknown>>) => string {
    return (key, params) => {
      const template = this.dictionaries.get(namespace)?.get(this.active)?.[key]
        ?? this.dictionaries.get('common')?.get(this.active)?.[key]
        ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
        name in params ? String(params[name]) : match)
    }
  }

  getSnapshot(): { readonly active: string; readonly revision: number } {
    return { active: this.active, revision: this.revision }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

/** Source-plane copy of the small navigation controller used by service tests. */
export class LayoutController {
  private navigation = new AbortController()

  constructor(
    private readonly panels: {
      selectPanel(panelId: unknown): void
      toggleSidebar(): void
      openRightbar(track: boolean, fullscreen: boolean): void
      closeRightbar(): void
    },
    private readonly hasMainPanel: (id: never) => boolean,
    readonly panelInfo: { getSnapshot(): unknown; subscribe(listener: () => void): () => void },
  ) {}

  selectPanel(panelId: never | null): void {
    if (panelId !== null && !this.hasMainPanel(panelId)) {
      throw new Error(`layout.selectPanel: main panel "${String(panelId)}" is not registered`)
    }
    this.navigation.abort()
    this.panels.selectPanel(panelId)
  }

  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  dispose(): void { this.navigation.abort() }

  toggleSidebar(): void { this.panels.toggleSidebar() }

  openRightbar(track: boolean, fullscreen: boolean): void { this.panels.openRightbar(track, fullscreen) }

  closeRightbar(): void { this.panels.closeRightbar() }
}

/** Structured create failure mirrored from the pinned Session Controller release. */
export class SessionCreateError extends Error {
  readonly name = 'SessionCreateError'

  constructor(
    readonly rpcError: { readonly code: string; readonly message: string },
    readonly requestedSessionId: unknown,
  ) {
    super(`session create failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Structured fork failure mirrored from the pinned Session Controller release. */
export class SessionForkError extends Error {
  readonly name = 'SessionForkError'

  constructor(
    readonly rpcError: { readonly code: string; readonly message: string },
    readonly sourceSessionId: unknown,
  ) {
    super(`session fork failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

type SlotSpec = {
  readonly kind?: string
  readonly scope?: string
  readonly inject?: object
}

type SlotOptions = {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly priority?: number
  readonly locale?: string
  readonly inject?: (...args: never[]) => object
  readonly store?: object
  readonly children?: Readonly<Record<string, SlotSpec>>
}

export type TestStoredEntry = {
  readonly options: SlotOptions
  readonly component: unknown
  readonly locale?: string
  readonly inject?: (...args: never[]) => object
  readonly store?: object
}

type Injection = {
  active: (() => void) | undefined
  readonly callback: () => (() => void) | Iterable<() => void, void, void>
}

/** Declaration-aware registry adapter for the official Workspace apply tests. */
export class SlotRegistry extends Service {
  private readonly declarations = new Map<string, { count: number; spec: SlotSpec }>()
  private readonly injections = new Map<string, Set<Injection>>()
  private readonly registrations = new Map<string, TestStoredEntry[]>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly rootHooks = new Map<string, object>()
  private readonly versions = new Map<string, number>()
  private locale: LocaleRuntime | undefined

  constructor(ctx: Context) { super(ctx, 'slots') }

  register(options: SlotOptions, component: unknown): () => void {
    const dispose = this.ctx.effect(() => this.registerNow(options, component), `test slots.register(${options.name})`)
    return () => { void dispose() }
  }

  inject(name: string, callback: Injection['callback']): () => void {
    const dispose = this.ctx.effect(() => {
      const injection: Injection = { active: undefined, callback }
      const listeners = this.injections.get(name) ?? new Set<Injection>()
      listeners.add(injection)
      this.injections.set(name, listeners)
      this.reconcile(name, injection)
      return () => {
        injection.active?.()
        injection.active = undefined
        listeners.delete(injection)
        if (listeners.size === 0) this.injections.delete(name)
      }
    }, `test slots.inject(${name})`)
    return () => { void dispose() }
  }

  entries(name: string): readonly TestStoredEntry[] {
    return [...(this.registrations.get(name) ?? [])].sort((left, right) =>
      (left.options.order ?? 0) - (right.options.order ?? 0))
  }

  spec(name: string): SlotSpec | undefined { return this.declarations.get(name)?.spec }

  subscribe(name: string, listener: () => void): () => void {
    const listeners = this.listeners.get(name) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(name, listeners)
    return () => { listeners.delete(listener) }
  }

  provideRoot(face: { readonly hooks?: Readonly<Record<string, object>> }): () => void {
    for (const [name, source] of Object.entries(face.hooks ?? {})) this.rootHooks.set(name, source)
    return () => {
      for (const [name, source] of Object.entries(face.hooks ?? {})) {
        if (this.rootHooks.get(name) === source) this.rootHooks.delete(name)
      }
    }
  }

  installLocale(locale: LocaleRuntime): void { this.locale = locale }

  localeFace(): LocaleRuntime | undefined { return this.locale }

  rootSource(name: string): object | undefined { return this.rootHooks.get(name) }

  version(name: string): number { return this.versions.get(name) ?? 0 }

  private registerNow(options: SlotOptions, component: unknown): () => void {
    const entry: TestStoredEntry = {
      options,
      component,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.inject === undefined ? {} : { inject: options.inject }),
      ...(options.store === undefined ? {} : { store: options.store }),
    }
    const entries = this.registrations.get(options.name) ?? []
    entries.push(entry)
    this.registrations.set(options.name, entries)

    const declared = Object.entries(options.children ?? {})
    for (const [name, spec] of declared) {
      const current = this.declarations.get(name)
      this.declarations.set(name, { count: (current?.count ?? 0) + 1, spec })
      this.reconcileAll(name)
    }
    this.notify(options.name)

    return () => {
      for (const [name] of [...declared].reverse()) {
        const current = this.declarations.get(name)
        if (current === undefined || current.count === 1) this.declarations.delete(name)
        else this.declarations.set(name, { ...current, count: current.count - 1 })
        this.reconcileAll(name)
      }
      const index = entries.indexOf(entry)
      if (index !== -1) entries.splice(index, 1)
      if (entries.length === 0) this.registrations.delete(options.name)
      this.notify(options.name)
    }
  }

  private reconcileAll(name: string): void {
    for (const injection of this.injections.get(name) ?? []) this.reconcile(name, injection)
  }

  private reconcile(name: string, injection: Injection): void {
    const declared = this.declarations.has(name)
    if (!declared) {
      injection.active?.()
      injection.active = undefined
      return
    }
    if (injection.active !== undefined) return
    const result = injection.callback()
    const disposers = typeof result === 'function' ? [result] : [...result]
    injection.active = () => {
      for (const dispose of [...disposers].reverse()) dispose()
    }
  }

  private notify(name: string): void {
    this.versions.set(name, this.version(name) + 1)
    for (const listener of this.listeners.get(name) ?? []) listener()
  }
}
