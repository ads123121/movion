const clampNumber = (value, minimum, maximum) => {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, value))
}

const clampUnit = (value) => clampNumber(value, 0, 1)
const lerpNumber = (left, right, progress) => left + (right - left) * progress

const easeOutCubic = (progress) => 1 - (1 - progress) ** 3
const easeInOutCubic = (progress) =>
  progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2
const smootherStep = (progress) => {
  const clamped = clampUnit(progress)
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10)
}

const evaluateCriticallyDampedSpring = (progress, response) => {
  const clamped = clampUnit(progress)

  if (!Number.isFinite(response) || response <= 0) {
    return clamped
  }

  const normalizationFactor = 1 - Math.exp(-response) * (1 + response)

  if (Math.abs(normalizationFactor) <= 0.000001) {
    return clamped
  }

  return clampUnit((1 - Math.exp(-response * clamped) * (1 + response * clamped)) / normalizationFactor)
}

export const FOCUS_MOTION_PROFILES = Object.freeze({
  connectedGapThresholdSeconds: 1.18,
  enter: {
    baseSeconds: 0.34,
    minSeconds: 0.24,
    maxSeconds: 0.74,
    positionWeight: 0.28,
    zoomWeight: 0.24,
  },
  reframe: {
    baseSeconds: 0.3,
    minSeconds: 0.22,
    maxSeconds: 0.64,
    positionWeight: 0.24,
    zoomWeight: 0.18,
  },
  exit: {
    baseSeconds: 0.4,
    minSeconds: 0.28,
    maxSeconds: 0.86,
    positionWeight: 0.3,
    zoomWeight: 0.24,
  },
})

export const FOCUS_MOTION_EASINGS = Object.freeze({
  linear: {
    baseCurve: 'linear',
    springResponse: null,
    springWeight: 0,
    leadFactor: 1,
  },
  cinematicZoom: {
    baseCurve: 'smootherStep',
    springResponse: 4.4,
    springWeight: 0.24,
    leadFactor: 1,
  },
  cinematicFocus: {
    baseCurve: 'easeOutCubic',
    springResponse: 4.8,
    springWeight: 0.18,
    leadFactor: 1.08,
  },
  cinematicReframe: {
    baseCurve: 'easeOutCubic',
    springResponse: 4.4,
    springWeight: 0.28,
    leadFactor: 1.04,
  },
  cinematicExit: {
    baseCurve: 'smootherStep',
    springResponse: 3.8,
    springWeight: 0.34,
    leadFactor: 1,
  },
})

export const AUTO_FOCUS_REPEAT_CLICK_WINDOW_SECONDS = 0.36
export const AUTO_FOCUS_REPEAT_DISTANCE = 0.045
export const AUTO_FOCUS_CLUSTER_CLICK_WINDOW_SECONDS = 2.4
export const AUTO_FOCUS_CLUSTER_VISIBLE_GAP_SECONDS = 0.45
export const AUTO_FOCUS_CLUSTER_DISTANCE = 0.09
export const AUTO_FOCUS_SETTLE_LEAD_SECONDS = 0.2
export const AUTO_FOCUS_LONG_CLICK_SETTLE_LEAD_SECONDS = 0.24
const AUTO_FOCUS_APPROACH_DISTANCE_WEIGHT = 0.22
const AUTO_FOCUS_APPROACH_SPEED_WEIGHT = 0.04
const AUTO_FOCUS_MAX_ADDITIONAL_LEAD_SECONDS = 0.16
export const AUTO_FOCUS_CLICK_MATCH_WINDOW_SECONDS = 0.42
export const AUTO_FOCUS_CLICK_MATCH_DISTANCE = 0.14
export const AUTO_FOCUS_POST_CLICK_HOLD_RATIO = 0.28
export const AUTO_FOCUS_MIN_POST_CLICK_HOLD_SECONDS = 0.22
export const AUTO_FOCUS_MAX_POST_CLICK_HOLD_SECONDS = 0.48

function createFocusRegionId(index) {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  return randomUuid || `focus-region-${index + 1}`
}

export function shouldSettleFocusRegionAtStart(region) {
  if (region?.settleAtStart === true) {
    return true
  }

  if (region?.settleAtStart === false) {
    return false
  }

  return typeof region?.label === 'string' && /^auto zoom\b/i.test(region.label.trim())
}

