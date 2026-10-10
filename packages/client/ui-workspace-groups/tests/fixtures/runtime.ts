import type { Context } from '@deepseek-ai/cordis'
import { useSyncExternalStore } from 'react'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** Bind the observable source to a selector hook without relying on unpublished renderer sources. */
export function bindSnapshotSelector<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  const subscribe = (listener: () => void) => source.subscribe(listener)
  const getSnapshot = () => source.getSnapshot()
  return function useSelector<S>(selector: (snapshot: T) => S): S {
    return selector(useSyncExternalStore(subscribe, getSnapshot, getSnapshot))
  }
}

/** Resolve translations through the namespace and common dictionaries used by a test. */
export function makeTranslate(...dictionaries: readonly Record<string, string>[]) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dictionaries.find(dictionary => Object.hasOwn(dictionary, key))?.[key] ?? key
    return template.replace(/\{([^}]+)\}/gu, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
  }
}

/** Minimal Remote service used by Workspace assembly tests. */
export class TestRemote {
  private readonly subscriptions = new Map<string, Set<(...args: never[]) => void>>()
  readonly $host: { home: string | undefined; isLoopback: boolean } = {
    home: undefined,
    isLoopback: true,
  }

  constructor(private readonly ctx: Context, namespaces: Readonly<Record<string, object>> = {}) {
    ctx.provide('remote', this as never)
    this.provideNamespaces(namespaces)
  }

  provideNamespaces(namespaces: Readonly<Record<string, object>>): void {
    for (const [name, namespace] of Object.entries(namespaces)) {
      Object.assign(this, { [name]: namespace })
      this.ctx.provide(`remote.${name}`, namespace as never)
    }
  }

  emit(event: string, args: readonly unknown[]): void {
    for (const listener of this.subscriptions.get(event) ?? []) listener(...args as never[])
  }

  $on(event: string, listener: (...args: never[]) => void): () => void {
    const listeners = this.subscriptions.get(event) ?? new Set()
    listeners.add(listener)
    this.subscriptions.set(event, listeners)
    return () => { listeners.delete(listener) }
  }

  async $mount(): Promise<never> {
    throw new Error('TestRemote does not mount generated namespaces')
  }
}
