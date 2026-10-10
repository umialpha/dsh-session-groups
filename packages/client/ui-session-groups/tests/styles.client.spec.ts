import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SessionGroupsView.module.css', import.meta.url)), 'utf8')

describe('Session groups styles', () => {
  it('uses the shared accent token only for the active drop target', () => {
    const rule = css.match(/\.dropOver\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''
    expect(rule).toContain('background: var(--dsw-alias-interactive-bg-hover-accent)')
    expect(rule).not.toContain('color-mix(')
    expect(css).not.toContain('.rootDropTarget')
    expect(css).not.toContain('border-left: 2px solid')
  })
})
