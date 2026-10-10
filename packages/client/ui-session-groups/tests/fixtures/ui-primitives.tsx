import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
} from 'react'

type IconProps = {
  readonly className?: string
}

function Icon({ className }: IconProps) {
  return <svg aria-hidden="true" className={className} />
}

export const IconArchiveOutlineRegular = Icon
export const IconBranchOutlineRegular = Icon
export const IconEditOutlineRegular = Icon
export const IconEllipsisOutlineRegular = Icon
export const IconListPenOutlineRegular = Icon
export const IconPinFillRegular = Icon
export const IconPinOutlineRegular = Icon
export const IconPlusOutlineRegular = Icon
export const IconTrashOutlineRegular = Icon
export const IconTriangleRightFillRegular = Icon
export const IconWarningOutlineRegular = Icon

export function StateDot({ state }: { readonly state: string }) {
  return <span data-state={state} />
}

type MenuItem = {
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
  readonly danger?: boolean
}

export function Menu({
  open,
  onClose,
  items,
  onSelect,
  anchor,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly items: readonly MenuItem[]
  readonly onSelect: (id: string) => void
  readonly anchor: ReactNode
  readonly portal?: boolean
  readonly closeOnPointerLeave?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [onClose, open])
  return (
    <>
      {anchor}
      {open && (
        <div role="menu">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                onSelect(item.id)
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export function Button({ variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: string
}) {
  return <button type="button" data-variant={variant} {...props} />
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />
}

export function Tooltip({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <span data-tooltip={label}>{children}</span>
}

export function Modal({
  open,
  onClose,
  closeLabel,
  title,
  description,
  footer,
  children,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly closeLabel: string
  readonly title: string
  readonly description?: string
  readonly footer?: ReactNode
  readonly children?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [onClose, open])
  if (!open) return null
  return (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button type="button" aria-label={closeLabel} onClick={onClose}>×</button>
      {description === undefined ? null : <p>{description}</p>}
      {children}
      <footer>{footer}</footer>
    </div>
  )
}

export function Toast({
  text,
  icon,
  tone,
  holdMs = 4000,
  actions = [],
  onDone,
}: {
  readonly text: string
  readonly icon?: ReactNode
  readonly tone?: string
  readonly holdMs?: number
  readonly actions?: readonly { readonly label: string; readonly onClick: () => void }[]
  readonly onDone: () => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, holdMs)
    return () => { window.clearTimeout(timer) }
  }, [holdMs, onDone])
  return (
    <div role="alert" data-tone={tone}>
      {icon ?? <span aria-hidden="true" />}
      {text}
      {actions.map(action => (
        <button key={action.label} type="button" onClick={action.onClick}>{action.label}</button>
      ))}
    </div>
  )
}
