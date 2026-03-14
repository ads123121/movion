import type { CursorTrackPoint, CursorVisualKind } from '../types'

export type CursorAnimationStyleLike = 'molasses' | 'default' | 'gentle' | 'stiff'

export type TimedCursorPointLike = {
  timeSeconds: number
  x: number
  y: number
}

export type CursorVisualPointLike = TimedCursorPointLike & {
  cursorKind?: CursorTrackPoint['cursorKind'] | CursorVisualKind
  cursorAppearanceId?: string
  cursorHotspotRatioX?: number
  cursorHotspotRatioY?: number
}

export type CursorVisualProjectionOptions = {
  includeTimeSeconds?: boolean
}

export type ProjectedCursorVisualPoint = {
  timeSeconds?: number
  x: number
  y: number
  cursorKind: CursorVisualKind
  cursorAppearanceId: string
  cursorHotspotRatioX: number
  cursorHotspotRatioY: number
}

export function findCursorPointFloorIndex<T extends { timeSeconds: number }>(points: T[], targetTime: number): number

export function findCursorSegmentIndex<T extends { timeSeconds: number }>(points: T[], targetTime: number): number

export function getCursorInterpolationBlend(animationStyle?: CursorAnimationStyleLike): number

export function getCursorInterpolationProgress(
  previousTimeSeconds: number,
  nextTimeSeconds: number,
  targetTime: number,
  animationStyle?: CursorAnimationStyleLike,
): {
  rawRatio: number
  ratio: number
}

export function interpolateCursorCoordinate<T extends TimedCursorPointLike>(
  points: T[],
  rightIndex: number,
  targetTime: number,
  axis: 'x' | 'y',
  baseRatio: number,
  cubicBlend: number,
): number

export function projectDiscreteCursorVisualPoint<T extends CursorVisualPointLike>(
  point: T,
  targetTime: number,
  options?: CursorVisualProjectionOptions,
): ProjectedCursorVisualPoint

export function projectInterpolatedCursorVisualPoint<T extends CursorVisualPointLike>(
  context: {
    points: T[]
    rightIndex: number
    targetTime: number
    rawRatio: number
    ratio: number
    previousPoint: T
    nextPoint: T
    interpolationBlend: number
  },
  options?: CursorVisualProjectionOptions,
): ProjectedCursorVisualPoint

export function getCursorPointAtTime<T extends TimedCursorPointLike, TResult>(
  points: T[],
  timeSeconds: number,
  options: {
    smoothingEnabled?: boolean
    animationStyle?: CursorAnimationStyleLike
    projectDiscretePoint?: (point: T, targetTime: number) => TResult
    projectInterpolatedPoint: (context: {
      points: T[]
      rightIndex: number
      targetTime: number
      rawRatio: number
      ratio: number
      previousPoint: T
      nextPoint: T
      interpolationBlend: number
    }) => TResult
  },
): TResult | null
