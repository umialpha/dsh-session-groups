import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import { defineConfig } from 'tsdown'

function isClientFace(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`--env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

export default defineConfig(({ env }) => {
  const client = isClientFace(env?.DSH_BUILD_FACE)
  return {
    workspace: ['packages/*/*'],
    entry: client ? '' : ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