export function isAutomaticFocusRegion(region) {
  return Boolean(
    region &&
      shouldSettleFocusRegionAtStart(region) &&
      typeof region.label === 'string' &&
      /^auto zoom\b/i.test(region.label.trim()),
  )
}

export function shouldClusterAutomaticFocusRegions(previousRegion, nextRegion) {
  if (!isAutomaticFocusRegion(previousRegion) || !isAutomaticFocusRegion(nextRegion)) {
    return false
  }

  const clickWindowSeconds = nextRegion.startSeconds - previousRegion.startSeconds
  const visibleGapSeconds = nextRegion.startSeconds - previousRegion.endSeconds
  const focusDistance = Math.hypot(nextRegion.focusX - previousRegion.focusX, nextRegion.focusY - previousRegion.focusY)

  return (
    clickWindowSeconds <= AUTO_FOCUS_CLUSTER_CLICK_WINDOW_SECONDS &&
    visibleGapSeconds <= AUTO_FOCUS_CLUSTER_VISIBLE_GAP_SECONDS &&
    focusDistance <= AUTO_FOCUS_CLUSTER_DISTANCE
  )
}

export function coalesceAutomaticFocusRegions(regions) {
  if (!Array.isArray(regions) || !regions.length) {
    return []
  }

  const coalescedRegions = []

  regions.forEach((region) => {
    const previousRegion = coalescedRegions.at(-1)

    if (previousRegion && shouldClusterAutomaticFocusRegions(previousRegion, region)) {
      previousRegion.endSeconds = Number(Math.max(previousRegion.endSeconds, region.endSeconds).toFixed(3))
      previousRegion.zoom = Number(Math.max(previousRegion.zoom, region.zoom).toFixed(2))
      previousRegion.settleAtStart = true
      previousRegion.settleLeadSeconds = Number(
        Math.max(previousRegion.settleLeadSeconds ?? 0, region.settleLeadSeconds ?? 0).toFixed(3),
      )
      return
    }

    coalescedRegions.push({
      ...region,
    })
  })

  return coalescedRegions
}

export function normalizeFocusRegions(focusRegions, durationSeconds) {
  if (!Array.isArray(focusRegions) || !focusRegions.length) {
    return []
  }

  const maxDuration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Number(durationSeconds)
      : Number.POSITIVE_INFINITY

  return coalesceAutomaticFocusRegions(
    focusRegions
      .map((region, index) => {
        const startSeconds = clampNumber(
          Number.isFinite(region?.startSeconds) ? Number(region.startSeconds) : 0,
          0,
          maxDuration,
        )
        const endSeconds = clampNumber(
          Number.isFinite(region?.endSeconds) ? Number(region.endSeconds) : startSeconds + 1.2,
          startSeconds + 0.08,
          maxDuration,
        )
        const focusX = clampNumber(Number.isFinite(region?.focusX) ? Number(region.focusX) : 0.5, 0, 1)
        const focusY = clampNumber(Number.isFinite(region?.focusY) ? Number(region.focusY) : 0.5, 0, 1)

        return {
          id: region?.id || createFocusRegionId(index),
          label:
            typeof region?.label === 'string' && region.label.trim()
              ? region.label.trim()
              : `Zoom ${index + 1}`,
          startSeconds: Number(startSeconds.toFixed(3)),
          endSeconds: Number(endSeconds.toFixed(3)),
          zoom: Number(clampNumber(Number.isFinite(region?.zoom) ? Number(region.zoom) : 2.15, 1.05, 4).toFixed(2)),
          focusX: Number(focusX.toFixed(4)),
          focusY: Number(focusY.toFixed(4)),
          settleAtStart: shouldSettleFocusRegionAtStart(region),
          settleLeadSeconds: shouldSettleFocusRegionAtStart(region)
            ? Number(
                clampNumber(
                  Number.isFinite(region?.settleLeadSeconds)
                    ? Number(region.settleLeadSeconds)
                    : AUTO_FOCUS_SETTLE_LEAD_SECONDS,
                  0.1,
                  0.42,
                ).toFixed(3),
              )
            : undefined,
        }
      })
      .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds),
  )
}

