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

  it('keeps sibling headings neutral and bounds the Pinned body with the shared scrollbar skin', () => {
    const root = css.match(/\.root\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''
    const header = css.match(/\.header\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''
    const list = css.match(/\.list\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''
    expect(root).toContain('max-height: 45%')
    expect(root).toContain('min-height: 0')
    expect(header).toContain('color: var(--dsw-alias-label-tertiary)')
    expect(header).toContain('padding-left: 4px')
    expect(list).toContain('overflow-y: auto')
    expect(list).toContain('padding-top: 6px')
    expect(list).toContain('padding-bottom: 6px')
    expect(list).toContain('scrollbar-gutter: stable')
    expect(list).toContain('--dsh-scrollbar-width')
    expect(css).not.toContain('::-webkit-scrollbar')
  })
})
