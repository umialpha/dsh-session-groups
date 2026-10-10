/** Root-lived Toast state for Pinned-area operation outcomes. */
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** One localized operation outcome retained outside the sidebar surface. */
export interface SessionGroupsNotice {
  readonly sequence: number
  readonly text: string
  readonly tone: 'success' | 'warning'
  readonly holdMs?: number
  readonly action?: {
    readonly label: string
    readonly onClick: () => void
  }
}

/** Notice payload accepted from a mounted Pinned-area action. */
export type SessionGroupsNoticeInput = Omit<SessionGroupsNotice, 'sequence'>

/** Injection shared by the Pinned view and frame-wide Toast entry. */
export interface SessionGroupsNoticeInjected {
  hooks: {
    /** Current notice, or none. */
    sessionGroupsNotice: SessionGroupsNoticeController
  }
  /** Publish one localized outcome. */
  notify: (notice: SessionGroupsNoticeInput) => void
  /** Dismiss the matching notice without retiring a newer one. */
  dismissNotice: (sequence: number) => void
}

/** Props supplied to the root `shell.overlay` entry. */
export type SessionGroupsNoticeProps = PropsRuntime<'shell.overlay'> & {
  useSessionGroupsNotice: SnapshotSelectorHook<SessionGroupsNotice | null>
  dismissNotice: (sequence: number) => void
}

/** Small observable whose lifetime matches the browser plugin, not the sidebar view. */
export class SessionGroupsNoticeController implements HostObservable<SessionGroupsNotice | null> {
  private notice: SessionGroupsNotice | null = null
  private sequence = 0
  private disposed = false
  private readonly listeners = new Set<() => void>()

  /** Return the currently visible notice. */
  getSnapshot = (): SessionGroupsNotice | null => this.notice

  /** Subscribe to notice replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Show one outcome and restart the Toast lifetime. */
  show(input: SessionGroupsNoticeInput): void {
    if (this.disposed) return
    this.sequence += 1
    this.publish({ ...input, sequence: this.sequence })
  }

  /** Dismiss a notice only when its sequence is still current. */
  dismiss(sequence: number): void {
    if (this.notice?.sequence === sequence) this.publish(null)
  }

  /** Stop future publications after plugin unload. */
  dispose(): void {
    this.disposed = true
    this.notice = null
    this.listeners.clear()
  }

  /** Publish one state and contain subscriber defects. */
  private publish(notice: SessionGroupsNotice | null): void {
    this.notice = notice
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-session-groups] notice subscriber threw:', error)
      }
    }
  }
}

/** Render the current operation outcome from the frame-wide overlay. */
export function SessionGroupsToast({ useSessionGroupsNotice, dismissNotice }: SessionGroupsNoticeProps) {
  const notice = useSessionGroupsNotice(value => value)
  if (notice === null) return null
  return (
    <Toast
      key={notice.sequence}
      text={notice.text}
      {...notice.tone === 'success'
        ? { tone: 'success' as const }
        : { icon: <IconWarningOutlineRegular /> }}
      {...notice.holdMs === undefined ? {} : { holdMs: notice.holdMs }}
      {...notice.action === undefined ? {} : {
        actions: [{
          label: notice.action.label,
          onClick: () => {
            dismissNotice(notice.sequence)
            notice.action?.onClick()
          },
        }],
      }}
      onDone={() => { dismissNotice(notice.sequence) }}
    />
  )
}
