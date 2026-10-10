import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(root, '../../client/ui-workspace-groups')

const DSH_VERSION = '0.2.1-alpha.2'
const WORKSPACE_DSH_PEERS = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-workspace-controller',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-product-analytics',
  '@deepseek-ai/dsh-client-shortcuts',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-schedule',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-util-values',
  '@deepseek-ai/dsh-util-workspace-path',
] as const

describe('session-groups bundle', () => {
  it('owns one precise profile replacement layer', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
      dependencies: Record<string, string>
      dsh: { bundle: { patch: string } }
    }
    expect(manifest.peerDependencies['@deepseek-ai/dsh']).toBe(DSH_VERSION)
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@umialpha/dsh-client-ui-session-groups',
      '@umialpha/dsh-client-ui-workspace-groups',
      '@umialpha/dsh-session-group-registry',
    ])
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')

    const patch = load(await readFile(resolve(root, 'cordis.patch.yml'), 'utf8'))
    expect(patch).toEqual([
      {
        id: 'ui-workspace',
        name: '@deepseek-ai/dsh-client-ui-workspace',
        disabled: true,
      },
      {
        insert: [
          {
            id: 'session-group-registry',
            name: '@umialpha/dsh-session-group-registry',
            config: { maxTitleBytes: 80 },
          },
          { id: 'ui-workspace-groups', name: '@umialpha/dsh-client-ui-workspace-groups' },
          { id: 'ui-session-groups', name: '@umialpha/dsh-client-ui-session-groups' },
        ],
      },
    ])
  })

  it('publishes the Workspace fork against only the supported DSH release', async () => {
    const manifest = JSON.parse(await readFile(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      peerDependencies: Record<string, string>
    }

    expect(manifest.exports).not.toHaveProperty('./src/*')
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBe('4.0.5-alpha.1')
    expect(Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-')).sort())
      .toEqual([...WORKSPACE_DSH_PEERS].sort())
    for (const peer of WORKSPACE_DSH_PEERS) {
      expect(manifest.peerDependencies[peer]).toBe(DSH_VERSION)
    }
  })
})
