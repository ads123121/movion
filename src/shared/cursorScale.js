const clampNumber = (value, minimum, maximum) => {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, Number(value)))
}

export function clampCursorBaseScale(value) {
  return clampNumber(value, 0.6, 2.4)
}

export function resolveCursorScaleMetrics({
  baseScale = 1,
  frameWidth,
  frameHeight,
  coordinateSpaceWidth,
  coordinateSpaceHeight,
}) {
  const safeBaseScale = clampCursorBaseScale(baseScale)
  const scaleX =
    safeBaseScale *
    clampNumber(
      Number(frameWidth) > 0 && Number(coordinateSpaceWidth) > 0
        ? Number(frameWidth) / Number(coordinateSpaceWidth)
        : 1,
      0.05,
      8,
    )
  const scaleY =
    safeBaseScale *
    clampNumber(
      Number(frameHeight) > 0 && Number(coordinateSpaceHeight) > 0
        ? Number(frameHeight) / Number(coordinateSpaceHeight)
        : 1,
      0.05,
      8,
    )

  return {
    scaleX,
    scaleY,
    scale: (scaleX + scaleY) / 2,
  }
}
