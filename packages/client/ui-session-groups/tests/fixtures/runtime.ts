import { afterEach, beforeEach } from 'vitest'

/** Resolve translations through the same first-match chain used by DSH locale tests. */
export function makeTranslate(
  ...dictionaries: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    const template = dictionaries.find(dictionary => Object.hasOwn(dictionary, key))?.[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

/** Pin browser language for suites that assert localized copy. */
export function usePinnedBrowserLanguages(primary: string, ...rest: string[]): void {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', {
      value: [primary, ...rest],
      configurable: true,
    })
    Object.defineProperty(navigator, 'language', {
      value: primary,
      configurable: true,
    })
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
    Reflect.deleteProperty(navigator, 'language')
  })
}

/** Minimal structured Remote failure used by controller tests. */
export class RemoteError extends Error {
  readonly isDSHRemoteError = true

  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'RemoteError'
  }
}
