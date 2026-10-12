import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { transform } from 'lightningcss'
import type { TsdownPlugin, UserConfig } from 'tsdown'
import { nodeBundle } from './node-bundle.ts'

/** DSH 0.2.1-alpha.2 modules supplied by the Web shell's frozen module table. */
export const DSH_CLIENT_PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

const CSS_VIRTUAL_PREFIX = '\0dsh-session-groups-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const TYPES_MARKER = `${sep}lib${sep}types${sep}`
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

/** Options shared by the three browser-capable packages. */
export interface ClientBundleOptions {
  /** Browser entry emitted by the Client TypeScript face. */
  readonly clientEntry?: string
  /** Additional exact module-table keys imported by this bundle. */
  readonly moduleTable?: readonly string[]
  /** Emit the Node entry during the Host pass instead of the Client pass. */
  readonly hostPhase?: boolean
  /** Package-specific Node-half overrides, including optional build plugins. */
  readonly node?: UserConfig
  /** Optional legal text selected by emitted Client filename. */
  readonly clientBanner?: (fileName: string) => string | undefined
}

/** One of the two independent DSH build programs. */
type BuildFace = 'host' | 'client' | undefined

/** A package tsdown config selected by `DSH_BUILD_FACE`. */
export type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

/**
 * Build a DSH Client plugin as a ModuleLoader closure plus its Node loader entry.
 *
 * The helper intentionally has no repository purity or isolation gate. The
 * exact module-table list is visible at each caller; all other browser-safe
 * dependencies are bundled into the closure.
 *
 * @param id - Published package name and ModuleLoader registration id.
 * @param nodeEntries - JavaScript entries previously emitted by TypeScript.
 * @param options - Client entry, extra module-table keys, and phase placement.
 * @returns A build-face-aware tsdown configuration.
 */
export function clientBundle(
  id: string,
  nodeEntries: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  const node = nodeBundle(id, nodeEntries, options.node)
  const client = clientConfig(id, options)

  return ({ env }) => {
    const face = buildFace(env?.DSH_BUILD_FACE)
    if (face === 'host') return options.hostPhase === true ? [node] : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') return options.hostPhase === true ? [client] : [node, client]
    return [node, client]
  }
}

/** Parse and validate the root build's selected face. */
function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`--env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/** Create the standalone browser closure configuration. */
function clientConfig(id: string, options: ClientBundleOptions): UserConfig {
  if (id.length === 0) throw new Error('client bundle id must not be empty')
  const moduleTable = requestedModules(id, options.moduleTable ?? [])
  const mode = process.env.NODE_ENV ?? 'production'

  return {
    name: `${id}/client`,
    entry: { client: options.clientEntry ?? 'lib/types/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string): boolean => moduleTable.has(specifier),
      alwaysBundle: (specifier: string): boolean => !moduleTable.has(specifier),
    },
    inputOptions: {
      resolve: {
        conditionNames: [
          mode === 'development' ? 'development' : 'production',
          'browser',
          'import',
          'module',
          'default',
        ],
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'import.meta.env.MODE': JSON.stringify(mode),
      'import.meta.env': JSON.stringify({ MODE: mode }),
    },
    plugins: [moduleTablePlugin(moduleTable), cssModulesPlugin(id)],
    outputOptions: {
      entryFileNames: 'client.js',
      chunkFileNames: 'client.[name].js',
      sourcemapExcludeSources: false,
      banner: chunk => {
        const registration = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`
        const legal = options.clientBanner?.(chunk.fileName)
        return legal === undefined ? registration : `${legal}\n${registration}`
      },
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
}

/** Merge the fixed Web platform baseline with exact caller declarations. */
function requestedModules(id: string, additional: readonly string[]): ReadonlySet<string> {
  const modules = new Set<string>(DSH_CLIENT_PLATFORM_MODULES)
  for (const specifier of additional) {
    if (!isBareSpecifier(specifier)) {
      throw new Error(`client bundle ${id} has an invalid module-table specifier ${JSON.stringify(specifier)}`)
    }
    modules.add(specifier)
  }
  return modules
}

/** Whether a specifier can be an exact module-table key. */
function isBareSpecifier(specifier: string): boolean {
  return specifier.length > 0
    && !specifier.startsWith('.')
    && !specifier.startsWith('\0')
    && !isAbsolute(specifier)
}

/** Mark only declared module-table imports as external. */
function moduleTablePlugin(moduleTable: ReadonlySet<string>): TsdownPlugin {
  return {
    name: 'dsh-session-groups-module-table',
    resolveId: {
      order: 'pre',
      handler(source: string, importer: string | undefined) {
        if (importer === undefined || !moduleTable.has(source)) return null
        return { id: source, external: true }
      },
    },
  }
}

/** Compile CSS Modules into a class map and an idempotent style injection. */
function cssModulesPlugin(id: string): TsdownPlugin {
  const sourceRoot = process.cwd()
  return {
    name: 'dsh-session-groups-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      const fileId = sourceAssetPath(source, importer)
      const modulePath = relative(sourceRoot, fileId).split(sep).join('/')
      return CSS_VIRTUAL_PREFIX + modulePath + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = resolve(sourceRoot, virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length))
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const result = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, cssExport] of Object.entries(result.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        classMap[local] = cssExport.name
      }
      return styleInjectionModule(id, fileId, result.code.toString(), classMap)
    },
  }
}

/** Resolve a stylesheet next to source even when its importer came from `lib/types`. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = isAbsolute(source) ? source : resolve(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

/** Render one CSS Module as a browser module with a default class-map export. */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap: Readonly<Record<string, string>>,
): string {
  const tagId = `${id}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
    '  const tag = document.createElement("style");',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}
