import type { UserConfig } from 'tsdown'
import { nodeBundle } from '../../../build/node-bundle.ts'

const SKIP_CLIENT_BUILD: UserConfig = { entry: '' }
const node = nodeBundle('@umialpha/dsh-session-groups', ['lib/types/index.js'])

export default ({ env }: Pick<UserConfig, 'env'>): UserConfig[] => {
  const face = env?.DSH_BUILD_FACE
  if (face === undefined || face === 'host') return [node]
  if (face === 'client') return [SKIP_CLIENT_BUILD]
  throw new Error(`--env.DSH_BUILD_FACE must be host or client, received ${String(face)}`)
}
