import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { access, appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dshCli = cliOption('--dsh-cli')
const publicInstall = process.argv.includes('--public')
const keep = process.argv.includes('--keep')

if (dshCli === undefined) {
  throw new Error('usage: node tests/install/session-groups.smoke.mjs --dsh-cli /absolute/path/to/dsh [--public] [--keep]')
}

await access(dshCli, constants.X_OK)

const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-session-groups-install-'))
const packDir = join(tempRoot, 'packs')
const dshHome = join(tempRoot, 'home')
const profileDir = join(dshHome, 'profiles', 'web')
const userConfig = join(tempRoot, 'public-user.npmrc')
const globalConfig = join(tempRoot, 'public-global.npmrc')
const cwd = publicInstall ? tempRoot : repoRoot
if (!publicInstall) await mkdir(packDir)

const packages = [
  ['packages/client/ui-workspace-groups', 'umialpha-dsh-client-ui-workspace-groups-0.1.0.tgz'],
  ['packages/session/session-group-registry', 'umialpha-dsh-session-group-registry-0.1.0.tgz'],
  ['packages/client/ui-session-groups', 'umialpha-dsh-client-ui-session-groups-0.1.0.tgz'],
  ['packages/bundle/session-groups', 'umialpha-dsh-session-groups-0.1.0.tgz'],
]

const parentEnv = publicInstall
  ? Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(npm|pnpm)_config_/i.test(name) && name !== 'NPM_TOKEN' && name !== 'NODE_AUTH_TOKEN'))
  : process.env
const env = {
  ...parentEnv,
  DSH_HOME: dshHome,
  ...(publicInstall ? {
    XDG_CONFIG_HOME: join(tempRoot, 'pnpm-config'),
    PNPM_CONFIG_NPMRC_AUTH_FILE: userConfig,
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
  } : {}),
}
const registryArgs = publicInstall ? ['--registry=https://registry.npmjs.org/'] : []

try {
  if (publicInstall) {
    await appendFile(userConfig, '')
    await appendFile(globalConfig, '')
  }
  if (!publicInstall) {
    await run('pnpm', ['run', 'build'], { cwd: repoRoot })
    for (const [directory] of packages) {
      await run('pnpm', ['--dir', directory, 'pack', '--pack-destination', packDir], { cwd: repoRoot })
    }
  }

  const [workspaceTarball, registryTarball, uiTarball, bundleTarball] = packages
    .map(([, filename]) => join(packDir, filename))
  await run(dshCli, ['web', '--dump-config'], { cwd, env })

  if (!publicInstall) {
    await appendFile(join(profileDir, 'pnpm-workspace.yaml'), [
      '',
      '# Resolve unpublished package dependencies from the tarballs under test.',
      'overrides:',
      `  '@umialpha/dsh-client-ui-session-groups@0.1.0': file:${uiTarball}`,
      `  '@umialpha/dsh-client-ui-workspace-groups@0.1.0': file:${workspaceTarball}`,
      `  '@umialpha/dsh-session-group-registry@0.1.0': file:${registryTarball}`,
      '',
    ].join('\n'))
  }

  const bundleSpecifier = publicInstall ? '@umialpha/dsh-session-groups@0.1.0' : bundleTarball
  await run(dshCli, ['plugin', '--profile', 'web', 'add', bundleSpecifier, ...registryArgs], { cwd, env })
  await assertInstalledPackages(profileDir)

  const enabled = await run(dshCli, ['web', '--dump-config'], { cwd, env })
  assertEnabledConfig(enabled.stdout)
  await startAndStopWeb(dshCli, cwd, env)

  await run(dshCli, ['plugin', '--profile', 'web', 'remove', '@umialpha/dsh-session-groups'], {
    cwd,
    env,
  })
  const recovered = await run(dshCli, ['web', '--dump-config'], { cwd, env })
  assertRecoveredConfig(recovered.stdout)
  await startAndStopWeb(dshCli, cwd, env)

  process.stdout.write(`install smoke passed: ${tempRoot}\n`)
} finally {
  if (!keep) await rm(tempRoot, { recursive: true, force: true })
}

function cliOption(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} needs a value`)
  }
  return resolve(value)
}

async function assertInstalledPackages(profileDirectory) {
  const expected = new Map([
    ['dsh-client-ui-session-groups', '@umialpha/dsh-client-ui-session-groups'],
    ['dsh-client-ui-workspace-groups', '@umialpha/dsh-client-ui-workspace-groups'],
    ['dsh-session-group-registry', '@umialpha/dsh-session-group-registry'],
    ['dsh-session-groups', '@umialpha/dsh-session-groups'],
  ])

  for (const [directory, name] of expected) {
    const manifest = JSON.parse(await readFile(
      join(profileDirectory, 'node_modules', '@umialpha', directory, 'package.json'),
      'utf8',
    ))
    assert.equal(manifest.name, name)
    assert.equal(manifest.version, '0.1.0')
  }
}

function assertEnabledConfig(config) {
  const official = [
    '- id: ui-workspace',
    "  name: '@deepseek-ai/dsh-client-ui-workspace'",
    '  disabled: true',
  ].join('\n')
  assert.match(config, new RegExp(escapeRegExp(official)))
  assert.match(config, /- id: session-group-registry\n  name: '@umialpha\/dsh-session-group-registry'/)
  assert.match(config, /- id: ui-workspace-groups\n  name: '@umialpha\/dsh-client-ui-workspace-groups'/)
  assert.match(config, /- id: ui-session-groups\n  name: '@umialpha\/dsh-client-ui-session-groups'/)
}

function assertRecoveredConfig(config) {
  const official = [
    '- id: ui-workspace',
    "  name: '@deepseek-ai/dsh-client-ui-workspace'",
  ].join('\n')
  assert.match(config, new RegExp(escapeRegExp(official)))
  assert.doesNotMatch(config, new RegExp(`${escapeRegExp(official)}\\n  disabled: true`))
  assert.doesNotMatch(config, /@umialpha\/dsh-/)
}

async function startAndStopWeb(command, cwd, processEnv) {
  const child = spawn(command, ['web', '--no-open', '--port', '0'], {
    cwd,
    env: processEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''

  try {
    const url = await new Promise((resolveUrl, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`timed out waiting for dsh web readiness\n${output}`))
      }, 30_000)
      const inspect = chunk => {
        output += chunk.toString()
        const match = output.match(/dsh web: (http:\/\/[^\s]+)/)
        if (match === null) return
        clearTimeout(timeout)
        resolveUrl(match[1])
      }
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', code => {
        clearTimeout(timeout)
        reject(new Error(`dsh web exited before readiness with ${String(code)}\n${output}`))
      })
    })
    const response = await fetch(url, { redirect: 'manual' })
    assert.equal(response.status, 303)
  } finally {
    if (child.exitCode === null) child.kill('SIGINT')
    await waitForExit(child)
  }
}

async function waitForExit(child) {
  if (child.exitCode !== null) return
  await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('dsh web did not stop after SIGINT'))
    }, 10_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function run(command, args, options) {
  process.stdout.write(`$ ${command} ${args.join(' ')}\n`)
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', resolveExit)
  })
  if (code !== 0) {
    throw new Error(`${command} exited with ${String(code)}\n${stdout}${stderr}`)
  }
  return { stdout, stderr }
}
