import type { CursorAppearanceAsset, CursorVisualKind } from './types'
import arrowSvg from '../cursors/Arrow.svg?raw'
import helpSvg from '../cursors/Help.svg?raw'
import moveSvg from '../cursors/Move.svg?raw'
import pointerSvg from '../cursors/Pointer.svg?raw'
import textSvg from '../cursors/Text.svg?raw'
import typingSvg from '../cursors/Typing (GIF).svg?raw'
import zoomOutSvg from '../cursors/ZoomOut.svg?raw'

const svgToDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    svg
      .replace(/\r?\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  )}`

const CURSOR_BASE_LAYOUT_SIZE = 24
const CURSOR_CANVAS_SIZE = 64
const WINDOWS_CURSOR_REFERENCE_SIZE = 32

const arrowHotspot = { hotspotRatioX: 0.3333, hotspotRatioY: 0.2256 }
const handHotspot = { hotspotRatioX: 0.36, hotspotRatioY: 0.06 }
const centeredHotspot = { hotspotRatioX: 0.5, hotspotRatioY: 0.5 }

const extractSvgViewBox = (svgMarkup: string) => {
  const match = svgMarkup.match(/viewBox=["']([^"']+)["']/i)

  if (!match) {
    return { minX: 0, minY: 0, width: CURSOR_CANVAS_SIZE, height: CURSOR_CANVAS_SIZE }
  }

  const [minX, minY, width, height] = match[1]
    .trim()
    .split(/[ ,]+/)
    .map((value) => Number(value))

  if (![minX, minY, width, height].every((value) => Number.isFinite(value))) {
    return { minX: 0, minY: 0, width: CURSOR_CANVAS_SIZE, height: CURSOR_CANVAS_SIZE }
  }

  return {
    minX,
    minY,
    width: width > 0 ? width : CURSOR_CANVAS_SIZE,
    height: height > 0 ? height : CURSOR_CANVAS_SIZE,
  }
}

const extractSvgBody = (svgMarkup: string) => {
  const openingTagEnd = svgMarkup.indexOf('>')
  const closingTagStart = svgMarkup.lastIndexOf('</svg>')

  if (openingTagEnd === -1 || closingTagStart === -1 || closingTagStart <= openingTagEnd) {
    return svgMarkup.trim()
  }

  return svgMarkup.slice(openingTagEnd + 1, closingTagStart).trim()
}

const formatSvgNumber = (value: number) => Number(value.toFixed(4))
const scaleCursorLayout = (value: number) =>
  formatSvgNumber((value / CURSOR_BASE_LAYOUT_SIZE) * CURSOR_CANVAS_SIZE)

const composeCursorSvg = (
  layers: Array<{
    svgMarkup: string
    x: number
    y: number
    width: number
    height: number
  }>,
) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CURSOR_CANVAS_SIZE}" height="${CURSOR_CANVAS_SIZE}" viewBox="0 0 ${CURSOR_CANVAS_SIZE} ${CURSOR_CANVAS_SIZE}" fill="none">${layers
    .map(({ svgMarkup, x, y, width, height }) => {
      const { minX, minY, width: sourceWidth, height: sourceHeight } = extractSvgViewBox(svgMarkup)
      const scaleX = width / sourceWidth
      const scaleY = height / sourceHeight
      const translateX = x - minX * scaleX
      const translateY = y - minY * scaleY

      return `<g transform="translate(${formatSvgNumber(translateX)} ${formatSvgNumber(translateY)}) scale(${formatSvgNumber(scaleX)} ${formatSvgNumber(scaleY)})">${extractSvgBody(svgMarkup)}</g>`
    })
    .join('')}</svg>`

const normalizeCursorSvg = (svgMarkup: string) =>
  composeCursorSvg([
    {
      svgMarkup,
      x: 0,
      y: 0,
      width: CURSOR_CANVAS_SIZE,
      height: CURSOR_CANVAS_SIZE,
    },
  ])

const createCursorAsset = (
  id: string,
  cursorKind: CursorVisualKind,
  svgMarkup: string,
  hotspot: { hotspotRatioX: number; hotspotRatioY: number },
): CursorAppearanceAsset => ({
  id,
  cursorKind,
  imageDataUrl: svgToDataUrl(svgMarkup),
  hotspotRatioX: hotspot.hotspotRatioX,
  hotspotRatioY: hotspot.hotspotRatioY,
  referenceWidth: WINDOWS_CURSOR_REFERENCE_SIZE,
  referenceHeight: WINDOWS_CURSOR_REFERENCE_SIZE,
})

