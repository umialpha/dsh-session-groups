// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { GroupSessionNode } from '../src/client/derive.ts'
import {
  SessionGroupRow,
  sessionStatuses,
  type SessionRowDragProps,
} from '../src/client/SessionGroupRow.tsx'
import { zh } from '../src/client/locales.ts'
import { sid } from './fixtures.client.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () =>
  import('./fixtures/ui-primitives.tsx'))

afterEach(() => { cleanup(); vi.useRealTimers() })

const t = ((key: keyof typeof zh, params?: Readonly<Record<string, string | number>>): string => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}) as never

function node(overrides: Partial<GroupSessionNode> = {}): GroupSessionNode {
  return {
    id: sid('one'),
    title: 'Persisted one',
    displayTitle: 'One',
    blank: false,
    running: false,
    runningSubagentCount: 0,
    completed: false,
    updatedAt: 0,
    workspace: 'Project Alpha',
    ...overrides,
  }
}

function drag(overrides: Partial<SessionRowDragProps> = {}): SessionRowDragProps {
  return {
    start: vi.fn(),
    end: vi.fn(),
    active: false,
    marker: null,
    hover: vi.fn(),
    drop: vi.fn(),
    disabled: false,
    ...overrides,
  }
}

function mount(overrides: {
  node?: GroupSessionNode
  drag?: SessionRowDragProps
  currentId?: string
  now?: number
  grouped?: boolean
} = {}) {
  const callbacks = {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onFork: vi.fn(),
    onArchive: vi.fn(),
    onMoveToRoot: vi.fn(),
    onUnpin: vi.fn(),
  }
  const rowDrag = overrides.drag ?? drag()
  const item = overrides.node ?? node()
  const rendered = render(
    <SessionGroupRow
      node={item}
      currentId={overrides.currentId}
      now={overrides.now ?? 0}
      drag={rowDrag}
      onOpen={callbacks.onOpen}
      onRename={callbacks.onRename}
      onFork={callbacks.onFork}
      onArchive={callbacks.onArchive}
      onUnpin={callbacks.onUnpin}
      {...overrides.grouped ? { onMoveToRoot: callbacks.onMoveToRoot } : {}}
      t={t}
    />,
  )
  return { ...rendered, ...callbacks, drag: rowDrag, node: item }
}

/** jsdom has no DragEvent constructor carrying coordinates. */
function fireDrag(row: HTMLElement, kind: 'dragOver' | 'drop', clientY: number): Event {
  const event = kind === 'dragOver' ? createEvent.dragOver(row) : createEvent.drop(row)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', {
    value: { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() },
  })
  fireEvent(row, event)
  return event
}

