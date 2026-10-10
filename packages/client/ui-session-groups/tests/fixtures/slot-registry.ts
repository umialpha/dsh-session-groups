import { Service, type Context } from '@deepseek-ai/cordis'

type SlotOptions = {
  readonly name: string
  readonly id?: string
  readonly locale?: string
  readonly inject?: () => object
  readonly children?: Readonly<Record<string, object>>
}

export type TestSlotEntry = {
  readonly options: SlotOptions
  readonly component: unknown
  readonly locale?: string
  readonly inject?: () => object
}

type Injection = {
  active: (() => void) | undefined
  readonly callback: () => (() => void) | Iterable<() => void, void, void>
}

/** Minimal declaration-aware Slot service for browser-plugin lifecycle tests. */
export class TestSlotRegistry extends Service {
  private readonly declarations = new Map<string, number>()
  private readonly injections = new Map<string, Set<Injection>>()
  private readonly registered = new Map<string, TestSlotEntry[]>()

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  register(options: SlotOptions, component: unknown): () => void {
    const dispose = this.ctx.effect(() => this.registerNow(options, component), 'test slots.register')
    return () => { void dispose() }
  }

  inject(
    name: string,
    callback: () => (() => void) | Iterable<() => void, void, void>,
  ): () => void {
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

  entries(name: string): readonly TestSlotEntry[] {
    return this.registered.get(name) ?? []
  }

  private registerNow(options: SlotOptions, component: unknown): () => void {
    const children = Object.keys(options.children ?? {})
    if (children.length !== 0) {
      for (const name of children) {
        this.declarations.set(name, (this.declarations.get(name) ?? 0) + 1)
        this.reconcileAll(name)
      }
      return () => {
        for (const name of [...children].reverse()) {
          const count = (this.declarations.get(name) ?? 1) - 1
          if (count === 0) this.declarations.delete(name)
          else this.declarations.set(name, count)
          this.reconcileAll(name)
        }
      }
    }

    const entry: TestSlotEntry = {
      options,
      component,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.inject === undefined ? {} : { inject: options.inject }),
    }
    const entries = this.registered.get(options.name) ?? []
    entries.push(entry)
    this.registered.set(options.name, entries)
    return () => {
      const index = entries.indexOf(entry)
      if (index !== -1) entries.splice(index, 1)
      if (entries.length === 0) this.registered.delete(options.name)
    }
  }

  private reconcileAll(name: string): void {
    for (const injection of this.injections.get(name) ?? []) this.reconcile(name, injection)
  }

  private reconcile(name: string, injection: Injection): void {
    const declared = (this.declarations.get(name) ?? 0) !== 0
    if (declared && injection.active === undefined) {
      const effect = injection.callback()
      if (typeof effect === 'function') {
        injection.active = effect
      } else {
        const disposers = [...effect]
        injection.active = () => {
          for (const dispose of disposers.reverse()) dispose()
        }
      }
    } else if (!declared && injection.active !== undefined) {
      injection.active()
      injection.active = undefined
    }
  }
}
