const clampNumber = (value, minimum, maximum) => {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, value))
}

export function getCursorDistance(left, right) {
  return Math.hypot((right?.x ?? 0) - (left?.x ?? 0), (right?.y ?? 0) - (left?.y ?? 0))
}

export function getCursorSpeed(left, right) {
  const deltaSeconds = Math.max(0.016, (right?.timeSeconds ?? 0) - (left?.timeSeconds ?? 0))
  return getCursorDistance(left, right) / deltaSeconds
}

export function inferCursorPulseEvents(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return []
  }

  const pulses = []
  let lastPulseTime = -1

  for (let index = 2; index < points.length; index += 1) {
    const first = points[index - 2]
    const second = points[index - 1]
    const third = points[index]
    const incomingSpeed = getCursorSpeed(first, second)
    const outgoingSpeed = getCursorSpeed(second, third)
    const recentTravel = getCursorDistance(first, second) + getCursorDistance(second, third)
    const holdDistance = getCursorDistance(second, third)

    if (
      incomingSpeed < 0.85 ||
      outgoingSpeed > 0.08 ||
      recentTravel < 0.035 ||
      holdDistance > 0.012 ||
      second.timeSeconds - lastPulseTime < 0.42
    ) {
      continue
    }

    lastPulseTime = second.timeSeconds
    pulses.push({
      id: `pulse-${index}-${second.timeSeconds.toFixed(3)}`,
      timeSeconds: second.timeSeconds,
      x: second.x,
      y: second.y,
      strength: Number(clampNumber(incomingSpeed / 2.6, 0.8, 1.45).toFixed(3)),
    })
  }

  return pulses
}

export function getCursorPulseEventsForTrack(cursorTrack) {
  if (!cursorTrack?.points?.length) {
    return []
  }

  if (Array.isArray(cursorTrack.clicks) && cursorTrack.clicks.length) {
    return cursorTrack.clicks.map((click, index) => ({
      id: `click-${click.button}-${index}-${click.timeSeconds.toFixed(3)}`,
      timeSeconds: click.timeSeconds,
      x: click.x,
      y: click.y,
      strength: click.button === 'right' ? 1.15 : 1,
    }))
  }

  return inferCursorPulseEvents(cursorTrack.points)
}

export function getCursorApproachMetrics(
  points,
  targetTimeSeconds,
  {
    sampleRange = null,
    lookbackSeconds = 0.36,
  } = {},
) {
  if (!Array.isArray(points) || !points.length || !Number.isFinite(targetTimeSeconds) || typeof sampleRange !== 'function') {
    return null
  }

  const sampledPoints = sampleRange(points, Math.max(0, targetTimeSeconds - lookbackSeconds), targetTimeSeconds)

  if (!Array.isArray(sampledPoints) || sampledPoints.length < 2) {
    return null
  }

  let traveledDistance = 0
  let lastMeaningfulSpeed = 0

  for (let index = 1; index < sampledPoints.length; index += 1) {
    const previousPoint = sampledPoints[index - 1]
    const currentPoint = sampledPoints[index]
    const segmentDistance = getCursorDistance(previousPoint, currentPoint)
    const deltaSeconds = Math.max(0.016, currentPoint.timeSeconds - previousPoint.timeSeconds)

    traveledDistance += segmentDistance

    if (segmentDistance > 0.002) {
      lastMeaningfulSpeed = segmentDistance / deltaSeconds
    }
  }

  const directDistance = getCursorDistance(sampledPoints[0], sampledPoints[sampledPoints.length - 1])
  const effectiveDistance = clampNumber(
    directDistance + Math.max(0, traveledDistance - directDistance) * 0.28,
    0,
    0.4,
  )
  const elapsedSeconds = Math.max(
    0.016,
    sampledPoints[sampledPoints.length - 1].timeSeconds - sampledPoints[0].timeSeconds,
  )

  return {
    effectiveDistance,
    approachSpeed: Math.max(effectiveDistance / elapsedSeconds, lastMeaningfulSpeed),
  }
}