const defaultCursorHotspots: Record<CursorVisualKind, { hotspotRatioX: number; hotspotRatioY: number }> = {
  arrow: arrowHotspot,
  hand: handHotspot,
  ibeam: centeredHotspot,
  crosshair: centeredHotspot,
  move: centeredHotspot,
  'resize-ew': centeredHotspot,
  'resize-ns': centeredHotspot,
  'resize-nesw': centeredHotspot,
  'resize-nwse': centeredHotspot,
  'not-allowed': arrowHotspot,
  help: arrowHotspot,
  wait: arrowHotspot,
}

const arrowCursorSvg = normalizeCursorSvg(arrowSvg)
const handCursorSvg = normalizeCursorSvg(pointerSvg)
const ibeamCursorSvg = normalizeCursorSvg(textSvg)
const moveCursorSvg = normalizeCursorSvg(moveSvg)

const helpCursorSvg = composeCursorSvg([
  { svgMarkup: arrowCursorSvg, x: 0, y: 0, width: CURSOR_CANVAS_SIZE, height: CURSOR_CANVAS_SIZE },
  {
    svgMarkup: helpSvg,
    x: scaleCursorLayout(11.5),
    y: scaleCursorLayout(11.1),
    width: scaleCursorLayout(10.3),
    height: scaleCursorLayout(10.3),
  },
])

const notAllowedCursorSvg = composeCursorSvg([
  { svgMarkup: arrowCursorSvg, x: 0, y: 0, width: CURSOR_CANVAS_SIZE, height: CURSOR_CANVAS_SIZE },
  {
    svgMarkup: zoomOutSvg,
    x: scaleCursorLayout(11.8),
    y: scaleCursorLayout(11.2),
    width: scaleCursorLayout(10.2),
    height: scaleCursorLayout(10.2),
  },
])

const waitCursorSvg = composeCursorSvg([
  { svgMarkup: arrowCursorSvg, x: 0, y: 0, width: CURSOR_CANVAS_SIZE, height: CURSOR_CANVAS_SIZE },
  {
    svgMarkup: typingSvg,
    x: scaleCursorLayout(12.2),
    y: scaleCursorLayout(11.4),
    width: scaleCursorLayout(9.4),
    height: scaleCursorLayout(9.4),
  },
])

export const PREMIUM_CURSOR_APPEARANCE_CATALOG: CursorAppearanceAsset[] = [
  createCursorAsset('premium-arrow', 'arrow', arrowCursorSvg, defaultCursorHotspots.arrow),
  createCursorAsset('premium-hand', 'hand', handCursorSvg, defaultCursorHotspots.hand),
  createCursorAsset('premium-ibeam', 'ibeam', ibeamCursorSvg, defaultCursorHotspots.ibeam),
  createCursorAsset('premium-crosshair', 'crosshair', moveCursorSvg, defaultCursorHotspots.crosshair),
  createCursorAsset('premium-move', 'move', moveCursorSvg, defaultCursorHotspots.move),
  createCursorAsset('premium-resize-ew', 'resize-ew', moveCursorSvg, defaultCursorHotspots['resize-ew']),
  createCursorAsset('premium-resize-ns', 'resize-ns', moveCursorSvg, defaultCursorHotspots['resize-ns']),
  createCursorAsset('premium-resize-nesw', 'resize-nesw', moveCursorSvg, defaultCursorHotspots['resize-nesw']),
  createCursorAsset('premium-resize-nwse', 'resize-nwse', moveCursorSvg, defaultCursorHotspots['resize-nwse']),
  createCursorAsset('premium-help', 'help', helpCursorSvg, defaultCursorHotspots.help),
  createCursorAsset(
    'premium-not-allowed',
    'not-allowed',
    notAllowedCursorSvg,
    defaultCursorHotspots['not-allowed'],
  ),
  createCursorAsset('premium-wait', 'wait', waitCursorSvg, defaultCursorHotspots.wait),
]

export const PREMIUM_CURSOR_APPEARANCE_BY_KIND = new Map(
  PREMIUM_CURSOR_APPEARANCE_CATALOG.map((asset) => [asset.cursorKind, asset] as const),
)

export const getDefaultCursorHotspotRatios = (cursorKind: CursorVisualKind) =>
  defaultCursorHotspots[cursorKind] ?? defaultCursorHotspots.arrow
