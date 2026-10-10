/** Global Pinned Session area rendered before the unchanged project tree. */
import { type DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconEditOutlineRegular,
  IconEllipsisOutlineRegular,
  IconListPenOutlineRegular,
  IconPinFillRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  IconTriangleRightFillRegular,
  Input,
  Menu,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionActivity } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionGroupId } from '@umialpha/dsh-session-group-registry/types'
import type {
  SessionGroupsClientFailure,
} from './controller.ts'
import { deriveSessionGroups, type GroupSessionNode, type SessionGroupSection } from './derive.ts'
import { SessionGroupRow } from './SessionGroupRow.tsx'
import type { SessionGroupsViewProps, SessionRenameTarget } from './slots.ts'
import css from './SessionGroupsView.module.css'

type Translate = SessionGroupsViewProps['t']

type GroupDrag = {
  kind: 'group'
  groupId: SessionGroupId
}

type SessionDrag = {
  kind: 'session'
  sessionId: SessionId
}

type ActiveDrag = GroupDrag | SessionDrag

type SessionDrop = {
  targetGroupId: SessionGroupId | null
  beforeSessionId: SessionId | null
}

type SessionArchiveTarget = {
  sessionId: SessionId
  displayTitle: string
  activity: readonly SessionActivity[]
}

/**
 * Accept an internal native drag at document level so releasing outside the
 * Pinned area cannot insert its opaque id into editable content.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

interface NamedGroupActions {
  onDragStart: () => void
  onDragEnd: () => void
  onHover: (half: 'before' | 'after') => void
  onDrop: (half: 'before' | 'after') => void
  onRename: () => void
  onDelete: () => void
}

/** Human-facing text for one Host or carrier failure. */
export function failureMessage(error: SessionGroupsClientFailure, t: Translate): string {
  switch (error.code) {
    case 'revision-conflict': return t('error.revisionConflict')
    case 'title-blank': return t('error.titleBlank')
    case 'title-too-large': return t('error.titleTooLarge', { n: error.maxBytes })
    case 'title-conflict': return t('error.titleConflict', { name: error.title })
    case 'group-not-found': return t('error.groupNotFound')
    case 'session-not-found': return t('error.sessionNotFound')
    case 'session-archived': return t('error.sessionArchived')
    case 'session-anchor-not-found': return t('error.anchorNotFound')
    case 'busy': return t('error.busy')
    case 'disposed': return t('error.disposed')
    case 'transport': return t('error.transport')
  }
}

/** Whether a failed title mutation belongs beside its owning input. */
function titleFailure(error: SessionGroupsClientFailure): boolean {
  return error.code === 'title-blank'
    || error.code === 'title-too-large'
    || error.code === 'title-conflict'
}

