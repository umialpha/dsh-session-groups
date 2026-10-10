/** First vertical slice of the root-scoped Pinned area. */

import { IconPinFillRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionGroupsSnapshot } from '@umialpha/dsh-session-group-registry/types'
import type { SessionGroupsKey } from './locales.ts'
import css from './PinnedSlice.module.css'

/** Props injected once the Host snapshot has crossed the generated Remote. */
export type PinnedSliceProps = PropsRuntime<'sidebar.workspaces.sessionGroups'>
  & PropsLocale<'sessionGroups'>
  & { readonly snapshot: SessionGroupsSnapshot }

/** Render the real Pinned root above the unchanged project tree. */
export function PinnedSlice({ snapshot, t }: PinnedSliceProps) {
  const count = snapshot.defaultSessionIds.length
    + snapshot.groups.reduce((total, group) => total + group.sessionIds.length, 0)
  return (
    <section className={css.root} aria-label={t('section.title')}>
      <div className={css.header}>
        <span className={css.icon}><IconPinFillRegular /></span>
        <span className={css.title}>{t('section.title')}</span>
        {count > 0 && <span className={css.count}>{t('section.count', { n: count })}</span>}
      </div>
    </section>
  )
}

/** Retain the dictionary type beside the component's public props. */
export type { SessionGroupsKey }
