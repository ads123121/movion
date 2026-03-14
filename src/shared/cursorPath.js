const clampNumber = (value, minimum, maximum) => {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, value))
}

import {
  normalizeCursorAppearanceId,
  normalizeCursorHotspotRatiosForKind,
  normalizeCursorVisualKind,
  normalizeCursorVisualState,
} from './cursorVisuals.js'

const clampUnit = (value) => clampNumber(value, 0, 1)
const lerpNumber = (left, right, progress) => left + (right - left) * progress

export function findCursorPointFloorIndex(points, targetTime) {
  if (!Array.isArray(points) || !points.length) {
    return -1
  }

  let low = 0
  let high = points.length - 1
  let bestIndex = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const middleTime = points[middle]?.timeSeconds ?? 0

    if (middleTime <= targetTime) {
      bestIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return bestIndex
}

export function findCursorSegmentIndex(points, targetTime) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0
  }

  let low = 1
  let high = points.length - 1

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const middleTime = points[middle]?.timeSeconds ?? 0

    if (middleTime < targetTime) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low
}

export function getCursorInterpolationBlend(animationStyle = 'default') {
  switch (animationStyle) {
    case 'molasses':
      return 0.82
    case 'gentle':
      return 0.68
    case 'default':
      return 0.48
    case 'stiff':
    default:
      return 0
  }
}

function getCursorAnimationEaseWeight(animationStyle = 'default') {
  switch (animationStyle) {
    case 'molasses':
      return 1
    case 'gentle':
      return 0.88
    case 'default':
      return 0.72
    case 'stiff':
    default:
      return 0
  }
}

export function getCursorInterpolationProgress(previousTimeSeconds, nextTimeSeconds, targetTime, animationStyle = 'default') {
  const span = Math.max(0.001, nextTimeSeconds - previousTimeSeconds)
  const rawRatio = clampUnit((targetTime - previousTimeSeconds) / span)
  const smoothstepRatio = rawRatio * rawRatio * (3 - 2 * rawRatio)
  const easeWeight = getCursorAnimationEaseWeight(animationStyle)

  return {
    rawRatio,
    ratio: clampUnit(rawRatio + (smoothstepRatio - rawRatio) * easeWeight),
  }
}

export function interpolateCursorCoordinate(points, rightIndex, targetTime, axis, baseRatio, cubicBlend) {
  const previousPoint = points[rightIndex - 1]
  const nextPoint = points[rightIndex]

  if (!previousPoint || !nextPoint) {
    return previousPoint?.[axis] ?? nextPoint?.[axis] ?? 0
  }

  const linearValue = lerpNumber(previousPoint[axis], nextPoint[axis], baseRatio)

  if (cubicBlend <= 0.001 || points.length < 3) {
    return linearValue
  }

  const beforePoint = points[Math.max(0, rightIndex - 2)] ?? previousPoint
  const afterPoint = points[Math.min(points.length - 1, rightIndex + 1)] ?? nextPoint
  const span = Math.max(0.001, nextPoint.timeSeconds - previousPoint.timeSeconds)
  const rawRatio = clampUnit((targetTime - previousPoint.timeSeconds) / span)
  const incomingSpan = Math.max(0.001, nextPoint.timeSeconds - beforePoint.timeSeconds)
  const outgoingSpan = Math.max(0.001, afterPoint.timeSeconds - previousPoint.timeSeconds)
  const tangentStart = ((nextPoint[axis] - beforePoint[axis]) / incomingSpan) * span
  const tangentEnd = ((afterPoint[axis] - previousPoint[axis]) / outgoingSpan) * span
  const ratioSquared = rawRatio * rawRatio
  const ratioCubed = ratioSquared * rawRatio
  const cubicValue =
    (2 * ratioCubed - 3 * ratioSquared + 1) * previousPoint[axis] +
    (ratioCubed - 2 * ratioSquared + rawRatio) * tangentStart +
    (-2 * ratioCubed + 3 * ratioSquared) * nextPoint[axis] +
    (ratioCubed - ratioSquared) * tangentEnd
  const localMinimum = Math.min(beforePoint[axis], previousPoint[axis], nextPoint[axis], afterPoint[axis])
  const localMaximum = Math.max(beforePoint[axis], previousPoint[axis], nextPoint[axis], afterPoint[axis])

  return lerpNumber(linearValue, clampNumber(cubicValue, localMinimum, localMaximum), cubicBlend)
}

