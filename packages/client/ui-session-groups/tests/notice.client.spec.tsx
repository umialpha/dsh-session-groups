// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@umialpha/dsh-client-ui-workspace-groups/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SessionGroupsNoticeController,
  SessionGroupsToast,
  type SessionGroupsNotice,
} from '../src/client/notice.tsx'
import { hook, sessionState, workspaceState } from './fixtures.client.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () =>
  import('./fixtures/ui-primitives.tsx'))

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

const standardProps: GlobalStandardProps = {
  usePanelInfo: selector => selector({ activePanelId: null }),
  useResource: () => ({
    status: 'none' as const,
    value: undefined,
    failure: undefined,
    reload: () => {},
  }),
  useSessions: hook(sessionState([])),
  useSessionStatus: hook(new Map()),
  useSessionRetainInfo: () => undefined,
  useWorkspaces: hook(workspaceState([])),
}

describe('Session groups notices', () => {
  it('replaces outcomes, rejects stale dismissal, and stops after disposal', () => {
    const notices = new SessionGroupsNoticeController()
    const listener = vi.fn()
    notices.subscribe(listener)

    notices.show({ text: 'Saved', tone: 'success' })
    const first = notices.getSnapshot()
    expect(first).toEqual({ sequence: 1, text: 'Saved', tone: 'success' })
    notices.show({ text: 'Retry', tone: 'warning' })
    expect(notices.getSnapshot()).toEqual({ sequence: 2, text: 'Retry', tone: 'warning' })
    notices.dismiss(first?.sequence ?? 0)
    expect(notices.getSnapshot()?.sequence).toBe(2)
    notices.dismiss(2)
    expect(notices.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)

    notices.dispose()
    notices.show({ text: 'Ignored', tone: 'success' })
    expect(notices.getSnapshot()).toBeNull()
  })

  it('renders success and warning outcomes and dismisses the current sequence after expiry', () => {
    vi.useFakeTimers()
    const dismissNotice = vi.fn()
    let notice: SessionGroupsNotice = { sequence: 1, text: 'Saved', tone: 'success' }
    const useSessionGroupsNotice = <T,>(selector: (value: typeof notice | null) => T): T => selector(notice)
    const view = render(
      <SessionGroupsToast
        {...standardProps}
        useSessionGroupsNotice={useSessionGroupsNotice}
        dismissNotice={dismissNotice}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('Saved')
    expect(screen.getByRole('alert').querySelector('[aria-hidden]')).toBeTruthy()

    notice = { sequence: 2, text: 'Retry', tone: 'warning' }
    view.rerender(
      <SessionGroupsToast
        {...standardProps}
        useSessionGroupsNotice={useSessionGroupsNotice}
        dismissNotice={dismissNotice}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('Retry')
    vi.advanceTimersByTime(4000)
    expect(dismissNotice).toHaveBeenCalledWith(2)

    const onAction = vi.fn()
    notice = {
      sequence: 3,
      text: 'Migration required',
      tone: 'warning',
      holdMs: 6000,
      action: { label: 'Open source', onClick: onAction },
    }
    view.rerender(
      <SessionGroupsToast
        {...standardProps}
        useSessionGroupsNotice={useSessionGroupsNotice}
        dismissNotice={dismissNotice}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }))
    expect(dismissNotice).toHaveBeenLastCalledWith(3)
    expect(onAction).toHaveBeenCalledOnce()
  })
})