export function buildAutomaticFocusRegions(cursorTrack, autoZoomMode, durationSeconds) {
  if (!cursorTrack || !Array.isArray(cursorTrack.clicks) || !cursorTrack.clicks.length || autoZoomMode === 'off') {
    return []
  }

  const eligibleClicks = cursorTrack.clicks.filter((click) => {
    if (click.button !== 'left') {
      return false
    }

    if (autoZoomMode === 'ctrl-click') {
      return Boolean(click.ctrlKey)
    }

    if (autoZoomMode === 'long-clicks') {
      return Number(click.durationMs) >= 260
    }

    return true
  })

  if (!eligibleClicks.length) {
    return []
  }

  const nextRegions = []
  let previousClick = null

  for (const click of eligibleClicks) {
    const clickDurationMs = Number.isFinite(click?.durationMs) ? Number(click.durationMs) : 0
    const startSeconds = clampNumber(click.timeSeconds, 0, durationSeconds)
    const postClickHoldSeconds =
      autoZoomMode === 'long-clicks'
        ? clampNumber(0.8 + clickDurationMs / 1000, 1.35, 1.9)
        : 1.22
    const endSeconds = clampNumber(click.timeSeconds + postClickHoldSeconds, startSeconds + 0.14, durationSeconds)
    const previousRegion = nextRegions.at(-1)
    const focusDistance = previousRegion
      ? Math.hypot(previousRegion.focusX - click.x, previousRegion.focusY - click.y)
      : Number.POSITIVE_INFINITY
    const previousClickDistance = previousClick
      ? Math.hypot(previousClick.x - click.x, previousClick.y - click.y)
      : Number.POSITIVE_INFINITY
    const clickWindowSeconds = previousClick
      ? click.timeSeconds - previousClick.timeSeconds
      : Number.POSITIVE_INFINITY
    const visibleGapSeconds = previousRegion
      ? click.timeSeconds - previousRegion.endSeconds
      : Number.POSITIVE_INFINITY

    if (
      previousRegion &&
      click.timeSeconds - previousRegion.startSeconds <= AUTO_FOCUS_REPEAT_CLICK_WINDOW_SECONDS &&
      focusDistance <= AUTO_FOCUS_REPEAT_DISTANCE
    ) {
      previousRegion.endSeconds = Math.max(previousRegion.endSeconds, Number(endSeconds.toFixed(3)))
      previousRegion.focusX = Number(click.x.toFixed(4))
      previousRegion.focusY = Number(click.y.toFixed(4))
      previousRegion.settleAtStart = true
      previousRegion.settleLeadSeconds = Number(
        Math.max(
          previousRegion.settleLeadSeconds ?? 0,
          autoZoomMode === 'long-clicks'
            ? AUTO_FOCUS_LONG_CLICK_SETTLE_LEAD_SECONDS
            : AUTO_FOCUS_SETTLE_LEAD_SECONDS,
        ).toFixed(3),
      )
      previousClick = click
      continue
    }

    if (
      previousRegion &&
      previousClick &&
      clickWindowSeconds <= AUTO_FOCUS_CLUSTER_CLICK_WINDOW_SECONDS &&
      visibleGapSeconds <= AUTO_FOCUS_CLUSTER_VISIBLE_GAP_SECONDS &&
      previousClickDistance <= AUTO_FOCUS_CLUSTER_DISTANCE
    ) {
      previousRegion.endSeconds = Math.max(previousRegion.endSeconds, Number(endSeconds.toFixed(3)))
      previousRegion.zoom = Number(Math.max(previousRegion.zoom, autoZoomMode === 'long-clicks' ? 2.35 : 2.15).toFixed(2))
      previousRegion.settleAtStart = true
      previousRegion.settleLeadSeconds = Number(
        Math.max(
          previousRegion.settleLeadSeconds ?? 0,
          autoZoomMode === 'long-clicks'
            ? AUTO_FOCUS_LONG_CLICK_SETTLE_LEAD_SECONDS
            : AUTO_FOCUS_SETTLE_LEAD_SECONDS,
        ).toFixed(3),
      )
      previousClick = click
      continue
    }

    nextRegions.push({
      id: createFocusRegionId(nextRegions.length),
      label: `Auto Zoom ${nextRegions.length + 1}`,
      startSeconds: Number(startSeconds.toFixed(3)),
      endSeconds: Number(endSeconds.toFixed(3)),
      zoom: autoZoomMode === 'long-clicks' ? 2.35 : 2.15,
      focusX: Number(click.x.toFixed(4)),
      focusY: Number(click.y.toFixed(4)),
      settleAtStart: true,
      settleLeadSeconds:
        autoZoomMode === 'long-clicks'
          ? AUTO_FOCUS_LONG_CLICK_SETTLE_LEAD_SECONDS
          : AUTO_FOCUS_SETTLE_LEAD_SECONDS,
    })
    previousClick = click
  }

  return normalizeFocusRegions(nextRegions, durationSeconds)
}

