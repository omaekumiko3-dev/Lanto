import type { LantoAPI } from '../shared/model.ts'

declare global {
  interface Window {
    lanto: LantoAPI
  }
}
