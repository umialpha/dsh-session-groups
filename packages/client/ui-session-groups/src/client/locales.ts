/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.title': '置顶',
  'section.count': '{n} 个会话',
} satisfies Record<string, string>

/** Session-groups dictionary key union. */
export type SessionGroupsKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'section.title': 'Pinned',
  'section.count': '{n} Sessions',
} satisfies Record<SessionGroupsKey, string>
