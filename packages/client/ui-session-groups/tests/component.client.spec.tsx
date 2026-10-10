// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  SessionPendingInteractionBase, SessionStatus, SessionStatusSnapshot,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionGroupsFailure } from '@umialpha/dsh-session-group-registry/types'
import {
  failureMessage,
  SessionGroupsView,
} from '../src/client/SessionGroupsView.tsx'
import type { SessionGroupsActionResult, SessionGroupsView as ControllerView } from '../src/client/controller.ts'
import type { SessionGroupsViewProps } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'
import {
  controllerView,
  gid,
  group,
  hook,
  sessionState,
  sid,
  snapshot,
  summary,
  workspace,
  workspaceState,
} from './fixtures.client.ts'
import { zh as commonZh } from './fixtures/common-locales.ts'
import { makeTranslate } from './fixtures/runtime.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () =>
  import('./fixtures/ui-primitives.tsx'))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t: SessionGroupsViewProps['t'] = makeTranslate(zh, commonZh)
const OK: SessionGroupsActionResult = { ok: true }
const useResource = (() => ({
  status: 'none' as const,
  value: undefined,
  failure: undefined,
  reload: () => {},
})) as GlobalStandardProps['useResource']

function readyView(overrides: Partial<ControllerView> = {}): ControllerView {
  return controllerView({
    snapshot: snapshot([
      group('work', 'Work', ['one', 'two']),
      group('play', 'Play', ['three']),
      group('empty', 'Empty'),
    ]),
    ...overrides,
  })
}

function mount(options: {
  view?: ControllerView
  pendingInteraction?: 'approval' | 'plan-review' | 'question'
  externalSessionId?: string
  blankSession?: boolean
  pinnedSessionIds?: readonly string[]
  panelActive?: boolean
} = {}) {
  let currentView = options.view ?? readyView()
  let externalSessionId = options.externalSessionId
  const sessions = sessionState([
    summary('one', 4, {
      displayTitle: 'One',
      running: true,
      blank: options.blankSession ?? false,
      retainedBy: { mainView: 1 },
    }),
    summary('two', 3, { displayTitle: 'Two' }),
    summary('three', 2, { displayTitle: 'Three' }),
    summary('loose', 1, { displayTitle: 'Loose', cwd: '/personal/hobby' }),
  ])
  const pending = options.pendingInteraction === undefined
    ? undefined
    : ({
      key: 'pending-one', kind: options.pendingInteraction, sessionId: sid('one'),
    } satisfies SessionPendingInteractionBase) as NonNullable<SessionStatus['pendingInteraction']>
  const oneStatus: SessionStatus = {
    running: undefined,
    pendingInteraction: pending,
    completionUnread: false,
  }
  const twoStatus: SessionStatus = {
    running: undefined,
    pendingInteraction: undefined,
    completionUnread: true,
  }
  const statuses: SessionStatusSnapshot = new Map([
    [sid('one'), oneStatus],
    [sid('two'), twoStatus],
  ])
  const workspaces = workspaceState([
    workspace('alpha', ['one', 'three'], 'Alpha'),
    workspace('beta', ['two'], 'Beta'),
  ], [], (options.pinnedSessionIds ?? ['one', 'two', 'three']).map(sid))
  const actions = {
    ensure: vi.fn(async () => OK),
    refresh: vi.fn(async () => OK),
    createGroup: vi.fn(async () => OK),
    renameGroup: vi.fn(async () => OK),
    deleteGroup: vi.fn(async () => OK),
    insertGroupBefore: vi.fn(async () => OK),
    moveSession: vi.fn(async () => OK),
    open: vi.fn(),
    renameSession: vi.fn(async () => {}),
    forkSession: vi.fn<SessionGroupsViewProps['forkSession']>(async () => 'forked'),
    archiveSession: vi.fn<SessionGroupsViewProps['archiveSession']>(async () => ({ kind: 'archived' })),
    unpinSession: vi.fn(async () => {}),
    notify: vi.fn(),
  }
  const claimDrop = vi.fn()
  const props = (): SessionGroupsViewProps => ({
    activeSessionDrag: externalSessionId === undefined
      ? null
      : { sessionId: sid(externalSessionId), claimDrop },
    useSessions: hook(sessions),
    useSessionStatus: hook(statuses),
    useSessionRetainInfo: () => undefined,
    usePanelInfo: selector => selector({
      activePanelId: options.panelActive ? 'plugins' as MainPanelId : null,
    }),
    useResource,
    useWorkspaces: hook(workspaces),
    useSessionGroups: selector => selector(currentView),
    ...actions,
    t,
  })
  const rendered = render(<SessionGroupsView {...props()} />)
  return {
    ...rendered,
    ...actions,
    claimDrop,
    update(next: Partial<ControllerView>) {
      currentView = { ...currentView, ...next }
      rendered.rerender(<SessionGroupsView {...props()} />)
    },
    setExternalSessionDrag(sessionId: string | undefined) {
      externalSessionId = sessionId
      rendered.rerender(<SessionGroupsView {...props()} />)
    },
  }
}

