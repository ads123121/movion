const CURSOR_DEFAULT_HOTSPOTS = {
  arrow: Object.freeze({ hotspotRatioX: 0.3333, hotspotRatioY: 0.2256 }),
  hand: Object.freeze({ hotspotRatioX: 0.36, hotspotRatioY: 0.06 }),
  ibeam: Object.freeze({ hotspotRatioX: 0.5, hotspotRatioY: 0.5 }),
  crosshair: Object.freeze({ hotspotRatioX: 0.5, hotspotRatioY: 0.5 }),
  move: Object.freeze({ hotspotRatioX: 0.5, hotspotRatioY: 0.5 }),
  'resize-ew': Object.freeze({ hotspotRatioX: 0.5, hotspotRatioY: 0.5 }),
  'resize-ns': Object.freeze({ hotspotRatioX: 0.5, hotspotRatioY: 0.5 }),
  'resize-nesw': Object.freeze({ hotspotRatioX: 0.5, hotspotRatioY: 0.5 }),
  'resize-nwse': Object.freeze({ hotspotRatioX: 0.5, hotspotRatioY: 0.5 }),
  'not-allowed': Object.freeze({ hotspotRatioX: 0.3333, hotspotRatioY: 0.2256 }),
  help: Object.freeze({ hotspotRatioX: 0.3333, hotspotRatioY: 0.2256 }),
  wait: Object.freeze({ hotspotRatioX: 0.3333, hotspotRatioY: 0.2256 }),
}

const clampUnit = (value) => {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, Number(value)))
}

const normalizeCursorHotspotRatio = (value, fallback = 0) =>
  Number(clampUnit(Number.isFinite(value) ? Number(value) : fallback).toFixed(4))

export function normalizeCursorVisualKind(cursorKind) {
  switch (cursorKind) {
    case 'hand':
    case 'ibeam':
    case 'crosshair':
    case 'move':
    case 'resize-ew':
    case 'resize-ns':
    case 'resize-nesw':
    case 'resize-nwse':
    case 'not-allowed':
    case 'help':
    case 'wait':
      return cursorKind
    default:
      return 'arrow'
  }
}

export function normalizeCursorAppearanceId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export function getDefaultCursorHotspotRatios(cursorKind) {
  return CURSOR_DEFAULT_HOTSPOTS[normalizeCursorVisualKind(cursorKind)] ?? CURSOR_DEFAULT_HOTSPOTS.arrow
}

export function normalizeCursorHotspotRatiosForKind(cursorKind, hotspotRatioX, hotspotRatioY) {
  const defaults = getDefaultCursorHotspotRatios(cursorKind)
  let normalizedHotspotRatioX = normalizeCursorHotspotRatio(hotspotRatioX, defaults.hotspotRatioX)
  let normalizedHotspotRatioY = normalizeCursorHotspotRatio(hotspotRatioY, defaults.hotspotRatioY)

  if (defaults.hotspotRatioX > 0.0001 && normalizedHotspotRatioX <= 0.0001) {
    normalizedHotspotRatioX = defaults.hotspotRatioX
  }
  if (defaults.hotspotRatioY > 0.0001 && normalizedHotspotRatioY <= 0.0001) {
    normalizedHotspotRatioY = defaults.hotspotRatioY
  }

  return {
    hotspotRatioX: Number(normalizedHotspotRatioX.toFixed(4)),
    hotspotRatioY: Number(normalizedHotspotRatioY.toFixed(4)),
  }
}

export function normalizeCursorVisualState(point) {
  const cursorKind = normalizeCursorVisualKind(point?.cursorKind)
  const hotspotRatios = normalizeCursorHotspotRatiosForKind(
    cursorKind,
    point?.cursorHotspotRatioX,
    point?.cursorHotspotRatioY,
  )

  return {
    cursorKind,
    cursorAppearanceId: normalizeCursorAppearanceId(point?.cursorAppearanceId),
    cursorHotspotRatioX: hotspotRatios.hotspotRatioX,
    cursorHotspotRatioY: hotspotRatios.hotspotRatioY,
  }
}

export function normalizeCursorAppearanceAsset(asset) {
  const id = normalizeCursorAppearanceId(asset?.id)
  const imageDataUrl = typeof asset?.imageDataUrl === 'string' ? asset.imageDataUrl.trim() : ''

  if (!id || !imageDataUrl) {
    return null
  }

  const cursorKind = normalizeCursorVisualKind(asset?.cursorKind)
  const hotspotRatios = normalizeCursorHotspotRatiosForKind(
    cursorKind,
    asset?.hotspotRatioX,
    asset?.hotspotRatioY,
  )
  const referenceWidth =
    Number.isFinite(asset?.referenceWidth) && Number(asset?.referenceWidth) > 0
      ? Math.max(1, Number(asset.referenceWidth))
      : null
  const referenceHeight =
    Number.isFinite(asset?.referenceHeight) && Number(asset?.referenceHeight) > 0
      ? Math.max(1, Number(asset.referenceHeight))
      : null

  return {
    id,
    cursorKind,
    imageDataUrl,
    hotspotRatioX: hotspotRatios.hotspotRatioX,
    hotspotRatioY: hotspotRatios.hotspotRatioY,
    ...(referenceWidth ? { referenceWidth } : {}),
    ...(referenceHeight ? { referenceHeight } : {}),
  }
}

export function stabilizeCursorVisualKinds(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return points
  }

  const stabilizedPoints = points.map((point) => ({
    ...point,
    ...normalizeCursorVisualState(point),
  }))
  const segments = []
  let segmentStartIndex = 0

  for (let index = 1; index <= stabilizedPoints.length; index += 1) {
    const segmentKind = normalizeCursorVisualKind(stabilizedPoints[segmentStartIndex]?.cursorKind)
    const nextKind =
      index < stabilizedPoints.length
        ? normalizeCursorVisualKind(stabilizedPoints[index]?.cursorKind)
        : null

    if (index < stabilizedPoints.length && nextKind === segmentKind) {
      continue
    }

    segments.push({
      startIndex: segmentStartIndex,
      endIndex: index - 1,
      cursorKind: segmentKind,
      startSeconds: stabilizedPoints[segmentStartIndex].timeSeconds,
      endSeconds: stabilizedPoints[index - 1].timeSeconds,
    })
    segmentStartIndex = index
  }

  for (let index = 1; index < segments.length - 1; index += 1) {
    const previousSegment = segments[index - 1]
    const transientSegment = segments[index]
    const nextSegment = segments[index + 1]
    const segmentDuration = transientSegment.endSeconds - transientSegment.startSeconds
    const previousSegmentPoint = stabilizedPoints[previousSegment.endIndex] ?? stabilizedPoints[previousSegment.startIndex]

    if (
      previousSegment.cursorKind === nextSegment.cursorKind &&
      transientSegment.cursorKind !== previousSegment.cursorKind &&
      segmentDuration <= 0.075
    ) {
      for (let pointIndex = transientSegment.startIndex; pointIndex <= transientSegment.endIndex; pointIndex += 1) {
        stabilizedPoints[pointIndex] = {
          ...stabilizedPoints[pointIndex],
          ...normalizeCursorVisualState({
            cursorKind: previousSegment.cursorKind,
            cursorAppearanceId: previousSegmentPoint?.cursorAppearanceId,
            cursorHotspotRatioX: previousSegmentPoint?.cursorHotspotRatioX,
            cursorHotspotRatioY: previousSegmentPoint?.cursorHotspotRatioY,
          }),
        }
      }
    }
  }

  return stabilizedPoints
}
