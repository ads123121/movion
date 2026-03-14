import type { CursorTrack, CursorTrackPoint } from '../types'

export function compactCursorTrackPoints(points: CursorTrackPoint[] | null | undefined): CursorTrackPoint[]

export function normalizeCursorTrack(
  track: Partial<CursorTrack> | null | undefined,
  sourceKind?: 'screen' | 'window' | null | undefined,
  durationSeconds?: number | null | undefined,
): CursorTrack | null