function dragTransfer() {
  return { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
}

/** Dispatch one native drag event with the pointer coordinate retained in jsdom. */
function fireDrag(target: HTMLElement, kind: 'dragOver' | 'drop', clientY: number): Event {
  const event = kind === 'dragOver' ? createEvent.dragOver(target) : createEvent.drop(target)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: dragTransfer() })
  fireEvent(target, event)
  return event
}

function stubRect(target: HTMLElement): void {
  target.getBoundingClientRect = () => ({
    top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40,
    x: 0, y: 100, toJSON: () => ({}),
  })
}

function groupRow(name: string): HTMLElement {
  return screen.getByText(name).closest('[role="treeitem"]') as HTMLElement
}

function sessionRow(name: string): HTMLElement {
  return screen.getByText(name).closest('[role="treeitem"]') as HTMLElement
}

describe('SessionGroupsView', () => {
  it('translates every stable Host and client failure', () => {
    const failures: readonly [SessionGroupsFailure | { code: 'busy' | 'disposed' | 'transport'; message: string }, string][] = [
      [{ code: 'revision-conflict', current: snapshot() }, '置顶布局已在其他窗口中更新，已载入最新状态'],
      [{ code: 'title-blank' }, '分组名称不能为空'],
      [{ code: 'title-too-large', maxBytes: 80, actualBytes: 81 }, '分组名称不能超过 80 字节'],
      [{ code: 'title-conflict', title: 'Work', existingGroupId: gid('work') }, '已存在名为“Work”的分组'],
      [{ code: 'group-not-found', groupId: gid('gone') }, '该分组已不存在，请重试'],
      [{ code: 'session-not-found', sessionId: sid('gone') }, '该会话已不存在'],
      [{ code: 'session-archived', sessionId: sid('gone') }, '该会话已归档，无法置顶'],
      [{ code: 'session-anchor-not-found', targetGroupId: gid('work'), beforeSessionId: sid('gone') }, '目标位置已变化，请重试'],
      [{ code: 'busy', message: 'busy' }, '另一项置顶布局更改正在提交'],
      [{ code: 'disposed', message: 'disposed' }, '置顶分组插件已卸载'],
      [{ code: 'transport', message: 'offline' }, '无法连接置顶布局服务'],
    ]
    for (const [failure, expected] of failures) {
      expect(failureMessage(failure, t)).toBe(expected)
    }
  })

  it('renders the Pinned root before named groups without a default-group label', () => {
    const ui = mount()
    expect(ui.ensure).toHaveBeenCalledOnce()
    expect(screen.getByRole('group', { name: '置顶会话' })).toBeTruthy()
    expect(screen.getByText('置顶')).toBeTruthy()
    expect(screen.queryByText('未分组')).toBeNull()
    expect(screen.queryByText('默认')).toBeNull()
    expect(screen.queryByText('Loose')).toBeNull()

    ui.update({ snapshot: snapshot([], 'revision-2', ['one', 'two', 'three']) })
    const rootRows = screen.getAllByRole('treeitem')
    expect(rootRows.map(row => row.textContent)).toEqual([
      expect.stringContaining('One'),
      expect.stringContaining('Two'),
      expect.stringContaining('Three'),
    ])

    cleanup()
    mount({ view: controllerView({ snapshot: snapshot() }), pinnedSessionIds: [] })
    expect(screen.getByText('尚无置顶会话')).toBeTruthy()
  })

  it('keeps the Pinned tree geometry stable while a project Session drag starts', () => {
    const ui = mount({
      view: controllerView({
        snapshot: snapshot([
          group('play', 'Play', ['three']),
          group('empty', 'Empty'),
        ], 'stable-layout', ['one', 'two']),
      }),
    })
    const rootRow = sessionRow('One')
    const list = rootRow.parentElement as HTMLElement
    const children = [...list.children]
    const header = screen.getByText('置顶').closest('button')!.parentElement as HTMLElement
    const headerClass = header.className

    ui.setExternalSessionDrag('loose')

    expect([...list.children]).toEqual(children)
    expect(screen.queryByText('拖到置顶区域')).toBeNull()
    expect(header.className).toBe(headerClass)

    fireDrag(header, 'dragOver', 0)
    expect(header.className).not.toBe(headerClass)
    fireDrag(header, 'drop', 0)
    expect(ui.claimDrop).toHaveBeenCalledOnce()
    expect(ui.moveSession).toHaveBeenCalledWith(sid('loose'), null, null)
  })

  it('folds all Pinned rows and preserves the named-group disclosure state', () => {
    mount()
    fireEvent.click(groupRow('Work'))
    expect(screen.queryByText('One')).toBeNull()

    const collapse = screen.getByRole('button', { name: '折叠置顶' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(collapse)
    const expand = screen.getByRole('button', { name: '展开置顶' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Work')).toBeNull()
    expect(screen.queryByRole('treeitem')).toBeNull()
    expect(screen.getByRole('button', { name: '创建分组' })).toBeTruthy()

    fireEvent.click(expand)
    expect(groupRow('Work').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('One')).toBeNull()
    expect(screen.getByText('Three')).toBeTruthy()
    fireEvent.click(groupRow('Work'))
    expect(screen.getByText('One')).toBeTruthy()
  })

  it('keeps a folded section closed after create failure and opens it after successful creation', async () => {
    const ui = mount()
    fireEvent.click(screen.getByRole('button', { name: '折叠置顶' }))
    fireEvent.click(screen.getByRole('button', { name: '创建分组' }))
    const dialog = screen.getByRole('dialog', { name: '创建分组' })
    const input = within(dialog).getByRole('textbox', { name: '分组名称' })
    fireEvent.change(input, { target: { value: 'Work' } })
    ui.createGroup.mockResolvedValueOnce({
      ok: false,
      error: { code: 'title-conflict', title: 'Work', existingGroupId: gid('work') },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    await waitFor(() => { expect(within(dialog).getByRole('alert')).toBeTruthy() })
    expect(screen.getByRole('button', { name: '展开置顶' })).toBeTruthy()
    expect(screen.queryByText('One')).toBeNull()

    fireEvent.change(input, { target: { value: 'Ideas' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '创建分组' })).toBeNull() })
    expect(screen.getByRole('button', { name: '折叠置顶' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('One')).toBeTruthy()
  })

  it('accepts a project Session on the folded header and expands the Pinned list', () => {
    const ui = mount({ externalSessionId: 'loose' })
    fireEvent.click(screen.getByRole('button', { name: '折叠置顶' }))
    const header = screen.getByRole('button', { name: '展开置顶' }).parentElement as HTMLElement
    expect(screen.queryByText('Work')).toBeNull()
    fireDrag(header, 'dragOver', 0)
    fireDrag(header, 'drop', 0)
    expect(ui.claimDrop).toHaveBeenCalledOnce()
    expect(ui.moveSession).toHaveBeenCalledExactlyOnceWith(sid('loose'), null, null)
    expect(screen.getByRole('button', { name: '折叠置顶' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Work')).toBeTruthy()
  })

  it('keeps the folded header closed when a pending layout refuses another drop', () => {
    const ui = mount({ externalSessionId: 'loose', view: readyView({ pending: true }) })
    fireEvent.click(screen.getByRole('button', { name: '折叠置顶' }))
    const header = screen.getByRole('button', { name: '展开置顶' }).parentElement as HTMLElement
    expect(fireDrag(header, 'drop', 0).defaultPrevented).toBe(false)
    expect(ui.claimDrop).not.toHaveBeenCalled()
    expect(ui.moveSession).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '展开置顶' })).toBeTruthy()
  })

  it('renders loading and both retryable empty-snapshot failure forms', () => {
    const ui = mount({ view: controllerView({ status: 'loading', snapshot: null }) })
    expect(screen.getByRole('status').textContent).toBe('正在加载置顶布局…')

    ui.update({ status: 'error', snapshot: null, error: null })
    expect(screen.getByText('无法加载置顶布局')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(ui.refresh).toHaveBeenCalledOnce()

    ui.update({
      status: 'error',
      snapshot: null,
      error: { code: 'transport', message: 'offline' },
    })
    expect(screen.getByText('无法加载置顶布局')).toBeTruthy()
  })

  it('creates, renames, deletes, and folds named groups', async () => {
    const ui = mount()
    expect(screen.getByText('One')).toBeTruthy()
    fireEvent.click(groupRow('Work'))
    expect(screen.queryByText('One')).toBeNull()
    fireEvent.click(groupRow('Work'))
    expect(screen.getByText('One')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '创建分组' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '创建分组' })).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '创建分组' })).toBeNull()

    const createGate = Promise.withResolvers<SessionGroupsActionResult>()
    ui.createGroup.mockImplementationOnce(() => createGate.promise)
    fireEvent.click(screen.getByRole('button', { name: '创建分组' }))
    const createDialog = screen.getByRole('dialog', { name: '创建分组' })
    const createInput = within(createDialog).getByRole('textbox', { name: '分组名称' })
    expect(within(createDialog).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(createInput, { key: 'Enter' })
    expect(ui.createGroup).not.toHaveBeenCalled()
    fireEvent.compositionStart(createInput)
    fireEvent.change(createInput, { target: { value: '  Ideas  ' } })
    fireEvent.keyDown(createInput, { key: 'Enter' })
    expect(ui.createGroup).not.toHaveBeenCalled()
    fireEvent.compositionEnd(createInput)
    fireEvent.keyDown(createInput, { key: 'Enter' })
    expect(ui.createGroup).toHaveBeenCalledWith('Ideas')
    expect(createInput.hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(createInput, { key: 'Enter' })
    expect(ui.createGroup).toHaveBeenCalledOnce()
    fireEvent.click(within(createDialog).getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('dialog', { name: '创建分组' })).toBeTruthy()
    fireEvent.click(within(createDialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('dialog', { name: '创建分组' })).toBeTruthy()
    await act(async () => { createGate.resolve({ ok: false, error: { code: 'title-blank' } }) })
    expect(createInput.hasAttribute('disabled')).toBe(false)

    expect(within(createDialog).getByRole('alert').textContent).toBe('分组名称不能为空')
    fireEvent.change(createInput, { target: { value: 'Fresh ideas' } })
    expect(within(createDialog).queryByRole('alert')).toBeNull()
    fireEvent.click(within(createDialog).getByRole('button', { name: '创建' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '创建分组' })).toBeNull() })
    expect(ui.notify).toHaveBeenLastCalledWith({ text: '已创建分组', tone: 'success' })

    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const renameDialog = screen.getByRole('dialog', { name: '重命名分组' })
    const renameInput = within(renameDialog).getByRole('textbox', { name: '分组名称' }) as HTMLInputElement
    expect(renameInput.value).toBe('Work')
    fireEvent.change(renameInput, { target: { value: 'Focused' } })
    fireEvent.click(within(renameDialog).getByRole('button', { name: '重命名' }))
    await waitFor(() => { expect(ui.renameGroup).toHaveBeenCalledWith(gid('work'), 'Focused') })

    fireEvent.click(screen.getByRole('button', { name: '分组“Play”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除分组' }))
    const deleteDialog = screen.getByRole('dialog', { name: '删除分组' })
    expect(deleteDialog.textContent).toContain('会话仍保持置顶并回到置顶区域')
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '删除分组' }))
    await waitFor(() => { expect(ui.deleteGroup).toHaveBeenCalledWith(gid('play')) })
  })

  it('resets IME composition when create and rename dialogs are reopened', async () => {
    const ui = mount()

    fireEvent.click(screen.getByRole('button', { name: '创建分组' }))
    let dialog = screen.getByRole('dialog', { name: '创建分组' })
    fireEvent.compositionStart(within(dialog).getByRole('textbox', { name: '分组名称' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '创建分组' }))
    dialog = screen.getByRole('dialog', { name: '创建分组' })
    let input = within(dialog).getByRole('textbox', { name: '分组名称' })
    fireEvent.change(input, { target: { value: 'Ideas' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(ui.createGroup).toHaveBeenCalledWith('Ideas') })

    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    dialog = screen.getByRole('dialog', { name: '重命名分组' })
    fireEvent.compositionStart(within(dialog).getByRole('textbox', { name: '分组名称' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    dialog = screen.getByRole('dialog', { name: '重命名分组' })
    input = within(dialog).getByRole('textbox', { name: '分组名称' })
    fireEvent.change(input, { target: { value: 'Focused' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(ui.renameGroup).toHaveBeenCalledWith(gid('work'), 'Focused') })

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    dialog = screen.getByRole('dialog', { name: '重命名会话' })
    fireEvent.compositionStart(within(dialog).getByRole('textbox', { name: '会话名称' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    dialog = screen.getByRole('dialog', { name: '重命名会话' })
    input = within(dialog).getByRole('textbox', { name: '会话名称' })
    fireEvent.change(input, { target: { value: 'Renamed one' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(ui.renameSession).toHaveBeenCalledWith(sid('one'), 'Renamed one') })
  })

  it('keeps failed deletion open, closes successful deletion, and blocks close while pending', async () => {
    const ui = mount()
    const gate = Promise.withResolvers<SessionGroupsActionResult>()
    ui.deleteGroup.mockImplementationOnce(() => gate.promise)
    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除分组' }))
    const dialog = screen.getByRole('dialog', { name: '删除分组' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除分组' }))
    expect(within(dialog).getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('dialog', { name: '删除分组' })).toBeTruthy()
    const guardedDelete = within(dialog).getByRole('button', { name: '删除分组' })
    guardedDelete.removeAttribute('disabled')
    fireEvent.click(guardedDelete)
    expect(ui.deleteGroup).toHaveBeenCalledOnce()
    await act(async () => { gate.resolve({ ok: false, error: { code: 'group-not-found', groupId: gid('work') } }) })
    expect(ui.notify).toHaveBeenLastCalledWith({
      text: '无法删除分组：该分组已不存在，请重试',
      tone: 'warning',
    })
    expect(screen.getByRole('dialog', { name: '删除分组' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: '删除分组' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除分组' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除分组' })).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除分组' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除分组' })).getByRole('button', { name: '删除分组' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '删除分组' })).toBeNull() })
  })

  it('routes Session open, rename, fork, removal, archive, and shows rename rejection text', async () => {
    const ui = mount({ pendingInteraction: 'question' })
    const one = sessionRow('One')
    expect(one.getAttribute('aria-selected')).toBe('true')
    expect(one.textContent).toContain('等待回答')
    fireEvent.click(one)
    expect(ui.open).toHaveBeenCalledWith(sid('one'))

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '分叉会话' }))
    expect(ui.forkSession).toHaveBeenCalledWith(sid('one'))
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移出分组' }))
    expect(ui.moveSession).toHaveBeenCalledWith(sid('one'), null, null)
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    expect(ui.archiveSession).toHaveBeenCalledWith(sid('one'))

    ui.renameSession.mockRejectedValueOnce(new Error('rename unavailable'))
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const dialog = screen.getByRole('dialog', { name: '重命名会话' })
    const input = within(dialog).getByRole('textbox', { name: '会话名称' }) as HTMLInputElement
    expect(input.value).toBe('One')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(ui.renameSession).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed one' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))
    await waitFor(() => {
      expect(ui.notify).toHaveBeenLastCalledWith({ text: '无法重命名会话，请重试', tone: 'warning' })
    })
    expect(screen.getByRole('dialog', { name: '重命名会话' })).toBeTruthy()

    ui.renameSession.mockRejectedValueOnce('plain rejection')
    fireEvent.change(input, { target: { value: 'Again' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(ui.renameSession).toHaveBeenCalledOnce()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(ui.renameSession).toHaveBeenCalledTimes(2) })

    fireEvent.change(input, { target: { value: 'Final' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '重命名会话' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const finalDialog = screen.getByRole('dialog', { name: '重命名会话' })
    const finalInput = within(finalDialog).getByRole('textbox', { name: '会话名称' })
    fireEvent.change(finalInput, { target: { value: 'Final' } })
    fireEvent.click(within(finalDialog).getByRole('button', { name: '重命名' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '重命名会话' })).toBeNull() })
    expect(ui.renameSession).toHaveBeenLastCalledWith(sid('one'), 'Final')
  })

  it('clears the Pinned selection while a main panel is active', () => {
    mount({ panelActive: true })
    expect(sessionRow('One').getAttribute('aria-selected')).toBe('false')
  })

  it('keeps blank Sessions open without time, actions, or drag behavior', () => {
    const ui = mount({ blankSession: true })
    const row = sessionRow('新会话')
    expect(row.getAttribute('draggable')).toBe('false')
    expect(within(row).queryByText('刚刚')).toBeNull()
    expect(screen.queryByRole('button', { name: '会话“新会话”的操作' })).toBeNull()

    fireEvent.click(row)
    expect(ui.open).toHaveBeenCalledWith(sid('one'))
    expect(ui.moveSession).not.toHaveBeenCalled()
  })

  it('guards the Session rename modal close while pending and closes it when idle', async () => {
    const ui = mount()
    const gate = Promise.withResolvers<undefined>()
    ui.renameSession.mockImplementationOnce(() => gate.promise)
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    let dialog = screen.getByRole('dialog', { name: '重命名会话' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('dialog', { name: '重命名会话' })).toBeTruthy()
    await act(async () => { gate.resolve(undefined) })
    expect(screen.queryByRole('dialog', { name: '重命名会话' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    dialog = screen.getByRole('dialog', { name: '重命名会话' })
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: '重命名会话' })).toBeNull()
  })

  it('reorders named groups with before/after DOM insertion semantics', () => {
    const ui = mount()
    const work = groupRow('Work')
    const play = groupRow('Play')
    stubRect(work)
    stubRect(play)
    const transfer = dragTransfer()

    fireEvent.dragStart(work, { dataTransfer: transfer })
    expect(transfer.effectAllowed).toBe('move')
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', gid('work'))
    expect(fireDrag(play, 'dragOver', 101).defaultPrevented).toBe(true)
    fireDrag(play, 'drop', 101)
    expect(ui.insertGroupBefore).toHaveBeenLastCalledWith(gid('work'), gid('play'))

    fireEvent.dragStart(work, { dataTransfer: dragTransfer() })
    fireDrag(play, 'dragOver', 139)
    fireDrag(play, 'drop', 139)
    expect(ui.insertGroupBefore).toHaveBeenLastCalledWith(gid('work'), gid('empty'))

    fireEvent.dragStart(work, { dataTransfer: dragTransfer() })
    fireDrag(groupRow('Empty'), 'drop', 139)
    expect(ui.insertGroupBefore).toHaveBeenLastCalledWith(gid('work'), null)

    const calls = ui.insertGroupBefore.mock.calls.length
    fireEvent.dragStart(work, { dataTransfer: dragTransfer() })
    fireDrag(work, 'drop', 101)
    expect(ui.insertGroupBefore).toHaveBeenCalledTimes(calls)
    fireEvent.dragEnd(work)
    expect(fireDrag(play, 'dragOver', 120).defaultPrevented).toBe(false)
    expect(fireDrag(play, 'drop', 120).defaultPrevented).toBe(false)
  })

  it('accepts internal Session and group drops over outside editable content without committing them', () => {
    const ui = mount()
    const one = sessionRow('One')
    const work = groupRow('Work')
    const outsideInput = document.createElement('input')
    ui.container.append(outsideInput)

    expect(fireDrag(outsideInput, 'drop', 0).defaultPrevented).toBe(false)

    fireEvent.dragStart(one, { dataTransfer: dragTransfer() })
    const sessionDragOver = fireDrag(outsideInput, 'dragOver', 0)
    expect(sessionDragOver.defaultPrevented).toBe(true)
    expect((sessionDragOver as DragEvent).dataTransfer?.dropEffect).toBe('move')
    expect(fireDrag(outsideInput, 'drop', 0).defaultPrevented).toBe(true)
    expect(ui.moveSession).not.toHaveBeenCalled()
    fireEvent.dragEnd(one)

    fireEvent.dragStart(work, { dataTransfer: dragTransfer() })
    expect(fireDrag(outsideInput, 'dragOver', 0).defaultPrevented).toBe(true)
    expect(fireDrag(outsideInput, 'drop', 0).defaultPrevented).toBe(true)
    expect(ui.insertGroupBefore).not.toHaveBeenCalled()
    fireEvent.dragEnd(work)

    expect(fireDrag(outsideInput, 'drop', 0).defaultPrevented).toBe(false)
  })

  it('moves grouped Sessions across rows, group append targets, and empty bodies', () => {
    const ui = mount()
    const one = sessionRow('One')
    const two = sessionRow('Two')
    const three = sessionRow('Three')
    const play = groupRow('Play')
    stubRect(two)
    stubRect(three)

    fireEvent.dragStart(one, { dataTransfer: dragTransfer() })
    fireDrag(three, 'dragOver', 101)
    fireDrag(three, 'drop', 101)
    expect(ui.moveSession).toHaveBeenLastCalledWith(sid('one'), gid('play'), sid('three'))

    fireEvent.dragStart(one, { dataTransfer: dragTransfer() })
    fireDrag(two, 'drop', 139)
    expect(ui.moveSession).toHaveBeenLastCalledWith(sid('one'), gid('work'), null)

    fireEvent.dragStart(two, { dataTransfer: dragTransfer() })
    fireDrag(play, 'dragOver', 120)
    fireDrag(play, 'drop', 120)
    expect(ui.moveSession).toHaveBeenLastCalledWith(sid('two'), gid('play'), null)

    fireEvent.dragStart(three, { dataTransfer: dragTransfer() })
    fireDrag(groupRow('Empty'), 'dragOver', 120)
    const dropHere = screen.getByText('拖到此处')
    fireDrag(dropHere, 'drop', 120)
    expect(ui.moveSession).toHaveBeenLastCalledWith(sid('three'), gid('empty'), null)
  })

  it('claims a project-tree Session drop before adding its group reference', async () => {
    const ui = mount({ externalSessionId: 'loose' })
    const play = groupRow('Play')

    expect(fireDrag(play, 'dragOver', 120).defaultPrevented).toBe(true)
    fireDrag(play, 'drop', 120)

    expect(ui.claimDrop).toHaveBeenCalledOnce()
    expect(ui.moveSession).toHaveBeenCalledWith(sid('loose'), gid('play'), null)
    expect(ui.claimDrop.mock.invocationCallOrder[0]).toBeLessThan(ui.moveSession.mock.invocationCallOrder[0]!)
    await waitFor(() => {
      expect(ui.notify).toHaveBeenLastCalledWith({ text: '已置顶会话并加入分组', tone: 'success' })
    })
  })

  it('moves Sessions within the Pinned root and between the root and named groups', () => {
    const ui = mount({
      view: controllerView({
        snapshot: snapshot([group('work', 'Work', ['one'])], 'root-layout', ['two', 'three']),
      }),
    })
    const one = sessionRow('One')
    const two = sessionRow('Two')
    const three = sessionRow('Three')
    stubRect(three)

    fireEvent.dragStart(two, { dataTransfer: dragTransfer() })
    fireDrag(three, 'drop', 139)
    expect(ui.moveSession).toHaveBeenLastCalledWith(sid('two'), null, null)

    fireEvent.dragStart(one, { dataTransfer: dragTransfer() })
    fireDrag(three, 'drop', 101)
    expect(ui.moveSession).toHaveBeenLastCalledWith(sid('one'), null, sid('three'))

    fireEvent.dragStart(three, { dataTransfer: dragTransfer() })
    fireDrag(groupRow('Work'), 'drop', 120)
    expect(ui.moveSession).toHaveBeenLastCalledWith(sid('three'), gid('work'), null)
  })

  it('does not claim a pin commit for client-side busy failures', async () => {
    const ui = mount({ externalSessionId: 'loose' })
    ui.moveSession.mockResolvedValueOnce({ ok: false, error: { code: 'busy', message: 'busy' } })
    fireDrag(groupRow('Play'), 'drop', 120)

    await waitFor(() => {
      expect(ui.notify).toHaveBeenLastCalledWith({
        text: '无法更新置顶布局：另一项置顶布局更改正在提交',
        tone: 'warning',
      })
    })
  })

  it('reports committed pin fallback separately from an unknown carrier outcome', async () => {
    const conflict = mount({ externalSessionId: 'loose' })
    conflict.moveSession.mockResolvedValueOnce({
      ok: false,
      error: { code: 'revision-conflict', current: snapshot() },
    })
    fireDrag(groupRow('Play'), 'drop', 120)
    await waitFor(() => {
      expect(conflict.notify).toHaveBeenLastCalledWith({
        text: '会话已置顶，但未能加入目标分组，已保留在置顶区域',
        tone: 'warning',
      })
    })

    cleanup()
    const unknown = mount({ externalSessionId: 'loose' })
    unknown.moveSession.mockResolvedValueOnce({
      ok: false,
      error: { code: 'transport', message: 'disconnected' },
    })
    fireDrag(groupRow('Play'), 'drop', 120)
    await waitFor(() => {
      expect(unknown.notify).toHaveBeenLastCalledWith({
        text: '无法确认置顶布局是否保存，请刷新后检查',
        tone: 'warning',
      })
    })
  })

  it('unpins through the native owner and distinguishes cleanup and unpin failures', async () => {
    const ui = mount()
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '取消置顶' }))
    await waitFor(() => {
      expect(ui.unpinSession).toHaveBeenCalledWith(sid('one'))
      expect(ui.refresh).toHaveBeenCalledOnce()
      expect(ui.notify).toHaveBeenLastCalledWith({ text: '已取消置顶', tone: 'success' })
    })

    ui.refresh.mockResolvedValueOnce({ ok: false, error: { code: 'transport', message: 'offline' } })
    fireEvent.click(screen.getByRole('button', { name: '会话“Two”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '取消置顶' }))
    await waitFor(() => {
      expect(ui.notify).toHaveBeenLastCalledWith({
        text: '已取消置顶，布局清理将在稍后重试',
        tone: 'warning',
      })
    })

    ui.unpinSession.mockRejectedValueOnce(new Error('not unpinned'))
    fireEvent.click(screen.getByRole('button', { name: '会话“Three”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '取消置顶' }))
    await waitFor(() => {
      expect(ui.notify).toHaveBeenLastCalledWith({ text: '无法取消置顶，请重试', tone: 'warning' })
    })
  })

  it('ends abandoned drags and disables every draggable while a mutation is pending', () => {
    const ui = mount()
    const one = sessionRow('One')
    fireEvent.dragStart(one, { dataTransfer: dragTransfer() })
    fireEvent.dragEnd(one)
    const calls = ui.moveSession.mock.calls.length
    fireDrag(sessionRow('Three'), 'drop', 101)
    expect(ui.moveSession).toHaveBeenCalledTimes(calls)

    ui.update({ pending: true })
    expect(groupRow('Work').getAttribute('draggable')).toBe('false')
    expect(sessionRow('One').getAttribute('draggable')).toBe('false')
  })

  it('reports archive rejections through the root-lived notice host', async () => {
    const ui = mount()
    ui.archiveSession.mockRejectedValueOnce(new Error('archive unavailable'))

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))

    await waitFor(() => {
      expect(ui.notify).toHaveBeenLastCalledWith({ text: '无法归档会话，请重试', tone: 'warning' })
    })
  })

  it('confirms stop-and-archive, retaining the dialog and row across retryable failures', async () => {
    const ui = mount()
    const activity = [{ kind: 'turn' as never }]
    ui.archiveSession.mockResolvedValueOnce({ kind: 'session-active', activity })

    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    const dialog = await screen.findByRole('dialog', { name: '停止并归档此会话？' })
    expect(dialog.textContent).toContain('“One”仍有正在进行的工作')
    expect(within(dialog).getByRole('list', { name: '将被停止的工作' }).textContent)
      .toContain('正在进行的会话工作')
    expect(ui.archiveSession).toHaveBeenNthCalledWith(1, sid('one'))

    ui.archiveSession.mockRejectedValueOnce(new Error('stop failed'))
    fireEvent.click(within(dialog).getByRole('button', { name: '停止并归档' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('alert').textContent).toBe('无法停止并归档会话，请重试')
    })
    expect(screen.getByText('One')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '停止并归档此会话？' })).toBeTruthy()
    expect(ui.archiveSession).toHaveBeenNthCalledWith(2, sid('one'), { stopActivity: true })

    fireEvent.click(within(dialog).getByRole('button', { name: '停止并归档' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '停止并归档此会话？' })).toBeNull()
    })
    expect(ui.archiveSession).toHaveBeenNthCalledWith(3, sid('one'), { stopActivity: true })
    expect(ui.notify).toHaveBeenLastCalledWith({ text: '已停止工作并归档会话', tone: 'success' })

    ui.archiveSession.mockResolvedValueOnce({ kind: 'session-active', activity })
    fireEvent.click(screen.getByRole('button', { name: '会话“Two”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    const cancelDialog = await screen.findByRole('dialog', { name: '停止并归档此会话？' })
    fireEvent.click(within(cancelDialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '停止并归档此会话？' })).toBeNull()
  })
})