export function createFocusMotionPoint(timeSeconds, state) {
  return {
    timeSeconds: Number(timeSeconds.toFixed(3)),
    zoom: Number(clampNumber(state.zoom, 1, 4).toFixed(3)),
    focusX: Number(clampUnit(state.focusX).toFixed(4)),
    focusY: Number(clampUnit(state.focusY).toFixed(4)),
  }
}

function appendFocusMotionSegment(
  segments,
  startSeconds,
  endSeconds,
  fromState,
  toState,
  zoomEasing = 'linear',
  focusEasing = zoomEasing,
) {
  if (endSeconds <= startSeconds + 0.001) {
    return
  }

  segments.push({
    startSeconds: Number(startSeconds.toFixed(3)),
    endSeconds: Number(endSeconds.toFixed(3)),
    from: createFocusMotionPoint(startSeconds, fromState),
    to: createFocusMotionPoint(endSeconds, toState),
    zoomEasing,
    focusEasing,
  })
}

export function buildFocusTransitionSeconds(from, to, options) {
  const focusDistance = Math.hypot(to.focusX - from.focusX, to.focusY - from.focusY)
  const zoomDistance = Math.abs(to.zoom - from.zoom)
  return clampNumber(
    options.baseSeconds + focusDistance * options.positionWeight + zoomDistance * options.zoomWeight,
    options.minSeconds,
    options.maxSeconds,
  )
}

export function getFocusEnterMotionProfile(from) {
  return from.zoom > 1.01
    ? {
        profile: FOCUS_MOTION_PROFILES.reframe,
        focusEasing: 'cinematicReframe',
      }
    : {
        profile: FOCUS_MOTION_PROFILES.enter,
        focusEasing: 'cinematicFocus',
      }
}

export function getFocusRegionTargetState(region) {
  return createFocusMotionPoint(region.startSeconds, {
    zoom: region.zoom,
    focusX: region.focusX,
    focusY: region.focusY,
  })
}

export function getFocusRegionSettleLeadSeconds(
  region,
  enterDurationSeconds,
  {
    cursorTrack = null,
    getCursorApproachMetrics = null,
  } = {},
) {
  if (!shouldSettleFocusRegionAtStart(region)) {
    return 0
  }

  const explicitLeadSeconds = Number.isFinite(region?.settleLeadSeconds)
    ? Number(region.settleLeadSeconds)
    : AUTO_FOCUS_SETTLE_LEAD_SECONDS
  const adaptiveLeadSeconds = clampNumber(enterDurationSeconds * 0.34, 0.12, 0.24)
  const cursorApproachMetrics =
    Number.isFinite(region?.startSeconds) && cursorTrack?.points?.length && typeof getCursorApproachMetrics === 'function'
      ? getCursorApproachMetrics(cursorTrack.points, Number(region.startSeconds))
      : null
  const motionLeadSeconds = cursorApproachMetrics
    ? clampNumber(
        cursorApproachMetrics.effectiveDistance * AUTO_FOCUS_APPROACH_DISTANCE_WEIGHT +
          cursorApproachMetrics.approachSpeed * AUTO_FOCUS_APPROACH_SPEED_WEIGHT,
        0,
        AUTO_FOCUS_MAX_ADDITIONAL_LEAD_SECONDS,
      )
    : 0

  return clampNumber(Math.max(explicitLeadSeconds, adaptiveLeadSeconds) + motionLeadSeconds, 0.1, 0.56)
}

