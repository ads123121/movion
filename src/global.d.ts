import type { ForkApi } from './types'

declare global {
  interface Window {
    forkApi: ForkApi
  }
}

export {}