/** Pointer half used for group and Session insertion targets. */
function rowHalf(event: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/** Resolve the anchor after dropping before or after one visible Session row. */
function sessionAnchor(
  sessions: readonly GroupSessionNode[],
  targetId: SessionId,
  half: 'before' | 'after',
): SessionId | null {
  if (half === 'before') return targetId
  const index = sessions.findIndex(session => session.id === targetId)
  return sessions[index + 1]?.id ?? null
}

/** Localized summary for one active-work family returned by the Workspace Host. */
function archiveActivityLine(activity: SessionActivity, t: Translate): string {
  const items = activity.items ?? []
  if (items.length === 0) return t('archive.activity.generic')
  const names = items.map(item => item.label ?? item.id).join(t('archive.activity.separator'))
  return t(items.length === 1 ? 'archive.activity.items.one' : 'archive.activity.items.other', {
    n: items.length,
    names,
  })
}

/** One collapsible named group within the Pinned area. */
function GroupSection({
  id,
  title,
  sessions,
  expanded,
  currentId,
  pending,
  activeDrag,
  sessionDragActive,
  canAcceptSessionDrop,
  groupMarker,
  sessionMarker,
  onToggle,
  namedActions,
  onSessionDragStart,
  onSessionDragEnd,
  onSessionHover,
  onSessionDrop,
  onAppendSession,
  onOpen,
  onRenameSession,
  onFork,
  onArchive,
  onMoveToRoot,
  onUnpin,
  t,
}: {
  id: SessionGroupId
  title: string
  sessions: readonly GroupSessionNode[]
  expanded: boolean
  currentId: SessionId | undefined
  pending: boolean
  activeDrag: ActiveDrag | null
  sessionDragActive: boolean
  canAcceptSessionDrop: () => boolean
  groupMarker: 'before' | 'after' | null
  sessionMarker: { id: SessionId; half: 'before' | 'after' } | null
  onToggle: () => void
  namedActions: NamedGroupActions
  onSessionDragStart: (sessionId: SessionId) => void
  onSessionDragEnd: () => void
  onSessionHover: (sessionId: SessionId, half: 'before' | 'after') => void
  onSessionDrop: (sessionId: SessionId, half: 'before' | 'after') => void
  onAppendSession: () => void
  onOpen: (sessionId: SessionId) => void
  onRenameSession: (sessionId: SessionId, title: string) => void
  onFork: (sessionId: SessionId) => void
  onArchive: (sessionId: SessionId) => void
  onMoveToRoot: (sessionId: SessionId) => void
  onUnpin: (sessionId: SessionId) => void
  t: Translate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sessionDropOver, setSessionDropOver] = useState(false)
  useEffect(() => {
    if (!sessionDragActive) setSessionDropOver(false)
  }, [sessionDragActive])
  return (
    <section
      className={clsx(
        css.group,
        sessionDropOver && css.groupDropActive,
        groupMarker === 'before' && css.groupDropBefore,
        groupMarker === 'after' && css.groupDropAfter,
      )}
      onDragOver={(event) => {
        if (!canAcceptSessionDrop()) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setSessionDropOver(true)
      }}
      onDragLeave={(event) => {
        const related = event.relatedTarget
        if (related instanceof Node && event.currentTarget.contains(related)) return
        setSessionDropOver(false)
      }}
      onDrop={(event) => {
        if (!canAcceptSessionDrop()) return
        event.preventDefault()
        event.stopPropagation()
        setSessionDropOver(false)
        onAppendSession()
      }}
    >
      <div
        className={clsx(css.groupHeader, menuOpen && css.menuOpen)}
        role="treeitem"
        aria-expanded={expanded}
        draggable={!pending}
        onClick={onToggle}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', id)
          namedActions.onDragStart()
        }}
        onDragEnd={namedActions.onDragEnd}
        onDragOver={(event) => {
          if (activeDrag?.kind === 'group') {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            namedActions.onHover(rowHalf(event))
          }
        }}
        onDrop={(event) => {
          if (activeDrag?.kind !== 'group') return
          namedActions.onDrop(rowHalf(event))
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <span className={css.groupIcon}>
          <IconListPenOutlineRegular />
        </span>
        <IconTriangleRightFillRegular className={clsx(css.chevron, expanded && css.chevronOpen)} />
        <span className={css.groupTitle}>{title}</span>
        <span className={css.groupCount}>{sessions.length}</span>
        <span className={css.groupActions}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={[
              { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular /> },
              { id: 'delete', label: t('group.delete'), icon: <IconTrashOutlineRegular />, danger: true },
            ]}
            onSelect={(action) => {
              setMenuOpen(false)
              if (action === 'rename') namedActions.onRename()
              else namedActions.onDelete()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('group.actions', { name: title })}
                onClick={(event) => { event.stopPropagation(); setMenuOpen(open => !open) }}
              >
                <IconEllipsisOutlineRegular />
              </button>
            )}
          />
        </span>
      </div>
      {expanded && (
        <div className={css.groupBody} role="group">
          {sessions.map(node => (
            <SessionGroupRow
              key={`pinned-group:${id}:${node.id}`}
              node={node}
              currentId={currentId}
              now={Date.now()}
              drag={{
                start: () => { onSessionDragStart(node.id) },
                end: onSessionDragEnd,
                active: sessionDragActive,
                marker: sessionMarker?.id === node.id ? sessionMarker.half : null,
                hover: (half) => { onSessionHover(node.id, half) },
                drop: (half) => { onSessionDrop(node.id, half) },
                disabled: pending,
              }}
              onOpen={onOpen}
              onRename={onRenameSession}
              onFork={onFork}
              onArchive={onArchive}
              onMoveToRoot={onMoveToRoot}
              onUnpin={onUnpin}
              t={t}
            />
          ))}
          {sessions.length === 0 && (
            <div className={css.emptyGroup}>{t(sessionDropOver ? 'group.dropHere' : 'group.empty')}</div>
          )}
        </div>
      )}
    </section>
  )
}