describe('SessionGroupRow', () => {
  it('projects the complete status precedence including secondary subagent activity', () => {
    expect(sessionStatuses(node({ pendingInteraction: 'approval', running: true, runningSubagentCount: 1 }), t))
      .toEqual([
        { state: 'warning', label: '等待审批' },
        { state: 'ongoing', label: '1 个子代理运行中' },
      ])
    expect(sessionStatuses(node({ pendingInteraction: 'plan-review' }), t))
      .toEqual([{ state: 'warning', label: '计划待审' }])
    expect(sessionStatuses(node({ pendingInteraction: 'question' }), t))
      .toEqual([{ state: 'warning', label: '等待回答' }])
    expect(sessionStatuses(node({ running: true, runningSubagentCount: 2 }), t))
      .toEqual([
        { state: 'ongoing', label: '进行中' },
        { state: 'ongoing', label: '2 个子代理运行中' },
      ])
    expect(sessionStatuses(node({ runningSubagentCount: 1 }), t))
      .toEqual([{ state: 'ongoing', label: '1 个子代理运行中' }])
    expect(sessionStatuses(node({ completed: true }), t))
      .toEqual([{ state: 'done', label: '已完成' }])
    expect(sessionStatuses(node(), t)).toEqual([{ state: 'done', label: '空闲' }])
  })

  it('renders selection, Workspace context, blank rows, and every relative-time band', () => {
    const minute = 60_000
    const cases = [
      [-1, '刚刚'],
      [minute, '1分钟'],
      [60 * minute, '1小时'],
      [24 * 60 * minute, '1天'],
      [30 * 24 * 60 * minute, '1个月'],
      [365 * 24 * 60 * minute, '1年'],
    ] as const
    for (const [age, expected] of cases) {
      const now = 500 * 365 * 24 * 60 * minute
      const ui = mount({ node: node({ updatedAt: now - age }), currentId: 'one', now })
      const row = screen.getByRole('treeitem')
      expect(row.getAttribute('aria-selected')).toBe('true')
      expect(screen.getByText('Project Alpha')).toBeTruthy()
      expect(screen.getByText(expected)).toBeTruthy()
      ui.unmount()
    }

    mount({ node: node({ blank: true, workspace: '' }), currentId: 'other' })
    expect(screen.getByText('新会话')).toBeTruthy()
    expect(screen.getByText('无工作区')).toBeTruthy()
    expect(screen.queryByText('刚刚')).toBeNull()
    expect(screen.getByRole('treeitem').querySelector('[data-state]')).toBeNull()
    expect(screen.queryByRole('button', { name: '会话“新会话”的操作' })).toBeNull()
  })

  it('opens the Session and dispatches every menu action without opening from the menu button', () => {
    const ui = mount({ node: node({ completed: true }) })
    const row = screen.getByRole('treeitem')
    expect(row.querySelector('[data-state="done"]')).toBeTruthy()
    fireEvent.click(row)
    expect(ui.onOpen).toHaveBeenCalledWith(sid('one'))

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    expect(ui.onOpen).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    expect(ui.onRename).toHaveBeenCalledWith(sid('one'), 'Persisted one')

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '分叉会话' }))
    expect(ui.onFork).toHaveBeenCalledWith(sid('one'))

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    expect(screen.queryByRole('menuitem', { name: '移出分组' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '取消置顶' }))
    expect(ui.onUnpin).toHaveBeenCalledWith(sid('one'))

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    expect(ui.onArchive).toHaveBeenCalledWith(sid('one'))

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers named-group members removal before the native unpin action', () => {
    const ui = mount({ grouped: true })
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移出分组' }))
    expect(ui.onMoveToRoot).toHaveBeenCalledWith(sid('one'))

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '取消置顶' }))
    expect(ui.onUnpin).toHaveBeenCalledWith(sid('one'))
  })

  it('keeps a blank named-group row openable without actions or drag-source behavior', () => {
    const ui = mount({ grouped: true, node: node({ blank: true }) })
    const row = screen.getByRole('treeitem')
    expect(row.getAttribute('draggable')).toBe('false')
    expect(screen.queryByRole('button')).toBeNull()

    fireEvent.click(row)
    expect(ui.onOpen).toHaveBeenCalledWith(sid('one'))

    const transfer = { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
    fireEvent.dragStart(row, { dataTransfer: transfer })
    fireEvent.dragEnd(row)
    expect(transfer.effectAllowed).toBe('uninitialized')
    expect(transfer.setData).not.toHaveBeenCalled()
    expect(ui.drag.start).not.toHaveBeenCalled()
    expect(ui.drag.end).not.toHaveBeenCalled()
    expect(ui.onRename).not.toHaveBeenCalled()
    expect(ui.onFork).not.toHaveBeenCalled()
    expect(ui.onArchive).not.toHaveBeenCalled()
    expect(ui.onMoveToRoot).not.toHaveBeenCalled()
    expect(ui.onUnpin).not.toHaveBeenCalled()
  })

  it('wires native drag start/end and resolves pointer halves only while a drag is active', () => {
    const rowDrag = drag({ active: true, marker: 'before' })
    mount({ drag: rowDrag })
    const row = screen.getByRole('treeitem')
    row.getBoundingClientRect = () => ({
      top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40,
      x: 0, y: 100, toJSON: () => ({}),
    })
    const transfer = { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
    fireEvent.dragStart(row, { dataTransfer: transfer })
    expect(transfer.effectAllowed).toBe('move')
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', sid('one'))
    expect(rowDrag.start).toHaveBeenCalledOnce()

    expect(fireDrag(row, 'dragOver', 101).defaultPrevented).toBe(true)
    expect(rowDrag.hover).toHaveBeenLastCalledWith('before')
    expect(fireDrag(row, 'drop', 139).defaultPrevented).toBe(true)
    expect(rowDrag.drop).toHaveBeenLastCalledWith('after')
    fireEvent.dragEnd(row)
    expect(rowDrag.end).toHaveBeenCalledOnce()

    const inactive = drag({ active: false, disabled: true, marker: 'after' })
    cleanup()
    mount({ drag: inactive })
    const disabled = screen.getByRole('treeitem')
    expect(disabled.getAttribute('draggable')).toBe('false')
    expect(fireDrag(disabled, 'dragOver', 0).defaultPrevented).toBe(false)
    expect(fireDrag(disabled, 'drop', 0).defaultPrevented).toBe(false)
    expect(inactive.hover).not.toHaveBeenCalled()
    expect(inactive.drop).not.toHaveBeenCalled()
  })
})