export function findMatchingAutoFocusClick(region, cursorTrack) {
  if (!isAutomaticFocusRegion(region) || !Array.isArray(cursorTrack?.clicks) || !cursorTrack.clicks.length) {
    return null
  }

  let bestMatch = null
  let bestScore = Number.POSITIVE_INFINITY

  cursorTrack.clicks.forEach((click) => {
    if (click.button !== 'left') {
      return
    }

    const timeDistance = Math.abs(click.timeSeconds - region.startSeconds)
    const focusDistance = Math.hypot(click.x - region.focusX, click.y - region.focusY)

    if (timeDistance > AUTO_FOCUS_CLICK_MATCH_WINDOW_SECONDS || focusDistance > AUTO_FOCUS_CLICK_MATCH_DISTANCE) {
      return
    }

    const score = timeDistance * 1.8 + focusDistance

    if (score < bestScore) {
      bestScore = score
      bestMatch = click
    }
  })

  return bestMatch
}

export function getAutoFocusRegionClickAnchorSeconds(region, cursorTrack, durationSeconds) {
  if (!isAutomaticFocusRegion(region)) {
    return clampNumber(region.startSeconds, 0, durationSeconds)
  }

  const matchedClick = findMatchingAutoFocusClick(region, cursorTrack)
  const rawAnchorSeconds = matchedClick ? Number(matchedClick.timeSeconds) : region.startSeconds

  return clampNumber(rawAnchorSeconds, 0, durationSeconds)
}

export function getAutoFocusPostClickHoldSeconds(region, clickAnchorSeconds) {
  return clampNumber(
    Math.max(0, region.endSeconds - clickAnchorSeconds) * AUTO_FOCUS_POST_CLICK_HOLD_RATIO,
    AUTO_FOCUS_MIN_POST_CLICK_HOLD_SECONDS,
    AUTO_FOCUS_MAX_POST_CLICK_HOLD_SECONDS,
  )
}

export function getFocusRegionCueStartSeconds(
  from,
  region,
  durationSeconds,
  {
    cursorTrack = null,
    getCursorApproachMetrics = null,
  } = {},
) {
  const targetState = getFocusRegionTargetState(region)
  const { profile } = getFocusEnterMotionProfile(from)
  const enterDurationSeconds = buildFocusTransitionSeconds(from, targetState, profile)
  const settleLeadSeconds = getFocusRegionSettleLeadSeconds(region, enterDurationSeconds, {
    cursorTrack,
    getCursorApproachMetrics,
  })
  const clickAnchorSeconds = getAutoFocusRegionClickAnchorSeconds(region, cursorTrack, durationSeconds)
  const cueStartSeconds = shouldSettleFocusRegionAtStart(region)
    ? clickAnchorSeconds - (enterDurationSeconds + settleLeadSeconds)
    : region.startSeconds

  return clampNumber(cueStartSeconds, 0, durationSeconds)
}

function evaluateBaseCurve(baseCurve, progress) {
  if (baseCurve === 'smootherStep') {
    return smootherStep(progress)
  }

  if (baseCurve === 'easeOutCubic') {
    return easeOutCubic(progress)
  }

  if (baseCurve === 'easeInOutCubic') {
    return easeInOutCubic(progress)
  }

  return clampUnit(progress)
}

export function evaluateFocusMotionEasing(easingId, progress) {
  const easing = FOCUS_MOTION_EASINGS[easingId] ?? FOCUS_MOTION_EASINGS.linear
  const clamped = clampUnit(progress)
  const ledProgress = clampUnit(clamped * easing.leadFactor)
  const baseValue = evaluateBaseCurve(easing.baseCurve, ledProgress)

  if (!easing.springResponse || easing.springWeight <= 0.001) {
    return baseValue
  }

  const springValue = evaluateCriticallyDampedSpring(ledProgress, easing.springResponse)
  return clampUnit(lerpNumber(baseValue, springValue, easing.springWeight))
}