/** Render the global Pinned root, named groups, dialogs, and drag operations. */
export function SessionGroupsView({
  activeSessionDrag,
  useSessions,
  useSessionStatus,
  useWorkspaces,
  usePanelInfo,
  useSessionGroups,
  ensure,
  refresh,
  createGroup,
  renameGroup,
  deleteGroup,
  insertGroupBefore,
  moveSession,
  open,
  renameSession,
  forkSession,
  archiveSession,
  unpinSession,
  notify,
  t,
}: SessionGroupsViewProps) {
  const state = useSessionGroups(value => value)
  const sessions = useSessions(value => value)
  const statuses = useSessionStatus(value => value)
  const workspaceState = useWorkspaces(value => value)
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const { items: workspaces, archivedSessionIds, pinnedSessionIds } = workspaceState
  const pinnedKey = pinnedSessionIds.join('\u0000')
  const refreshedPins = useRef(pinnedKey)
  const pinnedSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])
  const [collapsed, setCollapsed] = useState<readonly SessionGroupId[]>([])
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
  const [groupMarker, setGroupMarker] = useState<{ id: SessionGroupId; half: 'before' | 'after' } | null>(null)
  const [rootDropOver, setRootDropOver] = useState(false)
  const [sessionMarker, setSessionMarker] = useState<{
    groupId: SessionGroupId | null
    id: SessionId
    half: 'before' | 'after'
  } | null>(null)
  useNativeDragAcceptance(activeDrag !== null)

  useEffect(() => { void ensure() }, [ensure])
  useEffect(() => {
    if (pinnedKey === refreshedPins.current || state.pending) return
    refreshedPins.current = pinnedKey
    void refresh()
  }, [pinnedKey, refresh, state.pending])

  const projection = useMemo(
    () => state.snapshot === null
      ? null
      : deriveSessionGroups(
        sessions,
        statuses,
        workspaces,
        t('workspace.defaultName'),
        archivedSessionIds,
        pinnedSessionIds,
        state.snapshot,
      ),
    [archivedSessionIds, pinnedSessionIds, sessions, state.snapshot, statuses, t, workspaces],
  )

  const [editTarget, setEditTarget] = useState<'create' | { id: SessionGroupId; title: string } | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editPending, setEditPending] = useState(false)
  const [editError, setEditError] = useState<SessionGroupsClientFailure | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: SessionGroupId; title: string } | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [sessionRenameTarget, setSessionRenameTarget] = useState<SessionRenameTarget | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenamePending, setSessionRenamePending] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<SessionArchiveTarget | null>(null)
  const [archivePending, setArchivePending] = useState(false)
  const [archiveError, setArchiveError] = useState(false)
  const editComposing = useRef(false)
  const sessionRenameComposing = useRef(false)
  useEffect(() => { editComposing.current = false }, [editTarget])
  useEffect(() => { sessionRenameComposing.current = false }, [sessionRenameTarget])

  const showSuccess = (text: string) => { notify({ text, tone: 'success' }) }
  const showWarning = (text: string) => { notify({ text, tone: 'warning' }) }
  const operationFailure = (
    key: 'error.createGroup' | 'error.renameGroup' | 'error.deleteGroup' | 'error.moveSession',
    error: SessionGroupsClientFailure,
  ) => t(key, { message: failureMessage(error, t) })

  const closeEdit = () => {
    if (editPending) return
    setEditTarget(null)
    setEditError(null)
  }
  const confirmEdit = () => {
    const title = editDraft.trim()
    if (editTarget === null || title === '' || editPending) return
    setEditPending(true)
    setEditError(null)
    const target = editTarget
    const pending = target === 'create' ? createGroup(title) : renameGroup(target.id, title)
    void pending.then((result) => {
      setEditPending(false)
      if (result.ok) {
        setEditTarget(null)
        showSuccess(t(target === 'create' ? 'success.groupCreated' : 'success.groupRenamed'))
        return
      }
      if (titleFailure(result.error)) setEditError(result.error)
      else showWarning(operationFailure(
        target === 'create' ? 'error.createGroup' : 'error.renameGroup',
        result.error,
      ))
    })
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the delete action exists only while a target is selected. */
    if (deleteTarget === null || deletePending) return
    setDeletePending(true)
    void deleteGroup(deleteTarget.id).then((result) => {
      setDeletePending(false)
      if (result.ok) {
        setDeleteTarget(null)
        showSuccess(t('success.groupDeleted'))
      } else {
        showWarning(operationFailure('error.deleteGroup', result.error))
      }
    })
  }
  const confirmSessionRename = () => {
    const title = sessionRenameDraft.trim()
    if (sessionRenameTarget === null || title === '' || sessionRenamePending) return
    setSessionRenamePending(true)
    renameSession(sessionRenameTarget.sessionId, title).then(() => {
      setSessionRenamePending(false)
      setSessionRenameTarget(null)
      showSuccess(t('success.sessionRenamed'))
    }).catch((_reason: unknown) => {
      setSessionRenamePending(false)
      showWarning(t('error.renameSession'))
    })
  }
  const endDrag = () => {
    setActiveDrag(null)
    setGroupMarker(null)
    setSessionMarker(null)
    setRootDropOver(false)
  }
  const performMove = async (
    sessionId: SessionId,
    drop: SessionDrop,
    source: 'internal' | 'project',
    wasPinned: boolean,
  ): Promise<void> => {
    const result = await moveSession(sessionId, drop.targetGroupId, drop.beforeSessionId)
    if (result.ok) {
      if (source === 'project' && !wasPinned) {
        showSuccess(t(drop.targetGroupId === null ? 'success.pinned' : 'success.pinnedAndGrouped'))
      } else {
        showSuccess(t('success.layoutUpdated'))
      }
      return
    }
    if (source === 'project' && !wasPinned) {
      if (result.error.code === 'transport') {
        showWarning(t('error.moveUnknown'))
        return
      }
      if (result.error.code === 'revision-conflict'
        || result.error.code === 'group-not-found'
        || result.error.code === 'session-anchor-not-found') {
        showWarning(t(drop.targetGroupId === null ? 'error.pinOrder' : 'error.pinPlacement'))
        return
      }
    }
    showWarning(operationFailure('error.moveSession', result.error))
  }
  const commitSessionDrop = (drop: SessionDrop) => {
    const internal = activeDrag?.kind === 'session' ? activeDrag : null
    const sessionId = internal?.sessionId ?? activeSessionDrag?.sessionId
    /* v8 ignore next -- drop targets emit only while one of these Session drags is active. */
    if (sessionId === undefined) return
    const source = internal === null ? 'project' : 'internal'
    const wasPinned = pinnedSet.has(sessionId)
    if (source === 'project') activeSessionDrag?.claimDrop()
    endDrag()
    void performMove(sessionId, drop, source, wasPinned)
  }
  const onFork = (sessionId: SessionId) => {
    void forkSession(sessionId).then((result) => {
      if (result === 'forked') showSuccess(t('success.sessionForked'))
    }).catch((_reason: unknown) => {
      showWarning(t('error.forkSession'))
    })
  }
  const onArchive = (sessionId: SessionId) => {
    void archiveSession(sessionId).then((result) => {
      if (result.kind === 'archived') {
        showSuccess(t('success.sessionArchived'))
        return
      }
      setArchiveError(false)
      setArchiveTarget({
        sessionId,
        displayTitle: sessions.byId[sessionId]?.displayTitle ?? sessionId,
        activity: result.activity,
      })
    }).catch((_reason: unknown) => {
      showWarning(t('error.archiveSession'))
    })
  }
  const closeArchive = () => {
    if (archivePending) return
    setArchiveTarget(null)
    setArchiveError(false)
  }
  const confirmArchive = () => {
    if (archiveTarget === null || archivePending) return
    const target = archiveTarget
    setArchivePending(true)
    setArchiveError(false)
    void archiveSession(target.sessionId, { stopActivity: true }).then((result) => {
      setArchivePending(false)
      if (result.kind === 'session-active') {
        setArchiveTarget({ ...target, activity: result.activity })
        setArchiveError(true)
        return
      }
      setArchiveTarget(null)
      showSuccess(t('success.sessionStoppedAndArchived'))
    }).catch((_reason: unknown) => {
      setArchivePending(false)
      setArchiveError(true)
    })
  }
  const onUnpin = (sessionId: SessionId) => {
    void unpinSession(sessionId).then(async () => {
      const result = await refresh()
      if (result.ok) showSuccess(t('success.unpinned'))
      else showWarning(t('error.unpinCleanup'))
    }).catch((_reason: unknown) => {
      showWarning(t('error.unpinSession'))
    })
  }
  const onMoveToRoot = (sessionId: SessionId) => {
    void performMove(sessionId, { targetGroupId: null, beforeSessionId: null }, 'internal', true)
  }

  const groupRows = projection?.groups ?? []
  const defaultRows = projection?.defaultSessions ?? []
  const currentSessionId = panelActive ? undefined : projection?.currentSessionId
  const sessionDragActive = !state.pending && (activeDrag?.kind === 'session' || activeSessionDrag !== null)
  const canAcceptSessionDrop = () => sessionDragActive
  const acceptRootDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!canAcceptSessionDrop()) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setRootDropOver(true)
  }
  const leaveRootDrop = (event: ReactDragEvent<HTMLElement>) => {
    const related = event.relatedTarget
    if (related instanceof Node && event.currentTarget.contains(related)) return
    setRootDropOver(false)
  }
  const commitRootDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!canAcceptSessionDrop()) return
    event.preventDefault()
    event.stopPropagation()
    setRootDropOver(false)
    commitSessionDrop({ targetGroupId: null, beforeSessionId: null })
  }
  useEffect(() => {
    if (!sessionDragActive) setRootDropOver(false)
  }, [sessionDragActive])
  return (
    <section className={css.root} role="group" aria-label={t('groups.aria')}>
      <div
        className={clsx(css.header, rootDropOver && css.dropOver)}
        onDragOver={acceptRootDrop}
        onDragLeave={leaveRootDrop}
        onDrop={commitRootDrop}
      >
        <span className={css.heading}>
          <IconPinFillRegular />
          {t('section.title')}
        </span>
        <Tooltip label={t('group.create')}>
          <button
            type="button"
            className={css.addButton}
            aria-label={t('group.create')}
            onClick={() => { setEditDraft(''); setEditError(null); setEditTarget('create') }}
          >
            <IconPlusOutlineRegular />
          </button>
        </Tooltip>
      </div>

      {state.status === 'error' && (
        <div className={css.error} role="alert">
          <span>{t('error.load')}</span>
          <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button>
        </div>
      )}

      <div className={css.list}>
        {state.status === 'loading' && state.snapshot === null && (
          <div className={css.status} role="status">{t('loading')}</div>
        )}
        {projection !== null && (
          <>
            {defaultRows.map(node => (
              <SessionGroupRow
                key={`pinned-root:${node.id}`}
                node={node}
                currentId={currentSessionId}
                now={Date.now()}
                drag={{
                  start: () => { setActiveDrag({ kind: 'session', sessionId: node.id }) },
                  end: endDrag,
                  active: sessionDragActive,
                  marker: sessionMarker?.groupId === null && sessionMarker.id === node.id
                    ? sessionMarker.half
                    : null,
                  hover: (half) => { setSessionMarker({ groupId: null, id: node.id, half }) },
                  drop: (half) => {
                    commitSessionDrop({
                      targetGroupId: null,
                      beforeSessionId: sessionAnchor(defaultRows, node.id, half),
                    })
                  },
                  disabled: state.pending,
                }}
                onOpen={open}
                onRename={(sessionId, title) => {
                  setSessionRenameTarget({ sessionId, currentTitle: title })
                  setSessionRenameDraft(title)
                }}
                onFork={onFork}
                onArchive={onArchive}
                onUnpin={onUnpin}
                t={t}
              />
            ))}
            {pinnedSessionIds.length === 0 && (
              <div
                className={clsx(css.emptySection, rootDropOver && css.dropOver)}
                onDragOver={acceptRootDrop}
                onDragLeave={leaveRootDrop}
                onDrop={commitRootDrop}
              >
                {t('section.empty')}
              </div>
            )}
            {groupRows.map((group: SessionGroupSection, index) => {
              const marker = groupMarker?.id === group.id ? groupMarker.half : null
              const dropMarker = sessionMarker?.groupId === group.id
                ? { id: sessionMarker.id, half: sessionMarker.half }
                : null
              return (
                <GroupSection
                  key={`pinned-group:${group.id}`}
                  id={group.id}
                  title={group.title}
                  sessions={group.sessions}
                  expanded={!collapsed.includes(group.id)}
                  currentId={currentSessionId}
                  pending={state.pending}
                  activeDrag={activeDrag}
                  sessionDragActive={sessionDragActive}
                  canAcceptSessionDrop={canAcceptSessionDrop}
                  groupMarker={marker}
                  sessionMarker={dropMarker}
                  onToggle={() => {
                    setCollapsed(keys => keys.includes(group.id)
                      ? keys.filter(key => key !== group.id)
                      : [...keys, group.id])
                  }}
                  namedActions={{
                    onDragStart: () => { setActiveDrag({ kind: 'group', groupId: group.id }) },
                    onDragEnd: endDrag,
                    onHover: (half) => { setGroupMarker({ id: group.id, half }) },
                    onDrop: (half) => {
                      /* v8 ignore next -- GroupSection emits group drops only for an active group drag. */
                      if (activeDrag?.kind !== 'group') return
                      const before = half === 'before' ? group.id : groupRows[index + 1]?.id ?? null
                      const moving = activeDrag.groupId
                      endDrag()
                      if (before === moving) return
                      void insertGroupBefore(moving, before).then((result) => {
                        if (result.ok) showSuccess(t('success.layoutUpdated'))
                        else showWarning(operationFailure('error.moveSession', result.error))
                      })
                    },
                    onRename: () => {
                      setEditDraft(group.title)
                      setEditError(null)
                      setEditTarget({ id: group.id, title: group.title })
                    },
                    onDelete: () => { setDeleteTarget({ id: group.id, title: group.title }) },
                  }}
                  onSessionDragStart={(sessionId) => { setActiveDrag({ kind: 'session', sessionId }) }}
                  onSessionDragEnd={endDrag}
                  onSessionHover={(sessionId, half) => {
                    setSessionMarker({ groupId: group.id, id: sessionId, half })
                  }}
                  onSessionDrop={(sessionId, half) => {
                    commitSessionDrop({
                      targetGroupId: group.id,
                      beforeSessionId: sessionAnchor(group.sessions, sessionId, half),
                    })
                  }}
                  onAppendSession={() => {
                    commitSessionDrop({ targetGroupId: group.id, beforeSessionId: null })
                  }}
                  onOpen={open}
                  onRenameSession={(sessionId, title) => {
                    setSessionRenameTarget({ sessionId, currentTitle: title })
                    setSessionRenameDraft(title)
                  }}
                  onFork={onFork}
                  onArchive={onArchive}
                  onMoveToRoot={onMoveToRoot}
                  onUnpin={onUnpin}
                  t={t}
                />
              )
            })}
          </>
        )}
      </div>

      <Modal
        open={editTarget !== null}
        onClose={closeEdit}
        closeLabel={t('close')}
        title={editTarget === 'create' ? t('group.create') : t('group.rename')}
        footer={(
          <>
            <Button variant="outline" disabled={editPending} onClick={closeEdit}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={editPending || editDraft.trim() === ''}
              onClick={confirmEdit}
            >
              {editTarget === 'create' ? t('create') : t('rename')}
            </Button>
          </>
        )}
      >
        <Input
          {...css.input === undefined ? {} : { className: css.input }}
          value={editDraft}
          aria-label={t('group.name')}
          data-modal-autofocus
          disabled={editPending}
          onFocus={(event) => { event.target.select() }}
          onChange={(event) => { setEditDraft(event.target.value); setEditError(null) }}
          onCompositionStart={() => { editComposing.current = true }}
          onCompositionEnd={() => { editComposing.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !editComposing.current) {
              event.preventDefault()
              confirmEdit()
            }
          }}
        />
        {editError !== null && <div className={css.modalError} role="alert">{failureMessage(editError, t)}</div>}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => { if (!deletePending) setDeleteTarget(null) }}
        closeLabel={t('close')}
        title={t('group.delete')}
        {...deleteTarget === null ? {} : { description: t('group.deleteDescription', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deletePending} onClick={() => { setDeleteTarget(null) }}>
              {t('cancel')}
            </Button>
            <Button variant="outline" disabled={deletePending} onClick={confirmDelete}>{t('group.delete')}</Button>
          </>
        )}
      />

      <Modal
        open={sessionRenameTarget !== null}
        onClose={() => { if (!sessionRenamePending) setSessionRenameTarget(null) }}
        closeLabel={t('close')}
        title={t('session.rename')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenamePending} onClick={() => { setSessionRenameTarget(null) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={sessionRenamePending || sessionRenameDraft.trim() === ''}
              onClick={confirmSessionRename}
            >
              {t('rename')}
            </Button>
          </>
        )}
      >
        <Input
          {...css.input === undefined ? {} : { className: css.input }}
          value={sessionRenameDraft}
          aria-label={t('session.name')}
          data-modal-autofocus
          disabled={sessionRenamePending}
          onFocus={(event) => { event.target.select() }}
          onChange={(event) => { setSessionRenameDraft(event.target.value) }}
          onCompositionStart={() => { sessionRenameComposing.current = true }}
          onCompositionEnd={() => { sessionRenameComposing.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !sessionRenameComposing.current) {
              event.preventDefault()
              confirmSessionRename()
            }
          }}
        />
      </Modal>

      <Modal
        open={archiveTarget !== null}
        onClose={closeArchive}
        closeLabel={t('close')}
        title={t('archive.confirm.title')}
        {...archiveTarget === null ? {} : {
          description: t('archive.confirm.description', { title: archiveTarget.displayTitle }),
        }}
        footer={(
          <>
            <Button variant="outline" disabled={archivePending} onClick={closeArchive}>{t('cancel')}</Button>
            <Button variant="outline" disabled={archivePending} onClick={confirmArchive}>
              {t('archive.confirm.action')}
            </Button>
          </>
        )}
      >
        {archiveTarget !== null && (
          <ul aria-label={t('archive.confirm.activity')}>
            {archiveTarget.activity.map((activity, index) => (
              <li key={`${String(activity.kind)}-${String(index)}`}>{archiveActivityLine(activity, t)}</li>
            ))}
          </ul>
        )}
        {archivePending && <div role="status">{t('archive.confirm.pending')}</div>}
        {archiveError && <div className={css.modalError} role="alert">{t('error.stopAndArchiveSession')}</div>}
      </Modal>
    </section>
  )
}
