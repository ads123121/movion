export function clampCursorBaseScale(value: number | null | undefined): number

export function resolveCursorScaleMetrics(input: {
  baseScale?: number | null | undefined
  frameWidth: number
  frameHeight: number
  coordinateSpaceWidth: number
  coordinateSpaceHeight: number
}): {
  scaleX: number
  scaleY: number
  scale: number
}
