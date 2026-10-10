import { isBuiltin } from 'node:module'
import { isAbsolute } from 'node:path'
import type { UserConfig } from 'tsdown'

/** Whether an import is resolved from the installed package graph. */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('\0') && !isAbsolute(specifier)
}

/**
 * Create the Node half of one DSH plugin package.
 *
 * Package-local modules are bundled into the entry. Bare imports remain real
 * install-time dependencies so the published manifest stays authoritative.
 *
 * @param id - Published package name used in build diagnostics.
 * @param entries - JavaScript entries previously emitted under `lib/types`.
 * @param overrides - Narrow package-specific tsdown overrides, such as a Typert plugin.
 * @returns A tsdown configuration that writes ESM entries under `lib`.
 */
export function nodeBundle(
  id: string,
  entries: readonly string[],
  overrides: UserConfig = {},
): UserConfig {
  if (id.length === 0) throw new Error('node bundle id must not be empty')
  if (entries.length === 0) throw new Error(`node bundle ${id} needs at least one entry`)

  const dependencyRules = {
    neverBundle: (specifier: string): boolean => isBuiltin(specifier) || isBareSpecifier(specifier),
    alwaysBundle: (specifier: string): boolean => !isBuiltin(specifier) && !isBareSpecifier(specifier),
  }

  return {
    name: id,
    entry: [...entries],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    ...overrides,
    deps: {
      ...dependencyRules,
      ...overrides.deps,
    },
  }
}
