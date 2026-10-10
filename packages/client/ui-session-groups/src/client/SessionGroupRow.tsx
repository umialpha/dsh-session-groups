/** Pure Session row used by the global Pinned area. */
import { useState } from 'react'
import clsx from 'clsx'
import {
  IconArchiveOutlineRegular,
  IconBranchOutlineRegular,
  IconEditOutlineRegular,
  IconEllipsisOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
  Menu,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { GroupSessionNode } from './derive.ts'
import type { SessionGroupsViewProps } from './slots.ts'
import css from './SessionGroupRow.module.css'

type Translate = SessionGroupsViewProps['t']

/** Native drag wiring owned by the group list. */
export interface SessionRowDragProps {
  start: () => void
  end: () => void
  active: boolean
  marker: 'before' | 'after' | null
  hover: (half: 'before' | 'after') => void
  drop: (half: 'before' | 'after') => void
  disabled: boolean
}

interface RowStatus {
  state: StateDotState
  label: string
}

/** Closed status projection; user-input waits outrank running and completion. */
export function sessionStatuses(node: GroupSessionNode, t: Translate): readonly [RowStatus, ...RowStatus[]] {
  const subagents: RowStatus | undefined = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(node.runningSubagentCount === 1 ? 'status.subagents.one' : 'status.subagents.other', {
        n: node.runningSubagentCount,
      }),
    }
  let pending: RowStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval': pending = { state: 'warning', label: t('status.approval') }; break
    case 'plan-review': pending = { state: 'warning', label: t('status.planReview') }; break
    case 'question': pending = { state: 'warning', label: t('status.answer') }; break
    case undefined: break
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const running: RowStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [running] : [running, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}

/** Compact relative update label. */
function timeLabel(updatedAt: number, now: number, t: Translate): string {
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const diff = Math.max(0, now - updatedAt)
  if (diff < minute) return t('time.now')
  if (diff < hour) return t('time.minutes', { n: Math.floor(diff / minute) })
  if (diff < day) return t('time.hours', { n: Math.floor(diff / hour) })
  if (diff < 30 * day) return t('time.days', { n: Math.floor(diff / day) })
  if (diff < 365 * day) return t('time.months', { n: Math.floor(diff / (30 * day)) })
  return t('time.years', { n: Math.floor(diff / (365 * day)) })
}

/** Pointer half used to resolve a DOM insert-before anchor. */
function rowHalf(event: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/** Render one Session with Workspace context and existing row actions. */
export function SessionGroupRow({
  node,
  currentId,
  now,
  drag,
  onOpen,
  onRename,
  onFork,
  onArchive,
  onMoveToRoot,
  onUnpin,
  t,
}: {
  node: GroupSessionNode
  currentId: string | undefined
  now: number
  drag: SessionRowDragProps
  onOpen: (id: GroupSessionNode['id']) => void
  onRename: (id: GroupSessionNode['id'], title: string) => void
  onFork: (id: GroupSessionNode['id']) => void
  onArchive: (id: GroupSessionNode['id']) => void
  onMoveToRoot?: (id: GroupSessionNode['id']) => void
  onUnpin: (id: GroupSessionNode['id']) => void
  t: Translate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const title = node.blank ? t('session.new') : node.displayTitle
  const statuses = sessionStatuses(node, t)
  const primary = statuses[0]
  const showStatus = primary.state !== 'done' || node.completed
  const draggable = !node.blank && !drag.disabled
  const membershipItems = [
    ...onMoveToRoot === undefined
      ? []
      : [{ id: 'move-to-root', label: t('session.moveToRoot'), icon: <IconPinOutlineRegular /> }],
    { id: 'unpin', label: t('session.unpin'), icon: <IconPinFillRegular /> },
  ]
  const menuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular /> },
    { id: 'fork', label: t('session.fork'), icon: <IconBranchOutlineRegular /> },
    ...membershipItems,
    { id: 'archive', label: t('session.archive'), icon: <IconArchiveOutlineRegular size={16} /> },
  ]
  return (
    <div
      className={clsx(
        css.row,
        node.id === currentId && css.selected,
        menuOpen && css.menuOpen,
        drag.marker === 'before' && css.dropBefore,
        drag.marker === 'after' && css.dropAfter,
      )}
      role="treeitem"
      aria-selected={node.id === currentId}
      draggable={draggable}
      onClick={() => { onOpen(node.id) }}
      onDragStart={!draggable
        ? undefined
        : (event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', node.id)
          drag.start()
        }}
      onDragEnd={!draggable ? undefined : drag.end}
      onDragOver={(event) => {
        if (!drag.active) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        drag.hover(rowHalf(event))
      }}
      onDrop={(event) => {
        if (!drag.active) return
        event.preventDefault()
        event.stopPropagation()
        drag.drop(rowHalf(event))
      }}
    >
      <span className={css.status}>
        {showStatus && <StateDot state={primary.state} />}
        {statuses.map(status => <span className={css.visuallyHidden} key={status.label}>{status.label}</span>)}
      </span>
      <span className={css.text}>
        <span className={css.title}>{title}</span>
        <span className={css.workspace}>{node.workspace === '' ? t('workspace.none') : node.workspace}</span>
      </span>
      {!node.blank && <span className={css.time}>{timeLabel(node.updatedAt, now, t)}</span>}
      {!node.blank && (
        <span className={css.actions}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={menuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') onRename(node.id, node.title)
              else if (id === 'fork') onFork(node.id)
              else if (id === 'move-to-root') onMoveToRoot?.(node.id)
              else if (id === 'unpin') onUnpin(node.id)
              else onArchive(node.id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.actionButton}
                aria-label={t('session.actions', { name: title })}
                onClick={(event) => { event.stopPropagation(); setMenuOpen(open => !open) }}
              >
                <IconEllipsisOutlineRegular />
              </button>
            )}
          />
        </span>
      )}
    </div>
  )
}