export function projectDiscreteCursorVisualPoint(point, targetTime, { includeTimeSeconds = false } = {}) {
  const projectedPoint = {
    x: Number((point?.x ?? 0).toFixed(4)),
    y: Number((point?.y ?? 0).toFixed(4)),
    ...normalizeCursorVisualState(point),
  }

  if (!includeTimeSeconds) {
    return projectedPoint
  }

  return {
    timeSeconds: targetTime,
    ...projectedPoint,
  }
}

export function projectInterpolatedCursorVisualPoint(
  {
    points,
    rightIndex,
    targetTime,
    rawRatio,
    ratio,
    previousPoint,
    nextPoint,
    interpolationBlend,
  },
  { includeTimeSeconds = false } = {},
) {
  const previousHotspotRatios = normalizeCursorHotspotRatiosForKind(
    previousPoint?.cursorKind,
    previousPoint?.cursorHotspotRatioX,
    previousPoint?.cursorHotspotRatioY,
  )
  const nextHotspotRatios = normalizeCursorHotspotRatiosForKind(
    nextPoint?.cursorKind,
    nextPoint?.cursorHotspotRatioX,
    nextPoint?.cursorHotspotRatioY,
  )
  const projectedPoint = {
    x: Number(interpolateCursorCoordinate(points, rightIndex, targetTime, 'x', ratio, interpolationBlend).toFixed(4)),
    y: Number(interpolateCursorCoordinate(points, rightIndex, targetTime, 'y', ratio, interpolationBlend).toFixed(4)),
    cursorKind:
      rawRatio >= 0.98
        ? normalizeCursorVisualKind(nextPoint?.cursorKind)
        : normalizeCursorVisualKind(previousPoint?.cursorKind ?? nextPoint?.cursorKind),
    cursorAppearanceId:
      rawRatio >= 0.98
        ? normalizeCursorAppearanceId(nextPoint?.cursorAppearanceId)
        : normalizeCursorAppearanceId(previousPoint?.cursorAppearanceId || nextPoint?.cursorAppearanceId),
    cursorHotspotRatioX: Number(
      (
        previousHotspotRatios.hotspotRatioX +
        (nextHotspotRatios.hotspotRatioX - previousHotspotRatios.hotspotRatioX) * ratio
      ).toFixed(4),
    ),
    cursorHotspotRatioY: Number(
      (
        previousHotspotRatios.hotspotRatioY +
        (nextHotspotRatios.hotspotRatioY - previousHotspotRatios.hotspotRatioY) * ratio
      ).toFixed(4),
    ),
  }

  if (!includeTimeSeconds) {
    return projectedPoint
  }

  return {
    timeSeconds: targetTime,
    ...projectedPoint,
  }
}

export function getCursorPointAtTime(points, timeSeconds, options = {}) {
  const {
    smoothingEnabled = true,
    animationStyle = 'default',
    projectDiscretePoint = (point, targetTime) => ({
      ...point,
      timeSeconds: targetTime,
    }),
    projectInterpolatedPoint,
  } = options

  if (!Array.isArray(points) || !points.length || typeof projectInterpolatedPoint !== 'function') {
    return null
  }

  const targetTime = Math.max(0, timeSeconds)

  if (!smoothingEnabled) {
    const floorIndex = findCursorPointFloorIndex(points, targetTime)
    const point = points[Math.max(0, floorIndex)] ?? points[0]
    return projectDiscretePoint(point, targetTime)
  }

  if (targetTime <= points[0].timeSeconds) {
    return projectDiscretePoint(points[0], targetTime)
  }

  const rightIndex = findCursorSegmentIndex(points, targetTime)
  const previousPoint = points[Math.max(0, rightIndex - 1)]
  const nextPoint = points[rightIndex] ?? points[points.length - 1]

  if (previousPoint && nextPoint) {
    const { rawRatio, ratio } = getCursorInterpolationProgress(
      previousPoint.timeSeconds,
      nextPoint.timeSeconds,
      targetTime,
      animationStyle,
    )

    return projectInterpolatedPoint({
      points,
      rightIndex,
      targetTime,
      rawRatio,
      ratio,
      previousPoint,
      nextPoint,
      interpolationBlend: getCursorInterpolationBlend(animationStyle),
    })
  }

  return projectDiscretePoint(points[points.length - 1], targetTime)
}
