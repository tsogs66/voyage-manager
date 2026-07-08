import type { Voyage } from './types'
import { sampleVoyage } from './factory'

const KEY = 'voyage-manager:voyages'

export function loadVoyages(): Voyage[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      const seed = [sampleVoyage()]
      saveVoyages(seed)
      return seed
    }
    const parsed = JSON.parse(raw) as Voyage[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

export function saveVoyages(voyages: Voyage[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(voyages))
  } catch {
    // storage unavailable (private mode / quota) — ignore
  }
}
