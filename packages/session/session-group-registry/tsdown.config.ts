import { clientBundle } from '../../../build/client-bundle.ts'

export default clientBundle(
  '@umialpha/dsh-session-group-registry',
  ['lib/types/index.js'],
  {
    hostPhase: true,
  },
)
