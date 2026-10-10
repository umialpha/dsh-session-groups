import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UserConfig } from 'tsdown'
import { describe, expect, it } from 'vitest'
import { clientBundle } from './client-bundle.ts'

function clientConfig(moduleTable: readonly string[] = []): UserConfig {
  const configs = clientBundle('@umialpha/test-client', ['lib/types/index.js'], { moduleTable })({
    env: { DSH_BUILD_FACE: 'client' },
  })
  const config = configs.find(candidate => candidate.platform === 'browser')
  if (config === undefined) throw new Error('client config missing')
  return config
}

describe('client bundle', () => {
  it('emits the DSH closure factory and externalizes exact module-table keys', () => {
    const config = clientConfig(['@umialpha/runtime-service'])
    const rules = config.deps as {
      neverBundle: (specifier: string) => boolean
      alwaysBundle: (specifier: string) => boolean
    }
    const output = config.outputOptions as {
      entryFileNames: string
      banner: (chunk: { fileName: string; isEntry: boolean }) => string
      footer: string
    }

    expect(output.entryFileNames).toBe('client.js')
    expect(output.banner({ fileName: 'client.js', isEntry: true }))
      .toContain('window.__ModuleLoader__.load')
    expect(output.footer).toContain('return module.exports')
    expect(rules.neverBundle('react')).toBe(true)
    expect(rules.neverBundle('@umialpha/runtime-service')).toBe(true)
    expect(rules.neverBundle('@umialpha/runtime-service/subpath')).toBe(false)
    expect(rules.alwaysBundle('clsx')).toBe(true)
  })

  it('rejects relative module-table declarations', () => {
    expect(() => clientConfig(['./runtime.ts'])).toThrow('invalid module-table specifier')
  })
})

describe('CSS Modules', () => {
  it('watches, compiles, and injects the physical stylesheet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-groups-css-'))
    try {
      const stylesheet = join(root, 'Fixture.module.css')
      await writeFile(stylesheet, '.root { color: red; }\n')
      const plugins = clientConfig().plugins as {
        name?: string
        resolveId?: (source: string, importer?: string) => string | null
        load?: (this: { addWatchFile(file: string): void }, id: string) => Promise<string | null>
      }[]
      const plugin = plugins.find(candidate => candidate.name === 'dsh-session-groups-css-modules')
      if (plugin === undefined || typeof plugin.resolveId !== 'function' || typeof plugin.load !== 'function') {
        throw new Error('CSS Modules plugin hooks are incomplete')
      }
      const virtualId = plugin.resolveId('./Fixture.module.css', join(root, 'index.ts'))
      if (typeof virtualId !== 'string') throw new Error('CSS Modules virtual id missing')
      const watched: string[] = []
      const output = await plugin.load.call(
        { addWatchFile: file => watched.push(file) },
        virtualId,
      )

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('data-plugin-css')
      expect(output).toContain('export default')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
