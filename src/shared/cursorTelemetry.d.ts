export type CursorMotionPointLike = {
  timeSeconds: number
  x: number
  y: number
}

export type CursorClickLike = {
  timeSeconds: number
  x: number
  y: number
  button: 'left' | 'right'
}

export type CursorTrackLike = {
  points: CursorMotionPointLike[]
  clicks?: CursorClickLike[] | null
}

export type CursorPulseEventLike = {
  id: string
  timeSeconds: number
  x: number
  y: number
  strength: number
}

export function getCursorDistance(
  left: Pick<CursorMotionPointLike, 'x' | 'y'>,
  right: Pick<CursorMotionPointLike, 'x' | 'y'>,
): number

export function getCursorSpeed(left: CursorMotionPointLike, right: CursorMotionPointLike): number

export function inferCursorPulseEvents(points: CursorMotionPointLike[]): CursorPulseEventLike[]

export function getCursorPulseEventsForTrack(cursorTrack: CursorTrackLike | null | undefined): CursorPulseEventLike[]

export function getCursorApproachMetrics(
  points: CursorMotionPointLike[],
  targetTimeSeconds: number,
  options?: {
    sampleRange?: (
      points: CursorMotionPointLike[],
      startSeconds: number,
      endSeconds: number,
    ) => CursorMotionPointLike[]
    lookbackSeconds?: number
  },
): {
  effectiveDistance: number
  approachSpeed: number
} | null
