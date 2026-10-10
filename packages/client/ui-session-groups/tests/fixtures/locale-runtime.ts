type LocaleDict = Readonly<Record<string, string>>

/** Small locale registry for browser-plugin assembly tests against published DSH packages. */
export class TestLocaleRuntime {
  private readonly dictionaries = new Map<string, Map<string, LocaleDict>>()

  register(namespace: string, locale: string, dictionary: LocaleDict): () => void
  register(namespace: string, dictionaries: Readonly<Record<string, LocaleDict>>): () => void
  register(
    namespace: string,
    localeOrDictionaries: string | Readonly<Record<string, LocaleDict>>,
    dictionary?: LocaleDict,
  ): () => void {
    const additions = typeof localeOrDictionaries === 'string'
      ? [[localeOrDictionaries, dictionary ?? {}] as const]
      : Object.entries(localeOrDictionaries)
    const namespaceDictionaries = this.dictionaries.get(namespace) ?? new Map<string, LocaleDict>()
    for (const [locale, value] of additions) {
      if (namespaceDictionaries.has(locale)) {
        throw new Error(`Duplicate locale dictionary: ${namespace}/${locale}`)
      }
      namespaceDictionaries.set(locale, value)
    }
    this.dictionaries.set(namespace, namespaceDictionaries)
    return () => {
      for (const [locale, value] of additions) {
        if (namespaceDictionaries.get(locale) === value) namespaceDictionaries.delete(locale)
      }
      if (namespaceDictionaries.size === 0) this.dictionaries.delete(namespace)
    }
  }

  bind(namespace: string): (key: string, params?: Readonly<Record<string, unknown>>) => string {
    return (key, params) => {
      const language = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      const template = this.dictionaries.get(namespace)?.get(language)?.[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
        name in params ? String(params[name]) : match)
    }
  }
}
