import {
  normalizeCursorAppearanceAsset,
  normalizeCursorVisualState,
  stabilizeCursorVisualKinds,
} from './cursorVisuals.js'

const clampNumber = (value, minimum, maximum) => {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, Number(value)))
}

const clampUnit = (value) => clampNumber(value, 0, 1)

function normalizeCursorCoordinateSpace(coordinateSpace) {
  if (
    !Number.isFinite(coordinateSpace?.width) ||
    Number(coordinateSpace.width) <= 0 ||
    !Number.isFinite(coordinateSpace?.height) ||
    Number(coordinateSpace.height) <= 0
  ) {
    return undefined
  }

  return {
    width: Math.max(1, Math.round(Number(coordinateSpace.width))),
    height: Math.max(1, Math.round(Number(coordinateSpace.height))),
  }
}

export function compactCursorTrackPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return []
  }

  const compacted = []

  for (const point of points) {
    const normalizedPoint = {
      timeSeconds: Number(Math.max(0, Number(point?.timeSeconds) || 0).toFixed(3)),
      x: Number(clampUnit(point?.x).toFixed(4)),
      y: Number(clampUnit(point?.y).toFixed(4)),
      ...normalizeCursorVisualState(point),
    }
    const previousPoint = compacted[compacted.length - 1]

    if (!previousPoint) {
      compacted.push(normalizedPoint)
      continue
    }

    const deltaTime = normalizedPoint.timeSeconds - previousPoint.timeSeconds
    const deltaX = Math.abs(normalizedPoint.x - previousPoint.x)
    const deltaY = Math.abs(normalizedPoint.y - previousPoint.y)

    if (deltaTime < 0.012) {
      compacted[compacted.length - 1] = normalizedPoint
      continue
    }

    if (
      deltaTime < 0.08 &&
      deltaX < 0.0015 &&
      deltaY < 0.0015 &&
      previousPoint.cursorKind === normalizedPoint.cursorKind &&
      previousPoint.cursorAppearanceId === normalizedPoint.cursorAppearanceId &&
      previousPoint.cursorHotspotRatioX === normalizedPoint.cursorHotspotRatioX &&
      previousPoint.cursorHotspotRatioY === normalizedPoint.cursorHotspotRatioY
    ) {
      continue
    }

    compacted.push(normalizedPoint)
  }

  return stabilizeCursorVisualKinds(compacted)
}

export function normalizeCursorTrack(track, sourceKind, durationSeconds) {
  if (!track || !Array.isArray(track.points) || track.points.length === 0) {
    return null
  }

  const maxTime =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Number(durationSeconds)
      : Number.POSITIVE_INFINITY
  const sampleIntervalMs = Number.isFinite(track?.sampleIntervalMs)
    ? Math.min(240, Math.max(16, Number(track.sampleIntervalMs)))
    : 16
  const points = track.points
    .map((point) => {
      const timeSeconds = Number.isFinite(point?.timeSeconds) ? Number(point.timeSeconds) : NaN
      const x = Number.isFinite(point?.x) ? clampUnit(point.x) : NaN
      const y = Number.isFinite(point?.y) ? clampUnit(point.y) : NaN

      if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }

      return {
        timeSeconds: Math.min(maxTime, Number(timeSeconds.toFixed(3))),
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
        ...normalizeCursorVisualState(point),
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.timeSeconds - right.timeSeconds)

  const dedupedPoints = []

  for (const point of points) {
    const previousPoint = dedupedPoints[dedupedPoints.length - 1]

    if (previousPoint && Math.abs(previousPoint.timeSeconds - point.timeSeconds) < 0.001) {
      dedupedPoints[dedupedPoints.length - 1] = point
      continue
    }

    if (
      previousPoint &&
      previousPoint.x === point.x &&
      previousPoint.y === point.y &&
      previousPoint.cursorKind === point.cursorKind &&
      previousPoint.cursorAppearanceId === point.cursorAppearanceId &&
      previousPoint.cursorHotspotRatioX === point.cursorHotspotRatioX &&
      previousPoint.cursorHotspotRatioY === point.cursorHotspotRatioY &&
      point.timeSeconds - previousPoint.timeSeconds < sampleIntervalMs / 1000
    ) {
      continue
    }

    dedupedPoints.push(point)
  }

  if (!dedupedPoints.length) {
    return null
  }

  const stablePoints = stabilizeCursorVisualKinds(dedupedPoints)

  const clicks = Array.isArray(track?.clicks)
    ? track.clicks
        .map((click) => {
          const timeSeconds = Number.isFinite(click?.timeSeconds) ? Number(click.timeSeconds) : NaN
          const x = Number.isFinite(click?.x) ? clampUnit(click.x) : NaN
          const y = Number.isFinite(click?.y) ? clampUnit(click.y) : NaN

          if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
            return null
          }

          return {
            timeSeconds: Math.min(maxTime, Number(timeSeconds.toFixed(3))),
            x: Number(x.toFixed(4)),
            y: Number(y.toFixed(4)),
            button: click?.button === 'right' ? 'right' : 'left',
            ctrlKey: Boolean(click?.ctrlKey),
            durationMs: Number.isFinite(click?.durationMs) ? Math.max(0, Number(click.durationMs)) : 0,
          }
        })
        .filter(Boolean)
        .sort((left, right) => left.timeSeconds - right.timeSeconds)
    : []

  const appearances = Array.isArray(track?.appearances)
    ? track.appearances
        .map((asset) => normalizeCursorAppearanceAsset(asset))
        .filter(Boolean)
    : []
  const coordinateSpace = normalizeCursorCoordinateSpace(track?.coordinateSpace)

  return {
    sourceKind:
      track?.sourceKind === 'window' || sourceKind === 'window'
        ? 'window'
        : 'screen',
    sampleIntervalMs,
    points: stablePoints,
    clicks,
    appearances,
    ...(coordinateSpace ? { coordinateSpace } : {}),
  }
}