export function buildFocusMotionSegments(
  focusRegions,
  durationSeconds,
  {
    idleFocusX = 0.5,
    idleFocusY = 0.5,
    cursorTrack = null,
    getCursorApproachMetrics = null,
  } = {},
) {
  const safeDuration = Math.max(0.01, durationSeconds)
  const idleState = createFocusMotionPoint(0, {
    zoom: 1,
    focusX: idleFocusX,
    focusY: idleFocusY,
  })

  if (!focusRegions.length) {
    return [
      {
        startSeconds: 0,
        endSeconds: Number(safeDuration.toFixed(3)),
        from: idleState,
        to: createFocusMotionPoint(safeDuration, idleState),
        zoomEasing: 'linear',
        focusEasing: 'linear',
      },
    ]
  }

  const segments = []
  let currentState = idleState
  let currentTime = 0

  focusRegions.forEach((region, index) => {
    const targetState = getFocusRegionTargetState(region)
    const nextRegion = focusRegions[index + 1] ?? null
    const { profile: enterProfile, focusEasing } = getFocusEnterMotionProfile(currentState)
    const enterDurationSeconds = buildFocusTransitionSeconds(currentState, targetState, enterProfile)
    const isAutoFocusRegion = shouldSettleFocusRegionAtStart(region)
    const clickAnchorSeconds = getAutoFocusRegionClickAnchorSeconds(region, cursorTrack, safeDuration)
    const enterStartSeconds = Math.max(
      currentTime,
      getFocusRegionCueStartSeconds(currentState, region, safeDuration, {
        cursorTrack,
        getCursorApproachMetrics,
      }),
    )
    const settleLeadSeconds = getFocusRegionSettleLeadSeconds(region, enterDurationSeconds, {
      cursorTrack,
      getCursorApproachMetrics,
    })

    if (enterStartSeconds > currentTime + 0.001) {
      appendFocusMotionSegment(segments, currentTime, enterStartSeconds, currentState, currentState)
      currentTime = enterStartSeconds
    }

    const settleTime = Math.min(
      safeDuration,
      region.endSeconds,
      Math.max(
        enterStartSeconds + 0.08,
        isAutoFocusRegion
          ? clickAnchorSeconds - settleLeadSeconds
          : enterStartSeconds + enterDurationSeconds,
      ),
    )
    appendFocusMotionSegment(
      segments,
      enterStartSeconds,
      settleTime,
      currentState,
      targetState,
      'cinematicZoom',
      focusEasing,
    )

    currentState = targetState
    currentTime = settleTime

    const nextCueStartSeconds = nextRegion
      ? getFocusRegionCueStartSeconds(currentState, nextRegion, safeDuration, {
          cursorTrack,
          getCursorApproachMetrics,
        })
      : Number.POSITIVE_INFINITY
    const holdEndSeconds = isAutoFocusRegion
      ? Math.min(
          region.endSeconds,
          Math.max(
            currentTime,
            Math.min(
              clickAnchorSeconds + getAutoFocusPostClickHoldSeconds(region, clickAnchorSeconds),
              nextCueStartSeconds,
            ),
          ),
        )
      : Math.min(region.endSeconds, Math.max(currentTime, nextCueStartSeconds))

    if (holdEndSeconds > currentTime + 0.001) {
      appendFocusMotionSegment(segments, currentTime, holdEndSeconds, currentState, currentState)
      currentTime = holdEndSeconds
    }

    const gapToNextSeconds = nextRegion ? Math.max(0, nextCueStartSeconds - currentTime) : Number.POSITIVE_INFINITY
    if (nextRegion && gapToNextSeconds <= FOCUS_MOTION_PROFILES.connectedGapThresholdSeconds) {
      return
    }

    const exitDurationSeconds = buildFocusTransitionSeconds(currentState, idleState, FOCUS_MOTION_PROFILES.exit)
    const exitStartSeconds = currentTime
    const nextCueFromIdleSeconds = nextRegion
      ? getFocusRegionCueStartSeconds(idleState, nextRegion, safeDuration, {
          cursorTrack,
          getCursorApproachMetrics,
        })
      : Number.POSITIVE_INFINITY
    const exitEndSeconds = Math.min(
      safeDuration,
      nextRegion
        ? Math.min(nextCueFromIdleSeconds, exitStartSeconds + exitDurationSeconds)
        : exitStartSeconds + exitDurationSeconds,
    )

    appendFocusMotionSegment(
      segments,
      exitStartSeconds,
      exitEndSeconds,
      currentState,
      idleState,
      'cinematicExit',
      'cinematicExit',
    )
    currentState = createFocusMotionPoint(exitEndSeconds, idleState)
    currentTime = exitEndSeconds
  })

  if (currentTime < safeDuration - 0.001) {
    appendFocusMotionSegment(segments, currentTime, safeDuration, currentState, currentState)
  }

  return segments
}
