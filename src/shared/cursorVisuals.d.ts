import type { CursorAppearanceAsset, CursorTrackPoint, CursorVisualKind } from '../types'

export type CursorVisualStateLike = Pick<
  CursorTrackPoint,
  'cursorKind' | 'cursorAppearanceId' | 'cursorHotspotRatioX' | 'cursorHotspotRatioY'
>

export function normalizeCursorVisualKind(
  cursorKind: CursorTrackPoint['cursorKind'] | CursorVisualKind | null | undefined,
): CursorVisualKind

export function normalizeCursorAppearanceId(value: string | null | undefined): string

export function getDefaultCursorHotspotRatios(
  cursorKind: CursorTrackPoint['cursorKind'] | CursorVisualKind | null | undefined,
): {
  hotspotRatioX: number
  hotspotRatioY: number
}

export function normalizeCursorHotspotRatiosForKind(
  cursorKind: CursorTrackPoint['cursorKind'] | CursorVisualKind | null | undefined,
  hotspotRatioX: number | null | undefined,
  hotspotRatioY: number | null | undefined,
): {
  hotspotRatioX: number
  hotspotRatioY: number
}

export function normalizeCursorVisualState(
  point: CursorVisualStateLike | null | undefined,
): {
  cursorKind: CursorVisualKind
  cursorAppearanceId: string
  cursorHotspotRatioX: number
  cursorHotspotRatioY: number
}

export function normalizeCursorAppearanceAsset(
  asset: Partial<CursorAppearanceAsset> | null | undefined,
): CursorAppearanceAsset | null

export function stabilizeCursorVisualKinds<T extends CursorTrackPoint>(points: T[]): T[]
