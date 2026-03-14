import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, protocol, screen, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  normalizeFocusRegions as normalizeFocusRegionsShared,
  FOCUS_MOTION_EASINGS as SHARED_FOCUS_MOTION_EASINGS,
  buildFocusMotionSegments as buildFocusMotionSegmentsShared,
  coalesceAutomaticFocusRegions as coalesceAutomaticFocusRegionsShared,
  findMatchingAutoFocusClick as findMatchingAutoFocusClickShared,
  getAutoFocusPostClickHoldSeconds as getAutoFocusPostClickHoldSecondsShared,
  getAutoFocusRegionClickAnchorSeconds as getAutoFocusRegionClickAnchorSecondsShared,
  getFocusRegionCueStartSeconds as getFocusRegionCueStartSecondsShared,
  getFocusRegionSettleLeadSeconds as getFocusRegionSettleLeadSecondsShared,
  isAutomaticFocusRegion as isAutomaticFocusRegionShared,
  shouldClusterAutomaticFocusRegions as shouldClusterAutomaticFocusRegionsShared,
  shouldSettleFocusRegionAtStart as shouldSettleFocusRegionAtStartShared,
} from '../src/shared/focusMotion.js'
import {
  getCursorApproachMetrics as getCursorApproachMetricsShared,
  getCursorPulseEventsForTrack as getCursorPulseEventsForTrackShared,
  inferCursorPulseEvents as inferCursorPulseEventsShared,
} from '../src/shared/cursorTelemetry.js'
import {
  getCursorPointAtTime as getCursorPointAtTimeShared,
  projectDiscreteCursorVisualPoint as projectDiscreteCursorVisualPointShared,
  projectInterpolatedCursorVisualPoint as projectInterpolatedCursorVisualPointShared,
} from '../src/shared/cursorPath.js'
import {
  clampCursorClickEffectStrength,
  CURSOR_CLICK_EFFECT_DURATION_SECONDS,
  CURSOR_CLICK_EFFECT_FADE_IN_SECONDS,
  CURSOR_CLICK_EFFECT_REFERENCE_SIZE,
  getCursorClickEffectFadeOutDurationSeconds,
  getCursorClickEffectFadeOutStartSeconds,
  getCursorClickEffectSize,
  LIQUID_GLASS_CURSOR_CLICK_EFFECT_DATA_URL,
} from '../src/shared/cursorClickEffect.js'
import { resolveCursorScaleMetrics } from '../src/shared/cursorScale.js'
import { sampleCursorTrackRange as sampleCursorTrackRangeShared } from '../src/shared/cursorSampling.js'
import { normalizeCursorTrack as normalizeCursorTrackShared } from '../src/shared/cursorTrack.js'
import {
  normalizeCursorAppearanceAsset as normalizeCursorAppearanceAssetShared,
  normalizeCursorAppearanceId as normalizeCursorAppearanceIdShared,
  normalizeCursorHotspotRatiosForKind as normalizeCursorHotspotRatiosForKindShared,
  normalizeCursorVisualKind as normalizeCursorVisualKindShared,
  normalizeCursorVisualState as normalizeCursorVisualStateShared,
  stabilizeCursorVisualKinds as stabilizeCursorVisualKindsShared,
} from '../src/shared/cursorVisuals.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const LOCAL_MEDIA_PROTOCOL = 'movion-media'

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

function resolveBundledHelperPath(fileName) {
  if (!app.isPackaged) {
    return path.join(__dirname, fileName)
  }

  return path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', fileName)
}

const captureState = {
  sourceId: null,
  sourceKind: 'screen',
  displayId: '',
  includeSystemAudio: false,
  cursorTrackingAvailable: false,
  keyboardTrackingAvailable: false,
  cursorBounds: null,
}

const nativeScreenCaptureState = {
  sessionId: '',
  process: null,
  filePath: '',
  mimeType: 'video/mp4',
  engine: 'gdigrab',
  encoder: '',
  startedAtMs: 0,
  stopPromise: null,
  stopResolve: null,
  stopReject: null,
  stderr: '',
}

const pointerTrackerState = {
  process: null,
  stdoutBuffer: '',
  clicks: [],
  cursorKind: 'arrow',
  cursorAppearanceId: '',
  cursorImageDataUrl: '',
  cursorHotspotRatioX: 0,
  cursorHotspotRatioY: 0,
  cursorReferenceWidth: 0,
  cursorReferenceHeight: 0,
  lastDeliveredAppearanceId: '',
}

let cursorAppearanceCatalogCache = null

const keyboardTrackerState = {
  process: null,
  stdoutBuffer: '',
  shortcuts: [],
}

const ffmpegState = {
  checked: false,
  available: false,
  path: '',
  version: '',
  supportedFilters: [],
  supportedEncoders: [],
  capabilityScore: 0,
  supportsAdvancedCompositing: false,
  preferredVideoEncoder: '',
  managed: false,
  sourcePath: '',
}

const ffprobeState = {
  checked: false,
  available: false,
  path: '',
}

let projectMutationQueue = Promise.resolve()
let mainWindowRef = null

const OPENAI_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024

function resolveLocalMediaPathFromRequest(requestUrl) {
  const parsed = new URL(requestUrl)
  if (parsed.protocol !== `${LOCAL_MEDIA_PROTOCOL}:` || parsed.host !== 'local') {
    return ''
  }

  const requestedPath = parsed.searchParams.get('path') || ''
  if (!requestedPath) {
    return ''
  }

  const normalizedPath = path.normalize(requestedPath)
  return path.isAbsolute(normalizedPath) ? normalizedPath : ''
}

function getLocalMediaContentType(targetPath) {
  switch (path.extname(targetPath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    case '.m4v':
      return 'video/x-m4v'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.ogg':
      return 'audio/ogg'
    case '.flac':
      return 'audio/flac'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function parseLocalMediaRange(rangeHeader, totalBytes) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null
  }

  const [startPartRaw, endPartRaw] = rangeHeader.slice(6).split('-', 2)
  const startPart = startPartRaw?.trim() ?? ''
  const endPart = endPartRaw?.trim() ?? ''

  if (!startPart && !endPart) {
    return 'invalid'
  }

  let start = 0
  let end = totalBytes - 1

  if (!startPart) {
    const suffixLength = Number.parseInt(endPart, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return 'invalid'
    }

    start = Math.max(0, totalBytes - suffixLength)
  } else {
    start = Number.parseInt(startPart, 10)
    if (!Number.isFinite(start) || start < 0) {
      return 'invalid'
    }
  }

  if (endPart) {
    end = Number.parseInt(endPart, 10)
    if (!Number.isFinite(end) || end < start) {
      return 'invalid'
    }
  }

  if (start >= totalBytes) {
    return 'invalid'
  }

  end = Math.min(end, totalBytes - 1)

  return { start, end }
}

async function createLocalMediaResponse(targetPath, rangeHeader) {
  const targetStat = await stat(targetPath)
  if (!targetStat.isFile()) {
    return new Response('Media file not found', { status: 404 })
  }

  const totalBytes = targetStat.size
  const contentType = getLocalMediaContentType(targetPath)
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  }

  if (totalBytes <= 0) {
    return new Response(null, {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': '0',
      },
    })
  }

  const parsedRange = parseLocalMediaRange(rangeHeader, totalBytes)
  if (parsedRange === 'invalid') {
    return new Response('Invalid range', {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${totalBytes}`,
      },
    })
  }

  if (parsedRange) {
    const { start, end } = parsedRange
    const stream = createReadStream(targetPath, { start, end })

    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
      },
    })
  }

  const stream = createReadStream(targetPath)
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(totalBytes),
    },
  })
}

const qualityProfiles = [
  {
    id: 'studio-4k',
    label: 'Studio 4K',
    width: 3840,
    height: 2160,
    fps: 60,
    videoBitsPerSecond: 24_000_000,
    detail: 'Master render with aggressive bitrate headroom.',
  },
  {
    id: 'sharp-demo',
    label: 'Sharp Demo',
    width: 2560,
    height: 1440,
    fps: 60,
    videoBitsPerSecond: 18_000_000,
    detail: 'High-clarity cursor work for product walkthroughs.',
  },
  {
    id: 'fast-share',
    label: 'Fast Share',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitsPerSecond: 10_000_000,
    detail: 'Balanced export for fast delivery and review cycles.',
  },
]

const motionPresets = [
  {
    id: 'precision-pan',
    label: 'Precision Pan',
    description: 'Tight cursor framing with restrained easing.',
  },
  {
    id: 'spotlight-float',
    label: 'Spotlight Float',
    description: 'Gentle focus shifts for narrated, cinematic demos.',
  },
  {
    id: 'snap-follow',
    label: 'Snap Follow',
    description: 'Fast retargeting for crisp interaction-heavy recordings.',
  },
]

const outputAspectPresets = {
  source: null,
  widescreen: {
    width: 1920,
    height: 1080,
  },
  square: {
    width: 1080,
    height: 1080,
  },
  portrait: {
    width: 1080,
    height: 1920,
  },
  feed: {
    width: 1080,
    height: 1350,
  },
}

const advancedCompositorFilters = [
  'overlay',
  'gblur',
  'drawbox',
  'drawtext',
  'drawgrid',
  'geq',
  'alphamerge',
  'color',
  'nullsrc',
  'pad',
  'crop',
  'scale',
  'format',
]

const backgroundVisualPresets = {
  wallpaper: [
    {
      id: 'aurora-grid',
      primary: '#08111f',
      secondary: '#121a34',
      accent: '#5d7dff',
      halo: '#f5be3d',
      gridOpacity: 0.18,
    },
    {
      id: 'ocean-glow',
      primary: '#061a22',
      secondary: '#0d2b39',
      accent: '#4de0ff',
      halo: '#7affc8',
      gridOpacity: 0.12,
    },
    {
      id: 'ember-silk',
      primary: '#1a0c11',
      secondary: '#32121d',
      accent: '#ff7d66',
      halo: '#ffd36d',
      gridOpacity: 0.08,
    },
    {
      id: 'forest-drive',
      primary: '#07140d',
      secondary: '#15251c',
      accent: '#58d18d',
      halo: '#d9ff7b',
      gridOpacity: 0.16,
    },
  ],
  gradient: [
    {
      id: 'midnight-bloom',
      primary: '#0d1020',
      secondary: '#1e1730',
      accent: '#6e7cff',
      halo: '#e1a2ff',
      gridOpacity: 0,
    },
    {
      id: 'studio-sunrise',
      primary: '#170f18',
      secondary: '#35181d',
      accent: '#ff8d58',
      halo: '#ffd36d',
      gridOpacity: 0,
    },
    {
      id: 'atlas-cyan',
      primary: '#071621',
      secondary: '#0d2533',
      accent: '#55d3ff',
      halo: '#8fffd9',
      gridOpacity: 0,
    },
    {
      id: 'graphite-lime',
      primary: '#101410',
      secondary: '#1a2217',
      accent: '#96ff69',
      halo: '#d7ff91',
      gridOpacity: 0,
    },
  ],
}

const defaultSettings = {
  capture: {
    selectedSourceId: '',
    includeSystemAudio: false,
    includeMicrophone: false,
    microphoneDeviceId: '',
    autoZoomMode: 'all-clicks',
    qualityProfileId: 'sharp-demo',
    motionPresetId: 'precision-pan',
  },
  importState: {
    lastScannedAt: '',
    lastImportedAt: '',
    sourceVersion: '',
    presetCount: 0,
    projectCount: 0,
    hasWindowState: false,
    hasPartitionState: false,
  },
  output: {
    capturesRootName: 'Movion',
  },
}

function mergeSettings(current, patch) {
  const nextImportStatePatch = patch.importState
    ? {
        ...patch.importState,
        sourceVersion:
          patch.importState.sourceVersion ?? patch.importState.canvidVersion ?? current.importState.sourceVersion,
      }
    : {}

  return {
    ...current,
    ...patch,
    capture: {
      ...current.capture,
      ...(patch.capture ?? {}),
    },
    importState: {
      ...current.importState,
      ...nextImportStatePatch,
    },
    output: {
      ...current.output,
      ...(patch.output ?? {}),
    },
  }
}

function sanitizeBaseName(value, fallback) {
  const candidate = (value || fallback)
    .replace(/[^a-z0-9\-_. ]+/gi, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return candidate || fallback
}

function getFfmpegCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const userProfile = process.env.USERPROFILE ?? ''
  const managedCandidate = app.isReady() ? getPaths().managedFfmpegPath : ''

  return [
    managedCandidate,
    process.env.MOVION_LOCAL_FFMPEG,
    process.env.CANVID_LOCAL_FFMPEG,
    path.join(localAppData, 'Programs', 'Movion', 'resources', 'binaries', 'win', 'ffmpeg', 'ffmpeg.exe'),
    path.join(localAppData, 'Programs', 'Canvid', 'resources', 'binaries', 'win', 'ffmpeg', 'ffmpeg.exe'),
    path.join(programFiles, 'Krita (x64)', 'bin', 'ffmpeg.exe'),
    path.join(
      userProfile,
      'Desktop',
      'PROJECTS',
      'Apostles Project Monolit',
      '.tools',
      'ffmpeg',
      'ffmpeg-8.0.1-essentials_build',
      'bin',
      'ffmpeg.exe',
    ),
    'ffmpeg.exe',
  ].filter(Boolean)
}

function getFfprobeCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const managedCandidate = app.isReady() ? getPaths().managedFfprobePath : ''
  const ffmpegSibling = ffmpegState.path ? path.join(path.dirname(ffmpegState.path), 'ffprobe.exe') : ''

  return [
    managedCandidate,
    process.env.MOVION_LOCAL_FFPROBE,
    process.env.CANVID_LOCAL_FFPROBE,
    ffmpegSibling,
    path.join(localAppData, 'Programs', 'Movion', 'resources', 'binaries', 'win', 'ffmpeg', 'ffprobe.exe'),
    path.join(localAppData, 'Programs', 'Canvid', 'resources', 'binaries', 'win', 'ffmpeg', 'ffprobe.exe'),
    'ffprobe.exe',
  ].filter(Boolean)
}

function getPaths() {
  const localAppData = process.env.LOCALAPPDATA ?? app.getPath('home')
  const legacyImportRoot = path.join(localAppData, 'Canvid')
  const forkVideosRoot = path.join(app.getPath('videos'), defaultSettings.output.capturesRootName)
  const runtimeToolsRoot = path.join(app.getPath('userData'), 'runtime-tools')
  const ffmpegRuntimeRoot = path.join(runtimeToolsRoot, 'ffmpeg')

  return {
    forkUserData: app.getPath('userData'),
    runtimeToolsRoot,
    ffmpegRuntimeRoot,
    managedFfmpegPath: path.join(ffmpegRuntimeRoot, 'ffmpeg.exe'),
    managedFfprobePath: path.join(ffmpegRuntimeRoot, 'ffprobe.exe'),
    ffmpegManifestFile: path.join(ffmpegRuntimeRoot, 'manifest.json'),
    settingsFile: path.join(app.getPath('userData'), 'settings.json'),
    capturesRoot: path.join(forkVideosRoot, 'Captures'),
    backgroundsRoot: path.join(forkVideosRoot, 'Backgrounds'),
    audioRoot: path.join(forkVideosRoot, 'Audio'),
    projectsRoot: path.join(forkVideosRoot, 'Projects'),
    exportsRoot: path.join(forkVideosRoot, 'Exports'),
    importsRoot: path.join(forkVideosRoot, 'Imports'),
    activeProjectPointerFile: path.join(forkVideosRoot, 'Projects', 'active-project-pointer.json'),
    activeProjectFile: path.join(forkVideosRoot, 'Projects', 'active-project.json'),
    legacyImportRoot,
    legacyWindowState: path.join(legacyImportRoot, 'window-state.json'),
    legacyPartition: path.join(legacyImportRoot, 'Partitions', 'canvid'),
    legacyPackageJson: path.join(legacyImportRoot, 'package.json'),
    legacyProjects: path.join(app.getPath('videos'), 'Canvid', 'Projects'),
    legacyPresets: path.join(app.getPath('videos'), 'Canvid', 'Presets'),
  }
}

async function writeRuntimeLog(message) {
  const rootPath = app.isReady()
    ? getPaths().forkUserData
    : path.join(process.env.LOCALAPPDATA ?? process.cwd(), 'movion-diagnostics')

  try {
    await mkdir(rootPath, { recursive: true })
    await appendFile(
      path.join(rootPath, 'runtime.log'),
      `[${new Date().toISOString()}] ${message}\n`,
      'utf8',
    )
  } catch {
    return
  }
}

function stopPointerTracker() {
  if (pointerTrackerState.process && !pointerTrackerState.process.killed) {
    pointerTrackerState.process.kill()
  }

  pointerTrackerState.process = null
  pointerTrackerState.stdoutBuffer = ''
  pointerTrackerState.clicks = []
  pointerTrackerState.cursorKind = 'arrow'
  pointerTrackerState.cursorAppearanceId = ''
  pointerTrackerState.cursorImageDataUrl = ''
  pointerTrackerState.cursorHotspotRatioX = 0
  pointerTrackerState.cursorHotspotRatioY = 0
  pointerTrackerState.cursorReferenceWidth = 0
  pointerTrackerState.cursorReferenceHeight = 0
  pointerTrackerState.lastDeliveredAppearanceId = ''
}

async function startPointerTracker() {
  if (pointerTrackerState.process && !pointerTrackerState.process.killed) {
    return true
  }

  const powershellPath = process.env.ComSpec
    ? 'powershell.exe'
    : 'powershell.exe'
  const scriptPath = resolveBundledHelperPath('windows-global-pointer.ps1')

  try {
    const helperProcess = spawn(
      powershellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    pointerTrackerState.process = helperProcess
  pointerTrackerState.stdoutBuffer = ''
  pointerTrackerState.clicks = []
  pointerTrackerState.cursorKind = 'arrow'
  pointerTrackerState.cursorAppearanceId = ''
  pointerTrackerState.cursorImageDataUrl = ''
  pointerTrackerState.cursorHotspotRatioX = 0
  pointerTrackerState.cursorHotspotRatioY = 0
  pointerTrackerState.cursorReferenceWidth = 0
  pointerTrackerState.cursorReferenceHeight = 0
  pointerTrackerState.lastDeliveredAppearanceId = ''
    helperProcess.stdout.setEncoding('utf8')
    helperProcess.stdout.on('data', (chunk) => {
      pointerTrackerState.stdoutBuffer += chunk
      const lines = pointerTrackerState.stdoutBuffer.split(/\r?\n/)
      pointerTrackerState.stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }

        try {
          const event = JSON.parse(trimmed)

          if (
            event?.type === 'click' &&
            (event?.button === 'left' || event?.button === 'right')
          ) {
            const fallbackPoint = screen.getCursorScreenPoint()
            pointerTrackerState.clicks.push({
              x: Number.isFinite(event?.x) ? Number(event.x) : Number(fallbackPoint.x),
              y: Number.isFinite(event?.y) ? Number(event.y) : Number(fallbackPoint.y),
              button: event.button,
              occurredAtMs: Number.isFinite(event?.occurredAtMs) ? Number(event.occurredAtMs) : Date.now(),
              ctrlKey: Boolean(event?.ctrlKey),
              durationMs: Number.isFinite(event?.durationMs) ? Math.max(0, Number(event.durationMs)) : 0,
            })

            if (pointerTrackerState.clicks.length > 120) {
              pointerTrackerState.clicks.splice(0, pointerTrackerState.clicks.length - 120)
            }
        } else if (event?.type === 'cursor') {
          pointerTrackerState.cursorKind = normalizeCursorVisualKind(event?.cursorKind)
          pointerTrackerState.cursorAppearanceId =
            typeof event?.cursorAppearanceId === 'string' ? event.cursorAppearanceId : ''
          pointerTrackerState.cursorImageDataUrl =
            typeof event?.cursorImageDataUrl === 'string' ? event.cursorImageDataUrl : ''
          pointerTrackerState.cursorHotspotRatioX = clampUnit(Number.isFinite(event?.hotspotRatioX) ? Number(event.hotspotRatioX) : 0)
          pointerTrackerState.cursorHotspotRatioY = clampUnit(Number.isFinite(event?.hotspotRatioY) ? Number(event.hotspotRatioY) : 0)
          pointerTrackerState.cursorReferenceWidth =
            Number.isFinite(event?.referenceWidth) && Number(event.referenceWidth) > 0
              ? Math.max(1, Math.round(Number(event.referenceWidth)))
              : 0
          pointerTrackerState.cursorReferenceHeight =
            Number.isFinite(event?.referenceHeight) && Number(event.referenceHeight) > 0
              ? Math.max(1, Math.round(Number(event.referenceHeight)))
              : 0
        }
        } catch {
          void writeRuntimeLog(`pointer tracker emitted invalid line: ${trimmed}`)
        }
      }
    })

    helperProcess.stderr.setEncoding('utf8')
    helperProcess.stderr.on('data', (chunk) => {
      const message = String(chunk).trim()
      if (message) {
        void writeRuntimeLog(`pointer tracker stderr: ${message}`)
      }
    })

    helperProcess.once('exit', (code, signal) => {
      void writeRuntimeLog(`pointer tracker exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      if (pointerTrackerState.process === helperProcess) {
        pointerTrackerState.process = null
      }
    })

    await writeRuntimeLog('pointer tracker started')
    return true
  } catch (error) {
    await writeRuntimeLog(
      `pointer tracker failed to start: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    stopPointerTracker()
    return false
  }
}

async function getCursorAppearanceCatalog() {
  if (cursorAppearanceCatalogCache) {
    return cursorAppearanceCatalogCache
  }

  const powershellPath = process.env.ComSpec
    ? 'powershell.exe'
    : 'powershell.exe'
  const scriptPath = resolveBundledHelperPath('windows-global-pointer.ps1')

  try {
    const output = await runProcess(
      powershellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-CatalogOnly',
      ],
    )
    const parsed = JSON.parse(output)
    cursorAppearanceCatalogCache = Array.isArray(parsed)
      ? parsed
          .map((asset) => normalizeCursorAppearanceAsset(asset))
          .filter(Boolean)
      : []
    return cursorAppearanceCatalogCache
  } catch (error) {
    await writeRuntimeLog(
      `cursor appearance catalog failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    cursorAppearanceCatalogCache = []
    return cursorAppearanceCatalogCache
  }
}

function drainPointerClicks() {
  if (!captureState.cursorTrackingAvailable || !captureState.cursorBounds?.width || !captureState.cursorBounds?.height) {
    pointerTrackerState.clicks = []
    return []
  }

  const { x, y, width, height } = captureState.cursorBounds
  const pendingClicks = [...pointerTrackerState.clicks]
  pointerTrackerState.clicks = []

  return pendingClicks
    .map((event) => {
      const dipPoint =
        typeof screen.screenToDipPoint === 'function'
          ? screen.screenToDipPoint({
              x: Number.isFinite(event.x) ? Number(event.x) : 0,
              y: Number.isFinite(event.y) ? Number(event.y) : 0,
            })
          : {
              x: Number.isFinite(event.x) ? Number(event.x) : 0,
              y: Number.isFinite(event.y) ? Number(event.y) : 0,
            }

      return {
        x: clampUnit((dipPoint.x - x) / width),
        y: clampUnit((dipPoint.y - y) / height),
        button: event.button,
        occurredAtMs: event.occurredAtMs,
        ctrlKey: Boolean(event.ctrlKey),
        durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Number(event.durationMs)) : 0,
      }
    })
    .filter((event) => event.x >= 0 && event.x <= 1 && event.y >= 0 && event.y <= 1)
}

function stopKeyboardTracker() {
  if (keyboardTrackerState.process && !keyboardTrackerState.process.killed) {
    keyboardTrackerState.process.kill()
  }

  keyboardTrackerState.process = null
  keyboardTrackerState.stdoutBuffer = ''
  keyboardTrackerState.shortcuts = []
}

async function startKeyboardTracker() {
  if (keyboardTrackerState.process && !keyboardTrackerState.process.killed) {
    return true
  }

  const powershellPath = process.env.ComSpec
    ? 'powershell.exe'
    : 'powershell.exe'
  const scriptPath = resolveBundledHelperPath('windows-global-keyboard.ps1')

  try {
    const helperProcess = spawn(
      powershellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    keyboardTrackerState.process = helperProcess
    keyboardTrackerState.stdoutBuffer = ''
    keyboardTrackerState.shortcuts = []
    helperProcess.stdout.setEncoding('utf8')
    helperProcess.stdout.on('data', (chunk) => {
      keyboardTrackerState.stdoutBuffer += chunk
      const lines = keyboardTrackerState.stdoutBuffer.split(/\r?\n/)
      keyboardTrackerState.stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }

        try {
          const event = JSON.parse(trimmed)

          if (
            event?.type === 'shortcut' &&
            Array.isArray(event?.keys) &&
            event.keys.length
          ) {
            keyboardTrackerState.shortcuts.push({
              keys: event.keys
                .map((key) => (typeof key === 'string' ? key.trim().toLowerCase() : ''))
                .filter(Boolean),
              occurredAtMs: Number.isFinite(event?.occurredAtMs) ? Number(event.occurredAtMs) : Date.now(),
              durationMs: Number.isFinite(event?.durationMs) ? Math.max(0, Number(event.durationMs)) : 0,
            })

            if (keyboardTrackerState.shortcuts.length > 180) {
              keyboardTrackerState.shortcuts.splice(0, keyboardTrackerState.shortcuts.length - 180)
            }
          }
        } catch {
          void writeRuntimeLog(`keyboard tracker emitted invalid line: ${trimmed}`)
        }
      }
    })

    helperProcess.stderr.setEncoding('utf8')
    helperProcess.stderr.on('data', (chunk) => {
      const message = String(chunk).trim()
      if (message) {
        void writeRuntimeLog(`keyboard tracker stderr: ${message}`)
      }
    })

    helperProcess.once('exit', (code, signal) => {
      void writeRuntimeLog(`keyboard tracker exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      if (keyboardTrackerState.process === helperProcess) {
        keyboardTrackerState.process = null
      }
    })

    await writeRuntimeLog('keyboard tracker started')
    return true
  } catch (error) {
    await writeRuntimeLog(
      `keyboard tracker failed to start: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    stopKeyboardTracker()
    return false
  }
}

function drainKeyboardShortcuts() {
  const pendingShortcuts = [...keyboardTrackerState.shortcuts]
  keyboardTrackerState.shortcuts = []

  return pendingShortcuts
    .map((shortcut) => ({
      keys: Array.isArray(shortcut?.keys)
        ? shortcut.keys
            .map((key) => (typeof key === 'string' ? key.trim().toLowerCase() : ''))
            .filter(Boolean)
        : [],
      occurredAtMs: Number.isFinite(shortcut?.occurredAtMs) ? Number(shortcut.occurredAtMs) : Date.now(),
      durationMs: Number.isFinite(shortcut?.durationMs) ? Math.max(0, Number(shortcut.durationMs)) : 0,
    }))
    .filter((shortcut) => shortcut.keys.length > 0)
}

async function ensureForkDirs() {
  const paths = getPaths()
  await mkdir(paths.capturesRoot, { recursive: true })
  await mkdir(paths.backgroundsRoot, { recursive: true })
  await mkdir(paths.audioRoot, { recursive: true })
  await mkdir(paths.projectsRoot, { recursive: true })
  await mkdir(paths.exportsRoot, { recursive: true })
  await mkdir(paths.importsRoot, { recursive: true })
  await mkdir(paths.forkUserData, { recursive: true })
  await mkdir(paths.runtimeToolsRoot, { recursive: true })
  await mkdir(paths.ffmpegRuntimeRoot, { recursive: true })
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function loadSettings() {
  await ensureForkDirs()
  const stored = await readJson(getPaths().settingsFile, defaultSettings)
  return mergeSettings(defaultSettings, stored)
}

async function saveSettings(patch) {
  const current = await loadSettings()
  const next = mergeSettings(current, patch)
  await writeFile(getPaths().settingsFile, JSON.stringify(next, null, 2))
  return next
}

function clampUnit(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, Number(value)))
}

const normalizeCursorVisualKind = normalizeCursorVisualKindShared
const normalizeCursorAppearanceId = normalizeCursorAppearanceIdShared
const normalizeCursorHotspotRatiosForKind = normalizeCursorHotspotRatiosForKindShared
const normalizeCursorVisualState = normalizeCursorVisualStateShared
const normalizeCursorAppearanceAsset = normalizeCursorAppearanceAssetShared
const stabilizeCursorVisualKinds = stabilizeCursorVisualKindsShared
const normalizeCursorTrack = normalizeCursorTrackShared

function normalizeKeyboardShortcutEvents(shortcuts, durationSeconds) {
  if (!Array.isArray(shortcuts) || shortcuts.length === 0) {
    return []
  }

  const maxTime =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Number(durationSeconds)
      : Number.POSITIVE_INFINITY

  return shortcuts
    .map((shortcut) => {
      const timeSeconds = Number.isFinite(shortcut?.timeSeconds) ? Number(shortcut.timeSeconds) : NaN
      const keys = Array.isArray(shortcut?.keys)
        ? shortcut.keys
            .map((key) => (typeof key === 'string' ? key.trim().toLowerCase() : ''))
            .filter(Boolean)
        : []

      if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !keys.length) {
        return null
      }

      return {
        id: shortcut?.id || globalThis.crypto.randomUUID(),
        timeSeconds: Math.min(maxTime, Number(timeSeconds.toFixed(3))),
        durationMs: Number.isFinite(shortcut?.durationMs) ? Math.max(40, Number(shortcut.durationMs)) : 180,
        keys,
        visible: shortcut?.visible !== false,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.timeSeconds - right.timeSeconds)
}

function normalizeTranscriptWords(words, durationSeconds) {
  if (!Array.isArray(words) || !words.length) {
    return []
  }

  const maxTime =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Number(durationSeconds)
      : Number.POSITIVE_INFINITY

  return words
    .map((word) => {
      const startSeconds = Number.isFinite(word?.startSeconds ?? word?.start) ? Number(word.startSeconds ?? word.start) : NaN
      const rawEndSeconds = Number.isFinite(word?.endSeconds ?? word?.end) ? Number(word.endSeconds ?? word.end) : NaN
      const text = typeof word?.text === 'string' && word.text.trim()
        ? word.text.trim()
        : typeof word?.word === 'string' && word.word.trim()
          ? word.word.trim()
          : ''

      if (!Number.isFinite(startSeconds) || !Number.isFinite(rawEndSeconds) || !text) {
        return null
      }

      const boundedStart = clampNumber(startSeconds, 0, maxTime)
      const boundedEnd = clampNumber(rawEndSeconds, boundedStart, maxTime)

      if (boundedEnd - boundedStart < 0.01) {
        return null
      }

      return {
        id: word?.id || globalThis.crypto.randomUUID(),
        startSeconds: Number(boundedStart.toFixed(3)),
        endSeconds: Number(boundedEnd.toFixed(3)),
        text,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds)
}

function normalizeTranscriptSegments(segments, words, durationSeconds, fallbackText = '') {
  if (!Array.isArray(segments) || !segments.length) {
    if (!fallbackText.trim()) {
      return []
    }

    const boundedDuration =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Number(durationSeconds)
        : Math.max(2, words.at(-1)?.endSeconds ?? 0)

    return [
      {
        id: globalThis.crypto.randomUUID(),
        startSeconds: 0,
        endSeconds: Number(Math.max(0.4, boundedDuration).toFixed(3)),
        text: fallbackText.trim(),
        speaker: '',
        visible: true,
        wordIds: words.map((word) => word.id),
      },
    ]
  }

  const maxTime =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Number(durationSeconds)
      : Number.POSITIVE_INFINITY

  return segments
    .map((segment, index) => {
      const startSeconds = Number.isFinite(segment?.startSeconds ?? segment?.start) ? Number(segment.startSeconds ?? segment.start) : NaN
      const rawEndSeconds = Number.isFinite(segment?.endSeconds ?? segment?.end) ? Number(segment.endSeconds ?? segment.end) : NaN
      const text = typeof segment?.text === 'string' && segment.text.trim() ? segment.text.trim() : ''

      if (!Number.isFinite(startSeconds) || !Number.isFinite(rawEndSeconds) || !text) {
        return null
      }

      const boundedStart = clampNumber(startSeconds, 0, maxTime)
      const boundedEnd = clampNumber(rawEndSeconds, boundedStart, maxTime)

      if (boundedEnd - boundedStart < 0.02) {
        return null
      }

      const wordIds = words
        .filter((word) => word.startSeconds < boundedEnd + 0.04 && word.endSeconds > boundedStart - 0.04)
        .map((word) => word.id)

      return {
        id: segment?.id || globalThis.crypto.randomUUID(),
        startSeconds: Number(boundedStart.toFixed(3)),
        endSeconds: Number(boundedEnd.toFixed(3)),
        text,
        speaker: typeof segment?.speaker === 'string' ? segment.speaker.trim() : '',
        visible: segment?.visible !== false,
        wordIds,
        orderIndex: index,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.orderIndex - right.orderIndex)
    .map(({ orderIndex, ...segment }) => segment)
}

function normalizeClipTranscript(transcript, durationSeconds) {
  const words = normalizeTranscriptWords(transcript?.words, durationSeconds)
  const text = typeof transcript?.text === 'string' ? transcript.text.trim() : ''
  const segments = normalizeTranscriptSegments(transcript?.segments, words, durationSeconds, text)
  const hasTranscript = Boolean(text || segments.length)

  return {
    status:
      transcript?.status === 'error'
        ? 'error'
        : hasTranscript
          ? 'ready'
          : 'idle',
    provider:
      transcript?.provider === 'imported'
        ? 'imported'
        : transcript?.provider === 'openai'
          ? 'openai'
          : 'none',
    model: typeof transcript?.model === 'string' ? transcript.model : '',
    language: typeof transcript?.language === 'string' ? transcript.language : '',
    generatedAt: typeof transcript?.generatedAt === 'string' ? transcript.generatedAt : '',
    error: typeof transcript?.error === 'string' ? transcript.error : '',
    text,
    segments,
    words,
  }
}

function normalizeWaveformPeaks(peaks) {
  if (!Array.isArray(peaks) || peaks.length === 0) {
    return []
  }

  const normalizedPeaks = peaks
    .map((peak) => (Number.isFinite(peak) ? Math.min(1, Math.max(0, Number(peak))) : null))
    .filter((peak) => peak !== null)

  if (!normalizedPeaks.length) {
    return []
  }

  return normalizedPeaks.map((peak) => Number(peak.toFixed(4)))
}

function normalizeClipAudio(audio, fallbackHasAudio) {
  return {
    hasAudio: typeof audio?.hasAudio === 'boolean' ? audio.hasAudio : Boolean(fallbackHasAudio),
    muted: Boolean(audio?.muted),
    gainDb: Number.isFinite(audio?.gainDb) ? Math.min(12, Math.max(-18, Number(audio.gainDb))) : 0,
    waveformPeaks: normalizeWaveformPeaks(audio?.waveformPeaks),
  }
}

function normalizeClipCameraTake(cameraTake) {
  if (!cameraTake?.filePath) {
    return null
  }

  return {
    filePath: cameraTake.filePath,
    mimeType: typeof cameraTake?.mimeType === 'string' && cameraTake.mimeType ? cameraTake.mimeType : 'video/webm',
    size: Number.isFinite(cameraTake?.size) ? Number(cameraTake.size) : 0,
    durationSeconds: Number.isFinite(cameraTake?.durationSeconds) ? Math.max(0, Number(cameraTake.durationSeconds)) : 0,
    deviceId: typeof cameraTake?.deviceId === 'string' ? cameraTake.deviceId : '',
    deviceLabel: typeof cameraTake?.deviceLabel === 'string' ? cameraTake.deviceLabel : '',
  }
}

function normalizeClipMicrophoneTake(microphoneTake) {
  if (!microphoneTake?.filePath) {
    return null
  }

  return {
    filePath: microphoneTake.filePath,
    mimeType: typeof microphoneTake?.mimeType === 'string' && microphoneTake.mimeType ? microphoneTake.mimeType : 'audio/webm',
    size: Number.isFinite(microphoneTake?.size) ? Number(microphoneTake.size) : 0,
    durationSeconds: Number.isFinite(microphoneTake?.durationSeconds)
      ? Math.max(0, Number(microphoneTake.durationSeconds))
      : 0,
    deviceId: typeof microphoneTake?.deviceId === 'string' ? microphoneTake.deviceId : '',
    deviceLabel: typeof microphoneTake?.deviceLabel === 'string' ? microphoneTake.deviceLabel : '',
  }
}

function normalizeClipAudioRetake(retake, clipDurationSeconds) {
  if (!retake?.filePath) {
    return null
  }

  const maxDuration = Number.isFinite(clipDurationSeconds) && clipDurationSeconds > 0
    ? Number(clipDurationSeconds)
    : Number.POSITIVE_INFINITY
  const startSeconds = Number.isFinite(retake?.startSeconds)
    ? Math.max(0, Number(retake.startSeconds))
    : null
  const rawEndSeconds = Number.isFinite(retake?.endSeconds) ? Number(retake.endSeconds) : null

  if (startSeconds === null || rawEndSeconds === null) {
    return null
  }

  const boundedStartSeconds = Math.min(maxDuration, startSeconds)
  const boundedEndSeconds = Math.min(
    maxDuration,
    Math.max(boundedStartSeconds + 0.04, rawEndSeconds),
  )
  const durationSeconds = Number.isFinite(retake?.durationSeconds)
    ? Math.max(0, Number(retake.durationSeconds))
    : Math.max(0, boundedEndSeconds - boundedStartSeconds)
  const timestamp = typeof retake?.createdAt === 'string' && retake.createdAt ? retake.createdAt : new Date().toISOString()

  return {
    id: retake?.id || globalThis.crypto.randomUUID(),
    filePath: retake.filePath,
    mimeType: typeof retake?.mimeType === 'string' && retake.mimeType ? retake.mimeType : 'audio/webm',
    size: Number.isFinite(retake?.size) ? Number(retake.size) : 0,
    durationSeconds,
    deviceId: typeof retake?.deviceId === 'string' ? retake.deviceId : '',
    deviceLabel: typeof retake?.deviceLabel === 'string' ? retake.deviceLabel : '',
    segmentId: typeof retake?.segmentId === 'string' ? retake.segmentId : '',
    segmentText: typeof retake?.segmentText === 'string' ? retake.segmentText.trim() : '',
    startSeconds: Number(boundedStartSeconds.toFixed(3)),
    endSeconds: Number(boundedEndSeconds.toFixed(3)),
    createdAt: timestamp,
    updatedAt: typeof retake?.updatedAt === 'string' && retake.updatedAt ? retake.updatedAt : timestamp,
  }
}

function normalizeClipAudioRetakes(retakes, clipDurationSeconds) {
  if (!Array.isArray(retakes) || !retakes.length) {
    return []
  }

  const dedupedRetakes = new Map()

  for (const retake of retakes) {
    const normalizedRetake = normalizeClipAudioRetake(retake, clipDurationSeconds)

    if (!normalizedRetake) {
      continue
    }

    const dedupeKey = normalizedRetake.segmentId || normalizedRetake.id
    const previousRetake = dedupedRetakes.get(dedupeKey)

    if (
      !previousRetake ||
      new Date(normalizedRetake.updatedAt).getTime() >= new Date(previousRetake.updatedAt).getTime()
    ) {
      dedupedRetakes.set(dedupeKey, normalizedRetake)
    }
  }

  return [...dedupedRetakes.values()].sort(
    (left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds,
  )
}

function normalizeMusicBedAutomationKeyframes(keyframes) {
  if (!Array.isArray(keyframes) || !keyframes.length) {
    return []
  }

  const nextKeyframes = keyframes
    .map((keyframe) => {
      const timeSeconds = Number.isFinite(keyframe?.timeSeconds)
        ? Math.max(0, Number(keyframe.timeSeconds))
        : null

      if (timeSeconds === null) {
        return null
      }

      return {
        id: keyframe?.id || globalThis.crypto.randomUUID(),
        timeSeconds,
        gainDb: Number.isFinite(keyframe?.gainDb) ? Math.min(18, Math.max(-18, Number(keyframe.gainDb))) : 0,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.timeSeconds - right.timeSeconds)

  const dedupedKeyframes = []

  for (const keyframe of nextKeyframes) {
    const previousKeyframe = dedupedKeyframes[dedupedKeyframes.length - 1]

    if (previousKeyframe && Math.abs(previousKeyframe.timeSeconds - keyframe.timeSeconds) < 0.001) {
      dedupedKeyframes[dedupedKeyframes.length - 1] = keyframe
      continue
    }

    dedupedKeyframes.push(keyframe)
  }

  return dedupedKeyframes
}

function normalizeMusicBedAutomation(automation) {
  const startSeconds = Number.isFinite(automation?.startSeconds)
    ? Math.max(0, Number(automation.startSeconds))
    : 0
  const endCandidate = Number.isFinite(automation?.endSeconds)
    ? Number(automation.endSeconds)
    : null
  const endSeconds =
    endCandidate === null
      ? null
      : Math.max(startSeconds, endCandidate)
  const normalizedKeyframes = normalizeMusicBedAutomationKeyframes(automation?.keyframes)
  const legacyKeyframes =
    Boolean(automation?.enabled) && normalizedKeyframes.length === 0
      ? [
          {
            id: globalThis.crypto.randomUUID(),
            timeSeconds: startSeconds,
            gainDb: 0,
          },
          {
            id: globalThis.crypto.randomUUID(),
            timeSeconds: Math.min(endSeconds ?? startSeconds, startSeconds + (Number.isFinite(automation?.rampSeconds) ? Math.max(0, Number(automation.rampSeconds)) : 0.4)),
            gainDb: Number.isFinite(automation?.gainDb) ? Math.min(18, Math.max(-18, Number(automation.gainDb))) : -3,
          },
          {
            id: globalThis.crypto.randomUUID(),
            timeSeconds: Math.max(startSeconds, (endSeconds ?? startSeconds) - (Number.isFinite(automation?.rampSeconds) ? Math.max(0, Number(automation.rampSeconds)) : 0.4)),
            gainDb: Number.isFinite(automation?.gainDb) ? Math.min(18, Math.max(-18, Number(automation.gainDb))) : -3,
          },
          {
            id: globalThis.crypto.randomUUID(),
            timeSeconds: endSeconds ?? startSeconds,
            gainDb: 0,
          },
        ]
      : []
  const keyframes = normalizedKeyframes.length
    ? normalizedKeyframes
    : normalizeMusicBedAutomationKeyframes(legacyKeyframes)

  return {
    enabled: Boolean(automation?.enabled),
    startSeconds,
    endSeconds,
    gainDb: Number.isFinite(automation?.gainDb) ? Math.min(18, Math.max(-18, Number(automation.gainDb))) : -3,
    rampSeconds: Number.isFinite(automation?.rampSeconds) ? Math.min(6, Math.max(0, Number(automation.rampSeconds))) : 0.4,
    keyframes,
  }
}

function normalizeMusicBed(musicBed) {
  if (!musicBed?.filePath) {
    return null
  }

  const durationSeconds = Number.isFinite(musicBed?.durationSeconds)
    ? Math.max(0, Number(musicBed.durationSeconds))
    : 0
  const trimStartSeconds = Number.isFinite(musicBed?.trimStartSeconds)
    ? Math.min(durationSeconds || Number.POSITIVE_INFINITY, Math.max(0, Number(musicBed.trimStartSeconds)))
    : 0
  const trimEndCandidate = Number.isFinite(musicBed?.trimEndSeconds)
    ? Number(musicBed.trimEndSeconds)
    : null
  const trimEndSeconds =
    trimEndCandidate === null
      ? durationSeconds || null
      : durationSeconds > 0
        ? Math.min(durationSeconds, Math.max(trimStartSeconds, trimEndCandidate))
        : Math.max(trimStartSeconds, trimEndCandidate)
  const timelineStartSeconds = Number.isFinite(musicBed?.timelineStartSeconds)
    ? Math.max(0, Number(musicBed.timelineStartSeconds))
    : 0
  const timelineEndCandidate = Number.isFinite(musicBed?.timelineEndSeconds)
    ? Number(musicBed.timelineEndSeconds)
    : null
  const timelineEndSeconds =
    timelineEndCandidate === null
      ? null
      : Math.max(timelineStartSeconds, timelineEndCandidate)

  return {
    id: musicBed?.id || globalThis.crypto.randomUUID(),
    label: musicBed?.label || path.parse(musicBed.filePath).name || 'Music Bed',
    sourceName: musicBed?.sourceName || path.basename(musicBed.filePath),
    filePath: musicBed.filePath,
    size: Number.isFinite(musicBed?.size) ? Number(musicBed.size) : 0,
    durationSeconds,
    trimStartSeconds,
    trimEndSeconds,
    timelineStartSeconds,
    timelineEndSeconds,
    fadeInSeconds: Number.isFinite(musicBed?.fadeInSeconds) ? Math.min(6, Math.max(0, Number(musicBed.fadeInSeconds))) : 0.18,
    fadeOutSeconds: Number.isFinite(musicBed?.fadeOutSeconds) ? Math.min(6, Math.max(0, Number(musicBed.fadeOutSeconds))) : 0.32,
    gainDb: Number.isFinite(musicBed?.gainDb) ? Math.min(12, Math.max(-24, Number(musicBed.gainDb))) : -12,
    routingMode: musicBed?.routingMode === 'bypass' ? 'bypass' : 'duck',
    automation: normalizeMusicBedAutomation(musicBed?.automation),
    loop: musicBed?.loop !== false,
    enabled: musicBed?.enabled !== false,
    waveformPeaks: normalizeWaveformPeaks(musicBed?.waveformPeaks),
    updatedAt: musicBed?.updatedAt || new Date().toISOString(),
  }
}

function normalizeProjectAudio(audio) {
  const defaults = createDefaultProject().audio
  const beds = Array.isArray(audio?.beds)
    ? audio.beds.map((bed) => normalizeMusicBed(bed)).filter(Boolean)
    : []
  const legacyBed = normalizeMusicBed(audio?.musicBed)
  const nextBeds = beds.length
    ? beds
    : legacyBed
      ? [legacyBed]
      : []
  const activeBedId = nextBeds.some((bed) => bed.id === audio?.activeBedId)
    ? audio.activeBedId
    : (nextBeds[0]?.id ?? '')

  return {
    beds: nextBeds,
    activeBedId,
    voiceClarity: {
      enabled: audio?.voiceClarity?.enabled === true,
      profile: audio?.voiceClarity?.profile === 'strong' ? 'strong' : defaults.voiceClarity.profile,
    },
    ducking: {
      enabled: audio?.ducking?.enabled !== false,
      reductionDb: Number.isFinite(audio?.ducking?.reductionDb)
        ? Math.min(18, Math.max(0, Number(audio.ducking.reductionDb)))
        : 10,
      attackMs: Number.isFinite(audio?.ducking?.attackMs)
        ? Math.min(600, Math.max(20, Number(audio.ducking.attackMs)))
        : 120,
      releaseMs: Number.isFinite(audio?.ducking?.releaseMs)
        ? Math.min(2000, Math.max(80, Number(audio.ducking.releaseMs)))
        : 420,
    },
  }
}

function getActiveMusicBed(audio) {
  if (!audio?.beds?.length) {
    return null
  }

  return audio.beds.find((bed) => bed.id === audio.activeBedId) ?? audio.beds[0]
}

function getMusicBedSourceDuration(musicBed) {
  const sourceTrimEnd =
    musicBed?.trimEndSeconds === null
      ? musicBed?.durationSeconds || 0
      : musicBed?.trimEndSeconds || 0

  return Math.max(0, sourceTrimEnd - (musicBed?.trimStartSeconds || 0))
}

function getMusicBedPlacement(musicBed, totalDuration) {
  const timelineStartSeconds = Math.min(
    Math.max(0, Number(musicBed?.timelineStartSeconds) || 0),
    Math.max(0, totalDuration),
  )
  const sourceDuration = getMusicBedSourceDuration(musicBed)
  const defaultTimelineEnd = musicBed?.loop ? totalDuration : timelineStartSeconds + sourceDuration
  const rawTimelineEnd =
    musicBed?.timelineEndSeconds === null || musicBed?.timelineEndSeconds === undefined
      ? defaultTimelineEnd
      : Number(musicBed.timelineEndSeconds)
  const maxTimelineEnd = musicBed?.loop
    ? totalDuration
    : Math.min(totalDuration, timelineStartSeconds + sourceDuration)
  const timelineEndSeconds = Math.min(
    Math.max(timelineStartSeconds, rawTimelineEnd),
    Math.max(timelineStartSeconds, maxTimelineEnd),
  )
  const durationSeconds = Math.max(0, timelineEndSeconds - timelineStartSeconds)

  return {
    timelineStartSeconds,
    timelineEndSeconds,
    durationSeconds,
    sourceDuration,
  }
}

function createDefaultProject() {
  const timestamp = new Date().toISOString()

  return {
    id: globalThis.crypto.randomUUID(),
    title: 'Local Motion Session',
    brief: 'A local-first project space for capture takes, trim ranges, notes, and export iterations.',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
    recovery: {
      autosaveEnabled: true,
      lastSavedAt: timestamp,
    },
    output: {
      format: 'mp4',
      videoCodec: 'libx264',
      audioCodec: 'aac',
      crf: 18,
      preset: 'slow',
      aspectPreset: 'source',
      fitMode: 'contain',
      gifFps: 18,
    },
    background: {
      mode: 'wallpaper',
      wallpaperId: 'aurora-grid',
      gradientId: 'midnight-bloom',
      colorValue: '#0f1319',
      imagePath: '',
      blur: 0.18,
      padding: 0,
      radius: 0,
      shadow: 0,
    },
    shortcuts: {
      enabled: true,
      showSymbols: false,
      labelSize: 'medium',
    },
    captions: {
      enabled: true,
      wordHighlighting: true,
      showSpeakerLabels: false,
      labelSize: 'medium',
      languageHint: '',
    },
    cursor: {
      showCursor: true,
      size: 1,
      style: 'windows',
      alwaysPointer: false,
      clickEffect: 'ripple',
      smoothingEnabled: true,
      animationStyle: 'default',
    },
    camera: {
      enabled: false,
      deviceId: '',
      deviceLabel: '',
      size: 0.24,
      position: 'bottom-right',
      offset: 0,
      mirror: false,
      shape: 'circle',
      roundness: 0.28,
      shadow: 0.42,
      border: 0.3,
    },
    timeline: {
      activeClipId: '',
      activeItemId: '',
      items: [],
      exports: [],
      lastExportPath: '',
    },
    audio: {
      beds: [],
      activeBedId: '',
      voiceClarity: {
        enabled: false,
        profile: 'balanced',
      },
      ducking: {
        enabled: true,
        reductionDb: 10,
        attackMs: 120,
        releaseMs: 420,
      },
    },
    clips: [],
  }
}

function createTimelineItemFromClip(clip) {
  const timestamp = new Date().toISOString()
  const trimStartSeconds = Number.isFinite(clip?.trim?.startSeconds) ? Number(clip.trim.startSeconds) : 0
  const trimEndSeconds = Number.isFinite(clip?.trim?.endSeconds) ? Number(clip.trim.endSeconds) : null

  return {
    id: globalThis.crypto.randomUUID(),
    clipId: clip.id,
    label: clip.label,
    enabled: true,
    trimStartSeconds,
    trimEndSeconds,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function normalizeClipFocusRegions(focusRegions, durationSeconds) {
  return normalizeFocusRegionsShared(focusRegions, durationSeconds)
}

function normalizeClip(clip) {
  const durationSeconds = Number.isFinite(clip?.durationSeconds)
    ? Math.max(0, Number(clip.durationSeconds))
    : 0
  const trimStart = Number.isFinite(clip?.trim?.startSeconds)
    ? Math.max(0, Number(clip.trim.startSeconds))
    : 0
  const rawTrimEnd = Number.isFinite(clip?.trim?.endSeconds)
    ? Number(clip.trim.endSeconds)
    : null
  const boundedTrimEnd =
    rawTrimEnd === null
      ? durationSeconds > 0
        ? durationSeconds
        : null
      : durationSeconds > 0
        ? Math.min(durationSeconds, Math.max(trimStart, rawTrimEnd))
        : Math.max(trimStart, rawTrimEnd)
  const timestamp = clip?.createdAt || new Date().toISOString()
  const motionPresetId = clip?.captureProfile?.motionPresetId || defaultSettings.capture.motionPresetId
  const motionPresetLabel =
    motionPresets.find((preset) => preset.id === motionPresetId)?.label ||
    clip?.captureProfile?.motionPresetLabel ||
    'Precision Pan'
  const cursorTrack = normalizeCursorTrack(
    clip?.cursorTrack,
    clip?.source?.kind || 'screen',
    durationSeconds,
  )
  const microphoneTake = normalizeClipMicrophoneTake(clip?.microphoneTake)
  const audio = normalizeClipAudio(
    clip?.audio,
    clip?.captureProfile?.includeSystemAudio || Boolean(microphoneTake?.filePath),
  )
  const cameraTake = normalizeClipCameraTake(clip?.cameraTake)
  const focusRegions = normalizeClipFocusRegions(clip?.focusRegions, durationSeconds)
  const keyboardShortcuts = normalizeKeyboardShortcutEvents(clip?.keyboardShortcuts, durationSeconds)
  const transcript = normalizeClipTranscript(clip?.transcript, durationSeconds)
  const audioRetakes = normalizeClipAudioRetakes(clip?.audioRetakes, durationSeconds)
  const cursorRenderMode = clip?.cursorRenderMode === 'overlay' ? 'overlay' : 'baked'

  return {
    id: clip?.id || globalThis.crypto.randomUUID(),
    label: clip?.label || 'Untitled Clip',
    filePath: clip?.filePath || '',
    thumbnailDataUrl: clip?.thumbnailDataUrl || '',
    mimeType: clip?.mimeType || 'video/webm',
    size: Number.isFinite(clip?.size) ? Number(clip.size) : 0,
    durationSeconds,
    createdAt: timestamp,
    updatedAt: clip?.updatedAt || timestamp,
    source: {
      id: clip?.source?.id || '',
      name: clip?.source?.name || 'Unknown source',
      kind: clip?.source?.kind || 'screen',
    },
    captureProfile: {
      qualityProfileId: clip?.captureProfile?.qualityProfileId || defaultSettings.capture.qualityProfileId,
      qualityProfileLabel: clip?.captureProfile?.qualityProfileLabel || 'Sharp Demo',
      motionPresetId,
      motionPresetLabel,
      includeSystemAudio: Boolean(clip?.captureProfile?.includeSystemAudio),
    },
    trim: {
      startSeconds: trimStart,
      endSeconds: boundedTrimEnd,
    },
    cursorRenderMode,
    cursorTrack,
    keyboardShortcuts,
    transcript,
    focusRegions,
    cameraTake,
    microphoneTake,
    audioRetakes,
    audio,
    notes: clip?.notes || '',
    exports: Array.isArray(clip?.exports)
      ? clip.exports.map((item) => ({
          id: item?.id || globalThis.crypto.randomUUID(),
          filePath: item?.filePath || '',
          format: item?.format || 'mp4',
          createdAt: item?.createdAt || timestamp,
          size: Number.isFinite(item?.size) ? Number(item.size) : 0,
          trimStartSeconds: Number.isFinite(item?.trimStartSeconds) ? Number(item.trimStartSeconds) : 0,
          trimEndSeconds: Number.isFinite(item?.trimEndSeconds) ? Number(item.trimEndSeconds) : null,
        }))
      : [],
    lastExportPath: clip?.lastExportPath || '',
  }
}

function normalizeTimelineItem(item, clipsById) {
  const clip = clipsById.get(item?.clipId)
  const maxDuration = clip?.durationSeconds ?? 0
  const sourceTrimStart = Number.isFinite(clip?.trim?.startSeconds) ? Number(clip.trim.startSeconds) : 0
  const sourceTrimEnd = Number.isFinite(clip?.trim?.endSeconds) ? Number(clip.trim.endSeconds) : null
  const trimStartSeconds = Number.isFinite(item?.trimStartSeconds)
    ? Math.max(0, Number(item.trimStartSeconds))
    : sourceTrimStart
  const rawTrimEnd = Number.isFinite(item?.trimEndSeconds)
    ? Number(item.trimEndSeconds)
    : sourceTrimEnd
  const boundedTrimEnd =
    rawTrimEnd === null
      ? maxDuration > 0
        ? maxDuration
        : null
      : maxDuration > 0
        ? Math.min(maxDuration, Math.max(trimStartSeconds, rawTrimEnd))
        : Math.max(trimStartSeconds, rawTrimEnd)
  const timestamp = item?.createdAt || new Date().toISOString()
  const transcriptCut =
    typeof item?.transcriptCut?.segmentId === 'string' && item.transcriptCut.segmentId
      ? {
          sourceItemId:
            typeof item.transcriptCut.sourceItemId === 'string' && item.transcriptCut.sourceItemId
              ? item.transcriptCut.sourceItemId
              : item?.id || globalThis.crypto.randomUUID(),
          sourceLabel:
            typeof item.transcriptCut.sourceLabel === 'string' && item.transcriptCut.sourceLabel.trim()
              ? item.transcriptCut.sourceLabel.trim()
              : item?.label || clip?.label || 'Sequence Item',
          segmentId: item.transcriptCut.segmentId,
          segmentText:
            typeof item.transcriptCut.segmentText === 'string' ? item.transcriptCut.segmentText.trim() : '',
          segmentStartSeconds: Number.isFinite(item.transcriptCut.segmentStartSeconds)
            ? Math.max(trimStartSeconds, Number(item.transcriptCut.segmentStartSeconds))
            : trimStartSeconds,
          segmentEndSeconds: Number.isFinite(item.transcriptCut.segmentEndSeconds)
            ? Math.max(
                trimStartSeconds,
                Math.min(
                  boundedTrimEnd ?? maxDuration ?? Number.POSITIVE_INFINITY,
                  Number(item.transcriptCut.segmentEndSeconds),
                ),
              )
            : boundedTrimEnd ?? trimStartSeconds,
          createdAt:
            typeof item.transcriptCut.createdAt === 'string' && item.transcriptCut.createdAt
              ? item.transcriptCut.createdAt
              : timestamp,
        }
      : null

  return {
    id: item?.id || globalThis.crypto.randomUUID(),
    clipId: clip?.id || item?.clipId || '',
    label: item?.label || clip?.label || 'Sequence Item',
    enabled: item?.enabled !== false,
    trimStartSeconds,
    trimEndSeconds: boundedTrimEnd,
    transcriptCut:
      transcriptCut && transcriptCut.segmentEndSeconds - transcriptCut.segmentStartSeconds >= 0.04
        ? transcriptCut
        : null,
    createdAt: timestamp,
    updatedAt: item?.updatedAt || timestamp,
  }
}

function mergeProject(current, patch) {
  return {
    ...current,
    ...patch,
    recovery: {
      ...current.recovery,
      ...(patch.recovery ?? {}),
    },
    output: {
      ...current.output,
      ...(patch.output ?? {}),
    },
    background: {
      ...current.background,
      ...(patch.background ?? {}),
    },
    shortcuts: {
      ...current.shortcuts,
      ...(patch.shortcuts ?? {}),
    },
    captions: {
      ...current.captions,
      ...(patch.captions ?? {}),
    },
    cursor: {
      ...current.cursor,
      ...(patch.cursor ?? {}),
    },
    camera: {
      ...current.camera,
      ...(patch.camera ?? {}),
    },
    timeline: {
      ...current.timeline,
      ...(patch.timeline ?? {}),
    },
    audio: {
      ...current.audio,
      ...(patch.audio ?? {}),
      voiceClarity: {
        ...current.audio.voiceClarity,
        ...(patch.audio?.voiceClarity ?? {}),
      },
      ducking: {
        ...current.audio.ducking,
        ...(patch.audio?.ducking ?? {}),
      },
    },
    clips: patch.clips ?? current.clips,
  }
}

function normalizeProjectShortcuts(shortcuts) {
  const defaults = createDefaultProject().shortcuts
  const labelSize = ['small', 'medium', 'large'].includes(shortcuts?.labelSize)
    ? shortcuts.labelSize
    : defaults.labelSize

  return {
    ...defaults,
    ...shortcuts,
    enabled: shortcuts?.enabled !== false,
    showSymbols: Boolean(shortcuts?.showSymbols),
    labelSize,
  }
}

function normalizeProjectCaptions(captions) {
  const defaults = createDefaultProject().captions
  const labelSize = ['small', 'medium', 'large'].includes(captions?.labelSize)
    ? captions.labelSize
    : defaults.labelSize

  return {
    ...defaults,
    ...captions,
    enabled: captions?.enabled !== false,
    wordHighlighting: captions?.wordHighlighting !== false,
    showSpeakerLabels: Boolean(captions?.showSpeakerLabels),
    labelSize,
    languageHint: typeof captions?.languageHint === 'string' ? captions.languageHint.trim() : defaults.languageHint,
  }
}

function getProjectFilePath(projectId) {
  return path.join(getPaths().projectsRoot, `${projectId}.json`)
}

function isManagedProjectFile(entryName) {
  return (
    entryName.endsWith('.json') &&
    entryName !== 'active-project.json' &&
    entryName !== 'active-project-pointer.json'
  )
}

function getProjectActivityTimestamp(project) {
  const candidate = project?.lastOpenedAt || project?.updatedAt || project?.createdAt || ''
  const timestamp = new Date(candidate).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortProjectsByActivity(projects, activeProjectId = '') {
  return [...projects].sort((left, right) => {
    if (left.id === activeProjectId) {
      return -1
    }

    if (right.id === activeProjectId) {
      return 1
    }

    return getProjectActivityTimestamp(right) - getProjectActivityTimestamp(left)
  })
}

function normalizeProjectOutput(output) {
  const defaults = createDefaultProject().output
  const format = output?.format === 'gif' ? 'gif' : 'mp4'
  const videoCodec = output?.videoCodec === 'libx265' ? 'libx265' : defaults.videoCodec
  const aspectPreset = Object.hasOwn(outputAspectPresets, output?.aspectPreset)
    ? output.aspectPreset
    : defaults.aspectPreset
  const fitMode = output?.fitMode === 'cover' ? 'cover' : defaults.fitMode
  const gifFps = Number.isFinite(output?.gifFps) ? Math.min(24, Math.max(10, Number(output.gifFps))) : defaults.gifFps

  return {
    ...defaults,
    ...output,
    format,
    videoCodec,
    audioCodec: defaults.audioCodec,
    crf: Number.isFinite(output?.crf) ? Math.min(30, Math.max(14, Number(output.crf))) : defaults.crf,
    preset:
      typeof output?.preset === 'string' && ['medium', 'slow', 'slower'].includes(output.preset)
        ? output.preset
        : defaults.preset,
    aspectPreset,
    fitMode,
    gifFps,
  }
}

function normalizeProjectCursor(cursor) {
  const defaults = createDefaultProject().cursor

  return {
    ...defaults,
    ...cursor,
    showCursor: cursor?.showCursor !== false,
    size: Number.isFinite(cursor?.size) ? Math.min(2.4, Math.max(0.6, Number(cursor.size))) : defaults.size,
    style: ['windows', 'mac', 'touch'].includes(cursor?.style) ? cursor.style : defaults.style,
    alwaysPointer: Boolean(cursor?.alwaysPointer),
    clickEffect: cursor?.clickEffect === 'none' ? 'none' : defaults.clickEffect,
    smoothingEnabled: cursor?.smoothingEnabled !== false,
    animationStyle: ['molasses', 'default', 'gentle', 'stiff'].includes(cursor?.animationStyle)
      ? cursor.animationStyle
      : defaults.animationStyle,
  }
}

function normalizeProjectBackground(background) {
  const defaults = createDefaultProject().background
  const legacyDefaultFrameBackground =
    Number.isFinite(background?.padding) &&
    Number.isFinite(background?.radius) &&
    Number.isFinite(background?.shadow) &&
    Math.abs(Number(background.padding) - 0.08) < 0.0005 &&
    Math.abs(Number(background.radius) - 0.05) < 0.0005 &&
    Math.abs(Number(background.shadow) - 0.38) < 0.0005

  const normalizedPadding = legacyDefaultFrameBackground ? defaults.padding : background?.padding
  const normalizedRadius = legacyDefaultFrameBackground ? defaults.radius : background?.radius
  const normalizedShadow = legacyDefaultFrameBackground ? defaults.shadow : background?.shadow

  return {
    ...defaults,
    ...background,
    mode: ['wallpaper', 'image', 'gradient', 'color'].includes(background?.mode) ? background.mode : defaults.mode,
    wallpaperId: typeof background?.wallpaperId === 'string' && background.wallpaperId ? background.wallpaperId : defaults.wallpaperId,
    gradientId: typeof background?.gradientId === 'string' && background.gradientId ? background.gradientId : defaults.gradientId,
    colorValue: typeof background?.colorValue === 'string' && background.colorValue ? background.colorValue : defaults.colorValue,
    imagePath: typeof background?.imagePath === 'string' ? background.imagePath : defaults.imagePath,
    blur: Number.isFinite(background?.blur) ? Math.min(0.5, Math.max(0, Number(background.blur))) : defaults.blur,
    padding: Number.isFinite(normalizedPadding) ? Math.min(0.22, Math.max(0, Number(normalizedPadding))) : defaults.padding,
    radius: Number.isFinite(normalizedRadius) ? Math.min(0.18, Math.max(0, Number(normalizedRadius))) : defaults.radius,
    shadow: Number.isFinite(normalizedShadow) ? Math.min(0.9, Math.max(0, Number(normalizedShadow))) : defaults.shadow,
  }
}

function normalizeProjectCamera(camera) {
  const defaults = createDefaultProject().camera
  const supportedPositions = [
    'top-left',
    'top-center',
    'top-right',
    'center-left',
    'center',
    'center-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ]

  return {
    ...defaults,
    ...camera,
    enabled: Boolean(camera?.enabled),
    deviceId: typeof camera?.deviceId === 'string' ? camera.deviceId : defaults.deviceId,
    deviceLabel: typeof camera?.deviceLabel === 'string' ? camera.deviceLabel : defaults.deviceLabel,
    size: Number.isFinite(camera?.size) ? Math.min(0.38, Math.max(0.14, Number(camera.size))) : defaults.size,
    position: supportedPositions.includes(camera?.position)
      ? camera.position
      : defaults.position,
    offset: Number.isFinite(camera?.offset) ? Math.min(1, Math.max(0, Number(camera.offset))) : defaults.offset,
    mirror: Boolean(camera?.mirror),
    shape: ['circle', 'rounded'].includes(camera?.shape) ? camera.shape : defaults.shape,
    roundness: Number.isFinite(camera?.roundness) ? Math.min(0.48, Math.max(0.08, Number(camera.roundness))) : defaults.roundness,
    shadow: Number.isFinite(camera?.shadow) ? Math.min(0.9, Math.max(0, Number(camera.shadow))) : defaults.shadow,
    border: Number.isFinite(camera?.border) ? Math.min(1, Math.max(0, Number(camera.border))) : defaults.border,
  }
}

function normalizeProject(project) {
  const defaults = createDefaultProject()
  const merged = mergeProject(defaults, project ?? {})
  const clips = Array.isArray(merged.clips) ? merged.clips.map((clip) => normalizeClip(clip)) : []
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]))
  const rawItems =
    Array.isArray(merged.timeline.items) && merged.timeline.items.length > 0
      ? merged.timeline.items
      : clips.map((clip) => createTimelineItemFromClip(clip))
  const items = rawItems
    .map((item) => normalizeTimelineItem(item, clipsById))
    .filter((item) => Boolean(item.clipId) && clipsById.has(item.clipId))
  const activeItemId = items.some((item) => item.id === merged.timeline.activeItemId)
    ? merged.timeline.activeItemId
    : (items[0]?.id ?? '')
  const activeItem = items.find((item) => item.id === activeItemId)
  const activeClipId = clips.some((clip) => clip.id === merged.timeline.activeClipId)
    ? merged.timeline.activeClipId
    : (activeItem?.clipId ?? clips[0]?.id ?? '')
  const timelineExports = Array.isArray(merged.timeline.exports)
    ? merged.timeline.exports.map((item) => ({
        id: item?.id || globalThis.crypto.randomUUID(),
        filePath: item?.filePath || '',
        format: item?.format || 'mp4',
        createdAt: item?.createdAt || new Date().toISOString(),
        size: Number.isFinite(item?.size) ? Number(item.size) : 0,
        itemCount: Number.isFinite(item?.itemCount) ? Number(item.itemCount) : 0,
        durationSeconds: Number.isFinite(item?.durationSeconds) ? Number(item.durationSeconds) : 0,
      }))
    : []

  return {
    ...merged,
    output: normalizeProjectOutput(merged.output),
    background: normalizeProjectBackground(merged.background),
    shortcuts: normalizeProjectShortcuts(merged.shortcuts),
    captions: normalizeProjectCaptions(merged.captions),
    cursor: normalizeProjectCursor(merged.cursor),
    camera: normalizeProjectCamera(merged.camera),
    audio: normalizeProjectAudio(merged.audio),
    clips,
    timeline: {
      ...merged.timeline,
      activeItemId,
      activeClipId,
      items,
      exports: timelineExports,
      lastExportPath: merged.timeline.lastExportPath || '',
    },
  }
}

async function loadProject() {
  const workspace = await loadProjectWorkspace()
  return workspace.activeProject
}

async function readActiveProjectPointer() {
  const pointer = await readJson(getPaths().activeProjectPointerFile, null)
  return typeof pointer?.projectId === 'string' ? pointer.projectId : ''
}

async function writeActiveProjectPointer(projectId) {
  await writeFile(
    getPaths().activeProjectPointerFile,
    JSON.stringify(
      {
        projectId,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  return projectId
}

async function writeLegacyActiveProjectSnapshot(project) {
  await writeFile(getPaths().activeProjectFile, JSON.stringify(project, null, 2))
}

async function readStoredProject(projectId) {
  const filePath = getProjectFilePath(projectId)
  const stored = await readJson(filePath, null)

  if (!stored) {
    return null
  }

  const normalized = normalizeProject(stored)

  if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
    await writeFile(filePath, JSON.stringify(normalized, null, 2))
  }

  return normalized
}

async function listStoredProjectIds() {
  if (!existsSync(getPaths().projectsRoot)) {
    return []
  }

  const entries = await readdir(getPaths().projectsRoot, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && isManagedProjectFile(entry.name))
    .map((entry) => path.basename(entry.name, '.json'))
}

async function migrateLegacyActiveProjectSnapshot() {
  const legacyProject = await readJson(getPaths().activeProjectFile, null)

  if (!legacyProject) {
    return ''
  }

  const normalized = normalizeProject(legacyProject)
  const filePath = getProjectFilePath(normalized.id)

  if (!existsSync(filePath)) {
    await writeFile(filePath, JSON.stringify(normalized, null, 2))
  }

  return normalized.id
}

function buildProjectSummary(project, activeProjectId) {
  const totalClipDuration = project.clips.reduce((total, clip) => total + clip.durationSeconds, 0)
  const enabledTimelineItemCount = project.timeline.items.filter((item) => item.enabled).length
  const totalTimelineDuration = project.timeline.items.reduce((total, item) => {
    if (!item.enabled) {
      return total
    }

    const clip = project.clips.find((entry) => entry.id === item.clipId)
    return total + getTimelineItemDuration(item, clip)
  }, 0)

  return {
    id: project.id,
    title: project.title,
    brief: project.brief,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
    clipCount: project.clips.length,
    totalClipDuration,
    timelineItemCount: project.timeline.items.length,
    enabledTimelineItemCount,
    totalTimelineDuration,
    exportCount:
      project.clips.reduce((total, clip) => total + clip.exports.length, 0) + project.timeline.exports.length,
    lastExportPath: project.timeline.lastExportPath || project.clips[0]?.lastExportPath || '',
    coverThumbnailDataUrl: project.clips.find((clip) => clip.thumbnailDataUrl)?.thumbnailDataUrl || '',
    isActive: project.id === activeProjectId,
  }
}

async function ensureProjectLibrary() {
  await ensureForkDirs()
  const migratedProjectId = await migrateLegacyActiveProjectSnapshot()
  let projectIds = await listStoredProjectIds()

  if (!projectIds.length) {
    const project = createDefaultProject()
    await writeFile(getProjectFilePath(project.id), JSON.stringify(project, null, 2))
    await writeActiveProjectPointer(project.id)
    await writeLegacyActiveProjectSnapshot(project)
    return {
      activeProjectId: project.id,
      projects: [project],
    }
  }

  const loadedProjects = (
    await Promise.all(projectIds.map((projectId) => readStoredProject(projectId)))
  ).filter(Boolean)

  if (!loadedProjects.length) {
    const project = createDefaultProject()
    await writeFile(getProjectFilePath(project.id), JSON.stringify(project, null, 2))
    await writeActiveProjectPointer(project.id)
    await writeLegacyActiveProjectSnapshot(project)
    return {
      activeProjectId: project.id,
      projects: [project],
    }
  }

  let activeProjectId = (await readActiveProjectPointer()) || migratedProjectId

  if (!loadedProjects.some((project) => project.id === activeProjectId)) {
    activeProjectId = sortProjectsByActivity(loadedProjects)[0]?.id ?? loadedProjects[0].id
  }

  const projects = sortProjectsByActivity(loadedProjects, activeProjectId)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]

  await writeActiveProjectPointer(activeProject.id)
  await writeLegacyActiveProjectSnapshot(activeProject)

  return {
    activeProjectId: activeProject.id,
    projects,
  }
}

async function loadProjectWorkspace() {
  const { activeProjectId, projects } = await ensureProjectLibrary()
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]

  return {
    activeProject,
    projects: projects.map((project) => buildProjectSummary(project, activeProject.id)),
  }
}

async function listProjects() {
  const workspace = await loadProjectWorkspace()
  return workspace.projects
}

async function writeProjectSnapshot(project, options = {}) {
  const nextProject = normalizeProject(project)

  await writeFile(getProjectFilePath(nextProject.id), JSON.stringify(nextProject, null, 2))

  const shouldActivate =
    options.setActive || (await readActiveProjectPointer()) === nextProject.id

  if (shouldActivate) {
    await writeActiveProjectPointer(nextProject.id)
    await writeLegacyActiveProjectSnapshot(nextProject)
  }

  return nextProject
}

function queueProjectTask(taskFactory) {
  const task = projectMutationQueue.then(() => taskFactory())

  projectMutationQueue = task.then(
    () => undefined,
    () => undefined,
  )

  return task
}

function queueProjectMutation(mutate) {
  return queueProjectTask(async () => {
    const current = await loadProject()
    const timestamp = new Date().toISOString()
    const next = normalizeProject(await mutate(current))

    next.updatedAt = timestamp
    next.lastOpenedAt = timestamp
    next.recovery.lastSavedAt = timestamp

    return writeProjectSnapshot(next, { setActive: true })
  })
}

function saveProject(patch) {
  return queueProjectMutation(async (current) => mergeProject(current, patch))
}

function createProject(payload = {}) {
  return queueProjectTask(async () => {
    const timestamp = new Date().toISOString()
    const nextProject = createDefaultProject()
    const title = payload?.title?.trim()
    const brief = payload?.brief?.trim()

    nextProject.title = title || nextProject.title
    nextProject.brief = brief || nextProject.brief
    nextProject.createdAt = timestamp
    nextProject.updatedAt = timestamp
    nextProject.lastOpenedAt = timestamp
    nextProject.recovery.lastSavedAt = timestamp

    await writeProjectSnapshot(nextProject, { setActive: true })
    return loadProjectWorkspace()
  })
}

function openProject(projectId) {
  return queueProjectTask(async () => {
    const project = await readStoredProject(projectId)

    if (!project) {
      throw new Error('Project was not found.')
    }

    const timestamp = new Date().toISOString()
    project.lastOpenedAt = timestamp
    await writeProjectSnapshot(project, { setActive: true })

    return loadProjectWorkspace()
  })
}

function duplicateProject(projectId) {
  return queueProjectTask(async () => {
    const sourceProject = await readStoredProject(projectId)

    if (!sourceProject) {
      throw new Error('Project was not found.')
    }

    const timestamp = new Date().toISOString()
    const nextProject = normalizeProject({
      ...sourceProject,
      id: globalThis.crypto.randomUUID(),
      title: `${sourceProject.title} Copy`,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
      recovery: {
        ...sourceProject.recovery,
        lastSavedAt: timestamp,
      },
      clips: sourceProject.clips.map((clip) => ({
        ...clip,
        exports: [],
        lastExportPath: '',
        updatedAt: timestamp,
      })),
      timeline: {
        ...sourceProject.timeline,
        exports: [],
        lastExportPath: '',
      },
    })

    await writeProjectSnapshot(nextProject, { setActive: true })
    return loadProjectWorkspace()
  })
}

function removeProject(projectId) {
  return queueProjectTask(async () => {
    const { activeProjectId, projects } = await ensureProjectLibrary()
    const targetProject = projects.find((project) => project.id === projectId)

    if (!targetProject) {
      throw new Error('Project was not found.')
    }

    const remainingProjects = projects.filter((project) => project.id !== projectId)

    await rm(getProjectFilePath(projectId), {
      force: true,
    })

    if (!remainingProjects.length) {
      const nextProject = createDefaultProject()
      await writeProjectSnapshot(nextProject, { setActive: true })
      return loadProjectWorkspace()
    }

    const nextActiveProjectId =
      activeProjectId === projectId
        ? sortProjectsByActivity(remainingProjects)[0]?.id ?? remainingProjects[0].id
        : activeProjectId
    const nextActiveProject =
      remainingProjects.find((project) => project.id === nextActiveProjectId) ?? remainingProjects[0]

    await writeActiveProjectPointer(nextActiveProject.id)
    await writeLegacyActiveProjectSnapshot(nextActiveProject)

    return loadProjectWorkspace()
  })
}

function analyzeProjectClipAudio(clipId) {
  return queueProjectMutation(async (current) => {
    const targetClip = current.clips.find((clip) => clip.id === clipId)

    if (!targetClip) {
      throw new Error('Clip was not found in the active project.')
    }

    const audio = await analyzeClipAudio(
      targetClip.filePath,
      Boolean(targetClip.captureProfile?.includeSystemAudio),
      targetClip.audio,
    )

    return mergeProject(current, {
      clips: current.clips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              updatedAt: new Date().toISOString(),
              audio,
            }
          : clip,
      ),
    })
  })
}

function generateProjectClipTranscript(clipId) {
  return queueProjectMutation(async (current) => {
    const targetClip = current.clips.find((clip) => clip.id === clipId)

    if (!targetClip) {
      throw new Error('Clip was not found in the active project.')
    }

    await writeRuntimeLog(`transcript generation started clip=${targetClip.id}`)

    try {
      const transcript = await requestTranscriptForClip(targetClip, current.captions)

      await writeRuntimeLog(
        `transcript generation completed clip=${targetClip.id} segments=${transcript.segments.length} words=${transcript.words.length}`,
      )

      return mergeProject(current, {
        clips: current.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                updatedAt: new Date().toISOString(),
                audioRetakes: [],
                transcript,
              }
            : clip,
        ),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcript generation failed.'

      await writeRuntimeLog(`transcript generation failed clip=${targetClip.id} reason=${message}`)

      throw new Error(message)
    }
  })
}

async function importProjectMusicBed() {
  if (!mainWindowRef) {
    throw new Error('Main window is not ready.')
  }

  const selection = await dialog.showOpenDialog(mainWindowRef, {
    title: 'Import Sequence Music Bed',
    properties: ['openFile'],
    filters: [
      {
        name: 'Audio files',
        extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
      },
    ],
  })

  if (selection.canceled || !selection.filePaths.length) {
    return {
      cancelled: true,
      project: null,
    }
  }

  await ensureForkDirs()

  const sourcePath = selection.filePaths[0]
  const parsedSource = path.parse(sourcePath)
  const safeBaseName = sanitizeBaseName(parsedSource.name, `music-bed-${Date.now()}`)
  const targetPath = path.join(getPaths().audioRoot, `${safeBaseName}-${Date.now()}${parsedSource.ext || '.mp3'}`)
  const mediaProfile = await probeMediaProfile(sourcePath, true)

  if (!mediaProfile.hasAudio) {
    throw new Error('Selected file does not contain an audio stream.')
  }

  await cp(sourcePath, targetPath, { force: true })

  const audioAnalysis = await analyzeClipAudio(targetPath, true, null)
  const targetStats = await stat(targetPath)
  const project = await queueProjectMutation(async (current) => {
    const activeBed = getActiveMusicBed(current.audio)
    const timelineDuration = getProjectTimelineDuration(current)
    const nextMusicBed = normalizeMusicBed({
      id: globalThis.crypto.randomUUID(),
      label: parsedSource.name || 'Music Bed',
      sourceName: path.basename(sourcePath),
      filePath: targetPath,
      size: targetStats.size,
      durationSeconds: mediaProfile.durationSeconds,
      trimStartSeconds: 0,
      trimEndSeconds: mediaProfile.durationSeconds || null,
      timelineStartSeconds: activeBed?.timelineStartSeconds ?? 0,
      timelineEndSeconds:
        activeBed?.timelineEndSeconds ??
        (timelineDuration > 0 ? timelineDuration : mediaProfile.durationSeconds || null),
      fadeInSeconds: activeBed?.fadeInSeconds ?? 0.18,
      fadeOutSeconds: activeBed?.fadeOutSeconds ?? 0.32,
      gainDb: activeBed?.gainDb ?? -16,
      routingMode: activeBed?.routingMode ?? 'duck',
      automation: {
        enabled: activeBed?.automation?.enabled ?? false,
        startSeconds: activeBed?.automation?.startSeconds ?? 0,
        endSeconds: activeBed?.automation?.endSeconds ?? null,
        gainDb: activeBed?.automation?.gainDb ?? -3,
        rampSeconds: activeBed?.automation?.rampSeconds ?? 0.4,
      },
      loop: activeBed?.loop ?? true,
      enabled: true,
      waveformPeaks: audioAnalysis.waveformPeaks,
      updatedAt: new Date().toISOString(),
    })

    return mergeProject(current, {
      audio: {
        beds: [nextMusicBed, ...current.audio.beds],
        activeBedId: nextMusicBed.id,
      },
    })
  })

  return {
    cancelled: false,
    project,
  }
}

async function importProjectBackgroundImage() {
  if (!mainWindowRef) {
    throw new Error('Main window is not ready.')
  }

  const selection = await dialog.showOpenDialog(mainWindowRef, {
    title: 'Import Background Image',
    properties: ['openFile'],
    filters: [
      {
        name: 'Image files',
        extensions: ['png', 'jpg', 'jpeg', 'webp'],
      },
    ],
  })

  if (selection.canceled || !selection.filePaths.length) {
    return {
      cancelled: true,
      project: null,
    }
  }

  await ensureForkDirs()

  const sourcePath = selection.filePaths[0]
  const parsedSource = path.parse(sourcePath)
  const safeBaseName = sanitizeBaseName(parsedSource.name, `background-${Date.now()}`)
  const targetPath = path.join(getPaths().backgroundsRoot, `${safeBaseName}-${Date.now()}${parsedSource.ext || '.png'}`)

  await cp(sourcePath, targetPath, { force: true })

  const project = await queueProjectMutation(async (current) =>
    mergeProject(current, {
      background: {
        mode: 'image',
        imagePath: targetPath,
      },
    }),
  )

  return {
    cancelled: false,
    project,
  }
}

function removeProjectMusicBed(bedId) {
  return queueProjectMutation(async (current) => {
    const nextBeds = current.audio.beds.filter((bed) => bed.id !== bedId)

    if (nextBeds.length === current.audio.beds.length) {
      throw new Error('Sequence bed was not found in the active project.')
    }

    const nextActiveBedId = nextBeds.some((bed) => bed.id === current.audio.activeBedId)
      ? current.audio.activeBedId
      : (nextBeds[0]?.id ?? '')

    return mergeProject(current, {
      audio: {
        beds: nextBeds,
        activeBedId: nextActiveBedId,
      },
    })
  })
}

function appendClipToProject(clip) {
  const nextClip = normalizeClip(clip)
  const nextTimelineItem = createTimelineItemFromClip(nextClip)

  return queueProjectMutation(async (current) =>
    mergeProject(current, {
      clips: [nextClip, ...current.clips.filter((item) => item.id !== nextClip.id)],
      timeline: {
        activeClipId: nextClip.id,
        activeItemId: nextTimelineItem.id,
        items: [...current.timeline.items, nextTimelineItem],
      },
    }),
  )
}

async function countFiles(rootPath) {
  if (!existsSync(rootPath)) {
    return 0
  }

  const entries = await readdir(rootPath, { withFileTypes: true })
  const counts = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootPath, entry.name)
      if (entry.isDirectory()) {
        return countFiles(fullPath)
      }

      return 1
    }),
  )

  return counts.reduce((total, count) => total + count, 0)
}

async function scanLegacyImportState() {
  const paths = getPaths()
  const sourcePackage = await readJson(paths.legacyPackageJson, {})

  return {
    detected: existsSync(paths.legacyImportRoot),
    sourceVersion: sourcePackage.version ?? '',
    presetCount: await countFiles(paths.legacyPresets),
    projectCount: await countFiles(paths.legacyProjects),
    hasWindowState: existsSync(paths.legacyWindowState),
    hasPartitionState: existsSync(paths.legacyPartition),
    scannedAt: new Date().toISOString(),
  }
}

async function importLegacyState() {
  const paths = getPaths()
  const summary = await scanLegacyImportState()

  if (summary.hasWindowState) {
    await cp(paths.legacyWindowState, path.join(paths.importsRoot, 'window-state.json'), {
      force: true,
    })
  }

  if (summary.presetCount > 0 && existsSync(paths.legacyPresets)) {
    await cp(paths.legacyPresets, path.join(paths.importsRoot, 'Presets'), {
      recursive: true,
      force: true,
    })
  }

  if (summary.projectCount > 0 && existsSync(paths.legacyProjects)) {
    await cp(paths.legacyProjects, path.join(paths.importsRoot, 'Projects'), {
      recursive: true,
      force: true,
    })
  }

  const settings = await saveSettings({
    importState: {
      lastScannedAt: summary.scannedAt,
      lastImportedAt: new Date().toISOString(),
      sourceVersion: summary.sourceVersion,
      presetCount: summary.presetCount,
      projectCount: summary.projectCount,
      hasWindowState: summary.hasWindowState,
      hasPartitionState: summary.hasPartitionState,
    },
  })

  return {
    summary,
    settings,
  }
}

async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    fetchWindowIcons: true,
    thumbnailSize: {
      width: 480,
      height: 270,
    },
  })

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: source.thumbnail.toDataURL(),
  }))
}

async function resolveCaptureTrackingState(sourceId) {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    fetchWindowIcons: false,
    thumbnailSize: {
      width: 1,
      height: 1,
    },
  })
  const selectedSource =
    sources.find((source) => source.id === sourceId) ??
    sources.find((source) => source.id.startsWith('screen:')) ??
    sources[0]

  if (!selectedSource) {
    return {
      sourceId,
      sourceKind: 'screen',
      displayId: '',
      cursorTrackingAvailable: false,
      cursorBounds: null,
      cursorCoordinateSpace: null,
    }
  }

  const sourceKind = selectedSource.id.startsWith('screen:') ? 'screen' : 'window'

  if (sourceKind !== 'screen') {
    return {
      sourceId: selectedSource.id,
      sourceKind,
      displayId: selectedSource.display_id || '',
      cursorTrackingAvailable: false,
      cursorBounds: null,
      cursorCoordinateSpace: null,
    }
  }

  const displays = screen.getAllDisplays()
  const parsedSourceId = String(selectedSource.id).split(':')[1] || ''
  const selectedDisplay =
    displays.find((display) => String(display.id) === selectedSource.display_id) ??
    displays.find((display) => String(display.id) === parsedSourceId) ??
    (displays.length === 1 ? displays[0] : null)

  return {
    sourceId: selectedSource.id,
    sourceKind,
    displayId: selectedSource.display_id || (selectedDisplay ? String(selectedDisplay.id) : ''),
    cursorTrackingAvailable: Boolean(
      selectedDisplay?.bounds?.width &&
      selectedDisplay?.bounds?.height,
    ),
    cursorBounds: selectedDisplay?.bounds ?? null,
    cursorCoordinateSpace:
      selectedDisplay?.bounds?.width && selectedDisplay?.bounds?.height
        ? {
            width: Math.max(1, Math.round(selectedDisplay.bounds.width)),
            height: Math.max(1, Math.round(selectedDisplay.bounds.height)),
          }
        : null,
  }
}

async function resolveNativeScreenCaptureTarget(sourceId) {
  const sources = await listCaptureSources()
  const screenSources = sources.filter((source) => source.kind === 'screen')
  const selectedSource =
    screenSources.find((source) => source.id === sourceId) ??
    screenSources[0] ??
    null

  if (!selectedSource || !selectedSource.id.startsWith('screen:')) {
    throw new Error('Native screen capture is available only for screen sources.')
  }

  const displays = screen.getAllDisplays()
  const selectedDisplay =
    displays.find((display) => String(display.id) === selectedSource.displayId) ??
    (displays.length === 1 ? displays[0] : null)

  if (!selectedDisplay?.bounds?.width || !selectedDisplay?.bounds?.height) {
    throw new Error('Could not resolve the selected display for native screen capture.')
  }

  const physicalRect =
    typeof screen.dipToScreenRect === 'function'
      ? screen.dipToScreenRect(null, selectedDisplay.bounds)
      : {
          x: Math.round(selectedDisplay.bounds.x * (Number(selectedDisplay.scaleFactor) || 1)),
          y: Math.round(selectedDisplay.bounds.y * (Number(selectedDisplay.scaleFactor) || 1)),
          width: Math.max(1, Math.round(selectedDisplay.bounds.width * (Number(selectedDisplay.scaleFactor) || 1))),
          height: Math.max(1, Math.round(selectedDisplay.bounds.height * (Number(selectedDisplay.scaleFactor) || 1))),
        }
  const screenOutputIndex = screenSources.findIndex((source) => source.id === selectedSource.id)
  const displayIndex = displays.findIndex((display) => display.id === selectedDisplay.id)
  const outputIndex =
    screenOutputIndex >= 0
      ? screenOutputIndex
      : displayIndex >= 0
        ? displayIndex
        : 0

  return {
    sourceId: selectedSource.id,
    displayId: selectedSource.displayId || String(selectedDisplay.id),
    displayLabel: selectedSource.name || `Display ${selectedDisplay.id}`,
    outputIndex,
    physicalBounds: {
      x: Math.round(physicalRect.x),
      y: Math.round(physicalRect.y),
      width: Math.max(1, Math.round(physicalRect.width)),
      height: Math.max(1, Math.round(physicalRect.height)),
    },
  }
}

function resolvePreferredRealtimeCaptureEncoder(supportedEncoders) {
  const encoderPriority = ['h264_mf', 'h264_qsv', 'h264_nvenc', 'h264_amf', 'libx264']

  for (const encoder of encoderPriority) {
    if (supportedEncoders.includes(encoder)) {
      return encoder
    }
  }

  return 'libx264'
}

function resolvePreferredNativeScreenCaptureEngines(supportedFilters, captureTarget) {
  const supportsDdagrab =
    Array.isArray(supportedFilters) &&
    supportedFilters.includes('ddagrab') &&
    Number.isInteger(captureTarget?.outputIndex) &&
    captureTarget.outputIndex >= 0

  return supportsDdagrab ? ['ddagrab', 'gdigrab'] : ['gdigrab']
}

function buildNativeScreenCaptureArgs({
  engine,
  captureTarget,
  fps,
  videoBitsPerSecond,
  encoder,
  outputPath,
}) {
  const bitrateKbps = Math.max(6_000, Math.round(videoBitsPerSecond / 1000))
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  const targetFrameRate = String(Math.max(1, Math.round(fps)))

  if (engine === 'ddagrab') {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `ddagrab=output_idx=${captureTarget.outputIndex}:draw_mouse=0:framerate=${targetFrameRate}:video_size=${captureTarget.physicalBounds.width}x${captureTarget.physicalBounds.height}`,
      '-vf',
      'hwdownload,format=bgra',
      '-an',
    )
  } else {
    args.push(
      '-f',
      'gdigrab',
      '-draw_mouse',
      '0',
      '-framerate',
      targetFrameRate,
      '-offset_x',
      String(captureTarget.physicalBounds.x),
      '-offset_y',
      String(captureTarget.physicalBounds.y),
      '-video_size',
      `${captureTarget.physicalBounds.width}x${captureTarget.physicalBounds.height}`,
      '-i',
      'desktop',
      '-an',
    )
  }

  if (encoder === 'h264_mf') {
    args.push(
      '-c:v',
      'h264_mf',
      '-scenario',
      'display_remoting',
      '-rate_control',
      'quality',
      '-quality',
      '100',
      '-pix_fmt',
      'yuv420p',
    )
  } else if (encoder === 'libx264') {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
    )
  } else {
    args.push(
      '-c:v',
      encoder,
      '-b:v',
      `${bitrateKbps}k`,
      '-maxrate',
      `${bitrateKbps}k`,
      '-bufsize',
      `${Math.max(bitrateKbps * 2, bitrateKbps + 4000)}k`,
      '-pix_fmt',
      'yuv420p',
    )
  }

  args.push('-movflags', '+faststart', outputPath)

  return args
}

function resetNativeScreenCaptureState() {
  nativeScreenCaptureState.sessionId = ''
  nativeScreenCaptureState.process = null
  nativeScreenCaptureState.filePath = ''
  nativeScreenCaptureState.mimeType = 'video/mp4'
  nativeScreenCaptureState.engine = 'gdigrab'
  nativeScreenCaptureState.encoder = ''
  nativeScreenCaptureState.startedAtMs = 0
  nativeScreenCaptureState.stopPromise = null
  nativeScreenCaptureState.stopResolve = null
  nativeScreenCaptureState.stopReject = null
  nativeScreenCaptureState.stderr = ''
}

async function startNativeScreenCaptureRecording({
  sourceId,
  fps,
  videoBitsPerSecond,
  fileName,
}) {
  if (nativeScreenCaptureState.process) {
    throw new Error('A native screen capture session is already running.')
  }

  const ffmpeg = await resolveFfmpegPath()

  if (!ffmpeg.available || !ffmpeg.path) {
    throw new Error('FFmpeg is not available for native screen capture.')
  }

  const captureTarget = await resolveNativeScreenCaptureTarget(sourceId)
  const encoder = resolvePreferredRealtimeCaptureEncoder(ffmpeg.supportedEncoders || [])
  const engineCandidates = resolvePreferredNativeScreenCaptureEngines(
    ffmpeg.supportedFilters || [],
    captureTarget,
  )
  const safeBaseName = sanitizeBaseName(fileName, `native-capture-${Date.now()}`)
  const tempRoot = path.join(getPaths().forkUserData, 'native-captures')
  await mkdir(tempRoot, { recursive: true })
  const outputPath = path.join(tempRoot, `${safeBaseName}.mp4`)
  let child = null
  let engine = 'gdigrab'
  let startupStderr = ''
  let startedAtMs = 0
  let lastStartError = null

  for (const candidateEngine of engineCandidates) {
    const args = buildNativeScreenCaptureArgs({
      engine: candidateEngine,
      captureTarget,
      fps,
      videoBitsPerSecond,
      encoder,
      outputPath,
    })
    const attemptStartedAtMs = Date.now()
    const attemptChild = spawn(ffmpeg.path, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    })

    let startupSettled = false
    let attemptStderr = ''

    try {
      await new Promise((resolve, reject) => {
        const startupTimer = setTimeout(() => {
          if (startupSettled) {
            return
          }

          startupSettled = true
          clearTimeout(startupTimer)
          resolve()
        }, 500)

        attemptChild.stderr.on('data', (chunk) => {
          attemptStderr += chunk.toString()
        })

        attemptChild.once('error', (error) => {
          if (startupSettled) {
            return
          }

          startupSettled = true
          clearTimeout(startupTimer)
          reject(error)
        })

        attemptChild.once('exit', (code, signal) => {
          if (startupSettled) {
            return
          }

          startupSettled = true
          clearTimeout(startupTimer)
          reject(
            new Error(
              attemptStderr.trim() ||
                `Native screen capture exited early with code=${code ?? 'null'} signal=${signal ?? 'null'}`,
            ),
          )
        })
      })

      child = attemptChild
      engine = candidateEngine
      startupStderr = attemptStderr
      startedAtMs = attemptStartedAtMs
      break
    } catch (error) {
      lastStartError = error
      try {
        attemptChild.kill('SIGKILL')
      } catch {}
      await writeRuntimeLog(
        `native capture start failed engine=${candidateEngine} source=${captureTarget.sourceId} display=${captureTarget.displayId} output=${captureTarget.outputIndex} reason=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (!child) {
    throw (lastStartError instanceof Error
      ? lastStartError
      : new Error('No native screen capture engine could start successfully.'))
  }

  const sessionId = globalThis.crypto.randomUUID()
  nativeScreenCaptureState.sessionId = sessionId
  nativeScreenCaptureState.process = child
  nativeScreenCaptureState.filePath = outputPath
  nativeScreenCaptureState.mimeType = 'video/mp4'
  nativeScreenCaptureState.engine = engine
  nativeScreenCaptureState.encoder = encoder
  nativeScreenCaptureState.startedAtMs = startedAtMs
  nativeScreenCaptureState.stderr = startupStderr
  nativeScreenCaptureState.stopPromise = new Promise((resolve, reject) => {
    nativeScreenCaptureState.stopResolve = resolve
    nativeScreenCaptureState.stopReject = reject
  })

  child.stderr.on('data', (chunk) => {
    if (nativeScreenCaptureState.process !== child) {
      return
    }

    nativeScreenCaptureState.stderr += chunk.toString()
    if (nativeScreenCaptureState.stderr.length > 16000) {
      nativeScreenCaptureState.stderr = nativeScreenCaptureState.stderr.slice(-16000)
    }
  })

  child.on('exit', async (code, signal) => {
    const stopResolve = nativeScreenCaptureState.stopResolve
    const stopReject = nativeScreenCaptureState.stopReject
    const activeSessionId = nativeScreenCaptureState.sessionId
    const filePath = nativeScreenCaptureState.filePath
    const engine = nativeScreenCaptureState.engine
    const encoderName = nativeScreenCaptureState.encoder
    const startedAtMs = nativeScreenCaptureState.startedAtMs
    const stderr = nativeScreenCaptureState.stderr

    try {
      if (code === 0 && existsSync(filePath)) {
        const fileSize = (await stat(filePath)).size
        const mediaProfile = await probeMediaProfile(filePath, false)
        stopResolve?.({
          ok: true,
          sessionId: activeSessionId,
          filePath,
          mimeType: nativeScreenCaptureState.mimeType,
          size: fileSize,
          engine,
          encoder: encoderName,
          startedAtMs,
          durationSeconds:
            mediaProfile.durationSeconds > 0 ? Number(mediaProfile.durationSeconds.toFixed(3)) : 0,
        })
        await writeRuntimeLog(
          `native capture finalized session=${activeSessionId} engine=${engine} encoder=${encoderName} path=${filePath} size=${fileSize} duration=${mediaProfile.durationSeconds || 0}`,
        )
      } else {
        stopReject?.(
          new Error(
            stderr.trim() ||
              `Native screen capture exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`,
          ),
        )
        await writeRuntimeLog(
          `native capture failed session=${activeSessionId} engine=${engine} encoder=${encoderName} code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderr.trim() || 'n/a'}`,
        )
      }
    } finally {
      resetNativeScreenCaptureState()
    }
  })

  await writeRuntimeLog(
    `native capture started session=${sessionId} engine=${engine} encoder=${encoder} source=${captureTarget.sourceId} display=${captureTarget.displayId} output=${captureTarget.outputIndex} bounds=${captureTarget.physicalBounds.x},${captureTarget.physicalBounds.y},${captureTarget.physicalBounds.width}x${captureTarget.physicalBounds.height} fps=${fps} targetBitrate=${videoBitsPerSecond}`,
  )

  return {
    ok: true,
    sessionId,
    filePath: outputPath,
    mimeType: 'video/mp4',
    engine,
    encoder,
    startedAtMs,
  }
}

async function stopNativeScreenCaptureRecording(sessionId) {
  if (!nativeScreenCaptureState.process || !nativeScreenCaptureState.sessionId) {
    throw new Error('There is no active native screen capture session to stop.')
  }

  if (sessionId && sessionId !== nativeScreenCaptureState.sessionId) {
    throw new Error('The native screen capture session id does not match the active session.')
  }

  try {
    nativeScreenCaptureState.process.stdin?.write('q')
    nativeScreenCaptureState.process.stdin?.end()
  } catch {
    nativeScreenCaptureState.process.kill('SIGTERM')
  }

  if (!nativeScreenCaptureState.stopPromise) {
    throw new Error('Native screen capture stop promise is unavailable.')
  }

  return nativeScreenCaptureState.stopPromise
}

async function prepareSpawnArgs(command, args) {
  const normalizedArgs = Array.isArray(args) ? [...args] : []

  if (process.platform !== 'win32') {
    return {
      args: normalizedArgs,
      cleanup: async () => undefined,
    }
  }

  const filterComplexIndex = normalizedArgs.indexOf('-filter_complex')

  if (filterComplexIndex === -1 || filterComplexIndex >= normalizedArgs.length - 1) {
    return {
      args: normalizedArgs,
      cleanup: async () => undefined,
    }
  }

  const filterComplexValue = normalizedArgs[filterComplexIndex + 1]
  const commandLength = [command, ...normalizedArgs].reduce(
    (total, part) => total + String(part ?? '').length + 1,
    0,
  )

  if (typeof filterComplexValue !== 'string' || (filterComplexValue.length < 8000 && commandLength < 28000)) {
    return {
      args: normalizedArgs,
      cleanup: async () => undefined,
    }
  }

  const filterScriptPath = path.join(
    app.getPath('temp'),
    `movion-filter-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  )
  await writeFile(filterScriptPath, filterComplexValue, 'utf8')
  normalizedArgs.splice(filterComplexIndex, 2, '-filter_complex_script', filterScriptPath)

  return {
    args: normalizedArgs,
    cleanup: async () => {
      await rm(filterScriptPath, { force: true }).catch(() => undefined)
    },
  }
}

async function runProcess(command, args) {
  const prepared = await prepareSpawnArgs(command, args)

  return new Promise((resolve, reject) => {
    const child = spawn(command, prepared.args, {
      windowsHide: true,
    })
    let output = ''

    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    child.on('error', (error) => {
      void prepared.cleanup()
      reject(error)
    })

    child.on('close', (code) => {
      void prepared.cleanup()
      if (code === 0) {
        resolve(output.trim())
        return
      }

      reject(new Error(output.trim() || `${command} exited with code ${code}`))
    })
  })
}

async function runProcessBuffer(command, args) {
  const prepared = await prepareSpawnArgs(command, args)

  return new Promise((resolve, reject) => {
    const child = spawn(command, prepared.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks = []
    let errorOutput = ''

    child.stdout.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
    })

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString()
    })

    child.on('error', (error) => {
      void prepared.cleanup()
      reject(error)
    })

    child.on('close', (code) => {
      void prepared.cleanup()
      if (code === 0) {
        resolve(Buffer.concat(chunks))
        return
      }

      reject(new Error(errorOutput.trim() || `${command} exited with code ${code}`))
    })
  })
}

function getTranscriptionCapability() {
  const apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY)

  return {
    available: apiKeyConfigured,
    provider: 'openai',
    model: 'whisper-1',
    apiKeyConfigured,
    reason: apiKeyConfigured
      ? 'OpenAI speech-to-text is ready for transcript generation.'
      : 'Set OPENAI_API_KEY to generate transcripts and captions in Movion.',
    maxUploadBytes: OPENAI_TRANSCRIPTION_MAX_BYTES,
  }
}

function getTranscriptionMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase()

  switch (extension) {
    case '.mp3':
      return 'audio/mpeg'
    case '.mp4':
      return 'video/mp4'
    case '.m4a':
      return 'audio/mp4'
    case '.wav':
      return 'audio/wav'
    case '.webm':
      return 'audio/webm'
    case '.mpeg':
    case '.mpga':
      return 'audio/mpeg'
    default:
      return 'application/octet-stream'
  }
}

async function prepareTranscriptionInput(clip) {
  const sourcePath = clip?.microphoneTake?.filePath || clip?.filePath || ''

  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error('No renderable audio source is available for transcript generation.')
  }

  const sourceStats = await stat(sourcePath)
  const extension = path.extname(sourcePath).toLowerCase()
  const acceptedInput = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'].includes(extension)

  if (acceptedInput && sourceStats.size <= OPENAI_TRANSCRIPTION_MAX_BYTES) {
    return {
      filePath: sourcePath,
      mimeType: getTranscriptionMimeType(sourcePath),
      cleanup: async () => {},
    }
  }

  const ffmpeg = await resolveFfmpegPath()

  if (!ffmpeg.available) {
    throw new Error('Transcript generation needs ffmpeg to downmix large or unsupported capture files.')
  }

  const tempRoot = path.join(app.getPath('temp'), 'movion-transcripts')
  await mkdir(tempRoot, { recursive: true })
  const outputPath = path.join(tempRoot, `${clip.id}-${Date.now()}.m4a`)

  await runProcess(ffmpeg.path, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'aac',
    '-b:a',
    '32k',
    outputPath,
  ])

  const outputStats = await stat(outputPath)

  if (outputStats.size > OPENAI_TRANSCRIPTION_MAX_BYTES) {
    await rm(outputPath, { force: true })
    throw new Error('The prepared transcript audio is still above the 25MB API limit. Shorten the clip or trim it before generating a transcript.')
  }

  return {
    filePath: outputPath,
    mimeType: 'audio/mp4',
    cleanup: async () => {
      await rm(outputPath, { force: true })
    },
  }
}

function buildTranscriptFromVerboseJson(payload, clip) {
  return normalizeClipTranscript(
    {
      status: 'ready',
      provider: 'openai',
      model: 'whisper-1',
      language: typeof payload?.language === 'string' ? payload.language : '',
      generatedAt: new Date().toISOString(),
      error: '',
      text: typeof payload?.text === 'string' ? payload.text : '',
      segments: Array.isArray(payload?.segments) ? payload.segments : [],
      words: Array.isArray(payload?.words) ? payload.words : [],
    },
    clip?.durationSeconds ?? 0,
  )
}

function parseSubtitleTimestamp(rawValue) {
  if (typeof rawValue !== 'string') {
    return Number.NaN
  }

  const normalized = rawValue.trim().replace(',', '.')
  const parts = normalized.split(':').map((part) => part.trim())

  if (parts.length < 2 || parts.length > 3) {
    return Number.NaN
  }

  const secondsPart = Number(parts.at(-1))
  const minutesPart = Number(parts.at(-2))
  const hoursPart = parts.length === 3 ? Number(parts[0]) : 0

  if (![secondsPart, minutesPart, hoursPart].every((value) => Number.isFinite(value))) {
    return Number.NaN
  }

  return Number((hoursPart * 3600 + minutesPart * 60 + secondsPart).toFixed(3))
}

function stripSubtitleMarkup(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\\[^}]+\}/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSpeakerPrefixedText(text) {
  const normalized = stripSubtitleMarkup(text)
  const match = normalized.match(/^([A-Za-zА-Яа-я0-9 _.'-]{2,24}):\s+(.+)$/)

  if (!match) {
    return {
      speaker: '',
      text: normalized,
    }
  }

  return {
    speaker: match[1].trim(),
    text: match[2].trim(),
  }
}

function parseSrtTranscriptText(rawText) {
  const blocks = String(rawText ?? '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)

      if (!lines.length) {
        return null
      }

      const timingLineIndex = lines.findIndex((line) => line.includes('-->'))

      if (timingLineIndex === -1) {
        return null
      }

      const timingLine = lines[timingLineIndex]
      const [rawStart, rawEnd] = timingLine.split('-->').map((part) => part.trim())
      const startSeconds = parseSubtitleTimestamp(rawStart)
      const endSeconds = parseSubtitleTimestamp(rawEnd?.split(/\s+/)[0] ?? '')
      const payloadLines = lines.slice(timingLineIndex + 1)
      const { speaker, text } = parseSpeakerPrefixedText(payloadLines.join(' '))

      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !text) {
        return null
      }

      return {
        startSeconds,
        endSeconds,
        text,
        speaker,
      }
    })
    .filter(Boolean)
}

function parseVttTranscriptText(rawText) {
  const blocks = String(rawText ?? '')
    .replace(/\r/g, '')
    .replace(/^WEBVTT\s*/i, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)

      if (!lines.length) {
        return null
      }

      const timingLineIndex = lines.findIndex((line) => line.includes('-->'))

      if (timingLineIndex === -1) {
        return null
      }

      const timingLine = lines[timingLineIndex]
      const [rawStart, rawEnd] = timingLine.split('-->').map((part) => part.trim())
      const startSeconds = parseSubtitleTimestamp(rawStart)
      const endSeconds = parseSubtitleTimestamp(rawEnd?.split(/\s+/)[0] ?? '')
      const payloadLines = lines.slice(timingLineIndex + 1)
      const { speaker, text } = parseSpeakerPrefixedText(payloadLines.join(' '))

      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !text) {
        return null
      }

      return {
        startSeconds,
        endSeconds,
        text,
        speaker,
      }
    })
    .filter(Boolean)
}

function buildImportedTranscriptFromText(rawText, extension, clip, sourceName) {
  const parser = extension === '.vtt' ? parseVttTranscriptText : parseSrtTranscriptText
  const parsedSegments = parser(rawText)

  if (!parsedSegments.length) {
    throw new Error('Imported subtitle file did not contain any readable timed caption segments.')
  }

  return normalizeClipTranscript(
    {
      status: 'ready',
      provider: 'imported',
      model: extension === '.vtt' ? 'webvtt' : 'srt',
      language: '',
      generatedAt: new Date().toISOString(),
      error: '',
      text: parsedSegments.map((segment) => segment.text).join(' ').trim(),
      segments: parsedSegments,
      words: [],
      sourceName,
    },
    clip?.durationSeconds ?? 0,
  )
}

async function requestTranscriptForClip(clip, captions) {
  const capability = getTranscriptionCapability()

  if (!capability.available) {
    throw new Error(capability.reason)
  }

  const preparedInput = await prepareTranscriptionInput(clip)

  try {
    const fileBuffer = await readFile(preparedInput.filePath)
    const form = new FormData()
    form.append('model', capability.model)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    form.append('timestamp_granularities[]', 'word')

    if (captions?.languageHint) {
      form.append('language', captions.languageHint)
    }

    form.append(
      'file',
      new Blob([fileBuffer], {
        type: preparedInput.mimeType,
      }),
      path.basename(preparedInput.filePath),
    )

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`OpenAI transcription failed (${response.status}): ${detail || 'No response body'}`)
    }

    return buildTranscriptFromVerboseJson(await response.json(), clip)
  } finally {
    await preparedInput.cleanup()
  }
}

async function importProjectClipTranscript(clipId) {
  if (!mainWindowRef) {
    throw new Error('Main window is not ready.')
  }

  const selection = await dialog.showOpenDialog(mainWindowRef, {
    title: 'Import Transcript or Captions',
    properties: ['openFile'],
    filters: [
      {
        name: 'Timed captions',
        extensions: ['srt', 'vtt'],
      },
    ],
  })

  if (selection.canceled || !selection.filePaths.length) {
    return loadProject()
  }

  const sourcePath = selection.filePaths[0]
  const extension = path.extname(sourcePath).toLowerCase()

  if (!['.srt', '.vtt'].includes(extension)) {
    throw new Error('Only SRT and VTT caption files are supported right now.')
  }

  return queueProjectMutation(async (current) => {
    const targetClip = current.clips.find((clip) => clip.id === clipId)

    if (!targetClip) {
      throw new Error('Clip was not found in the active project.')
    }

    await writeRuntimeLog(`transcript import started clip=${targetClip.id} source=${path.basename(sourcePath)}`)

    const rawText = await readFile(sourcePath, 'utf8')
    const transcript = buildImportedTranscriptFromText(rawText, extension, targetClip, path.basename(sourcePath))

    await writeRuntimeLog(
      `transcript import completed clip=${targetClip.id} source=${path.basename(sourcePath)} segments=${transcript.segments.length}`,
    )

    return mergeProject(current, {
      clips: current.clips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              updatedAt: new Date().toISOString(),
              audioRetakes: [],
              transcript,
            }
          : clip,
      ),
    })
  })
}

async function saveProjectClipAudioRetake({
  clipId,
  segmentId,
  segmentText,
  startSeconds,
  endSeconds,
  buffer,
  base64Data,
  byteLength,
  mimeType,
  fileName,
  deviceId,
  deviceLabel,
}) {
  const currentProject = await loadProject()
  const targetClip = currentProject.clips.find((clip) => clip.id === clipId)

  if (!targetClip) {
    throw new Error('Clip was not found in the active project.')
  }

  const canonicalSegment =
    targetClip.transcript?.segments?.find((segment) => segment.id === segmentId) ?? null
  const canonicalStartSeconds = Number.isFinite(canonicalSegment?.startSeconds)
    ? Number(canonicalSegment.startSeconds)
    : Number(startSeconds)
  const canonicalEndSeconds = Number.isFinite(canonicalSegment?.endSeconds)
    ? Number(canonicalSegment.endSeconds)
    : Number(endSeconds)
  const boundedStartSeconds = clampNumber(canonicalStartSeconds, 0, targetClip.durationSeconds)
  const boundedEndSeconds = clampNumber(canonicalEndSeconds, boundedStartSeconds, targetClip.durationSeconds)
  const segmentDurationSeconds = Number((boundedEndSeconds - boundedStartSeconds).toFixed(3))

  if (segmentDurationSeconds < 0.08) {
    throw new Error('Audio retakes need at least 0.08 seconds of selected transcript duration.')
  }

  if (segmentDurationSeconds > 15) {
    throw new Error('Audio retakes currently support transcript selections up to 15 seconds.')
  }

  await ensureForkDirs()

  const extension = mimeType?.includes('mp4') || mimeType?.includes('aac') ? 'm4a' : 'webm'
  const safeBaseName = sanitizeBaseName(
    fileName || `${path.parse(targetClip.filePath).name}-retake`,
    `audio-retake-${Date.now()}`,
  )
  const targetPath = path.join(getPaths().audioRoot, `${safeBaseName}.${extension}`)
  const payload = decodeRecordingPayload({ buffer, base64Data })

  await writeRuntimeLog(
    `audio retake payload received clip=${clipId} segment=${segmentId} transport=${base64Data ? 'base64' : 'binary'} bytes=${payload.length} declaredBytes=${byteLength ?? 'n/a'} head=${describeBufferSignature(payload) || 'empty'}`,
  )

  await writeFile(targetPath, payload)

  try {
    await validateRenderableAudioRecording(targetPath)
  } catch (error) {
    const invalidTargetPath = path.join(getPaths().audioRoot, `${safeBaseName}.invalid.${extension}`)
    await cp(targetPath, invalidTargetPath, { force: true }).catch(() => undefined)
    await writeRuntimeLog(
      `audio retake validation failed clip=${clipId} segment=${segmentId} path=${targetPath} preservedAt=${invalidTargetPath} error=${error?.message ?? error}`,
    )
    await rm(targetPath, { force: true }).catch(() => undefined)
    throw new Error(
      `The recorded audio retake could not be finalized into a renderable source. A debug copy was preserved at ${invalidTargetPath}. Record the retake again.`,
      { cause: error },
    )
  }

  const profile = await probeMediaProfile(targetPath, true)
  const timestamp = new Date().toISOString()
  const nextRetake = normalizeClipAudioRetake(
    {
      id: globalThis.crypto.randomUUID(),
      filePath: targetPath,
      mimeType: mimeType || 'audio/webm',
      size: (await stat(targetPath)).size,
      durationSeconds: profile.durationSeconds,
      deviceId,
      deviceLabel,
      segmentId,
      segmentText: canonicalSegment?.text || segmentText || '',
      startSeconds: boundedStartSeconds,
      endSeconds: boundedEndSeconds,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    targetClip.durationSeconds,
  )

  if (!nextRetake) {
    throw new Error('The audio retake could not be normalized for this clip.')
  }

  await writeRuntimeLog(
    `audio retake validation passed clip=${clipId} segment=${segmentId} path=${targetPath} duration=${nextRetake.durationSeconds.toFixed(3)}`,
  )

  return queueProjectMutation(async (current) => {
    const mutationTargetClip = current.clips.find((clip) => clip.id === clipId)

    if (!mutationTargetClip) {
      throw new Error('Clip was not found in the active project.')
    }

    return mergeProject(current, {
      clips: current.clips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              updatedAt: timestamp,
              audioRetakes: normalizeClipAudioRetakes(
                [
                  ...(clip.audioRetakes ?? []).filter((retake) => retake.segmentId !== segmentId),
                  nextRetake,
                ],
                clip.durationSeconds,
              ),
            }
          : clip,
      ),
    })
  })
}

function parseFfmpegCapabilityLines(output) {
  return Array.from(
    new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .map((line) => line.match(/^[A-Z.]+ +([a-z0-9_]+) +/i)?.[1]?.toLowerCase() ?? '')
        .filter(Boolean),
    ),
  )
}

function resolvePreferredVideoEncoder(supportedEncoders) {
  if (supportedEncoders.includes('libx264')) {
    return 'libx264'
  }

  if (supportedEncoders.includes('libx265')) {
    return 'libx265'
  }

  if (supportedEncoders.includes('libopenh264')) {
    return 'libopenh264'
  }

  if (supportedEncoders.includes('h264_qsv')) {
    return 'h264_qsv'
  }

  if (supportedEncoders.includes('h264_mf')) {
    return 'h264_mf'
  }

  return ''
}

function resetFfmpegState() {
  ffmpegState.checked = false
  ffmpegState.available = false
  ffmpegState.path = ''
  ffmpegState.version = ''
  ffmpegState.supportedFilters = []
  ffmpegState.supportedEncoders = []
  ffmpegState.capabilityScore = 0
  ffmpegState.supportsAdvancedCompositing = false
  ffmpegState.preferredVideoEncoder = ''
  ffmpegState.managed = false
  ffmpegState.sourcePath = ''
}

function resetFfprobeState() {
  ffprobeState.checked = false
  ffprobeState.available = false
  ffprobeState.path = ''
}

async function resolveExecutableCandidatePath(candidate) {
  if (!candidate) {
    return ''
  }

  if (path.isAbsolute(candidate)) {
    return existsSync(candidate) ? candidate : ''
  }

  if (candidate.includes(path.sep) || candidate.includes('/')) {
    const resolvedCandidate = path.resolve(candidate)
    return existsSync(resolvedCandidate) ? resolvedCandidate : ''
  }

  try {
    const output = await runProcess('where.exe', [candidate])
    const resolvedCandidate = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => Boolean(line) && existsSync(line))

    return resolvedCandidate ?? ''
  } catch {
    return ''
  }
}

async function inspectFfmpegCandidate(candidate) {
  const resolvedCandidatePath = (await resolveExecutableCandidatePath(candidate)) || candidate
  const versionOutput = await runProcess(resolvedCandidatePath, ['-version'])
  const filtersOutput = await runProcess(resolvedCandidatePath, ['-hide_banner', '-filters'])
  const encodersOutput = await runProcess(resolvedCandidatePath, ['-hide_banner', '-encoders'])
  const supportedFilters = parseFfmpegCapabilityLines(filtersOutput)
  const supportedEncoders = parseFfmpegCapabilityLines(encodersOutput)
  const preferredVideoEncoder = resolvePreferredVideoEncoder(supportedEncoders)
  const capabilityScore =
    advancedCompositorFilters.reduce(
      (total, filterName) => total + (supportedFilters.includes(filterName) ? 1 : 0),
      0,
    ) +
    (supportedEncoders.includes('aac') ? 2 : 0) +
    (preferredVideoEncoder === 'libx264'
      ? 6
      : preferredVideoEncoder === 'libx265'
        ? 5
        : preferredVideoEncoder
          ? 3
          : 0)

  return {
    path: resolvedCandidatePath,
    version: versionOutput.split(/\r?\n/, 1)[0] ?? 'ffmpeg',
    supportedFilters,
    supportedEncoders,
    capabilityScore,
    preferredVideoEncoder,
    directory: path.dirname(resolvedCandidatePath),
    ffprobePath: path.join(path.dirname(resolvedCandidatePath), 'ffprobe.exe'),
  }
}

function listManagedToolchainArtifacts(entries) {
  return entries.filter((entry) => {
    if (!entry.isFile()) {
      return false
    }

    return /\.(exe|dll|txt|md|json|license)$/i.test(entry.name)
  })
}

async function provisionManagedFfmpeg(candidate) {
  const paths = getPaths()
  const sourceDirectory = candidate.directory
  const targetDirectory = paths.ffmpegRuntimeRoot
  const sourceFfprobePath = candidate.ffprobePath

  if (!path.isAbsolute(candidate.path) || !existsSync(candidate.path) || !existsSync(sourceDirectory)) {
    await writeRuntimeLog(
      `ffmpeg provisioning skipped invalid-source path=${candidate.path || 'missing'} directory=${sourceDirectory || 'missing'}`,
    )
    return {
      ffmpegPath: candidate.path,
      ffprobePath: existsSync(sourceFfprobePath) ? sourceFfprobePath : paths.managedFfprobePath,
      managed: false,
    }
  }

  const sourceEntries = await readdir(sourceDirectory, { withFileTypes: true })
  const filesToCopy = listManagedToolchainArtifacts(sourceEntries)
  const manifest = await readJson(paths.ffmpegManifestFile, null)
  const sourceSignature = {
    sourcePath: candidate.path,
    version: candidate.version,
    capabilityScore: candidate.capabilityScore,
    preferredVideoEncoder: candidate.preferredVideoEncoder,
  }
  const managedSourcePath = paths.managedFfmpegPath
  const managedFfprobePath = paths.managedFfprobePath
  const sourceMatchesManaged =
    path.resolve(candidate.path).toLowerCase() === path.resolve(managedSourcePath).toLowerCase()

  if (sourceMatchesManaged) {
    return {
      ffmpegPath: candidate.path,
      ffprobePath: existsSync(sourceFfprobePath) ? sourceFfprobePath : managedFfprobePath,
      managed: true,
    }
  }

  if (!filesToCopy.some((entry) => entry.name.toLowerCase() === path.basename(candidate.path).toLowerCase())) {
    await writeRuntimeLog(
      `ffmpeg provisioning skipped missing-artifact path=${candidate.path} directory=${sourceDirectory}`,
    )
    return {
      ffmpegPath: candidate.path,
      ffprobePath: existsSync(sourceFfprobePath) ? sourceFfprobePath : managedFfprobePath,
      managed: false,
    }
  }

  const needsSync =
    !existsSync(managedSourcePath) ||
    !existsSync(managedFfprobePath) ||
    !manifest ||
    manifest.sourcePath !== sourceSignature.sourcePath ||
    manifest.version !== sourceSignature.version ||
    manifest.capabilityScore !== sourceSignature.capabilityScore ||
    manifest.preferredVideoEncoder !== sourceSignature.preferredVideoEncoder

  if (needsSync) {
    await ensureForkDirs()
    await writeRuntimeLog(`ffmpeg provisioning start source=${candidate.path} target=${managedSourcePath}`)

    const existingEntries = await readdir(targetDirectory, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      existingEntries
        .filter((entry) => entry.isFile())
        .map((entry) => rm(path.join(targetDirectory, entry.name), { force: true })),
    )

    await Promise.all(
      filesToCopy.map((entry) =>
        cp(path.join(sourceDirectory, entry.name), path.join(targetDirectory, entry.name), { force: true }),
      ),
    )

    await writeFile(
      paths.ffmpegManifestFile,
      JSON.stringify(
        {
          ...sourceSignature,
          syncedAt: new Date().toISOString(),
          copiedFiles: filesToCopy.map((entry) => entry.name),
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeRuntimeLog(`ffmpeg provisioning completed target=${managedSourcePath}`)
  }

  return {
    ffmpegPath: managedSourcePath,
    ffprobePath: managedFfprobePath,
    managed: true,
  }
}

async function resolveFfmpegPath() {
  if (ffmpegState.checked) {
    if (!ffmpegState.available) {
      return ffmpegState
    }

    const cachedPathMissing =
      !ffmpegState.path ||
      !path.isAbsolute(ffmpegState.path) ||
      !existsSync(ffmpegState.path)

    if (!cachedPathMissing) {
      return ffmpegState
    }

    await writeRuntimeLog(
      `ffmpeg cached path invalid path=${ffmpegState.path || 'missing'} source=${ffmpegState.sourcePath || 'unknown'} rechecking`,
    )
    resetFfmpegState()
    resetFfprobeState()
  }

  let bestCandidate = null

  for (const candidate of getFfmpegCandidates()) {
    if (candidate !== 'ffmpeg.exe' && !existsSync(candidate)) {
      continue
    }

    try {
      const inspectedCandidate = await inspectFfmpegCandidate(candidate)

      if (
        !bestCandidate ||
        inspectedCandidate.capabilityScore > bestCandidate.capabilityScore ||
        (inspectedCandidate.capabilityScore === bestCandidate.capabilityScore &&
      candidate !== path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Canvid', 'resources', 'binaries', 'win', 'ffmpeg', 'ffmpeg.exe') &&
      candidate !== path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Movion', 'resources', 'binaries', 'win', 'ffmpeg', 'ffmpeg.exe'))
      ) {
        bestCandidate = inspectedCandidate
      }
    } catch {
      continue
    }
  }

  if (bestCandidate) {
    const provisionedToolchain = await provisionManagedFfmpeg(bestCandidate)
    ffmpegState.checked = true
    ffmpegState.available = true
    ffmpegState.path = provisionedToolchain.ffmpegPath
    ffmpegState.version = bestCandidate.version
    ffmpegState.supportedFilters = bestCandidate.supportedFilters
    ffmpegState.supportedEncoders = bestCandidate.supportedEncoders
    ffmpegState.capabilityScore = bestCandidate.capabilityScore
    ffmpegState.supportsAdvancedCompositing =
      advancedCompositorFilters.every((filterName) => bestCandidate.supportedFilters.includes(filterName))
    ffmpegState.preferredVideoEncoder = bestCandidate.preferredVideoEncoder
    ffmpegState.managed = provisionedToolchain.managed
    ffmpegState.sourcePath = bestCandidate.path
    resetFfprobeState()
    await writeRuntimeLog(
      `ffmpeg resolved path=${ffmpegState.path} source=${ffmpegState.sourcePath} managed=${ffmpegState.managed} score=${ffmpegState.capabilityScore} advanced=${ffmpegState.supportsAdvancedCompositing} videoEncoder=${ffmpegState.preferredVideoEncoder || 'none'}`,
    )
    return ffmpegState
  }

  ffmpegState.checked = true
  return ffmpegState
}

async function resolveFfprobePath() {
  if (ffprobeState.checked) {
    if (!ffprobeState.available) {
      return ffprobeState
    }

    const cachedPathMissing =
      !ffprobeState.path ||
      !path.isAbsolute(ffprobeState.path) ||
      !existsSync(ffprobeState.path)

    if (!cachedPathMissing) {
      return ffprobeState
    }

    await writeRuntimeLog(`ffprobe cached path invalid path=${ffprobeState.path || 'missing'} rechecking`)
    resetFfprobeState()
  }

  await resolveFfmpegPath()

  for (const candidate of getFfprobeCandidates()) {
    if (candidate !== 'ffprobe.exe' && !existsSync(candidate)) {
      continue
    }

    try {
      const resolvedCandidatePath = (await resolveExecutableCandidatePath(candidate)) || candidate
      await runProcess(resolvedCandidatePath, ['-version'])
      ffprobeState.checked = true
      ffprobeState.available = true
      ffprobeState.path = resolvedCandidatePath
      return ffprobeState
    } catch {
      continue
    }
  }

  ffprobeState.checked = true
  return ffprobeState
}

function toEvenNumber(value, fallback = 2) {
  const candidate = Number.isFinite(value) ? Math.max(2, Math.round(Number(value))) : fallback
  return candidate % 2 === 0 ? candidate : candidate - 1
}

async function probeMediaProfile(filePath, fallbackHasAudio) {
  const ffprobe = await resolveFfprobePath()

  if (!ffprobe.available || !ffprobe.path) {
    return {
      hasAudio: fallbackHasAudio,
      width: 0,
      height: 0,
      durationSeconds: 0,
      fps: 0,
      averageFps: 0,
      nominalFps: 0,
    }
  }

  try {
    const output = await runProcess(ffprobe.path, [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-print_format',
      'json',
      filePath,
    ])
    const parsed = JSON.parse(output)
    const streams = Array.isArray(parsed.streams) ? parsed.streams : []
    const videoStream = streams.find((stream) => stream?.codec_type === 'video')
    const parseFrameRate = (frameRateSource) => {
      const fpsParts =
        typeof frameRateSource === 'string' && frameRateSource.includes('/')
          ? frameRateSource.split('/').map((part) => Number(part))
          : null

      if (
        fpsParts &&
        fpsParts.length === 2 &&
        Number.isFinite(fpsParts[0]) &&
        Number.isFinite(fpsParts[1]) &&
        fpsParts[1] > 0
      ) {
        return fpsParts[0] / fpsParts[1]
      }

      return Number.isFinite(Number(frameRateSource)) ? Number(frameRateSource) : 0
    }
    const averageFps = parseFrameRate(videoStream?.avg_frame_rate ?? 0)
    const nominalFps = parseFrameRate(videoStream?.r_frame_rate ?? videoStream?.avg_frame_rate ?? 0)
    const durationSource =
      parsed?.format?.duration ??
      videoStream?.duration ??
      streams.find((stream) => stream?.codec_type === 'audio')?.duration
    const durationSeconds = Number.isFinite(Number(durationSource)) ? Number(durationSource) : 0

    return {
      hasAudio: streams.some((stream) => stream?.codec_type === 'audio'),
      width: Number.isFinite(videoStream?.width) ? Number(videoStream.width) : 0,
      height: Number.isFinite(videoStream?.height) ? Number(videoStream.height) : 0,
      durationSeconds,
      fps: averageFps || nominalFps,
      averageFps,
      nominalFps,
    }
  } catch {
    return {
      hasAudio: fallbackHasAudio,
      width: 0,
      height: 0,
      durationSeconds: 0,
      fps: 0,
      averageFps: 0,
      nominalFps: 0,
    }
  }
}

function resolveStableVideoFps(mediaProfile) {
  const preferredFps =
    Number.isFinite(mediaProfile?.nominalFps) && mediaProfile.nominalFps > 0
      ? Number(mediaProfile.nominalFps)
      : Number.isFinite(mediaProfile?.fps) && mediaProfile.fps > 0
        ? Number(mediaProfile.fps)
        : 60

  return Math.max(30, Math.min(60, Math.round(preferredFps)))
}

function computeWaveformPeaks(audioBuffer, peakCount = 96) {
  if (!audioBuffer || audioBuffer.length < 2) {
    return []
  }

  const sampleCount = Math.floor(audioBuffer.length / 2)

  if (!sampleCount) {
    return []
  }

  const rawPeaks = []

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
    const startSample = Math.floor((peakIndex * sampleCount) / peakCount)
    const endSample = Math.floor(((peakIndex + 1) * sampleCount) / peakCount)
    let maxAmplitude = 0

    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
      const sampleValue = Math.abs(audioBuffer.readInt16LE(sampleIndex * 2)) / 32768
      maxAmplitude = Math.max(maxAmplitude, sampleValue)
    }

    rawPeaks.push(maxAmplitude)
  }

  const loudestPeak = Math.max(...rawPeaks, 0)

  if (loudestPeak <= 0) {
    return rawPeaks.map(() => 0)
  }

  return rawPeaks.map((peak) => peak / loudestPeak)
}

async function analyzeClipAudio(filePath, fallbackHasAudio, existingAudio = null) {
  const mediaProfile = await probeMediaProfile(filePath, fallbackHasAudio)
  const baseAudio = normalizeClipAudio(existingAudio, mediaProfile.hasAudio)

  if (!mediaProfile.hasAudio) {
    return {
      ...baseAudio,
      hasAudio: false,
      waveformPeaks: [],
    }
  }

  const ffmpeg = await resolveFfmpegPath()

  if (!ffmpeg.available || !ffmpeg.path) {
    return {
      ...baseAudio,
      hasAudio: true,
    }
  }

  try {
    const pcmBuffer = await runProcessBuffer(ffmpeg.path, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '1200',
      '-f',
      's16le',
      '-',
    ])

    return {
      ...baseAudio,
      hasAudio: true,
      waveformPeaks: normalizeWaveformPeaks(computeWaveformPeaks(pcmBuffer)),
    }
  } catch {
    return {
      ...baseAudio,
      hasAudio: true,
    }
  }
}

function buildAudioFilter(audio) {
  const gainDb = Number.isFinite(audio?.gainDb) ? Number(audio.gainDb) : 0

  if (Math.abs(gainDb) < 0.05) {
    return ''
  }

  return `volume=${gainDb.toFixed(1)}dB`
}

function buildVoiceClarityFilter(ffmpeg, voiceClarity) {
  if (!voiceClarity?.enabled) {
    return ''
  }

  const profile = voiceClarity.profile === 'strong' ? 'strong' : 'balanced'
  const filterNames = ffmpeg?.supportedFilters ?? []
  const filters = []

  if (filterNames.includes('highpass')) {
    filters.push(`highpass=f=${profile === 'strong' ? 90 : 70}`)
  }

  if (filterNames.includes('lowpass')) {
    filters.push(`lowpass=f=${profile === 'strong' ? 13500 : 15000}`)
  }

  if (filterNames.includes('afftdn')) {
    filters.push(profile === 'strong' ? 'afftdn=nr=18:nf=-30:tn=1' : 'afftdn=nr=10:nf=-26:tn=1')
  }

  if (filterNames.includes('acompressor')) {
    filters.push(
      profile === 'strong'
        ? 'acompressor=threshold=0.090:ratio=3.5:attack=5:release=120:makeup=3'
        : 'acompressor=threshold=0.120:ratio=2.2:attack=8:release=150:makeup=2',
    )
  }

  if (filterNames.includes('dynaudnorm')) {
    filters.push(profile === 'strong' ? 'dynaudnorm=f=120:g=11:p=0.85' : 'dynaudnorm=f=180:g=7:p=0.90')
  }

  return filters.join(',')
}

function buildAudioRetakeIntervals(audioRetakes, trimStartSeconds, durationSeconds) {
  if (!Array.isArray(audioRetakes) || !audioRetakes.length) {
    return []
  }

  const trimEndSeconds = trimStartSeconds + durationSeconds

  return audioRetakes
    .map((retake) => {
      const overlapStartSeconds = Math.max(trimStartSeconds, Number(retake?.startSeconds) || 0)
      const overlapEndSeconds = Math.min(trimEndSeconds, Number(retake?.endSeconds) || 0)
      const overlapDurationSeconds = overlapEndSeconds - overlapStartSeconds

      if (!Number.isFinite(overlapDurationSeconds) || overlapDurationSeconds < 0.04) {
        return null
      }

      return {
        retake,
        localStartSeconds: Number((overlapStartSeconds - trimStartSeconds).toFixed(3)),
        inputStartSeconds: Number((overlapStartSeconds - (Number(retake?.startSeconds) || 0)).toFixed(3)),
        durationSeconds: Number(overlapDurationSeconds.toFixed(3)),
      }
    })
    .filter(Boolean)
}

function buildAudioRetakeMuteVolumeFilter(intervals) {
  if (!intervals.length) {
    return ''
  }

  let expression = '1'

  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    const interval = intervals[index]
    expression = `if(between(t\\,${interval.localStartSeconds.toFixed(3)}\\,${(interval.localStartSeconds + interval.durationSeconds).toFixed(3)})\\,0\\,${expression})`
  }

  return `volume='${expression}':eval=frame`
}

function buildClipAudioRenderPlan({
  ffmpeg,
  projectAudio,
  clipAudio,
  sourceAudioAvailable,
  microphoneInputIndex,
  audioRetakeInputs = [],
  trimStartSeconds,
  durationSeconds,
}) {
  if (clipAudio?.muted) {
    return {
      useAudio: false,
      requiresComplex: false,
      simpleFilter: '',
      filterComplex: '',
      outputLabel: '[aout]',
    }
  }

  const finalGainFilter = buildAudioFilter(clipAudio)
  const retakeIntervals = buildAudioRetakeIntervals(
    audioRetakeInputs.map((entry) => entry.retake),
    trimStartSeconds,
    durationSeconds,
  )

  if ((microphoneInputIndex === null || microphoneInputIndex === undefined) && !retakeIntervals.length) {
    return {
      useAudio: sourceAudioAvailable,
      requiresComplex: false,
      simpleFilter: finalGainFilter,
      filterComplex: '',
      outputLabel: '[aout]',
    }
  }

  const filterParts = []
  const mixInputs = []
  const padDuration = durationSeconds.toFixed(3)
  const trimEndSeconds = (trimStartSeconds + durationSeconds).toFixed(3)

  if (sourceAudioAvailable) {
    filterParts.push(
      `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,apad=pad_dur=${padDuration},atrim=duration=${padDuration}[clip_source_a]`,
    )
    mixInputs.push('[clip_source_a]')
  }

  const voiceClarityFilter = buildVoiceClarityFilter(ffmpeg, projectAudio?.voiceClarity)
  const retakeMuteFilter = buildAudioRetakeMuteVolumeFilter(retakeIntervals)

  if (microphoneInputIndex !== null && microphoneInputIndex !== undefined) {
    const microphoneChain = [
      `atrim=start=${trimStartSeconds.toFixed(3)}:end=${trimEndSeconds}`,
      'asetpts=PTS-STARTPTS',
      'aresample=48000',
      `apad=pad_dur=${padDuration}`,
      `atrim=duration=${padDuration}`,
    ]

    if (retakeMuteFilter) {
      microphoneChain.push(retakeMuteFilter)
    }

    if (voiceClarityFilter) {
      microphoneChain.push(voiceClarityFilter)
    }

    filterParts.push(`[${microphoneInputIndex}:a:0]${microphoneChain.join(',')}[mic_a]`)
    mixInputs.push('[mic_a]')
  }

  for (const [intervalIndex, interval] of retakeIntervals.entries()) {
    const matchingInput = audioRetakeInputs.find((entry) => entry.retake.id === interval.retake.id)

    if (!matchingInput) {
      continue
    }

    const retakeChain = [
      `atrim=start=${interval.inputStartSeconds.toFixed(3)}:end=${(interval.inputStartSeconds + interval.durationSeconds).toFixed(3)}`,
      'asetpts=PTS-STARTPTS',
      'aresample=48000',
      `apad=pad_dur=${interval.durationSeconds.toFixed(3)}`,
      `atrim=duration=${interval.durationSeconds.toFixed(3)}`,
    ]

    if (voiceClarityFilter) {
      retakeChain.push(voiceClarityFilter)
    }

    retakeChain.push(`adelay=${Math.max(0, Math.round(interval.localStartSeconds * 1000))}|${Math.max(0, Math.round(interval.localStartSeconds * 1000))}`)
    filterParts.push(`[${matchingInput.inputIndex}:a:0]${retakeChain.join(',')}[retake_a_${intervalIndex}]`)
    mixInputs.push(`[retake_a_${intervalIndex}]`)
  }

  if (!mixInputs.length) {
    return {
      useAudio: false,
      requiresComplex: false,
      simpleFilter: '',
      filterComplex: '',
      outputLabel: '[aout]',
    }
  }

  const mixedLabel = mixInputs.length > 1 ? '[clip_mix_a]' : mixInputs[0]

  if (mixInputs.length > 1) {
    filterParts.push(
      `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0:dropout_transition=0${mixedLabel}`,
    )
  }

  filterParts.push(`${mixedLabel}${finalGainFilter ? `${finalGainFilter},` : ''}anull[aout]`)

  return {
    useAudio: true,
    requiresComplex: true,
    simpleFilter: '',
    filterComplex: filterParts.join(';'),
    outputLabel: '[aout]',
  }
}

function buildAutomationKeyframeExpression(keyframes) {
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    return ''
  }

  let expression = '0'

  for (let index = keyframes.length - 2; index >= 0; index -= 1) {
    const startPoint = keyframes[index]
    const endPoint = keyframes[index + 1]
    const startTime = Number(startPoint.timeSeconds).toFixed(3)
    const endTime = Number(endPoint.timeSeconds).toFixed(3)
    const span = Math.max(0, Number(endPoint.timeSeconds) - Number(startPoint.timeSeconds))
    const segmentExpression =
      span <= 0.001
        ? Number(endPoint.gainDb).toFixed(3)
        : `${Number(startPoint.gainDb).toFixed(3)}+((${(Number(endPoint.gainDb) - Number(startPoint.gainDb)).toFixed(3)})*((t-${startTime})/${span.toFixed(3)}))`

    expression = `if(lt(t\\,${startTime})\\,0\\,if(lt(t\\,${endTime})\\,${segmentExpression}\\,${expression}))`
  }

  return expression
}

function buildAutomationVolumeFilter({ baseGainDb, automation, placement }) {
  const normalizedBaseGainDb = Number.isFinite(baseGainDb) ? Number(baseGainDb) : 0

  if (!automation?.enabled) {
    return Math.abs(normalizedBaseGainDb) < 0.05 ? '' : `volume=${normalizedBaseGainDb.toFixed(1)}dB`
  }

  const normalizedKeyframes = normalizeMusicBedAutomationKeyframes(
    (automation?.keyframes ?? []).map((keyframe) => ({
      ...keyframe,
      timeSeconds: Math.min(
        placement.timelineEndSeconds,
        Math.max(
          placement.timelineStartSeconds,
          Number.isFinite(keyframe?.timeSeconds) ? Number(keyframe.timeSeconds) : placement.timelineStartSeconds,
        ),
      ),
    })),
  )
  const keyframeExpression = buildAutomationKeyframeExpression(normalizedKeyframes)

  if (keyframeExpression) {
    return `volume='pow(10,((${normalizedBaseGainDb.toFixed(3)})+(${keyframeExpression}))/20)':eval=frame`
  }

  const automationStart = Math.min(
    Math.max(placement.timelineStartSeconds, Number(automation.startSeconds) || 0),
    placement.timelineEndSeconds,
  )
  const automationEndRaw =
    automation.endSeconds === null || automation.endSeconds === undefined
      ? placement.timelineEndSeconds
      : Number(automation.endSeconds)
  const automationEnd = Math.min(
    Math.max(automationStart, automationEndRaw),
    placement.timelineEndSeconds,
  )

  if (automationEnd <= automationStart + 0.001) {
    return Math.abs(normalizedBaseGainDb) < 0.05 ? '' : `volume=${normalizedBaseGainDb.toFixed(1)}dB`
  }

  const automationGainDb = Number.isFinite(automation.gainDb) ? Number(automation.gainDb) : -3
  const rampSeconds = Math.min(
    Math.max(0, Number(automation.rampSeconds) || 0),
    Math.max(0, (automationEnd - automationStart) / 2),
  )
  const rampUpEnd = automationStart + rampSeconds
  const rampDownStart = automationEnd - rampSeconds
  const expression =
    rampSeconds <= 0.01
      ? `pow(10,((${normalizedBaseGainDb.toFixed(3)})+if(between(t\\,${automationStart.toFixed(3)}\\,${automationEnd.toFixed(3)})\\,${automationGainDb.toFixed(3)}\\,0))/20)`
      : `pow(10,((${normalizedBaseGainDb.toFixed(3)})+if(lt(t\\,${automationStart.toFixed(3)})\\,0\\,if(lt(t\\,${rampUpEnd.toFixed(3)})\\,${automationGainDb.toFixed(3)}*((t-${automationStart.toFixed(3)})/${rampSeconds.toFixed(3)})\\,if(lt(t\\,${rampDownStart.toFixed(3)})\\,${automationGainDb.toFixed(3)}\\,if(lt(t\\,${automationEnd.toFixed(3)})\\,${automationGainDb.toFixed(3)}*(1-((t-${rampDownStart.toFixed(3)})/${rampSeconds.toFixed(3)}))\\,0)))))/20)`

  return `volume='${expression}':eval=frame`
}

function appendMixedAudioBus(filterParts, labels, outputLabel) {
  if (!labels.length) {
    return ''
  }

  if (labels.length === 1) {
    filterParts.push(`${labels[0]}anull[${outputLabel}]`)
    return `[${outputLabel}]`
  }

  filterParts.push(
    `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0:dropout_transition=0[${outputLabel}]`,
  )
  return `[${outputLabel}]`
}

function buildSingleMusicBedFilters(musicBed, totalDuration) {
  const placement = getMusicBedPlacement(musicBed, totalDuration)

  if (placement.durationSeconds <= 0) {
    return ''
  }

  const sourceTrimEnd =
    musicBed.trimEndSeconds === null
      ? musicBed.durationSeconds || null
      : musicBed.trimEndSeconds
  const trimFilters = ['aresample=48000', 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo']

  if (musicBed.trimStartSeconds > 0 || sourceTrimEnd !== null) {
    const trimArgs = [`start=${musicBed.trimStartSeconds.toFixed(3)}`]

    if (sourceTrimEnd !== null && sourceTrimEnd > musicBed.trimStartSeconds) {
      trimArgs.push(`end=${sourceTrimEnd.toFixed(3)}`)
    }

    trimFilters.push(`atrim=${trimArgs.join(':')}`, 'asetpts=N/SR/TB')
  }

  if (musicBed.loop) {
    trimFilters.push('aloop=loop=-1:size=2147483647')
  }

  trimFilters.push(`atrim=duration=${placement.durationSeconds.toFixed(3)}`)

  const clampedFadeIn = Math.min(placement.durationSeconds, Math.max(0, musicBed.fadeInSeconds || 0))
  const clampedFadeOut = Math.min(
    Math.max(0, placement.durationSeconds - clampedFadeIn),
    Math.max(0, musicBed.fadeOutSeconds || 0),
  )

  if (clampedFadeIn > 0.01) {
    trimFilters.push(`afade=t=in:st=0:d=${clampedFadeIn.toFixed(3)}`)
  }

  if (clampedFadeOut > 0.01) {
    const fadeOutStart = Math.max(0, placement.durationSeconds - clampedFadeOut)
    trimFilters.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${clampedFadeOut.toFixed(3)}`)
  }

  if (placement.timelineStartSeconds > 0.001) {
    const delayMs = Math.round(placement.timelineStartSeconds * 1000)
    trimFilters.push(`adelay=${delayMs}|${delayMs}`)
  }

  trimFilters.push(`atrim=duration=${totalDuration.toFixed(3)}`)

  const gainFilter = buildAutomationVolumeFilter({
    baseGainDb: musicBed.gainDb,
    automation: musicBed.automation,
    placement,
  })

  if (gainFilter) {
    trimFilters.push(gainFilter)
  }

  return trimFilters.join(',')
}

function buildTimelineMusicBedFilter({ musicBeds, ducking, totalDuration }) {
  if (!Array.isArray(musicBeds) || !musicBeds.length || totalDuration <= 0) {
    return ''
  }

  const duckingRatio = Math.max(2, 2 + (ducking.reductionDb / 2))
  const filterParts = [
    '[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=2[voice_mix][voice_sc]',
  ]
  const duckedBedLabels = []
  const bypassBedLabels = []

  musicBeds.forEach((musicBed, index) => {
    const laneFilter = buildSingleMusicBedFilters(musicBed, totalDuration)

    if (!laneFilter) {
      return
    }

    const inputIndex = index + 1
    const laneLabel = `bed_${index}_lane`

    filterParts.push(
      `[${inputIndex}:a]${laneFilter}[${laneLabel}]`,
    )
    if (musicBed.routingMode === 'bypass') {
      bypassBedLabels.push(`[${laneLabel}]`)
      return
    }

    duckedBedLabels.push(`[${laneLabel}]`)
  })

  if (!duckedBedLabels.length && !bypassBedLabels.length) {
    return ''
  }

  const finalMixInputs = ['[voice_mix]']
  const duckBusLabel = appendMixedAudioBus(filterParts, duckedBedLabels, 'bed_duck_bus')
  const bypassBusLabel = appendMixedAudioBus(filterParts, bypassBedLabels, 'bed_bypass_bus')

  if (duckBusLabel) {
    filterParts.push(
      ducking.enabled
        ? `${duckBusLabel}[voice_sc]sidechaincompress=threshold=0.08:ratio=${duckingRatio.toFixed(2)}:attack=${Math.round(ducking.attackMs)}:release=${Math.round(ducking.releaseMs)}:makeup=1[bed_duck_mix]`
        : `${duckBusLabel}anull[bed_duck_mix]`,
    )
    finalMixInputs.push('[bed_duck_mix]')
  }

  if (bypassBusLabel) {
    filterParts.push(`${bypassBusLabel}anull[bed_bypass_mix]`)
    finalMixInputs.push('[bed_bypass_mix]')
  }

  if (finalMixInputs.length === 1) {
    return ''
  }

  filterParts.push(
    `${finalMixInputs.join('')}amix=inputs=${finalMixInputs.length}:duration=first:normalize=0:dropout_transition=0[aout]`,
  )

  return filterParts.join(';')
}

async function mixTimelineMusicBeds({
  ffmpegPath,
  assembledPath,
  outputPath,
  musicBeds,
  ducking,
  audioCodec,
  totalDuration,
}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', assembledPath]

  for (const musicBed of musicBeds) {
    args.push('-i', musicBed.filePath)
  }

  await runProcess(ffmpegPath, [
    ...args,
    '-filter_complex',
    buildTimelineMusicBedFilter({
      musicBeds,
      ducking,
      totalDuration,
    }),
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    audioCodec,
    '-movflags',
    '+faststart',
    outputPath,
  ])
}

function getCursorPointAtTime(points, timeSeconds, smoothingEnabled = true, animationStyle = 'default') {
  return getCursorPointAtTimeShared(points, timeSeconds, {
    smoothingEnabled,
    animationStyle,
    projectDiscretePoint: (point, targetTime) =>
      projectDiscreteCursorVisualPointShared(point, targetTime, {
        includeTimeSeconds: true,
      }),
    projectInterpolatedPoint: (context) =>
      projectInterpolatedCursorVisualPointShared(context, {
        includeTimeSeconds: true,
      }),
  })
}

function sampleCursorTrackRange(cursorTrack, startSeconds, endSeconds) {
  return sampleCursorTrackRangeShared(cursorTrack?.points ?? [], startSeconds, endSeconds, {
    getPointAtTime: (points, targetTimeSeconds) => getCursorPointAtTime(points, targetTimeSeconds),
    rebaseTimeToStart: true,
    projectPoint: (point, sampledTimeSeconds) => ({
      ...point,
      timeSeconds: sampledTimeSeconds,
    }),
  })
}

function smoothCursorSamples(points, responsiveness) {
  if (points.length < 2) {
    return points
  }

  let currentX = points[0].x
  let currentY = points[0].y

  return points.map((point, index) => {
    if (index === 0) {
      return point
    }

    currentX += (point.x - currentX) * responsiveness
    currentY += (point.y - currentY) * responsiveness

    return {
      ...point,
      x: Number(currentX.toFixed(4)),
      y: Number(currentY.toFixed(4)),
    }
  })
}

function resampleCursorSamples(points, sampleCount, smoothingEnabled = true, animationStyle = 'default') {
  if (points.length <= sampleCount) {
    return points
  }

  const durationSeconds = points[points.length - 1]?.timeSeconds ?? 0
  const resampled = []

  for (let index = 0; index < sampleCount; index += 1) {
    const timeSeconds = Number(((durationSeconds * index) / (sampleCount - 1)).toFixed(3))
    const point = getCursorPointAtTime(points, timeSeconds, smoothingEnabled, animationStyle)

    if (!point) {
      continue
    }

    resampled.push({
      ...point,
      timeSeconds,
    })
  }

  return resampled
}

function resolveCursorOverlayMaxSamples(durationSeconds, sampleCount) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return Math.max(48, Math.min(sampleCount, 180))
  }

  return Math.max(48, Math.min(sampleCount, Math.round(clampNumber(durationSeconds * 24, 144, 720))))
}

function collectProtectedCursorOverlaySampleIndices(points, protectedTimes = []) {
  if (!Array.isArray(points) || points.length <= 2) {
    return []
  }

  const protectedIndices = new Set()
  const preserveIndex = (index) => {
    if (Number.isInteger(index) && index > 0 && index < points.length - 1) {
      protectedIndices.add(index)
    }
  }

  for (const protectedTime of protectedTimes) {
    if (!Number.isFinite(protectedTime)) {
      continue
    }

    let closestIndex = 0
    let closestDelta = Number.POSITIVE_INFINITY

    for (let index = 0; index < points.length; index += 1) {
      const delta = Math.abs(points[index].timeSeconds - protectedTime)

      if (delta < closestDelta) {
        closestDelta = delta
        closestIndex = index
      }
    }

    preserveIndex(closestIndex - 1)
    preserveIndex(closestIndex)
    preserveIndex(closestIndex + 1)
  }

  // Preserve sharp trajectory changes so exported cursor motion stays readable after simplification.
  for (let index = 1; index < points.length - 1; index += 1) {
    const previousPoint = points[index - 1]
    const currentPoint = points[index]
    const nextPoint = points[index + 1]
    const incomingX = currentPoint.x - previousPoint.x
    const incomingY = currentPoint.y - previousPoint.y
    const outgoingX = nextPoint.x - currentPoint.x
    const outgoingY = nextPoint.y - currentPoint.y
    const incomingDistance = Math.hypot(incomingX, incomingY)
    const outgoingDistance = Math.hypot(outgoingX, outgoingY)

    if (incomingDistance < 1.25 || outgoingDistance < 1.25) {
      continue
    }

    const turnCosine = Math.max(
      -1,
      Math.min(1, (incomingX * outgoingX + incomingY * outgoingY) / (incomingDistance * outgoingDistance)),
    )
    const turnDegrees = Math.acos(turnCosine) * (180 / Math.PI)
    const speedDeltaRatio =
      Math.abs(outgoingDistance - incomingDistance) /
      Math.max(incomingDistance, outgoingDistance, 0.0001)

    if (turnDegrees >= 16 || speedDeltaRatio >= 0.48) {
      preserveIndex(index)
    }
  }

  return [...protectedIndices]
}

function simplifyCursorOverlaySamples(
  points,
  maxSamples = 48,
  initialTolerancePx = 1.1,
  smoothingEnabled = true,
  animationStyle = 'default',
  protectedIndices = [],
) {
  if (!Array.isArray(points) || points.length <= 2) {
    return Array.isArray(points) ? points : []
  }

  const normalizedProtectedIndices = [...new Set(
    protectedIndices.filter((index) => Number.isInteger(index) && index > 0 && index < points.length - 1),
  )]

  const runSimplification = (tolerancePx) => {
    const keep = new Set([0, points.length - 1, ...normalizedProtectedIndices])
    const stack = [[0, points.length - 1]]

    while (stack.length) {
      const [startIndex, endIndex] = stack.pop()
      const start = points[startIndex]
      const end = points[endIndex]
      const durationSeconds = end.timeSeconds - start.timeSeconds

      if (durationSeconds <= 0.0001 || endIndex - startIndex <= 1) {
        continue
      }

      let maxDeviation = 0
      let maxDeviationIndex = -1

      for (let index = startIndex + 1; index < endIndex; index += 1) {
        const point = points[index]
        const progress = (point.timeSeconds - start.timeSeconds) / durationSeconds
        const expectedX = start.x + (end.x - start.x) * progress
        const expectedY = start.y + (end.y - start.y) * progress
        const deviation = Math.max(
          Math.abs(point.x - expectedX),
          Math.abs(point.y - expectedY),
        )

        if (deviation > maxDeviation) {
          maxDeviation = deviation
          maxDeviationIndex = index
        }
      }

      if (maxDeviationIndex !== -1 && maxDeviation > tolerancePx) {
        keep.add(maxDeviationIndex)
        stack.push([startIndex, maxDeviationIndex], [maxDeviationIndex, endIndex])
      }
    }

    return [...keep]
      .sort((left, right) => left - right)
      .map((index) => points[index])
  }

  let tolerancePx = initialTolerancePx
  let simplified = runSimplification(tolerancePx)

  while (simplified.length > maxSamples && tolerancePx < 96) {
    tolerancePx *= 1.7
    simplified = runSimplification(tolerancePx)
  }

  if (simplified.length <= maxSamples) {
    return simplified
  }

  return resampleCursorSamples(simplified, maxSamples, smoothingEnabled, animationStyle)
}

function buildTimedValueExpression(points, getValue, timeVar = 't') {
  if (!points.length) {
    return '0'
  }

  if (points.length === 1) {
    return getValue(points[0]).toFixed(3)
  }

  const baseValue = getValue(points[0])
  const terms = [baseValue.toFixed(3)]

  for (let index = 0; index < points.length - 1; index += 1) {
    const currentPoint = points[index]
    const nextPoint = points[index + 1]
    const currentValue = getValue(currentPoint)
    const nextValue = getValue(nextPoint)
    const deltaValue = nextValue - currentValue
    const durationSeconds = nextPoint.timeSeconds - currentPoint.timeSeconds

    if (Math.abs(deltaValue) <= 0.0000005) {
      continue
    }

    if (durationSeconds <= 0.0001) {
      terms.push(
        `(gte(${timeVar}\\,${nextPoint.timeSeconds.toFixed(3)})*${deltaValue.toFixed(6)})`,
      )
      continue
    }

    terms.push(
      `(clip(((${timeVar}-${currentPoint.timeSeconds.toFixed(3)})/${durationSeconds.toFixed(6)})\\,0\\,1)*${deltaValue.toFixed(6)})`,
    )
  }

  return terms.join('+')
}

function getFitRectMetrics({ sourceWidth, sourceHeight, frameWidth, frameHeight, fitMode }) {
  const safeSourceWidth = Math.max(1, Number(sourceWidth) || 1)
  const safeSourceHeight = Math.max(1, Number(sourceHeight) || 1)
  const safeFrameWidth = Math.max(1, Number(frameWidth) || 1)
  const safeFrameHeight = Math.max(1, Number(frameHeight) || 1)
  const scale =
    fitMode === 'cover'
      ? Math.max(safeFrameWidth / safeSourceWidth, safeFrameHeight / safeSourceHeight)
      : Math.min(safeFrameWidth / safeSourceWidth, safeFrameHeight / safeSourceHeight)
  const width = safeSourceWidth * scale
  const height = safeSourceHeight * scale

  return {
    x: (safeFrameWidth - width) / 2,
    y: (safeFrameHeight - height) / 2,
    width,
    height,
  }
}

function buildTimeWindowEnableExpression(intervals, timeVar = 't') {
  if (!Array.isArray(intervals) || !intervals.length) {
    return '0'
  }

  return intervals
    .map((interval) => `between(${timeVar},${interval.startSeconds.toFixed(3)},${interval.endSeconds.toFixed(3)})`)
    .join('+')
}

async function rasterizeSvgDataUrlToPngBuffer(dataUrl, referenceWidth = 32, referenceHeight = 32) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/svg+xml')) {
    return null
  }

  const targetWidth = Math.min(1024, Math.max(256, Math.round(Math.max(1, referenceWidth) * 12)))
  const targetHeight = Math.min(1024, Math.max(256, Math.round(Math.max(1, referenceHeight) * 12)))
  const rasterWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  try {
    await rasterWindow.loadURL('data:text/html,<html><body style="margin:0;background:transparent"></body></html>')
    const pngBase64 = await rasterWindow.webContents.executeJavaScript(
      `(async () => {
        const dataUrl = ${JSON.stringify(dataUrl)}
        const targetWidth = ${targetWidth}
        const targetHeight = ${targetHeight}

        return await new Promise((resolve, reject) => {
          const image = new Image()
          image.decoding = 'async'
          image.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = targetWidth
            canvas.height = targetHeight
            const context = canvas.getContext('2d')

            if (!context) {
              reject(new Error('Cursor SVG rasterization canvas context unavailable.'))
              return
            }

            context.clearRect(0, 0, targetWidth, targetHeight)
            context.imageSmoothingEnabled = true
            context.imageSmoothingQuality = 'high'
            context.drawImage(image, 0, 0, targetWidth, targetHeight)
            const pngDataUrl = canvas.toDataURL('image/png')
            resolve(pngDataUrl.split(',')[1] || '')
          }
          image.onerror = () => reject(new Error('Cursor SVG rasterization image decode failed.'))
          image.src = dataUrl
        })
      })()`,
      true,
    )

    if (!pngBase64) {
      return null
    }

    return Buffer.from(pngBase64, 'base64')
  } catch (error) {
    console.warn('Cursor SVG rasterization failed', error)
    return null
  } finally {
    if (!rasterWindow.isDestroyed()) {
      rasterWindow.destroy()
    }
  }
}

async function ensureCursorOverlayAssetFiles(appearances) {
  if (!Array.isArray(appearances) || !appearances.length) {
    return new Map()
  }

  const assetRoot = path.join(getPaths().forkUserData, 'cursor-overlay-assets')
  await mkdir(assetRoot, { recursive: true })
  const assetEntries = []

  for (const asset of appearances) {
    const normalizedAsset = normalizeCursorAppearanceAsset(asset)

    if (!normalizedAsset?.imageDataUrl) {
      continue
    }

    let image = nativeImage.createFromDataURL(normalizedAsset.imageDataUrl)
    let imageBuffer = image.isEmpty() ? null : image.toPNG()

    if (image.isEmpty() && normalizedAsset.imageDataUrl.startsWith('data:image/svg+xml')) {
      const rasterizedBuffer = await rasterizeSvgDataUrlToPngBuffer(
        normalizedAsset.imageDataUrl,
        normalizedAsset.referenceWidth,
        normalizedAsset.referenceHeight,
      )

      if (rasterizedBuffer) {
        image = nativeImage.createFromBuffer(rasterizedBuffer)

        if (!image.isEmpty()) {
          imageBuffer = rasterizedBuffer
        }
      }
    }

    if (image.isEmpty() || !imageBuffer) {
      continue
    }

    const size = image.getSize()
    const fileName = `${sanitizeBaseName(normalizedAsset.id, `cursor-${normalizedAsset.cursorKind}`)}.png`
    const filePath = path.join(assetRoot, fileName)
    await writeFile(filePath, imageBuffer)

    assetEntries.push([
      normalizedAsset.id,
      {
        ...normalizedAsset,
        filePath,
        width: Math.max(1, size.width || 1),
        height: Math.max(1, size.height || 1),
      },
    ])
  }

  return new Map(assetEntries)
}

async function ensureCursorClickEffectAssetFile() {
  const assetRoot = path.join(getPaths().forkUserData, 'cursor-overlay-assets')
  await mkdir(assetRoot, { recursive: true })
  const filePath = path.join(assetRoot, 'cursor-click-liquid-glass.png')

  if (!existsSync(filePath)) {
    const imageBuffer =
      await rasterizeSvgDataUrlToPngBuffer(
        LIQUID_GLASS_CURSOR_CLICK_EFFECT_DATA_URL,
        CURSOR_CLICK_EFFECT_REFERENCE_SIZE,
        CURSOR_CLICK_EFFECT_REFERENCE_SIZE,
      )

    if (!imageBuffer) {
      return null
    }

    await writeFile(filePath, imageBuffer)
  }

  return {
    id: 'cursor-click-liquid-glass',
    filePath,
    width: CURSOR_CLICK_EFFECT_REFERENCE_SIZE,
    height: CURSOR_CLICK_EFFECT_REFERENCE_SIZE,
  }
}

function inferCursorPulseEvents(points) {
  return inferCursorPulseEventsShared(points)
}

function getCursorPulseEventsForTrack(cursorTrack) {
  return getCursorPulseEventsForTrackShared(cursorTrack)
}

async function prepareCursorClickOverlayPlan({
  cursorTrack,
  cursorSettings,
  trimStartSeconds = 0,
  durationSeconds,
  sourceWidth,
  sourceHeight,
  planeWidth,
  planeHeight,
  fitMode,
}) {
  if (
    !cursorTrack?.points?.length ||
    durationSeconds < 0.05 ||
    cursorSettings?.showCursor === false ||
    cursorSettings?.clickEffect === 'none'
  ) {
    return null
  }

  const clickEffectAsset = await ensureCursorClickEffectAssetFile()

  if (!clickEffectAsset?.filePath) {
    return null
  }

  const fitRect = getFitRectMetrics({
    sourceWidth,
    sourceHeight,
    frameWidth: planeWidth,
    frameHeight: planeHeight,
    fitMode,
  })
  const coordinateSpaceWidth =
    Number(cursorTrack?.coordinateSpace?.width) > 0
      ? Number(cursorTrack.coordinateSpace.width)
      : sourceWidth
  const coordinateSpaceHeight =
    Number(cursorTrack?.coordinateSpace?.height) > 0
      ? Number(cursorTrack.coordinateSpace.height)
      : sourceHeight
  const { scale: pointerScale } = resolveCursorScaleMetrics({
    baseScale: cursorSettings?.size ?? 1,
    frameWidth: fitRect.width,
    frameHeight: fitRect.height,
    coordinateSpaceWidth,
    coordinateSpaceHeight,
  })
  const events = getCursorPulseEventsForTrack(cursorTrack)
    .map((event) => {
      const startSeconds = Number((Number(event.timeSeconds) - trimStartSeconds).toFixed(3))
      const endSeconds = Number((startSeconds + CURSOR_CLICK_EFFECT_DURATION_SECONDS).toFixed(3))

      if (endSeconds <= 0 || startSeconds >= durationSeconds) {
        return null
      }

      const strength = clampCursorClickEffectStrength(event.strength)
      const startSize = Math.max(22, getCursorClickEffectSize(pointerScale, strength, 0))
      const endSize = Math.max(startSize + 1, getCursorClickEffectSize(pointerScale, strength, 1))
      const fadeOutStartSeconds = getCursorClickEffectFadeOutStartSeconds(startSeconds)
      const fadeOutDurationSeconds = getCursorClickEffectFadeOutDurationSeconds()

      return {
        id: event.id,
        startSeconds,
        endSeconds,
        centerX: Number((fitRect.x + clampUnit(event.x) * fitRect.width).toFixed(3)),
        centerY: Number((fitRect.y + clampUnit(event.y) * fitRect.height).toFixed(3)),
        startSize: Number(startSize.toFixed(3)),
        endSize: Number(endSize.toFixed(3)),
        fadeOutStartSeconds,
        fadeOutDurationSeconds,
      }
    })
    .filter(Boolean)

  if (!events.length) {
    return null
  }

  return {
    asset: clickEffectAsset,
    events,
  }
}

async function prepareCursorOverlayPlan({
  cursorTrack,
  cursorSettings,
  trimStartSeconds = 0,
  durationSeconds,
  sourceWidth,
  sourceHeight,
  planeWidth,
  planeHeight,
  fitMode,
}) {
  if (!cursorTrack?.points?.length || durationSeconds < 0.05) {
    return null
  }

  const sampledPoints = sampleCursorTrackRange(
    cursorTrack,
    trimStartSeconds,
    trimStartSeconds + durationSeconds,
  ).map((point) => ({
    ...point,
    ...normalizeCursorVisualState(point),
  }))

  if (!sampledPoints.length) {
    return null
  }

  const assetFiles = await ensureCursorOverlayAssetFiles(cursorTrack.appearances ?? [])

  if (!assetFiles.size) {
    return null
  }

  const fitRect = getFitRectMetrics({
    sourceWidth,
    sourceHeight,
    frameWidth: planeWidth,
    frameHeight: planeHeight,
    fitMode,
  })
  const coordinateSpaceWidth =
    Number(cursorTrack?.coordinateSpace?.width) > 0
      ? Number(cursorTrack.coordinateSpace.width)
      : sourceWidth
  const coordinateSpaceHeight =
    Number(cursorTrack?.coordinateSpace?.height) > 0
      ? Number(cursorTrack.coordinateSpace.height)
      : sourceHeight
  const { scaleX: cursorScaleX, scaleY: cursorScaleY } = resolveCursorScaleMetrics({
    baseScale: cursorSettings?.size ?? 1,
    frameWidth: fitRect.width,
    frameHeight: fitRect.height,
    coordinateSpaceWidth,
    coordinateSpaceHeight,
  })
  const overlayGroups = new Map()
  let activeAssetId = ''
  let activeIntervalStart = null
  const cursorClickTimes = Array.isArray(cursorTrack?.clicks)
    ? cursorTrack.clicks
        .filter(
          (click) =>
            Number.isFinite(click?.timeSeconds) &&
            click.timeSeconds >= trimStartSeconds &&
            click.timeSeconds <= trimStartSeconds + durationSeconds,
        )
        .map((click) => Number((click.timeSeconds - trimStartSeconds).toFixed(3)))
    : []

  const resolveOverlayAsset = (point) => {
    if (cursorSettings?.alwaysPointer) {
      return [...assetFiles.values()].find((asset) => asset.cursorKind === 'arrow') ?? null
    }

    const directAsset = assetFiles.get(normalizeCursorAppearanceId(point?.cursorAppearanceId))

    if (directAsset) {
      return directAsset
    }

    const normalizedKind = normalizeCursorVisualKind(point?.cursorKind)
    return [...assetFiles.values()].find((asset) => asset.cursorKind === normalizedKind) ?? null
  }

  const pushInterval = (assetId, startSeconds, endSeconds) => {
    if (!assetId || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      return
    }

    const group = overlayGroups.get(assetId)

    if (!group) {
      return
    }

    const normalizedStart = Math.max(0, Number(startSeconds.toFixed(3)))
    const normalizedEnd = Math.min(durationSeconds, Number(Math.max(endSeconds, startSeconds + 0.001).toFixed(3)))

    if (normalizedEnd <= normalizedStart) {
      return
    }

    const previousInterval = group.intervals[group.intervals.length - 1]

    if (previousInterval && normalizedStart - previousInterval.endSeconds <= 0.017) {
      previousInterval.endSeconds = normalizedEnd
      return
    }

    group.intervals.push({
      startSeconds: normalizedStart,
      endSeconds: normalizedEnd,
    })
  }

  sampledPoints.forEach((point, index) => {
    const asset = resolveOverlayAsset(point)
    const assetId = asset?.id ?? ''

    if (asset && !overlayGroups.has(asset.id)) {
      overlayGroups.set(asset.id, {
        asset,
        samples: [],
        intervals: [],
      })
    }

    if (assetId !== activeAssetId) {
      if (activeAssetId && activeIntervalStart !== null) {
        pushInterval(activeAssetId, activeIntervalStart, point.timeSeconds)
      }

      activeAssetId = assetId
      activeIntervalStart = assetId ? point.timeSeconds : null
    }

    if (asset) {
      const hotspotRatioX =
        normalizeCursorAppearanceId(point.cursorAppearanceId) === asset.id
          ? point.cursorHotspotRatioX
          : asset.hotspotRatioX
      const hotspotRatioY =
        normalizeCursorAppearanceId(point.cursorAppearanceId) === asset.id
          ? point.cursorHotspotRatioY
          : asset.hotspotRatioY
      const renderAssetWidth = Math.max(1, Number(asset.referenceWidth) || asset.width)
      const renderAssetHeight = Math.max(1, Number(asset.referenceHeight) || asset.height)
      const scaledAssetWidth = Math.max(1, renderAssetWidth * cursorScaleX)
      const scaledAssetHeight = Math.max(1, renderAssetHeight * cursorScaleY)

      overlayGroups.get(asset.id).samples.push({
        timeSeconds: Number(point.timeSeconds.toFixed(3)),
        x: Number((fitRect.x + point.x * fitRect.width - hotspotRatioX * scaledAssetWidth).toFixed(3)),
        y: Number((fitRect.y + point.y * fitRect.height - hotspotRatioY * scaledAssetHeight).toFixed(3)),
      })
    }

    if (index === sampledPoints.length - 1 && activeAssetId && activeIntervalStart !== null) {
      pushInterval(activeAssetId, activeIntervalStart, point.timeSeconds)
    }
  })

  const overlays = [...overlayGroups.values()]
    .map((group) => {
      if (!group.samples.length || !group.intervals.length) {
        return null
      }

      const protectedSampleIndices = collectProtectedCursorOverlaySampleIndices(
        group.samples,
        [
          ...group.intervals.flatMap((interval) => [interval.startSeconds, interval.endSeconds]),
          ...cursorClickTimes.filter((timeSeconds) =>
            group.intervals.some(
              (interval) => timeSeconds >= interval.startSeconds - 0.001 && timeSeconds <= interval.endSeconds + 0.001,
            ),
          ),
        ],
      )
      const simplifiedSamples = simplifyCursorOverlaySamples(
        group.samples,
        resolveCursorOverlayMaxSamples(durationSeconds, group.samples.length),
        0.85,
        cursorSettings?.smoothingEnabled !== false,
        cursorSettings?.animationStyle ?? 'default',
        protectedSampleIndices,
      )

      return {
        assetId: group.asset.id,
        xExpression: `clip(${buildTimedValueExpression(simplifiedSamples, (point) => point.x)}\\,-w\\,main_w)`,
        yExpression: `clip(${buildTimedValueExpression(simplifiedSamples, (point) => point.y)}\\,-h\\,main_h)`,
        enableExpression: buildTimeWindowEnableExpression(group.intervals),
      }
    })
    .filter(Boolean)

  if (!overlays.length) {
    return null
  }

  return {
    assets: [...overlayGroups.values()].map((group) => ({
      id: group.asset.id,
      filePath: group.asset.filePath,
      width: Math.max(
        1,
        Math.round((Number(group.asset.referenceWidth) || group.asset.width) * cursorScaleX),
      ),
      height: Math.max(
        1,
        Math.round((Number(group.asset.referenceHeight) || group.asset.height) * cursorScaleY),
      ),
    })),
    overlays,
  }
}

function buildCursorOverlayFilterChain({
  assets,
  overlays,
  assetInputIndexById,
  startLabel,
  labelPrefix = 'cursor',
}) {
  if (!Array.isArray(overlays) || !overlays.length) {
    return {
      filterParts: [],
      outputLabel: startLabel,
    }
  }

  const filterParts = []
  let currentLabel = startLabel
  const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset]))
  const scaledAssetLabelById = new Map()

  overlays.forEach((overlay, index) => {
    const inputIndex = assetInputIndexById.get(overlay.assetId)

    if (inputIndex === undefined) {
      return
    }

    let assetLabel = scaledAssetLabelById.get(overlay.assetId)

    if (!assetLabel) {
      const asset = assetById.get(overlay.assetId)

      if (asset?.width && asset?.height) {
        assetLabel = `[${labelPrefix}_asset_${scaledAssetLabelById.size}]`
        filterParts.push(
          `[${inputIndex}:v]scale=w=${asset.width}:h=${asset.height}:flags=lanczos${assetLabel}`,
        )
      } else {
        assetLabel = `[${inputIndex}:v]`
      }

      scaledAssetLabelById.set(overlay.assetId, assetLabel)
    }

    const nextLabel = `[${labelPrefix}_${index}]`
    filterParts.push(
      `${currentLabel}${assetLabel}overlay=x='${overlay.xExpression}':y='${overlay.yExpression}':enable='${overlay.enableExpression}':format=auto${nextLabel}`,
    )
    currentLabel = nextLabel
  })

  return {
    filterParts,
    outputLabel: currentLabel,
  }
}

function buildCursorClickOverlayFilterChain({
  assetInputIndex,
  events,
  startLabel,
  labelPrefix = 'cursorclick',
  targetFps = 60,
}) {
  if (!Array.isArray(events) || !events.length || assetInputIndex === null || assetInputIndex === undefined) {
    return {
      filterParts: [],
      outputLabel: startLabel,
    }
  }

  const safeTargetFps = Math.max(12, Math.round(Number(targetFps) || 60))
  const filterParts = []
  let currentLabel = startLabel
  const splitLabels = events.map((_, index) => `[${labelPrefix}_src_${index}]`)

  if (events.length === 1) {
    filterParts.push(`[${assetInputIndex}:v]format=rgba${splitLabels[0]}`)
  } else {
    filterParts.push(`[${assetInputIndex}:v]format=rgba,split=${events.length}${splitLabels.join('')}`)
  }

  events.forEach((event, index) => {
    const progressExpression = `clip(((t-${event.startSeconds.toFixed(3)})/${CURSOR_CLICK_EFFECT_DURATION_SECONDS.toFixed(6)})\\,0\\,1)`
    const easedProgressExpression = `(1-pow(1-${progressExpression}\\,3))`
    const sizeExpression = `(${event.startSize.toFixed(3)}+((${(event.endSize - event.startSize).toFixed(3)})*${easedProgressExpression}))`
    const ptsOffsetExpression =
      event.startSeconds >= 0
        ? `+${event.startSeconds.toFixed(3)}/TB`
        : `${event.startSeconds.toFixed(3)}/TB`
    const effectLabel = `[${labelPrefix}_effect_${index}]`
    const nextLabel = `[${labelPrefix}_${index}]`

    filterParts.push(
      `${splitLabels[index]}trim=duration=${CURSOR_CLICK_EFFECT_DURATION_SECONDS.toFixed(3)},fps=${safeTargetFps},setpts=PTS-STARTPTS${ptsOffsetExpression},scale=w='${sizeExpression}':h='${sizeExpression}':flags=lanczos:eval=frame,fade=t=in:st=${event.startSeconds.toFixed(3)}:d=${CURSOR_CLICK_EFFECT_FADE_IN_SECONDS.toFixed(3)}:alpha=1,fade=t=out:st=${event.fadeOutStartSeconds.toFixed(3)}:d=${event.fadeOutDurationSeconds.toFixed(3)}:alpha=1${effectLabel}`,
    )
    filterParts.push(
      `${currentLabel}${effectLabel}overlay=x='${event.centerX.toFixed(3)}-w/2':y='${event.centerY.toFixed(3)}-h/2':eof_action=pass:repeatlast=0:format=auto${nextLabel}`,
    )
    currentLabel = nextLabel
  })

  return {
    filterParts,
    outputLabel: currentLabel,
  }
}

function lerpNumber(left, right, progress) {
  return left + (right - left) * progress
}

const FOCUS_MOTION_EASINGS = SHARED_FOCUS_MOTION_EASINGS
const AUTO_FOCUS_APPROACH_LOOKBACK_SECONDS = 0.36

function shouldSettleFocusRegionAtStart(region) {
  return shouldSettleFocusRegionAtStartShared(region)
}

function isAutomaticFocusRegion(region) {
  return isAutomaticFocusRegionShared(region)
}

function shouldClusterAutomaticFocusRegions(previousRegion, nextRegion) {
  return shouldClusterAutomaticFocusRegionsShared(previousRegion, nextRegion)
}

function coalesceAutomaticFocusRegions(regions) {
  return coalesceAutomaticFocusRegionsShared(regions)
}

function getFocusRegionSettleLeadSeconds(region, enterDurationSeconds, cursorTrack = null) {
  return getFocusRegionSettleLeadSecondsShared(region, enterDurationSeconds, {
    cursorTrack,
    getCursorApproachMetrics,
  })
}

function getCursorApproachMetrics(points, targetTimeSeconds) {
  return getCursorApproachMetricsShared(points, targetTimeSeconds, {
    lookbackSeconds: AUTO_FOCUS_APPROACH_LOOKBACK_SECONDS,
    sampleRange: (cursorPoints, startSeconds, endSeconds) =>
      sampleCursorTrackRange({ points: cursorPoints }, startSeconds, endSeconds),
  })
}

function getFocusRegionCueStartSeconds(from, region, durationSeconds, cursorTrack = null) {
  return getFocusRegionCueStartSecondsShared(from, region, durationSeconds, {
    cursorTrack,
    getCursorApproachMetrics,
  })
}

function findMatchingAutoFocusClick(region, cursorTrack) {
  return findMatchingAutoFocusClickShared(region, cursorTrack)
}

function getAutoFocusRegionClickAnchorSeconds(region, cursorTrack, durationSeconds) {
  return getAutoFocusRegionClickAnchorSecondsShared(region, cursorTrack, durationSeconds)
}

function getAutoFocusPostClickHoldSeconds(region, clickAnchorSeconds) {
  return getAutoFocusPostClickHoldSecondsShared(region, clickAnchorSeconds)
}

function buildFocusMotionSegments(
  focusRegions,
  durationSeconds,
  idleFocusX = 0.5,
  idleFocusY = 0.5,
  cursorTrack = null,
) {
  return buildFocusMotionSegmentsShared(focusRegions, durationSeconds, {
    idleFocusX,
    idleFocusY,
    cursorTrack,
    getCursorApproachMetrics,
  })
}

function buildFocusMotionBaseExpression(progressExpression, baseCurve) {
  if (baseCurve === 'smootherStep') {
    return `((6*pow(${progressExpression}\\,5))-(15*pow(${progressExpression}\\,4))+(10*pow(${progressExpression}\\,3)))`
  }

  if (baseCurve === 'easeOutCubic') {
    return `(1-pow((1-${progressExpression})\\,3))`
  }

  if (baseCurve === 'easeInOutCubic') {
    return `if(lt(${progressExpression}\\,0.5)\\,(4*pow(${progressExpression}\\,3))\\,(1-(pow((-2*${progressExpression}+2)\\,3)/2)))`
  }

  return progressExpression
}

function buildCriticallyDampedSpringExpression(progressExpression, response) {
  const normalizationFactor = 1 - Math.exp(-response) * (1 + response)
  const responseText = response.toFixed(6)
  return `((1-(exp((-${responseText}*${progressExpression}))*(1+(${responseText}*${progressExpression}))))/${normalizationFactor.toFixed(6)})`
}

function buildFocusSegmentProgressExpression(startSeconds, endSeconds, easingId, timeVar = 'ot') {
  const durationSeconds = endSeconds - startSeconds

  if (durationSeconds <= 0.0001) {
    return '1'
  }

  const rawProgress = `clip(((${timeVar}-${startSeconds.toFixed(3)})/${durationSeconds.toFixed(6)})\\,0\\,1)`
  const easing = FOCUS_MOTION_EASINGS[easingId] ?? FOCUS_MOTION_EASINGS.linear
  const ledProgress =
    easing.leadFactor === 1 ? rawProgress : `min(1\\,(${rawProgress}*${easing.leadFactor.toFixed(3)}))`
  const baseExpression = buildFocusMotionBaseExpression(ledProgress, easing.baseCurve)

  if (!easing.springResponse || easing.springWeight <= 0.001) {
    return baseExpression
  }

  const baseWeight = (1 - easing.springWeight).toFixed(6)
  const springWeight = easing.springWeight.toFixed(6)
  const springExpression = buildCriticallyDampedSpringExpression(ledProgress, easing.springResponse)
  return `((${baseExpression}*${baseWeight})+(${springExpression}*${springWeight}))`
}

function buildFocusSegmentValueExpression(segments, valueKey, easingKey, timeVar = 'ot') {
  if (!segments.length) {
    return '0'
  }

  const baseValue = segments[0].from[valueKey]
  const terms = [baseValue.toFixed(3)]

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const deltaValue = segment.to[valueKey] - segment.from[valueKey]

    if (Math.abs(deltaValue) <= 0.0001) {
      continue
    }

    terms.push(
      `(${deltaValue.toFixed(6)}*${buildFocusSegmentProgressExpression(
        segment.startSeconds,
        segment.endSeconds,
        segment[easingKey],
        timeVar,
      )})`,
    )
  }

  return terms.join('+')
}

function buildDynamicZoomPanFilter({
  width,
  height,
  outputWidth = width,
  outputHeight = height,
  sourceFps = 60,
  zoomExpression,
  focusXExpression,
  focusYExpression,
}) {
  const safeWidth = toEvenNumber(outputWidth, 1920)
  const safeHeight = toEvenNumber(outputHeight, 1080)
  const safeFps = Math.max(1, Math.round(Number.isFinite(sourceFps) ? sourceFps : 60))
  // Match the renderer preview transform:
  // translate((0.5 - focus) * (zoom - 1) * 100%) scale(zoom)
  // In source-space, that means the visible window starts at focus * (1 - 1 / zoom).
  const cropXExpression = `clip(((${focusXExpression})*iw*(1-1/zoom))\\,0\\,(iw-iw/zoom))`
  const cropYExpression = `clip(((${focusYExpression})*ih*(1-1/zoom))\\,0\\,(ih-ih/zoom))`

  return `zoompan=z='${zoomExpression}':x='${cropXExpression}':y='${cropYExpression}':d=1:s=${safeWidth}x${safeHeight}:fps=${safeFps}`
}

function buildFixedZoomCropFilter({
  width,
  height,
  outputWidth = width,
  outputHeight = height,
  scaledWidth,
  scaledHeight,
  cropXExpression,
  cropYExpression,
}) {
  const safeWidth = toEvenNumber(outputWidth, 1920)
  const safeHeight = toEvenNumber(outputHeight, 1080)
  const safeScaledWidth = toEvenNumber(Math.max(safeWidth, scaledWidth), safeWidth)
  const safeScaledHeight = toEvenNumber(Math.max(safeHeight, scaledHeight), safeHeight)
  const clampedCropXExpression = `clip(${cropXExpression}\\,0\\,(iw-ow))`
  const clampedCropYExpression = `clip(${cropYExpression}\\,0\\,(ih-oh))`

  return [
    `scale=${safeScaledWidth}:${safeScaledHeight}:flags=lanczos`,
    `crop=${safeWidth}:${safeHeight}:'${clampedCropXExpression}':'${clampedCropYExpression}'`,
  ].join(',')
}

function buildFocusRegionMotionFilter({
  width,
  height,
  outputWidth = width,
  outputHeight = height,
  sourceFps = 60,
  durationSeconds,
  cursorTrack,
  focusRegions,
  trimStartSeconds = 0,
  idleFocusX = 0.5,
  idleFocusY = 0.5,
}) {
  if (!Array.isArray(focusRegions) || !focusRegions.length || durationSeconds < 0.2) {
    return ''
  }

  const relevantRegions = focusRegions
    .map((region) => ({
      startSeconds: clampNumber(region.startSeconds - trimStartSeconds, 0, durationSeconds),
      endSeconds: clampNumber(region.endSeconds - trimStartSeconds, 0, durationSeconds),
      focusX: clampUnit(region.focusX),
      focusY: clampUnit(region.focusY),
      zoom: clampNumber(region.zoom, 1.05, 4),
      label: region.label,
      settleAtStart: shouldSettleFocusRegionAtStart(region),
      settleLeadSeconds: Number.isFinite(region?.settleLeadSeconds)
        ? Number(region.settleLeadSeconds)
        : undefined,
    }))
    .filter((region) => region.endSeconds - region.startSeconds >= 0.08)

  if (!relevantRegions.length) {
    return ''
  }

  const trimmedCursorPoints = cursorTrack?.points?.length
    ? sampleCursorTrackRange(cursorTrack, trimStartSeconds, trimStartSeconds + durationSeconds)
    : []
  const motionSegments = buildFocusMotionSegments(
    relevantRegions,
    durationSeconds,
    idleFocusX,
    idleFocusY,
    trimmedCursorPoints.length
      ? {
          ...cursorTrack,
          points: trimmedCursorPoints,
        }
      : null,
  )
  const zoomExpression = buildFocusSegmentValueExpression(motionSegments, 'zoom', 'zoomEasing', 'ot')
  const focusXExpression = buildFocusSegmentValueExpression(motionSegments, 'focusX', 'focusEasing', 'ot')
  const focusYExpression = buildFocusSegmentValueExpression(motionSegments, 'focusY', 'focusEasing', 'ot')

  return buildDynamicZoomPanFilter({
    width,
    height,
    outputWidth,
    outputHeight,
    sourceFps,
    zoomExpression,
    focusXExpression,
    focusYExpression,
  })
}

function buildTrackedMotionFilter({
  width,
  height,
  outputWidth = width,
  outputHeight = height,
  durationSeconds,
  motionPresetId,
  cursorTrack,
  trimStartSeconds = 0,
}) {
  if (!cursorTrack?.points?.length || durationSeconds < 0.2) {
    return ''
  }

  const configs = {
    'precision-pan': {
      zoom: 1.12,
      responsiveness: 0.26,
      sampleCount: 14,
    },
    'spotlight-float': {
      zoom: 1.18,
      responsiveness: 0.19,
      sampleCount: 12,
    },
    'snap-follow': {
      zoom: 1.24,
      responsiveness: 0.46,
      sampleCount: 18,
    },
  }
  const config = configs[motionPresetId]

  if (!config) {
    return ''
  }

  const sampledPoints = sampleCursorTrackRange(
    cursorTrack,
    trimStartSeconds,
    trimStartSeconds + durationSeconds,
  )

  if (sampledPoints.length < 2) {
    return ''
  }

  const smoothedPoints = resampleCursorSamples(
    smoothCursorSamples(sampledPoints, config.responsiveness),
    config.sampleCount,
  )
  const safeWidth = toEvenNumber(width, 1920)
  const safeHeight = toEvenNumber(height, 1080)
  const scaledWidth = toEvenNumber(safeWidth * config.zoom, safeWidth)
  const scaledHeight = toEvenNumber(safeHeight * config.zoom, safeHeight)
  const travelX = Math.max(0, scaledWidth - safeWidth)
  const travelY = Math.max(0, scaledHeight - safeHeight)
  const cropPoints = smoothedPoints.map((point) => ({
    ...point,
    cropX: travelX
      ? Number(
          Math.min(
            travelX,
            Math.max(0, point.x * scaledWidth - safeWidth / 2),
          ).toFixed(3),
        )
      : 0,
    cropY: travelY
      ? Number(
          Math.min(
            travelY,
            Math.max(0, point.y * scaledHeight - safeHeight / 2),
          ).toFixed(3),
        )
      : 0,
  }))
  const xExpression = travelX ? buildTimedValueExpression(cropPoints, (point) => point.cropX) : '0'
  const yExpression = travelY ? buildTimedValueExpression(cropPoints, (point) => point.cropY) : '0'

  return buildFixedZoomCropFilter({
    width,
    height,
    outputWidth,
    outputHeight,
    scaledWidth,
    scaledHeight,
    cropXExpression: xExpression,
    cropYExpression: yExpression,
  })
}

function buildMotionFilter({
  width,
  height,
  outputWidth = width,
  outputHeight = height,
  sourceFps = 60,
  durationSeconds,
  motionPresetId,
  cursorTrack,
  focusRegions,
  trimStartSeconds = 0,
  idleFocusX = 0.5,
  idleFocusY = 0.5,
}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 180) {
    return ''
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.2) {
    return ''
  }

  const focusRegionFilter = buildFocusRegionMotionFilter({
    width,
    height,
    outputWidth,
    outputHeight,
    sourceFps,
    durationSeconds,
    cursorTrack,
    focusRegions,
    trimStartSeconds,
    idleFocusX,
    idleFocusY,
  })

  if (focusRegionFilter) {
    return focusRegionFilter
  }

  const configs = {
    'precision-pan': {
      zoom: 1.08,
      xAmplitude: 0.22,
      yAmplitude: 0.08,
      xFrequency: 0.55,
      yFrequency: 0.35,
    },
    'spotlight-float': {
      zoom: 1.14,
      xAmplitude: 0.12,
      yAmplitude: 0.16,
      xFrequency: 0.42,
      yFrequency: 0.58,
    },
    'snap-follow': {
      zoom: 1.18,
      xAmplitude: 0.32,
      yAmplitude: 0.12,
      xFrequency: 1.15,
      yFrequency: 0.82,
    },
  }
  const config = configs[motionPresetId]

  if (!config) {
    return ''
  }

  const trackedFilter = buildTrackedMotionFilter({
    width,
    height,
    outputWidth,
    outputHeight,
    durationSeconds,
    motionPresetId,
    cursorTrack,
    trimStartSeconds,
  })

  if (trackedFilter) {
    return trackedFilter
  }

  const safeWidth = toEvenNumber(width, 1920)
  const safeHeight = toEvenNumber(height, 1080)
  const scaledWidth = toEvenNumber(safeWidth * config.zoom, safeWidth)
  const scaledHeight = toEvenNumber(safeHeight * config.zoom, safeHeight)
  const travelX = Math.max(0, scaledWidth - safeWidth)
  const travelY = Math.max(0, scaledHeight - safeHeight)
  const centerX = travelX / 2
  const centerY = travelY / 2
  const xAmplitude = travelX * config.xAmplitude
  const yAmplitude = travelY * config.yAmplitude
  const xExpression =
    travelX > 0
      ? `'${centerX.toFixed(3)}+(${xAmplitude.toFixed(3)}*sin(t*${config.xFrequency.toFixed(3)}))'`
      : '0'
  const yExpression =
    travelY > 0
      ? `'${centerY.toFixed(3)}+(${yAmplitude.toFixed(3)}*cos(t*${config.yFrequency.toFixed(3)}))'`
      : '0'

  return buildFixedZoomCropFilter({
    width,
    height,
    outputWidth,
    outputHeight,
    scaledWidth,
    scaledHeight,
    cropXExpression: xExpression,
    cropYExpression: yExpression,
  })
}


function resolveMotionRenderMode({
  width,
  height,
  durationSeconds,
  motionPresetId,
  cursorTrack,
  focusRegions,
  trimStartSeconds = 0,
}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 180) {
    return 'none'
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.2) {
    return 'none'
  }

  if (
    buildFocusRegionMotionFilter({
      width,
      height,
      durationSeconds,
      focusRegions,
      trimStartSeconds,
    })
  ) {
    return 'focus'
  }

  if (
    buildTrackedMotionFilter({
      width,
      height,
      durationSeconds,
      motionPresetId,
      cursorTrack,
      trimStartSeconds,
    })
  ) {
    return 'tracked'
  }

  return motionPresetId ? 'preset' : 'none'
}

function hasBackgroundFrameTreatment(background) {
  return (
    clampNumber(background?.padding ?? 0, 0, 0.22) > 0.001 ||
    clampNumber(background?.radius ?? 0, 0, 0.18) > 0.001 ||
    clampNumber(background?.shadow ?? 0, 0, 0.9) > 0.001
  )
}

function getOutputTarget(output, sourceWidth, sourceHeight) {
  const preset = outputAspectPresets[output?.aspectPreset] ?? null

  if (!preset) {
    return {
      width: toEvenNumber(sourceWidth || 1920, 1920),
      height: toEvenNumber(sourceHeight || 1080, 1080),
    }
  }

  return {
    width: preset.width,
    height: preset.height,
  }
}

function clampNumber(value, min, max) {
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : min
  return Math.min(max, Math.max(min, numericValue))
}

function normalizeHexColor(value, fallback = '0f1319') {
  const normalized = String(value || fallback).replace('#', '')
  const safeHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : normalized.padEnd(6, '0').slice(0, 6)

  return safeHex.toLowerCase()
}

function hexToRgbChannels(value) {
  const safeHex = normalizeHexColor(value)
  return [
    Number.parseInt(safeHex.slice(0, 2), 16),
    Number.parseInt(safeHex.slice(2, 4), 16),
    Number.parseInt(safeHex.slice(4, 6), 16),
  ]
}

function toFfmpegColor(value) {
  return `0x${normalizeHexColor(value)}`
}

function toFfmpegColorWithAlpha(value, alpha) {
  return `${toFfmpegColor(value)}@${clampNumber(alpha, 0, 1).toFixed(3)}`
}

function getShortcutOverlayFontPath() {
  const candidates = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'segoeui.ttf'),
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'arial.ttf'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? ''
}

function formatShortcutToken(token, showSymbols) {
  const normalized = String(token || '').trim().toLowerCase()

  if (!normalized) {
    return ''
  }

  const symbolMap = {
    ctrl: '⌃',
    shift: '⇧',
    alt: '⌥',
    meta: '⊞',
    enter: '↵',
    tab: '⇥',
    backspace: '⌫',
    delete: '⌦',
    esc: '⎋',
    space: '␣',
    left: '←',
    right: '→',
    up: '↑',
    down: '↓',
  }

  const textMap = {
    ctrl: 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    meta: 'Win',
    enter: 'Enter',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    esc: 'Esc',
    space: 'Space',
    left: 'Left',
    right: 'Right',
    up: 'Up',
    down: 'Down',
    pageup: 'Page Up',
    pagedown: 'Page Down',
    home: 'Home',
    end: 'End',
    insert: 'Insert',
  }

  if (showSymbols && symbolMap[normalized]) {
    return symbolMap[normalized]
  }

  if (normalized.startsWith('f') && Number.isFinite(Number(normalized.slice(1)))) {
    return normalized.toUpperCase()
  }

  if (normalized.length === 1) {
    return normalized.toUpperCase()
  }

  return textMap[normalized] ?? normalized.replace(/(^|-)([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
}

function formatShortcutLabel(keys, showSymbols) {
  const parts = Array.isArray(keys)
    ? keys.map((key) => formatShortcutToken(key, showSymbols)).filter(Boolean)
    : []

  return showSymbols ? parts.join(' ') : parts.join(' + ')
}

function escapeDrawtextValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '\\%')
}

function buildKeyboardShortcutOverlayFilter({
  ffmpeg,
  shortcuts,
  shortcutSettings,
  trimStartSeconds,
  durationSeconds,
  aspectPreset,
  sourceWidth,
  sourceHeight,
}) {
  if (
    !ffmpeg?.supportedFilters?.includes('drawtext') ||
    !shortcutSettings?.enabled ||
    !Array.isArray(shortcuts) ||
    !shortcuts.length
  ) {
    return ''
  }

  const target = getOutputTarget({ aspectPreset }, sourceWidth, sourceHeight)
  const fontPath = getShortcutOverlayFontPath()
  const sizeScale =
    shortcutSettings?.labelSize === 'small'
      ? 0.82
      : shortcutSettings?.labelSize === 'large'
        ? 1.2
        : 1
  const fontSize = Math.max(20, Math.round(Math.min(target.width, target.height) * 0.032 * sizeScale))
  const bottomInset = Math.max(36, Math.round(target.height * 0.065))
  const laneHeight = fontSize + Math.max(18, Math.round(fontSize * 0.7))
  const boxBorder = Math.max(12, Math.round(fontSize * 0.55))

  const visibleShortcuts = shortcuts
    .filter((shortcut) => shortcut?.visible !== false)
    .map((shortcut, index) => {
      const startSeconds = Number.isFinite(shortcut?.timeSeconds)
        ? Number(shortcut.timeSeconds) - trimStartSeconds
        : NaN
      const eventDuration = clampNumber((Number(shortcut?.durationMs) || 180) / 1000 + 0.64, 0.7, 1.8)
      const endSeconds = startSeconds + eventDuration
      const text = formatShortcutLabel(shortcut?.keys, Boolean(shortcutSettings?.showSymbols))

      if (!Number.isFinite(startSeconds) || endSeconds <= 0 || startSeconds >= durationSeconds || !text) {
        return null
      }

      return {
        index,
        startSeconds: Math.max(0, Number(startSeconds.toFixed(3))),
        endSeconds: Math.min(durationSeconds, Number(endSeconds.toFixed(3))),
        text,
      }
    })
    .filter(Boolean)

  if (!visibleShortcuts.length) {
    return ''
  }

  return visibleShortcuts
    .map((shortcut) => {
      const verticalSlot = shortcut.index % 3
      const yOffset = bottomInset + verticalSlot * laneHeight
      const parts = [
        `text='${escapeDrawtextValue(shortcut.text)}'`,
        `x=(w-text_w)/2`,
        `y=h-text_h-${yOffset}`,
        `fontsize=${fontSize}`,
        `fontcolor=white`,
        `box=1`,
        `boxcolor=${toFfmpegColorWithAlpha('101722', 0.82)}`,
        `boxborderw=${boxBorder}`,
        `borderw=${Math.max(1, Math.round(fontSize * 0.06))}`,
        `bordercolor=${toFfmpegColorWithAlpha('ffffff', 0.08)}`,
        `shadowx=0`,
        `shadowy=${Math.max(2, Math.round(fontSize * 0.14))}`,
        `shadowcolor=${toFfmpegColorWithAlpha('04060a', 0.46)}`,
        `enable='between(t,${shortcut.startSeconds.toFixed(3)},${shortcut.endSeconds.toFixed(3)})'`,
      ]

      if (fontPath) {
        parts.unshift(`fontfile='${escapeDrawtextValue(fontPath)}'`)
      }

      return `drawtext=${parts.join(':')}`
    })
    .join(',')
}

function wrapCaptionText(text, maxCharsPerLine, maxLines = 2) {
  const words = String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (!words.length) {
    return ''
  }

  const lines = []
  let currentLine = ''

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word

    if (candidate.length <= maxCharsPerLine || !currentLine) {
      currentLine = candidate
      continue
    }

    lines.push(currentLine)
    currentLine = word

    if (lines.length >= maxLines - 1) {
      break
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine)
  }

  const consumedWordCount = lines.join(' ').split(' ').filter(Boolean).length

  if (consumedWordCount < words.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, '')}…`
  }

  return lines.join('\n')
}

function buildCaptionOverlayFilter({
  ffmpeg,
  transcript,
  captionSettings,
  trimStartSeconds,
  durationSeconds,
  aspectPreset,
  sourceWidth,
  sourceHeight,
}) {
  if (
    !ffmpeg?.supportedFilters?.includes('drawtext') ||
    !captionSettings?.enabled ||
    !Array.isArray(transcript?.segments) ||
    !transcript.segments.length
  ) {
    return ''
  }

  const target = getOutputTarget({ aspectPreset }, sourceWidth, sourceHeight)
  const fontPath = getShortcutOverlayFontPath()
  const sizeScale =
    captionSettings?.labelSize === 'small'
      ? 0.84
      : captionSettings?.labelSize === 'large'
        ? 1.18
        : 1
  const fontSize = Math.max(22, Math.round(Math.min(target.width, target.height) * 0.038 * sizeScale))
  const bottomInset = Math.max(34, Math.round(target.height * 0.08))
  const boxBorder = Math.max(14, Math.round(fontSize * 0.62))
  const maxCharsPerLine = Math.max(24, Math.round(target.width / (fontSize * 0.68)))

  const visibleSegments = transcript.segments
    .filter((segment) => segment?.visible !== false)
    .map((segment) => {
      const startSeconds = Number.isFinite(segment?.startSeconds)
        ? Number(segment.startSeconds) - trimStartSeconds
        : NaN
      const endSeconds = Number.isFinite(segment?.endSeconds)
        ? Number(segment.endSeconds) - trimStartSeconds
        : NaN
      const speakerPrefix =
        captionSettings?.showSpeakerLabels && typeof segment?.speaker === 'string' && segment.speaker.trim()
          ? `${segment.speaker.trim()}: `
          : ''
      const wrappedText = wrapCaptionText(`${speakerPrefix}${segment?.text ?? ''}`, maxCharsPerLine, 2)

      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !wrappedText || endSeconds <= 0 || startSeconds >= durationSeconds) {
        return null
      }

      return {
        startSeconds: Math.max(0, Number(startSeconds.toFixed(3))),
        endSeconds: Math.min(durationSeconds, Number(endSeconds.toFixed(3))),
        text: wrappedText,
      }
    })
    .filter(Boolean)

  if (!visibleSegments.length) {
    return ''
  }

  return visibleSegments
    .map((segment) => {
      const parts = [
        `text='${escapeDrawtextValue(segment.text)}'`,
        `x=(w-text_w)/2`,
        `y=h-(text_h+${bottomInset})`,
        `fontsize=${fontSize}`,
        `line_spacing=${Math.max(6, Math.round(fontSize * 0.22))}`,
        `fontcolor=white`,
        `box=1`,
        `boxcolor=${toFfmpegColorWithAlpha('05070d', 0.72)}`,
        `boxborderw=${boxBorder}`,
        `borderw=${Math.max(1, Math.round(fontSize * 0.06))}`,
        `bordercolor=${toFfmpegColorWithAlpha('ffffff', 0.06)}`,
        `shadowx=0`,
        `shadowy=${Math.max(2, Math.round(fontSize * 0.12))}`,
        `shadowcolor=${toFfmpegColorWithAlpha('000000', 0.34)}`,
        `enable='between(t,${segment.startSeconds.toFixed(3)},${segment.endSeconds.toFixed(3)})'`,
      ]

      if (fontPath) {
        parts.unshift(`fontfile='${escapeDrawtextValue(fontPath)}'`)
      }

      return `drawtext=${parts.join(':')}`
    })
    .join(',')
}

function getBackgroundVisualPreset(background) {
  const presetCollection =
    background?.mode === 'gradient' ? backgroundVisualPresets.gradient : backgroundVisualPresets.wallpaper
  const presetId = background?.mode === 'gradient' ? background?.gradientId : background?.wallpaperId

  return presetCollection.find((preset) => preset.id === presetId) ?? presetCollection[0]
}

function buildDiagonalGradientChannelExpression(startChannel, endChannel) {
  return `(${startChannel.toFixed(3)}+((${(endChannel - startChannel).toFixed(3)})*(((X/W)+(Y/H))/2)))`
}

function buildRoundedMaskAlphaExpression(width, height, radius) {
  const safeRadius = Math.max(0, Math.min(Math.round(radius), Math.round(Math.min(width, height) / 2)))

  if (!safeRadius) {
    return '255'
  }

  const halfWidth = width / 2
  const halfHeight = height / 2
  const innerWidth = Math.max(0, halfWidth - safeRadius)
  const innerHeight = Math.max(0, halfHeight - safeRadius)

  return `if(lte(pow(max(abs(X-${halfWidth.toFixed(3)})-${innerWidth.toFixed(3)},0),2)+pow(max(abs(Y-${halfHeight.toFixed(3)})-${innerHeight.toFixed(3)},0),2),${(safeRadius * safeRadius).toFixed(3)}),255,0)`
}

function getOutputCanvasMetrics({ sourceWidth, sourceHeight, aspectPreset, background }) {
  const target = getOutputTarget({ aspectPreset }, sourceWidth, sourceHeight)
  const inset = Math.round(
    Math.min(target.width, target.height) * clampNumber(background?.padding ?? 0, 0, 0.22),
  )
  const frameWidth = toEvenNumber(Math.max(2, target.width - inset * 2), target.width)
  const frameHeight = toEvenNumber(Math.max(2, target.height - inset * 2), target.height)
  const frameX = Math.max(0, Math.round((target.width - frameWidth) / 2))
  const frameY = Math.max(0, Math.round((target.height - frameHeight) / 2))
  const frameRadius = Math.round(
    Math.min(frameWidth, frameHeight) * clampNumber(background?.radius ?? 0, 0, 0.18),
  )
  const shadowStrength = clampNumber(background?.shadow ?? 0, 0, 0.9)

  return {
    targetWidth: target.width,
    targetHeight: target.height,
    frameX,
    frameY,
    frameWidth,
    frameHeight,
    frameRadius,
    shadowBlur: Math.max(8, Math.round(18 + shadowStrength * 28)),
    shadowOffsetY: Math.max(6, Math.round(10 + shadowStrength * 16)),
  }
}

function buildAspectFilter({ sourceWidth, sourceHeight, aspectPreset, fitMode }) {
  const target = getOutputTarget({ aspectPreset }, sourceWidth, sourceHeight)

  if (
    aspectPreset === 'source' ||
    (target.width === toEvenNumber(sourceWidth, target.width) &&
      target.height === toEvenNumber(sourceHeight, target.height))
  ) {
    return ''
  }

  if (fitMode === 'cover') {
    return `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,crop=${target.width}:${target.height}`
  }

  return `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=0x0f1319`
}

function buildFrameFitFilter({
  sourceWidth,
  sourceHeight,
  frameWidth,
  frameHeight,
  fitMode,
}) {
  const safeFrameWidth = toEvenNumber(frameWidth, sourceWidth || 1920)
  const safeFrameHeight = toEvenNumber(frameHeight, sourceHeight || 1080)

  if (
    safeFrameWidth === toEvenNumber(sourceWidth, safeFrameWidth) &&
    safeFrameHeight === toEvenNumber(sourceHeight, safeFrameHeight)
  ) {
    return ''
  }

  if (fitMode === 'cover') {
    return `scale=${safeFrameWidth}:${safeFrameHeight}:force_original_aspect_ratio=increase,crop=${safeFrameWidth}:${safeFrameHeight}`
  }

  return `scale=${safeFrameWidth}:${safeFrameHeight}:force_original_aspect_ratio=decrease,pad=${safeFrameWidth}:${safeFrameHeight}:(ow-iw)/2:(oh-ih)/2:color=${toFfmpegColor('0b1017')}`
}

function buildSimpleVideoFilter({
  sourceWidth,
  sourceHeight,
  sourceFps,
  durationSeconds,
  motionPresetId,
  cursorTrack,
  focusRegions,
  trimStartSeconds,
  aspectPreset,
  fitMode,
}) {
  const filters = []
  const motionFilter = buildMotionFilter({
    width: sourceWidth,
    height: sourceHeight,
    sourceFps,
    durationSeconds,
    motionPresetId,
    cursorTrack,
    focusRegions,
    trimStartSeconds,
  })
  const aspectFilter = buildAspectFilter({
    sourceWidth,
    sourceHeight,
    aspectPreset,
    fitMode,
  })

  if (motionFilter) {
    const stableMotionFps = Math.max(1, Math.round(Number.isFinite(sourceFps) ? sourceFps : 60))
    filters.push('setpts=PTS-STARTPTS', `fps=${stableMotionFps}`)
    filters.push(motionFilter)
  }

  if (aspectFilter) {
    filters.push(aspectFilter)
  }

  return filters.join(',')
}

function getCameraOverlayMetrics(camera, frameWidth, frameHeight) {
  const safeCamera = camera ?? createDefaultProject().camera
  const sizeRatio = clampNumber(safeCamera.size, 0.14, 0.38)
  const marginX = Math.max(18, Math.round(frameWidth * 0.04))
  const marginY = Math.max(18, Math.round(frameHeight * 0.04))
  const offsetRatio = clampNumber(safeCamera.offset, 0, 1)
  const offsetX = Math.round(Math.min(84, frameWidth * 0.12) * offsetRatio)
  const offsetY = Math.round(Math.min(84, frameHeight * 0.12) * offsetRatio)
  const baseWidth = Math.max(120, toEvenNumber(frameWidth * sizeRatio, Math.round(frameWidth * 0.22)))
  const isCircle = safeCamera.shape === 'circle'
  const width = baseWidth
  const height = isCircle
    ? width
    : Math.max(76, toEvenNumber(width * (9 / 16), Math.round(frameHeight * 0.18)))
  const maxHeight = Math.max(96, Math.round(frameHeight * 0.42))
  const fittedHeight = Math.min(height, maxHeight)
  const fittedWidth = isCircle
    ? fittedHeight
    : Math.max(120, toEvenNumber(fittedHeight * (16 / 9), width))
  const horizontalAnchor = safeCamera.position.endsWith('left')
    ? 'left'
    : safeCamera.position.endsWith('right')
      ? 'right'
      : 'center'
  const verticalAnchor = safeCamera.position.startsWith('top')
    ? 'top'
    : safeCamera.position.startsWith('bottom')
      ? 'bottom'
      : 'center'
  const x = horizontalAnchor === 'left'
    ? marginX + offsetX
    : horizontalAnchor === 'right'
      ? Math.max(0, frameWidth - fittedWidth - marginX - offsetX)
      : Math.max(0, Math.round((frameWidth - fittedWidth) / 2))
  const y = verticalAnchor === 'top'
    ? marginY + offsetY
    : verticalAnchor === 'bottom'
      ? Math.max(0, frameHeight - fittedHeight - marginY - offsetY)
      : Math.max(0, Math.round((frameHeight - fittedHeight) / 2))
  const radius = isCircle
    ? Math.round(Math.min(fittedWidth, fittedHeight) / 2)
    : Math.round(Math.min(fittedWidth, fittedHeight) * clampNumber(safeCamera.roundness, 0.08, 0.48))
  const shadowBlur = Math.max(10, Math.round(14 + clampNumber(safeCamera.shadow, 0, 0.9) * 18))
  const shadowOffsetY = Math.max(4, Math.round(6 + clampNumber(safeCamera.shadow, 0, 0.9) * 10))
  const borderWidth = Math.round(Math.min(fittedWidth, fittedHeight) * clampNumber(safeCamera.border, 0, 1) * 0.045)

  return {
    width: fittedWidth,
    height: fittedHeight,
    x,
    y,
    radius,
    shadowBlur,
    shadowOffsetY,
    borderWidth,
    borderOpacity: 0.12 + clampNumber(safeCamera.border, 0, 1) * 0.22,
  }
}

function buildCompositedVideoGraph({
  sourceWidth,
  sourceHeight,
  durationSeconds,
  fitMode,
  aspectPreset,
  background,
  baseVideoFilter,
  backgroundInputIndex,
  camera,
  cameraInputIndex,
  cursorClickOverlayPlan,
  cursorClickEffectInputIndex,
  cursorOverlayPlan,
  cursorAssetInputIndexById,
  targetFps,
}) {
  const metrics = getOutputCanvasMetrics({
    sourceWidth,
    sourceHeight,
    aspectPreset,
    background,
  })
  const filterParts = []
  const durationToken = durationSeconds.toFixed(3)
  const frameMaskExpression = buildRoundedMaskAlphaExpression(
    metrics.frameWidth,
    metrics.frameHeight,
    metrics.frameRadius,
  )
  const frameFitFilter = buildFrameFitFilter({
    sourceWidth,
    sourceHeight,
    frameWidth: metrics.frameWidth,
    frameHeight: metrics.frameHeight,
    fitMode,
  })
  const contentFilterChain = [baseVideoFilter, frameFitFilter].filter(Boolean).join(',')
  const safeBackground = background ?? createDefaultProject().background
  const safeCamera = camera ?? createDefaultProject().camera

  if (safeBackground.mode === 'image' && safeBackground.imagePath && backgroundInputIndex !== null) {
    const blurSigma = Math.round(clampNumber(safeBackground.blur, 0, 0.5) * 70)
    const imageBackgroundFilter = [
      `scale=${metrics.targetWidth}:${metrics.targetHeight}:force_original_aspect_ratio=increase`,
      `crop=${metrics.targetWidth}:${metrics.targetHeight}`,
    ]

    if (blurSigma > 0) {
      imageBackgroundFilter.push(`gblur=sigma=${blurSigma}`)
    }

    filterParts.push(`[${backgroundInputIndex}:v]${imageBackgroundFilter.join(',')}[bgbase]`)
  } else if (safeBackground.mode === 'color') {
    filterParts.push(
      `color=c=${toFfmpegColor(safeBackground.colorValue)}:s=${metrics.targetWidth}x${metrics.targetHeight}:d=${durationToken},format=rgba[bgbase]`,
    )
  } else {
    const preset = getBackgroundVisualPreset(safeBackground)
    const [primaryRed, primaryGreen, primaryBlue] = hexToRgbChannels(preset.primary)
    const [secondaryRed, secondaryGreen, secondaryBlue] = hexToRgbChannels(preset.secondary)
    const gridStep = Math.max(24, Math.round(Math.min(metrics.targetWidth, metrics.targetHeight) * 0.032))
    const glowWidth = Math.max(120, Math.round(metrics.targetWidth * 0.72))
    const glowHeight = Math.max(120, Math.round(metrics.targetHeight * 0.72))
    const glowSigma = Math.max(24, Math.round(Math.min(metrics.targetWidth, metrics.targetHeight) * 0.06))

    filterParts.push(
      `nullsrc=s=${metrics.targetWidth}x${metrics.targetHeight}:d=${durationToken},format=rgba,geq=r='${buildDiagonalGradientChannelExpression(primaryRed, secondaryRed)}':g='${buildDiagonalGradientChannelExpression(primaryGreen, secondaryGreen)}':b='${buildDiagonalGradientChannelExpression(primaryBlue, secondaryBlue)}':a='255'[bggradient]`,
    )
    filterParts.push(
      `color=c=${toFfmpegColorWithAlpha(preset.halo, 0.45)}:s=${glowWidth}x${glowHeight}:d=${durationToken},format=rgba,gblur=sigma=${glowSigma}[glowleft]`,
    )
    filterParts.push(
      `color=c=${toFfmpegColorWithAlpha(preset.accent, 0.3)}:s=${glowWidth}x${glowHeight}:d=${durationToken},format=rgba,gblur=sigma=${glowSigma}[glowright]`,
    )
    filterParts.push(`[bggradient][glowleft]overlay=x=${Math.round(-metrics.targetWidth * 0.18)}:y=${Math.round(-metrics.targetHeight * 0.14)}:format=auto[bgglowleft]`)
    filterParts.push(`[bgglowleft][glowright]overlay=x=${Math.round(metrics.targetWidth * 0.48)}:y=${Math.round(-metrics.targetHeight * 0.18)}:format=auto[bgglowright]`)

    if (preset.gridOpacity) {
      filterParts.push(
        `[bgglowright]drawgrid=w=${gridStep}:h=${gridStep}:t=1:c=white@${clampNumber(preset.gridOpacity, 0, 0.6).toFixed(3)}[bgbase]`,
      )
    } else {
      filterParts.push('[bgglowright]format=rgba[bgbase]')
    }
  }

  filterParts.push(
    `nullsrc=s=${metrics.frameWidth}x${metrics.frameHeight}:d=${durationToken},geq=lum='${frameMaskExpression}',format=gray,split=2[maskshadow][maskcontent]`,
  )
  filterParts.push(
    `color=c=${toFfmpegColor('04060a')}:s=${metrics.frameWidth}x${metrics.frameHeight}:d=${durationToken},format=rgba[shadowfill]`,
  )
  filterParts.push(`[shadowfill][maskshadow]alphamerge,gblur=sigma=${metrics.shadowBlur}[shadow]`)
  filterParts.push(
    `${contentFilterChain ? `[0:v]${contentFilterChain}` : '[0:v]null'}${contentFilterChain ? '' : ''}[contentbase]`,
  )
  filterParts.push('[contentbase]format=rgba[contentrgba]')
  let contentRgbaLabel = '[contentrgba]'

  if (cursorClickOverlayPlan?.events?.length && cursorClickEffectInputIndex !== null) {
    const cursorClickOverlayChain = buildCursorClickOverlayFilterChain({
      assetInputIndex: cursorClickEffectInputIndex,
      events: cursorClickOverlayPlan.events,
      startLabel: contentRgbaLabel,
      labelPrefix: 'contentclick',
      targetFps,
    })

    filterParts.push(...cursorClickOverlayChain.filterParts)
    contentRgbaLabel = cursorClickOverlayChain.outputLabel
  }

  if (cursorOverlayPlan?.overlays?.length && cursorAssetInputIndexById?.size) {
    const cursorOverlayChain = buildCursorOverlayFilterChain({
      assets: cursorOverlayPlan.assets,
      overlays: cursorOverlayPlan.overlays,
      assetInputIndexById: cursorAssetInputIndexById,
      startLabel: contentRgbaLabel,
      labelPrefix: 'contentcursor',
    })

    filterParts.push(...cursorOverlayChain.filterParts)
    contentRgbaLabel = cursorOverlayChain.outputLabel
  }

  filterParts.push(`${contentRgbaLabel}[maskcontent]alphamerge[contentmasked]`)
  let composedContentLabel = '[contentmasked]'

  if (cameraInputIndex !== null) {
    const cameraMetrics = getCameraOverlayMetrics(camera, metrics.frameWidth, metrics.frameHeight)
    const cameraMaskExpression = buildRoundedMaskAlphaExpression(
      cameraMetrics.width,
      cameraMetrics.height,
      cameraMetrics.radius,
    )
    const innerWidth = Math.max(2, cameraMetrics.width - cameraMetrics.borderWidth * 2)
    const innerHeight = Math.max(2, cameraMetrics.height - cameraMetrics.borderWidth * 2)
    const cameraFilters = []

    if (safeCamera.mirror) {
      cameraFilters.push('hflip')
    }

    cameraFilters.push(
      `scale=${innerWidth}:${innerHeight}:force_original_aspect_ratio=decrease`,
      `pad=${innerWidth}:${innerHeight}:(ow-iw)/2:(oh-ih)/2:color=${toFfmpegColor('0b1017')}`,
      'format=rgba',
    )

    filterParts.push(
      `[${cameraInputIndex}:v]${cameraFilters.join(',')}[caminner]`,
    )

    if (cameraMetrics.borderWidth > 0) {
      filterParts.push(
        `[caminner]pad=${cameraMetrics.width}:${cameraMetrics.height}:${cameraMetrics.borderWidth}:${cameraMetrics.borderWidth}:color=${toFfmpegColorWithAlpha('ffffff', cameraMetrics.borderOpacity)},format=rgba[camplate]`,
      )
    } else {
      filterParts.push('[caminner]format=rgba[camplate]')
    }

    filterParts.push(
      `nullsrc=s=${cameraMetrics.width}x${cameraMetrics.height}:d=${durationToken},geq=lum='${cameraMaskExpression}',format=gray,split=2[cammaskshadow][cammaskcontent]`,
    )
    filterParts.push(
      `color=c=${toFfmpegColor('04060a')}:s=${cameraMetrics.width}x${cameraMetrics.height}:d=${durationToken},format=rgba[camshadowfill]`,
    )
    filterParts.push(`[camshadowfill][cammaskshadow]alphamerge,gblur=sigma=${cameraMetrics.shadowBlur}[camshadow]`)
    filterParts.push('[camplate][cammaskcontent]alphamerge[camcontent]')
    filterParts.push(
      `${composedContentLabel}[camshadow]overlay=x=${cameraMetrics.x}:y=${cameraMetrics.y + cameraMetrics.shadowOffsetY}:format=auto[contentcamshadow]`,
    )
    filterParts.push(
      `[contentcamshadow][camcontent]overlay=x=${cameraMetrics.x}:y=${cameraMetrics.y}:format=auto[contentwithcamera]`,
    )
    composedContentLabel = '[contentwithcamera]'
  }

  filterParts.push(
    `[bgbase][shadow]overlay=x=${metrics.frameX}:y=${metrics.frameY + metrics.shadowOffsetY}:format=auto[bgshadowed]`,
  )
  filterParts.push(
    `[bgshadowed]${composedContentLabel}overlay=x=${metrics.frameX}:y=${metrics.frameY}:format=auto[vout]`,
  )

  return {
    usesComplexGraph: true,
    filterComplex: filterParts.join(';'),
    outputLabel: '[vout]',
    targetWidth: metrics.targetWidth,
    targetHeight: metrics.targetHeight,
  }
}

async function buildVideoRenderPlan({
  ffmpeg,
  sourceWidth,
  sourceHeight,
  sourceFps,
  durationSeconds,
  motionPresetId,
  cursorRenderMode,
  cursorTrack,
  keyboardShortcuts,
  transcript,
  focusRegions,
  trimStartSeconds,
  aspectPreset,
  fitMode,
  background,
  camera,
  cameraTake,
  cursorSettings,
  shortcutSettings,
  captionSettings,
}) {
  const safeCursorSettings = cursorSettings ?? createDefaultProject().cursor
  const baseVideoFilter = buildSimpleVideoFilter({
    sourceWidth,
    sourceHeight,
    sourceFps,
    durationSeconds,
    motionPresetId,
    cursorTrack,
    focusRegions,
    trimStartSeconds,
    aspectPreset: 'source',
    fitMode,
  })
  const simpleVideoFilter = buildSimpleVideoFilter({
    sourceWidth,
    sourceHeight,
    sourceFps,
    durationSeconds,
    motionPresetId,
    cursorTrack,
    focusRegions,
    trimStartSeconds,
    aspectPreset,
    fitMode,
  })
  const shortcutOverlayFilter = buildKeyboardShortcutOverlayFilter({
    ffmpeg,
    shortcuts: keyboardShortcuts,
    shortcutSettings,
    trimStartSeconds,
    durationSeconds,
    aspectPreset,
    sourceWidth,
    sourceHeight,
  })
  const captionOverlayFilter = buildCaptionOverlayFilter({
    ffmpeg,
    transcript,
    captionSettings,
    trimStartSeconds,
    durationSeconds,
    aspectPreset,
    sourceWidth,
    sourceHeight,
  })
  const plainSourceOutput =
    aspectPreset === 'source' &&
    !hasBackgroundFrameTreatment(background) &&
    !(camera?.enabled && cameraTake?.filePath)
  const overlayFilters = [captionOverlayFilter, shortcutOverlayFilter].filter(Boolean)
  const cursorOverlayEnabled =
    cursorRenderMode === 'overlay' &&
    ffmpeg?.supportedFilters?.includes('overlay') &&
    safeCursorSettings.showCursor &&
    cursorTrack?.points?.length
  const canRenderCursorOverlay =
    cursorOverlayEnabled &&
    Array.isArray(cursorTrack?.appearances) &&
    cursorTrack.appearances.length
  const canRenderCursorClickOverlay =
    cursorOverlayEnabled &&
    safeCursorSettings.clickEffect !== 'none'
  const simpleTarget = getOutputTarget({ aspectPreset }, sourceWidth, sourceHeight)
  const simpleCursorOverlayPlan = canRenderCursorOverlay
    ? await prepareCursorOverlayPlan({
        cursorTrack,
        cursorSettings: safeCursorSettings,
        trimStartSeconds,
        durationSeconds,
        sourceWidth,
        sourceHeight,
        planeWidth: simpleTarget.width,
        planeHeight: simpleTarget.height,
        fitMode,
      })
    : null
  const simpleCursorClickOverlayPlan = canRenderCursorClickOverlay
    ? await prepareCursorClickOverlayPlan({
        cursorTrack,
        cursorSettings: safeCursorSettings,
        trimStartSeconds,
        durationSeconds,
        sourceWidth,
        sourceHeight,
        planeWidth: simpleTarget.width,
        planeHeight: simpleTarget.height,
        fitMode,
      })
    : null
  const requiresCursorOverlay = Boolean(
    simpleCursorOverlayPlan?.overlays?.length || simpleCursorClickOverlayPlan?.events?.length,
  )

  if ((plainSourceOutput || !ffmpeg?.supportsAdvancedCompositing) && !requiresCursorOverlay) {
    return {
      usesComplexGraph: false,
      videoFilter: [simpleVideoFilter, captionOverlayFilter, shortcutOverlayFilter].filter(Boolean).join(','),
      outputLabel: '0:v:0',
      inputs: [],
      plainSourceOutput,
    }
  }

  if (plainSourceOutput || !ffmpeg?.supportsAdvancedCompositing) {
    const inputs = []
    let nextInputIndex = 1
    let cursorClickEffectInputIndex = null
    const cursorAssetInputIndexById = new Map()

    if (simpleCursorClickOverlayPlan?.asset?.filePath) {
      inputs.push({
        path: simpleCursorClickOverlayPlan.asset.filePath,
        loop: true,
      })
      cursorClickEffectInputIndex = nextInputIndex
      nextInputIndex += 1
    }

    for (const asset of simpleCursorOverlayPlan?.assets ?? []) {
      inputs.push({
        path: asset.filePath,
        loop: true,
      })
      cursorAssetInputIndexById.set(asset.id, nextInputIndex)
      nextInputIndex += 1
    }

    const filterParts = [
      simpleVideoFilter ? `[0:v]${simpleVideoFilter}[vbase]` : '[0:v]null[vbase]',
      '[vbase]format=rgba[vbase_rgba]',
    ]
    let currentOutputLabel = '[vbase_rgba]'

    if (simpleCursorClickOverlayPlan?.events?.length && cursorClickEffectInputIndex !== null) {
      const cursorClickOverlayChain = buildCursorClickOverlayFilterChain({
        assetInputIndex: cursorClickEffectInputIndex,
        events: simpleCursorClickOverlayPlan.events,
        startLabel: currentOutputLabel,
        labelPrefix: 'vclick',
        targetFps: sourceFps,
      })
      filterParts.push(...cursorClickOverlayChain.filterParts)
      currentOutputLabel = cursorClickOverlayChain.outputLabel
    }

    if (simpleCursorOverlayPlan?.overlays?.length) {
      const cursorOverlayChain = buildCursorOverlayFilterChain({
        assets: simpleCursorOverlayPlan.assets,
        overlays: simpleCursorOverlayPlan.overlays,
        assetInputIndexById: cursorAssetInputIndexById,
        startLabel: currentOutputLabel,
        labelPrefix: 'vcursor',
      })
      filterParts.push(...cursorOverlayChain.filterParts)
      currentOutputLabel = cursorOverlayChain.outputLabel
    }

    overlayFilters.forEach((filter, index) => {
      const nextOutputLabel = `[vplainoverlay_${index}]`
      filterParts.push(`${currentOutputLabel}${filter}${nextOutputLabel}`)
      currentOutputLabel = nextOutputLabel
    })

    return {
      usesComplexGraph: true,
      filterComplex: filterParts.join(';'),
      outputLabel: currentOutputLabel,
      videoFilter: '',
      inputs,
      plainSourceOutput,
    }
  }

  const backgroundInputPath =
    background?.mode === 'image' && background?.imagePath && existsSync(background.imagePath)
      ? background.imagePath
      : ''
  const cameraInputPath =
    camera?.enabled && cameraTake?.filePath && existsSync(cameraTake.filePath)
      ? cameraTake.filePath
      : ''

  const inputs = []
  let nextInputIndex = 1
  let backgroundInputIndex = null
  let cameraInputIndex = null
  let cursorClickEffectInputIndex = null
  const metrics = getOutputCanvasMetrics({
    sourceWidth,
    sourceHeight,
    aspectPreset,
    background,
  })
  const compositedCursorClickOverlayPlan = canRenderCursorClickOverlay
    ? await prepareCursorClickOverlayPlan({
        cursorTrack,
        cursorSettings: safeCursorSettings,
        trimStartSeconds,
        durationSeconds,
        sourceWidth,
        sourceHeight,
        planeWidth: metrics.frameWidth,
        planeHeight: metrics.frameHeight,
        fitMode,
      })
    : null
  const compositedCursorOverlayPlan = canRenderCursorOverlay
    ? await prepareCursorOverlayPlan({
        cursorTrack,
        cursorSettings: safeCursorSettings,
        trimStartSeconds,
        durationSeconds,
        sourceWidth,
        sourceHeight,
        planeWidth: metrics.frameWidth,
        planeHeight: metrics.frameHeight,
        fitMode,
      })
    : null
  const cursorAssetInputIndexById = new Map()

  if (backgroundInputPath) {
    inputs.push({
      path: backgroundInputPath,
      loop: true,
    })
    backgroundInputIndex = nextInputIndex
    nextInputIndex += 1
  }

  if (cameraInputPath) {
    inputs.push({
      path: cameraInputPath,
      loop: false,
    })
    cameraInputIndex = nextInputIndex
    nextInputIndex += 1
  }

  if (compositedCursorClickOverlayPlan?.asset?.filePath) {
    inputs.push({
      path: compositedCursorClickOverlayPlan.asset.filePath,
      loop: true,
    })
    cursorClickEffectInputIndex = nextInputIndex
    nextInputIndex += 1
  }

  for (const asset of compositedCursorOverlayPlan?.assets ?? []) {
    inputs.push({
      path: asset.filePath,
      loop: true,
    })
    cursorAssetInputIndexById.set(asset.id, nextInputIndex)
    nextInputIndex += 1
  }

  const compositedPlan = buildCompositedVideoGraph({
    sourceWidth,
    sourceHeight,
    durationSeconds,
    fitMode,
    aspectPreset,
    background,
    baseVideoFilter,
    backgroundInputIndex,
    camera,
    cameraInputIndex,
    cursorClickOverlayPlan: compositedCursorClickOverlayPlan,
    cursorClickEffectInputIndex,
    cursorOverlayPlan: compositedCursorOverlayPlan,
    cursorAssetInputIndexById,
    targetFps: sourceFps,
  })

  if (!overlayFilters.length) {
    return {
      ...compositedPlan,
      videoFilter: '',
      inputs,
    }
  }

  let currentOutputLabel = compositedPlan.outputLabel
  let overlayGraph = compositedPlan.filterComplex

  overlayFilters.forEach((filter, index) => {
    const nextOutputLabel = `[voverlay_${index}]`
    overlayGraph = `${overlayGraph};${currentOutputLabel}${filter}${nextOutputLabel}`
    currentOutputLabel = nextOutputLabel
  })

  return {
    ...compositedPlan,
    filterComplex: overlayGraph,
    outputLabel: currentOutputLabel,
    videoFilter: '',
    inputs,
  }
}

function resolveVideoEncoder(ffmpeg, requestedCodec) {
  if (requestedCodec === 'libx265' && ffmpeg?.supportedEncoders?.includes('libx265')) {
    return 'libx265'
  }

  if (requestedCodec === 'libx264' && ffmpeg?.supportedEncoders?.includes('libx264')) {
    return 'libx264'
  }

  if (ffmpeg?.preferredVideoEncoder) {
    return ffmpeg.preferredVideoEncoder
  }

  if (ffmpeg?.supportedEncoders?.includes('libopenh264')) {
    return 'libopenh264'
  }

  if (ffmpeg?.supportedEncoders?.includes('h264_qsv')) {
    return 'h264_qsv'
  }

  return requestedCodec || 'libx264'
}

function getOutputExtension(output) {
  return output?.format === 'gif' ? 'gif' : 'mp4'
}

function buildGifFilterGraph(filterChain, gifFps) {
  const baseFilter = filterChain ? `${filterChain},fps=${gifFps}` : `fps=${gifFps}`
  return `${baseFilter},split[gif_base][gif_palette_src];[gif_palette_src]palettegen=stats_mode=diff[gif_palette];[gif_base][gif_palette]paletteuse=dither=bayer`
}

function buildGifFilterComplex(inputLabel, gifFps, outputLabel = 'gifout') {
  return `${inputLabel}fps=${gifFps},split[gif_base][gif_palette_src];[gif_palette_src]palettegen=stats_mode=diff[gif_palette];[gif_base][gif_palette]paletteuse=dither=bayer[${outputLabel}]`
}

async function validateRenderableRecording(filePath) {
  const ffmpeg = await resolveFfmpegPath()

  if (!ffmpeg.available || !ffmpeg.path) {
    return
  }

  const tempValidationOutput = path.join(
    app.getPath('temp'),
    `movion-validate-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`,
  )

  try {
    await runProcess(ffmpeg.path, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      filePath,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      tempValidationOutput,
    ])
  } finally {
    await rm(tempValidationOutput, { force: true }).catch(() => undefined)
  }
}

async function validateRenderableAudioRecording(filePath) {
  const ffmpeg = await resolveFfmpegPath()

  if (!ffmpeg.available || !ffmpeg.path) {
    return
  }

  const tempValidationOutput = path.join(
    app.getPath('temp'),
    `movion-validate-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
  )

  try {
    await runProcess(ffmpeg.path, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      filePath,
      '-map',
      '0:a:0',
      '-t',
      '0.250',
      '-vn',
      '-c:a',
      'pcm_s16le',
      tempValidationOutput,
    ])
  } finally {
    await rm(tempValidationOutput, { force: true }).catch(() => undefined)
  }
}

async function ensureRenderableSource(filePath, label) {
  try {
    await validateRenderableRecording(filePath)
  } catch (error) {
    throw new Error(
      `Source clip "${label || path.basename(filePath)}" is not a renderable media file. Re-record or replace this take and export again.`,
      { cause: error },
    )
  }
}

async function ensureRenderableAudioSource(filePath, label) {
  try {
    await validateRenderableAudioRecording(filePath)
  } catch (error) {
    throw new Error(
      `Microphone take "${label || path.basename(filePath)}" is not a renderable audio file. Re-record or replace this take and export again.`,
      { cause: error },
    )
  }
}

function describeBufferSignature(buffer, length = 16) {
  return Array.from(buffer.subarray(0, Math.min(length, buffer.length)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join(' ')
}

function decodeRecordingPayload({ buffer, base64Data }) {
  if (typeof base64Data === 'string' && base64Data.length > 0) {
    return Buffer.from(base64Data, 'base64')
  }

  if (Buffer.isBuffer(buffer)) {
    return buffer
  }

  if (buffer instanceof Uint8Array) {
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  }

  if (buffer instanceof ArrayBuffer) {
    return Buffer.from(buffer)
  }

  if (buffer && typeof buffer === 'object' && buffer.type === 'Buffer' && Array.isArray(buffer.data)) {
    return Buffer.from(buffer.data)
  }

  return Buffer.from(buffer ?? [])
}

async function saveRecording({
  buffer,
  base64Data,
  byteLength,
  existingFilePath,
  mimeType,
  fileName,
  systemAudio,
  camera,
  microphone,
  clip,
}) {
  const extension =
    mimeType?.includes('mp4') || path.extname(existingFilePath || '').toLowerCase() === '.mp4'
      ? 'mp4'
      : 'webm'
  const safeBaseName = sanitizeBaseName(fileName, `capture-${Date.now()}`)
  const targetPath = path.join(getPaths().capturesRoot, `${safeBaseName}.${extension}`)

  await ensureForkDirs()
  if (existingFilePath) {
    await writeRuntimeLog(
      `capture payload received transport=existing-file path=${existingFilePath} mime=${mimeType || 'unknown'}`,
    )
    if (systemAudio?.base64Data || systemAudio?.buffer) {
      const ffmpeg = await resolveFfmpegPath()

      if (!ffmpeg.available || !ffmpeg.path) {
        throw new Error('FFmpeg is required to mux native screen video with system audio.')
      }

      const systemAudioExtension = systemAudio?.mimeType?.includes('mp4') ? 'm4a' : 'webm'
      const systemAudioTempPath = path.join(
        getPaths().forkUserData,
        'native-captures',
        `${safeBaseName}-system-audio.${systemAudioExtension}`,
      )
      const systemAudioPayload = decodeRecordingPayload(systemAudio)
      await writeFile(systemAudioTempPath, systemAudioPayload)

      try {
        await writeRuntimeLog(
          `capture system audio payload received bytes=${systemAudioPayload.length} mime=${systemAudio?.mimeType || 'unknown'} path=${systemAudioTempPath}`,
        )
        await runProcess(ffmpeg.path, [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          existingFilePath,
          '-i',
          systemAudioTempPath,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-shortest',
          '-movflags',
          '+faststart',
          targetPath,
        ])
        await writeRuntimeLog(`capture native video muxed with system audio path=${targetPath}`)
      } finally {
        await rm(systemAudioTempPath, { force: true }).catch(() => undefined)
        await rm(existingFilePath, { force: true }).catch(() => undefined)
      }
    } else {
      if (path.resolve(existingFilePath) !== path.resolve(targetPath)) {
        await cp(existingFilePath, targetPath, { force: true })
        await rm(existingFilePath, { force: true }).catch(() => undefined)
      }
    }
    const existingFileSize = (await stat(targetPath)).size
    await writeRuntimeLog(`capture saved candidate path=${targetPath} mime=${mimeType || 'unknown'} bytes=${existingFileSize}`)
  } else {
    const payload = decodeRecordingPayload({ buffer, base64Data })
    await writeRuntimeLog(
      `capture payload received transport=${base64Data ? 'base64' : 'binary'} bytes=${payload.length} declaredBytes=${byteLength ?? 'n/a'} head=${describeBufferSignature(payload) || 'empty'}`,
    )
    await writeFile(targetPath, payload)
    await writeRuntimeLog(`capture saved candidate path=${targetPath} mime=${mimeType || 'unknown'} bytes=${payload.length}`)
  }
  try {
    await validateRenderableRecording(targetPath)
  } catch (error) {
    const invalidTargetPath = path.join(getPaths().capturesRoot, `${safeBaseName}.invalid.${extension}`)
    await cp(targetPath, invalidTargetPath, { force: true }).catch(() => undefined)
    await writeRuntimeLog(
      `capture validation failed path=${targetPath} preservedAt=${invalidTargetPath} error=${error?.message ?? error}`,
    )
    await rm(targetPath, { force: true })
    throw new Error(
      `The recorded ${extension.toUpperCase()} file could not be finalized into a renderable media source. A debug copy was preserved at ${invalidTargetPath}. Record the clip again with the updated recorder.`,
      { cause: error },
    )
  }
  await writeRuntimeLog(`capture validation passed path=${targetPath}`)

  const mediaProfile = await probeMediaProfile(
    targetPath,
    Boolean(clip?.captureProfile?.includeSystemAudio),
  )
  await writeRuntimeLog(
    `capture media profile path=${targetPath} width=${mediaProfile.width} height=${mediaProfile.height} fps=${mediaProfile.fps || 0} averageFps=${mediaProfile.averageFps || 0} nominalFps=${mediaProfile.nominalFps || 0} duration=${mediaProfile.durationSeconds || 0} hasAudio=${mediaProfile.hasAudio}`,
  )
  const sourceAudio = await analyzeClipAudio(
    targetPath,
    Boolean(clip?.captureProfile?.includeSystemAudio),
    clip?.audio,
  )

  let cameraTake = null
  let microphoneTake = null

  if (camera?.base64Data || camera?.buffer) {
    const cameraExtension = camera?.mimeType?.includes('mp4') ? 'mp4' : 'webm'
    const cameraBaseName = sanitizeBaseName(camera?.fileName || `${safeBaseName}-camera`, `${safeBaseName}-camera`)
    const cameraTargetPath = path.join(getPaths().capturesRoot, `${cameraBaseName}.${cameraExtension}`)
    const cameraPayload = decodeRecordingPayload(camera)

    await writeRuntimeLog(
      `camera payload received transport=${camera?.base64Data ? 'base64' : 'binary'} bytes=${cameraPayload.length} declaredBytes=${camera?.byteLength ?? 'n/a'} head=${describeBufferSignature(cameraPayload) || 'empty'}`,
    )

    if (cameraPayload.length > 0) {
      try {
        await writeFile(cameraTargetPath, cameraPayload)
        await validateRenderableRecording(cameraTargetPath)
        const cameraProfile = await probeMediaProfile(cameraTargetPath, false)
        cameraTake = normalizeClipCameraTake({
          filePath: cameraTargetPath,
          mimeType: camera?.mimeType || 'video/webm',
          size: (await stat(cameraTargetPath)).size,
          durationSeconds: cameraProfile.durationSeconds,
          deviceId: camera?.deviceId,
          deviceLabel: camera?.deviceLabel,
        })
        await writeRuntimeLog(`camera validation passed path=${cameraTargetPath}`)
      } catch (error) {
        const invalidCameraTargetPath = path.join(getPaths().capturesRoot, `${cameraBaseName}.invalid.${cameraExtension}`)
        await cp(cameraTargetPath, invalidCameraTargetPath, { force: true }).catch(() => undefined)
        await writeRuntimeLog(
          `camera validation failed path=${cameraTargetPath} preservedAt=${invalidCameraTargetPath} error=${error?.message ?? error}`,
        )
        await rm(cameraTargetPath, { force: true }).catch(() => undefined)
      }
    }
  }

  if (microphone?.base64Data || microphone?.buffer) {
    const microphoneExtension = microphone?.mimeType?.includes('mp4') ? 'm4a' : 'webm'
    const microphoneBaseName = sanitizeBaseName(
      microphone?.fileName || `${safeBaseName}-microphone`,
      `${safeBaseName}-microphone`,
    )
    const microphoneTargetPath = path.join(getPaths().capturesRoot, `${microphoneBaseName}.${microphoneExtension}`)
    const microphonePayload = decodeRecordingPayload(microphone)

    await writeRuntimeLog(
      `microphone payload received transport=${microphone?.base64Data ? 'base64' : 'binary'} bytes=${microphonePayload.length} declaredBytes=${microphone?.byteLength ?? 'n/a'} head=${describeBufferSignature(microphonePayload) || 'empty'}`,
    )

    if (microphonePayload.length > 0) {
      try {
        await writeFile(microphoneTargetPath, microphonePayload)
        await validateRenderableAudioRecording(microphoneTargetPath)
        const microphoneProfile = await probeMediaProfile(microphoneTargetPath, true)
        microphoneTake = normalizeClipMicrophoneTake({
          filePath: microphoneTargetPath,
          mimeType: microphone?.mimeType || 'audio/webm',
          size: (await stat(microphoneTargetPath)).size,
          durationSeconds: microphoneProfile.durationSeconds,
          deviceId: microphone?.deviceId,
          deviceLabel: microphone?.deviceLabel,
        })
        await writeRuntimeLog(`microphone validation passed path=${microphoneTargetPath}`)
      } catch (error) {
        const invalidMicrophoneTargetPath = path.join(
          getPaths().capturesRoot,
          `${microphoneBaseName}.invalid.${microphoneExtension}`,
        )
        await cp(microphoneTargetPath, invalidMicrophoneTargetPath, { force: true }).catch(() => undefined)
        await writeRuntimeLog(
          `microphone validation failed path=${microphoneTargetPath} preservedAt=${invalidMicrophoneTargetPath} error=${error?.message ?? error}`,
        )
        await rm(microphoneTargetPath, { force: true }).catch(() => undefined)
      }
    }
  }

  const audio = normalizeClipAudio(sourceAudio, sourceAudio.hasAudio || Boolean(microphoneTake))

  const nextClip = {
    id: globalThis.crypto.randomUUID(),
    label: clip?.label || safeBaseName,
    filePath: targetPath,
    thumbnailDataUrl: clip?.thumbnailDataUrl || '',
    mimeType: mimeType || 'video/webm',
    size: (await stat(targetPath)).size,
    durationSeconds:
      mediaProfile.durationSeconds > 0
        ? Number(mediaProfile.durationSeconds.toFixed(3))
        : Number.isFinite(clip?.durationSeconds)
          ? Number(clip.durationSeconds)
          : 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      id: clip?.source?.id || '',
      name: clip?.source?.name || 'Unknown source',
      kind: clip?.source?.kind || 'screen',
    },
    captureProfile: {
      qualityProfileId: clip?.captureProfile?.qualityProfileId || defaultSettings.capture.qualityProfileId,
      qualityProfileLabel: clip?.captureProfile?.qualityProfileLabel || 'Sharp Demo',
      motionPresetId: clip?.captureProfile?.motionPresetId || defaultSettings.capture.motionPresetId,
      motionPresetLabel: clip?.captureProfile?.motionPresetLabel || 'Precision Pan',
      includeSystemAudio: Boolean(clip?.captureProfile?.includeSystemAudio),
    },
    trim: {
      startSeconds: 0,
      endSeconds:
        mediaProfile.durationSeconds > 0
          ? Number(mediaProfile.durationSeconds.toFixed(3))
          : Number.isFinite(clip?.durationSeconds)
            ? Number(clip.durationSeconds)
            : null,
    },
    cursorRenderMode: clip?.cursorRenderMode === 'overlay' ? 'overlay' : 'baked',
    cursorTrack: normalizeCursorTrack(
      clip?.cursorTrack,
      clip?.source?.kind || 'screen',
      mediaProfile.durationSeconds > 0
        ? Number(mediaProfile.durationSeconds)
        : Number.isFinite(clip?.durationSeconds)
          ? Number(clip.durationSeconds)
          : 0,
    ),
    keyboardShortcuts: normalizeKeyboardShortcutEvents(
      clip?.keyboardShortcuts,
      mediaProfile.durationSeconds > 0
        ? Number(mediaProfile.durationSeconds)
        : Number.isFinite(clip?.durationSeconds)
          ? Number(clip.durationSeconds)
          : 0,
    ),
    focusRegions: normalizeClipFocusRegions(
      clip?.focusRegions,
      mediaProfile.durationSeconds > 0
        ? Number(mediaProfile.durationSeconds)
        : Number.isFinite(clip?.durationSeconds)
          ? Number(clip.durationSeconds)
          : 0,
    ),
    cameraTake,
    microphoneTake,
    audioRetakes: [],
    audio,
    notes: clip?.notes || '',
    exports: [],
    lastExportPath: '',
  }

  await writeRuntimeLog(
    `capture clip assembled path=${targetPath} cursorSamples=${nextClip.cursorTrack?.points?.length ?? 0} shortcutTimestamps=${nextClip.keyboardShortcuts.length} focusRegions=${nextClip.focusRegions.length}`,
  )

  const project = await appendClipToProject(nextClip)

  return {
    filePath: targetPath,
    size: nextClip.size,
    clip: normalizeClip(nextClip),
    project,
  }
}

function getEffectiveTrim(clip, payload) {
  const startSeconds = Number.isFinite(payload?.trimStartSeconds)
    ? Math.max(0, Number(payload.trimStartSeconds))
    : Math.max(0, Number(clip.trim.startSeconds ?? 0))
  const clipEnd = Number.isFinite(clip.trim.endSeconds) ? Number(clip.trim.endSeconds) : null
  const rawEnd = Number.isFinite(payload?.trimEndSeconds)
    ? Number(payload.trimEndSeconds)
    : clipEnd
  const endSeconds = rawEnd === null ? null : Math.max(startSeconds, rawEnd)

  return {
    startSeconds,
    endSeconds,
  }
}

function getTimelineItemTrim(item, clip) {
  const clipTrimStart = Number.isFinite(clip?.trim?.startSeconds) ? Number(clip.trim.startSeconds) : 0
  const clipTrimEnd = Number.isFinite(clip?.trim?.endSeconds)
    ? Number(clip.trim.endSeconds)
    : Number.isFinite(clip?.durationSeconds)
      ? Number(clip.durationSeconds)
      : null
  const startSeconds = Number.isFinite(item?.trimStartSeconds)
    ? Math.max(0, Number(item.trimStartSeconds))
    : clipTrimStart
  const rawEnd = Number.isFinite(item?.trimEndSeconds) ? Number(item.trimEndSeconds) : clipTrimEnd
  const maxDuration = Number.isFinite(clip?.durationSeconds) ? Number(clip.durationSeconds) : null
  const endSeconds =
    rawEnd === null
      ? maxDuration
      : maxDuration === null
        ? Math.max(startSeconds, rawEnd)
        : Math.min(maxDuration, Math.max(startSeconds, rawEnd))

  return {
    startSeconds,
    endSeconds,
  }
}

function getTimelineItemDuration(item, clip) {
  const trim = getTimelineItemTrim(item, clip)
  if (trim.endSeconds === null) {
    return 0
  }

  return Math.max(0, trim.endSeconds - trim.startSeconds)
}

function getProjectTimelineDuration(project) {
  const clipsById = new Map((project?.clips ?? []).map((clip) => [clip.id, clip]))

  return (project?.timeline?.items ?? []).reduce((total, item) => {
    if (item?.enabled === false) {
      return total
    }

    return total + getTimelineItemDuration(item, clipsById.get(item.clipId))
  }, 0)
}

function formatConcatPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

async function exportClip(payload) {
  const project = await loadProject()
  const clip = project.clips.find((item) => item.id === payload.clipId)

  if (!clip) {
    throw new Error('Clip was not found in the active project.')
  }

  const ffmpeg = await resolveFfmpegPath()

  if (!ffmpeg.available || !ffmpeg.path) {
    throw new Error('FFmpeg was not found. Configure MOVION_LOCAL_FFMPEG or install ffmpeg.exe.')
  }

  await ensureRenderableSource(clip.filePath, clip.label)
  if (project.camera.enabled && clip.cameraTake?.filePath) {
    await ensureRenderableSource(clip.cameraTake.filePath, `${clip.label} camera`)
  }
  if (clip.microphoneTake?.filePath) {
    await ensureRenderableAudioSource(clip.microphoneTake.filePath, `${clip.label} microphone`)
  }
  for (const retake of clip.audioRetakes ?? []) {
    if (retake.filePath) {
      await ensureRenderableAudioSource(retake.filePath, `${clip.label} audio retake`)
    }
  }

  const trim = getEffectiveTrim(clip, payload)
  const outputName = sanitizeBaseName(
    payload.outputName || `${path.parse(clip.filePath).name}-export`,
    `clip-${clip.id}`,
  )
  const outputFormat = project.output.format === 'gif' ? 'gif' : 'mp4'
  const outputPath = path.join(getPaths().exportsRoot, `${outputName}.${getOutputExtension(project.output)}`)
  const mediaProfile = await probeMediaProfile(
    clip.filePath,
    Boolean(clip.captureProfile?.includeSystemAudio),
  )
  const durationSeconds =
    trim.endSeconds === null ? Math.max(0.01, clip.durationSeconds - trim.startSeconds) : Math.max(0.01, trim.endSeconds - trim.startSeconds)
  const outputFps = resolveStableVideoFps(mediaProfile)
  const videoPlan = await buildVideoRenderPlan({
    ffmpeg,
    sourceWidth: mediaProfile.width,
    sourceHeight: mediaProfile.height,
    sourceFps: outputFps,
    durationSeconds,
    motionPresetId: clip.captureProfile?.motionPresetId,
    cursorRenderMode: clip.cursorRenderMode,
    cursorTrack: clip.cursorTrack,
    keyboardShortcuts: clip.keyboardShortcuts,
    transcript: clip.transcript,
    focusRegions: clip.focusRegions,
    trimStartSeconds: trim.startSeconds,
    aspectPreset: project.output.aspectPreset,
    fitMode: project.output.fitMode,
    background: project.background,
    camera: project.camera,
    cameraTake: clip.cameraTake,
    cursorSettings: project.cursor,
    shortcutSettings: project.shortcuts,
    captionSettings: project.captions,
  })
  const motionMode = resolveMotionRenderMode({
    width: mediaProfile.width,
    height: mediaProfile.height,
    durationSeconds,
    motionPresetId: clip.captureProfile?.motionPresetId,
    cursorTrack: clip.cursorTrack,
    focusRegions: clip.focusRegions,
    trimStartSeconds: trim.startSeconds,
  })
  await writeRuntimeLog(
    `export clip clipId=${clip.id} motion=${motionMode} plainSource=${Boolean(videoPlan.plainSourceOutput)} fps=${outputFps} focusRegions=${clip.focusRegions?.length ?? 0} cursorSamples=${clip.cursorTrack?.points?.length ?? 0}`,
  )
  const videoEncoder = resolveVideoEncoder(ffmpeg, project.output.videoCodec)
  const args = ['-hide_banner', '-loglevel', 'error', '-y']

  if (trim.startSeconds > 0) {
    args.push('-ss', trim.startSeconds.toFixed(3))
  }

  args.push('-i', clip.filePath)

  for (const input of videoPlan.inputs ?? []) {
    if (input.loop) {
      args.push('-loop', '1')
    }

    args.push('-i', input.path)
  }

  const microphoneInputIndex =
    outputFormat !== 'gif' && clip.microphoneTake?.filePath ? 1 + (videoPlan.inputs?.length ?? 0) : null

  if (microphoneInputIndex !== null) {
    args.push('-i', clip.microphoneTake.filePath)
  }
  const audioRetakeInputs = []

  if (outputFormat !== 'gif') {
    for (const retake of clip.audioRetakes ?? []) {
      if (!retake.filePath) {
        continue
      }

      const inputIndex = 1 + (videoPlan.inputs?.length ?? 0) + (microphoneInputIndex !== null ? 1 : 0) + audioRetakeInputs.length
      args.push('-i', retake.filePath)
      audioRetakeInputs.push({
        inputIndex,
        retake,
      })
    }
  }

  const audioPlan =
    outputFormat === 'gif'
      ? {
          useAudio: false,
          requiresComplex: false,
          simpleFilter: '',
          filterComplex: '',
          outputLabel: '[aout]',
        }
      : buildClipAudioRenderPlan({
          ffmpeg,
          projectAudio: project.audio,
          clipAudio: clip.audio,
          sourceAudioAvailable: mediaProfile.hasAudio,
          microphoneInputIndex,
          audioRetakeInputs,
          trimStartSeconds: trim.startSeconds,
          durationSeconds,
        })
  const useAudio = audioPlan.useAudio

  if (trim.endSeconds !== null && trim.endSeconds > trim.startSeconds) {
    args.push('-t', durationSeconds.toFixed(3))
  }

  if (outputFormat === 'gif') {
    if (videoPlan.usesComplexGraph) {
      args.push(
        '-an',
        '-filter_complex',
        `${videoPlan.filterComplex};${buildGifFilterComplex(videoPlan.outputLabel, project.output.gifFps)}`,
        '-map',
        '[gifout]',
        '-loop',
        '0',
        outputPath,
      )
    } else {
      args.push(
        '-an',
        '-loop',
        '0',
        '-filter_complex',
        buildGifFilterGraph(videoPlan.videoFilter, project.output.gifFps),
        outputPath,
      )
    }
  } else {
    const useFilterComplex = videoPlan.usesComplexGraph || audioPlan.requiresComplex

    if (useFilterComplex) {
      const filterParts = []
      let videoOutputLabel = '0:v:0'

      if (videoPlan.usesComplexGraph) {
        filterParts.push(videoPlan.filterComplex)
        videoOutputLabel = videoPlan.outputLabel
      } else {
        filterParts.push(videoPlan.videoFilter ? `[0:v]${videoPlan.videoFilter}[vout]` : '[0:v]null[vout]')
        videoOutputLabel = '[vout]'
      }

      if (audioPlan.requiresComplex) {
        filterParts.push(audioPlan.filterComplex)
      }

      args.push('-filter_complex', filterParts.join(';'), '-map', videoOutputLabel)

      if (useAudio) {
        args.push('-map', audioPlan.outputLabel)
      } else {
        args.push('-an')
      }
    } else {
      if (videoPlan.videoFilter) {
        args.push('-vf', videoPlan.videoFilter)
      }

      args.push('-map', '0:v:0')

      if (useAudio) {
        args.push('-map', '0:a:0')

        if (audioPlan.simpleFilter) {
          args.push('-af', audioPlan.simpleFilter)
        }
      } else {
        args.push('-an')
      }
    }

    args.push(
      '-c:v',
      videoEncoder,
      '-r',
      String(outputFps),
      '-preset',
      project.output.preset,
      '-crf',
      String(project.output.crf),
      '-pix_fmt',
      'yuv420p',
    )

    if (useAudio) {
      args.push('-c:a', project.output.audioCodec)
    }

    if (videoEncoder === 'libx265') {
      args.push('-tag:v', 'hvc1')
    }

    args.push(
      '-movflags',
      '+faststart',
      outputPath,
    )
  }

  await runProcess(ffmpeg.path, args)
  const exportSize = (await stat(outputPath)).size
  const exportRecord = {
    id: globalThis.crypto.randomUUID(),
    filePath: outputPath,
    format: outputFormat,
    createdAt: new Date().toISOString(),
    size: exportSize,
    trimStartSeconds: trim.startSeconds,
    trimEndSeconds: trim.endSeconds,
  }

  const nextProject = await queueProjectMutation(async (current) =>
    mergeProject(current, {
      clips: current.clips.map((item) =>
        item.id === clip.id
          ? {
              ...item,
              updatedAt: new Date().toISOString(),
              exports: [exportRecord, ...(item.exports ?? [])],
              lastExportPath: outputPath,
            }
          : item,
      ),
      timeline: {
        activeClipId: clip.id,
      },
    }),
  )

  return {
    clipId: clip.id,
    filePath: outputPath,
    size: exportSize,
    exportRecord,
    project: nextProject,
  }
}

async function renderTimelineSegment({ ffmpegPath, project, clip, item, outputPath }) {
  await ensureRenderableSource(clip.filePath, clip.label)
  if (project.camera.enabled && clip.cameraTake?.filePath) {
    await ensureRenderableSource(clip.cameraTake.filePath, `${clip.label} camera`)
  }
  if (clip.microphoneTake?.filePath) {
    await ensureRenderableAudioSource(clip.microphoneTake.filePath, `${clip.label} microphone`)
  }
  for (const retake of clip.audioRetakes ?? []) {
    if (retake.filePath) {
      await ensureRenderableAudioSource(retake.filePath, `${clip.label} audio retake`)
    }
  }
  const trim = getTimelineItemTrim(item, clip)
  const durationSeconds =
    trim.endSeconds === null ? Math.max(0.01, clip.durationSeconds - trim.startSeconds) : Math.max(0.01, trim.endSeconds - trim.startSeconds)
  const mediaProfile = await probeMediaProfile(
    clip.filePath,
    Boolean(clip.captureProfile?.includeSystemAudio),
  )
  const outputFps = resolveStableVideoFps(mediaProfile)
  const ffmpeg = await resolveFfmpegPath()
  const videoEncoder = resolveVideoEncoder(ffmpeg, project.output.videoCodec)
  const videoPlan = await buildVideoRenderPlan({
    ffmpeg,
    sourceWidth: mediaProfile.width,
    sourceHeight: mediaProfile.height,
    sourceFps: outputFps,
    durationSeconds,
    motionPresetId: clip.captureProfile?.motionPresetId,
    cursorRenderMode: clip.cursorRenderMode,
    cursorTrack: clip.cursorTrack,
    keyboardShortcuts: clip.keyboardShortcuts,
    transcript: clip.transcript,
    focusRegions: clip.focusRegions,
    trimStartSeconds: trim.startSeconds,
    aspectPreset: project.output.aspectPreset,
    fitMode: project.output.fitMode,
    background: project.background,
    camera: project.camera,
    cameraTake: clip.cameraTake,
    cursorSettings: project.cursor,
    shortcutSettings: project.shortcuts,
    captionSettings: project.captions,
  })
  const motionMode = resolveMotionRenderMode({
    width: mediaProfile.width,
    height: mediaProfile.height,
    durationSeconds,
    motionPresetId: clip.captureProfile?.motionPresetId,
    cursorTrack: clip.cursorTrack,
    focusRegions: clip.focusRegions,
    trimStartSeconds: trim.startSeconds,
  })
  await writeRuntimeLog(
    `timeline segment itemId=${item.id} clipId=${clip.id} motion=${motionMode} plainSource=${Boolean(videoPlan.plainSourceOutput)} fps=${outputFps} focusRegions=${clip.focusRegions?.length ?? 0} cursorSamples=${clip.cursorTrack?.points?.length ?? 0}`,
  )
  const args = ['-hide_banner', '-loglevel', 'error', '-y']

  if (trim.startSeconds > 0) {
    args.push('-ss', trim.startSeconds.toFixed(3))
  }

  args.push('-i', clip.filePath)

  for (const input of videoPlan.inputs ?? []) {
    if (input.loop) {
      args.push('-loop', '1')
    }

    args.push('-i', input.path)
  }
  const microphoneInputIndex = clip.microphoneTake?.filePath ? 1 + (videoPlan.inputs?.length ?? 0) : null

  if (microphoneInputIndex !== null) {
    args.push('-i', clip.microphoneTake.filePath)
  }
  const audioRetakeInputs = []

  for (const retake of clip.audioRetakes ?? []) {
    if (!retake.filePath) {
      continue
    }

    const inputIndex = 1 + (videoPlan.inputs?.length ?? 0) + (microphoneInputIndex !== null ? 1 : 0) + audioRetakeInputs.length
    args.push('-i', retake.filePath)
    audioRetakeInputs.push({
      inputIndex,
      retake,
    })
  }

  const audioPlan = buildClipAudioRenderPlan({
    ffmpeg,
    projectAudio: project.audio,
    clipAudio: clip.audio,
    sourceAudioAvailable: mediaProfile.hasAudio,
    microphoneInputIndex,
    audioRetakeInputs,
    trimStartSeconds: trim.startSeconds,
    durationSeconds,
  })
  const filterParts = []
  let videoOutputLabel = '[vout]'

  if (videoPlan.usesComplexGraph) {
    filterParts.push(videoPlan.filterComplex)
    videoOutputLabel = videoPlan.outputLabel
  } else {
    filterParts.push(videoPlan.videoFilter ? `[0:v]${videoPlan.videoFilter}[vout]` : '[0:v]null[vout]')
  }

  if (audioPlan.useAudio) {
    if (audioPlan.requiresComplex) {
      filterParts.push(audioPlan.filterComplex)
    } else {
      filterParts.push(
        `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,apad=pad_dur=${durationSeconds.toFixed(3)},atrim=duration=${durationSeconds.toFixed(3)}${audioPlan.simpleFilter ? `,${audioPlan.simpleFilter}` : ''}[aout]`,
      )
    }
  } else {
    filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${durationSeconds.toFixed(3)}[aout]`)
  }

  args.push('-filter_complex', filterParts.join(';'))

  args.push(
    '-t',
    durationSeconds.toFixed(3),
    '-map',
    videoOutputLabel,
    '-map',
    '[aout]',
    '-c:v',
    videoEncoder,
    '-r',
    String(outputFps),
    '-preset',
    project.output.preset,
    '-crf',
    String(project.output.crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    project.output.audioCodec,
    '-ar',
    '48000',
    '-ac',
    '2',
  )

  if (videoEncoder === 'libx265') {
    args.push('-tag:v', 'hvc1')
  }

  args.push(
    '-movflags',
    '+faststart',
    outputPath,
  )

  await runProcess(ffmpegPath, args)

  return durationSeconds
}

async function exportTimeline(payload) {
  const project = await loadProject()
  const ffmpeg = await resolveFfmpegPath()

  if (!ffmpeg.available || !ffmpeg.path) {
    throw new Error('FFmpeg was not found. Configure MOVION_LOCAL_FFMPEG or install ffmpeg.exe.')
  }

  const clipsById = new Map(project.clips.map((clip) => [clip.id, clip]))
  const activeItems = project.timeline.items.filter((item) => item.enabled !== false && clipsById.has(item.clipId))

  if (activeItems.length === 0) {
    throw new Error('Timeline is empty. Add or enable at least one timeline item before exporting.')
  }

  const outputFormat = project.output.format === 'gif' ? 'gif' : 'mp4'
  const outputName = sanitizeBaseName(payload?.outputName || `${project.title}-timeline`, 'timeline-export')
  const outputPath = path.join(getPaths().exportsRoot, `${outputName}.${getOutputExtension(project.output)}`)
  const tempRoot = path.join(getPaths().exportsRoot, `.timeline-temp-${globalThis.crypto.randomUUID()}`)
  const projectTimelineDuration = getProjectTimelineDuration(project)
  const enabledMusicBeds = project.audio.beds.filter(
    (bed) => bed.enabled && bed.filePath && getMusicBedPlacement(bed, projectTimelineDuration).durationSeconds > 0,
  )
  const shouldMixMusicBeds = outputFormat !== 'gif' && enabledMusicBeds.length > 0

  await mkdir(tempRoot, { recursive: true })

  try {
    const segmentFiles = []
    let totalDuration = 0

    for (const [index, item] of activeItems.entries()) {
      const clip = clipsById.get(item.clipId)
      const segmentPath = path.join(tempRoot, `segment-${String(index).padStart(3, '0')}.mp4`)
      const segmentDuration = await renderTimelineSegment({
        ffmpegPath: ffmpeg.path,
        project,
        clip,
        item,
        outputPath: segmentPath,
      })

      totalDuration += segmentDuration
      segmentFiles.push(segmentPath)
    }

    const concatListPath = path.join(tempRoot, 'concat.txt')
    const concatBody = segmentFiles.map((filePath) => `file '${formatConcatPath(filePath)}'`).join('\n')

    await writeFile(concatListPath, concatBody, 'utf8')
    const assembledPath =
      outputFormat === 'gif' || shouldMixMusicBeds
        ? path.join(tempRoot, 'assembled-timeline.mp4')
        : outputPath

    await runProcess(ffmpeg.path, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      assembledPath,
    ])

    if (outputFormat === 'gif') {
      await runProcess(ffmpeg.path, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        assembledPath,
        '-an',
        '-loop',
        '0',
        '-filter_complex',
        buildGifFilterGraph('', project.output.gifFps),
        outputPath,
      ])
    } else if (shouldMixMusicBeds) {
      await mixTimelineMusicBeds({
        ffmpegPath: ffmpeg.path,
        assembledPath,
        outputPath,
        musicBeds: enabledMusicBeds,
        ducking: project.audio.ducking,
        audioCodec: project.output.audioCodec,
        totalDuration,
      })
    }

    const exportSize = (await stat(outputPath)).size
    const exportRecord = {
      id: globalThis.crypto.randomUUID(),
      filePath: outputPath,
      format: outputFormat,
      createdAt: new Date().toISOString(),
      size: exportSize,
      itemCount: activeItems.length,
      durationSeconds: Number(totalDuration.toFixed(2)),
    }

    const nextProject = await queueProjectMutation(async (current) =>
      mergeProject(current, {
        timeline: {
          ...current.timeline,
          exports: [exportRecord, ...(current.timeline.exports ?? [])],
          lastExportPath: outputPath,
        },
      }),
    )

    return {
      filePath: outputPath,
      size: exportSize,
      exportRecord,
      project: nextProject,
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1220,
    minHeight: 760,
    backgroundColor: '#0f1319',
    autoHideMenuBar: true,
    title: 'Movion',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    void writeRuntimeLog('window did-finish-load')
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    void writeRuntimeLog(
      `window did-fail-load mainFrame=${isMainFrame} code=${errorCode} url=${validatedURL} error=${errorDescription}`,
    )
  })

  mainWindow.webContents.on('console-message', (details) => {
    const level = Number.isFinite(details?.level) ? details.level : 0
    const line = Number.isFinite(details?.lineNumber) ? details.lineNumber : 0
    const sourceId = details?.sourceId || 'unknown'
    const message = details?.message || ''
    void writeRuntimeLog(`renderer console level=${level} source=${sourceId}:${line} ${message}`)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void writeRuntimeLog(
      `render-process-gone reason=${details.reason} exitCode=${details.exitCode ?? 'unknown'}`,
    )
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadURL(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString())
  }

  mainWindowRef = mainWindow
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
    }
  })

  return mainWindow
}

app.whenReady().then(async () => {
  await ensureForkDirs()
  await writeRuntimeLog('app ready')

  session.defaultSession.protocol.handle(LOCAL_MEDIA_PROTOCOL, async (request) => {
    try {
      const targetPath = resolveLocalMediaPathFromRequest(request.url)

      if (!targetPath) {
        return new Response('Invalid media path', { status: 400 })
      }

      if (!existsSync(targetPath)) {
        return new Response('Media file not found', { status: 404 })
      }

      return createLocalMediaResponse(targetPath, request.headers.get('range'))
    } catch (error) {
      await writeRuntimeLog(`local media protocol failed url=${request.url} error=${error?.stack ?? error}`)
      return new Response('Failed to load media', { status: 500 })
    }
  })

  process.on('uncaughtException', (error) => {
    void writeRuntimeLog(`uncaughtException ${error?.stack ?? error}`)
  })

  process.on('unhandledRejection', (reason) => {
    void writeRuntimeLog(`unhandledRejection ${reason}`)
  })

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      fetchWindowIcons: true,
      thumbnailSize: { width: 1, height: 1 },
    })

    const selectedSource =
      sources.find((source) => source.id === captureState.sourceId) ??
      sources.find((source) => source.id.startsWith('screen:')) ??
      sources[0]

    callback({
      video: selectedSource,
      audio: captureState.includeSystemAudio && process.platform === 'win32' ? 'loopback' : undefined,
    })
  })

  ipcMain.handle('app:bootstrap', async () => {
    await writeRuntimeLog('bootstrap requested')

    try {
      const ffmpeg = await resolveFfmpegPath()
      const workspace = await loadProjectWorkspace()
      const payload = {
        settings: await loadSettings(),
    importState: await scanLegacyImportState(),
        activeProject: workspace.activeProject,
        projects: workspace.projects,
        ffmpeg: {
          available: ffmpeg.available,
          path: ffmpeg.path,
          version: ffmpeg.version,
          managed: ffmpeg.managed,
          sourcePath: ffmpeg.sourcePath,
          preferredVideoEncoder: ffmpeg.preferredVideoEncoder,
          supportsAdvancedCompositing: ffmpeg.supportsAdvancedCompositing,
        },
        transcription: getTranscriptionCapability(),
        paths: {
          capturesRoot: getPaths().capturesRoot,
          audioRoot: getPaths().audioRoot,
          projectsRoot: getPaths().projectsRoot,
          exportsRoot: getPaths().exportsRoot,
          importsRoot: getPaths().importsRoot,
          runtimeLogFile: path.join(getPaths().forkUserData, 'runtime.log'),
        },
        qualityProfiles,
        motionPresets,
      }

      await writeRuntimeLog(
        `bootstrap completed projects=${payload.projects.length} clips=${payload.activeProject.clips.length} ffmpeg=${payload.ffmpeg.available}`,
      )

      return payload
    } catch (error) {
      await writeRuntimeLog(`bootstrap failed ${error?.stack ?? error}`)
      throw error
    }
  })

  ipcMain.handle('sources:list', async () => listCaptureSources())

  ipcMain.on('capture:prime-sync', (event, nextCaptureState) => {
    const sourceId =
      typeof nextCaptureState?.sourceId === 'string' && nextCaptureState.sourceId
        ? nextCaptureState.sourceId
        : captureState.sourceId || 'screen:0:0'
    const sourceKind = String(sourceId).startsWith('window:') ? 'window' : 'screen'

    captureState.sourceId = sourceId
    captureState.sourceKind = sourceKind
    captureState.includeSystemAudio = Boolean(nextCaptureState?.includeSystemAudio)
    captureState.displayId = ''
    captureState.cursorTrackingAvailable = false
    captureState.keyboardTrackingAvailable = false
    captureState.cursorBounds = null

    event.returnValue = {
      ok: true,
      sourceId,
      sourceKind,
    }

    void writeRuntimeLog(
      `capture primed source=${sourceId} kind=${sourceKind} includeSystemAudio=${captureState.includeSystemAudio}`,
    )
  })

  ipcMain.handle('capture:prepare', async (_event, nextCaptureState) => {
    const trackingState = await resolveCaptureTrackingState(nextCaptureState.sourceId)
    const keyboardTrackingAvailable = await startKeyboardTracker()

    captureState.sourceId = trackingState.sourceId
    captureState.sourceKind = trackingState.sourceKind
    captureState.displayId = trackingState.displayId
    captureState.includeSystemAudio = nextCaptureState.includeSystemAudio
    captureState.cursorTrackingAvailable = trackingState.cursorTrackingAvailable
    captureState.keyboardTrackingAvailable = keyboardTrackingAvailable
    captureState.cursorBounds = trackingState.cursorBounds

    await saveSettings({
      capture: {
        selectedSourceId: nextCaptureState.sourceId,
        includeSystemAudio: nextCaptureState.includeSystemAudio,
      },
    })

    if (trackingState.cursorTrackingAvailable) {
      await startPointerTracker()
    } else {
      stopPointerTracker()
    }

    await writeRuntimeLog(
      `capture prepared source=${trackingState.sourceId} kind=${trackingState.sourceKind} cursorTracking=${trackingState.cursorTrackingAvailable} keyboardTracking=${keyboardTrackingAvailable} cursorSpace=${trackingState.cursorCoordinateSpace?.width || 0}x${trackingState.cursorCoordinateSpace?.height || 0}`,
    )

    return {
      ok: true,
      sourceId: trackingState.sourceId,
      sourceKind: trackingState.sourceKind,
      cursorTrackingAvailable: trackingState.cursorTrackingAvailable,
      keyboardTrackingAvailable,
      cursorCoordinateSpace: trackingState.cursorCoordinateSpace,
    }
  })

  ipcMain.handle('capture:start-native-screen-recording', async (_event, payload) =>
    startNativeScreenCaptureRecording(payload),
  )

  ipcMain.handle('capture:stop-native-screen-recording', async (_event, payload) =>
    stopNativeScreenCaptureRecording(payload?.sessionId),
  )

  ipcMain.handle('capture:get-cursor-appearance-catalog', async () => getCursorAppearanceCatalog())

  ipcMain.handle('capture:get-cursor-snapshot', async () => {
    const shortcuts = drainKeyboardShortcuts()

    if (!captureState.cursorTrackingAvailable || !captureState.cursorBounds) {
      return {
        trackingAvailable: false,
        x: 0,
        y: 0,
        cursorKind: 'arrow',
        cursorAppearanceId: '',
        cursorImageDataUrl: '',
        cursorHotspotRatioX: 0,
        cursorHotspotRatioY: 0,
        clicks: [],
        shortcuts,
      }
    }

    const point = screen.getCursorScreenPoint()
    const { x, y, width, height } = captureState.cursorBounds

    if (!width || !height) {
      return {
        trackingAvailable: false,
        x: 0,
        y: 0,
        cursorKind: 'arrow',
        cursorAppearanceId: '',
        cursorImageDataUrl: '',
        cursorHotspotRatioX: 0,
        cursorHotspotRatioY: 0,
        clicks: [],
        shortcuts,
      }
    }

    const clicks = drainPointerClicks()
    const currentAppearanceId = pointerTrackerState.cursorAppearanceId || ''
    const shouldIncludeAppearanceData =
      Boolean(currentAppearanceId) &&
      currentAppearanceId !== pointerTrackerState.lastDeliveredAppearanceId &&
      Boolean(pointerTrackerState.cursorImageDataUrl)

    if (currentAppearanceId !== pointerTrackerState.lastDeliveredAppearanceId) {
      pointerTrackerState.lastDeliveredAppearanceId = currentAppearanceId
    }

    return {
      trackingAvailable: true,
      x: clampUnit((point.x - x) / width),
      y: clampUnit((point.y - y) / height),
      cursorKind: normalizeCursorVisualKind(pointerTrackerState.cursorKind),
      cursorAppearanceId: currentAppearanceId,
      cursorImageDataUrl: shouldIncludeAppearanceData ? pointerTrackerState.cursorImageDataUrl || '' : '',
      cursorHotspotRatioX: clampUnit(pointerTrackerState.cursorHotspotRatioX),
      cursorHotspotRatioY: clampUnit(pointerTrackerState.cursorHotspotRatioY),
      cursorReferenceWidth:
        pointerTrackerState.cursorReferenceWidth > 0 ? pointerTrackerState.cursorReferenceWidth : undefined,
      cursorReferenceHeight:
        pointerTrackerState.cursorReferenceHeight > 0 ? pointerTrackerState.cursorReferenceHeight : undefined,
      clicks,
      shortcuts,
    }
  })

  ipcMain.handle('capture:save-recording', async (_event, payload) => {
    try {
      return await saveRecording(payload)
    } finally {
      stopPointerTracker()
      stopKeyboardTracker()
    }
  })
  ipcMain.handle('settings:load', async () => loadSettings())
  ipcMain.handle('settings:save', async (_event, patch) => saveSettings(patch))
ipcMain.handle('import:scan', async () => scanLegacyImportState())
ipcMain.handle('import:run', async () => importLegacyState())
  ipcMain.handle('project:load', async () => loadProject())
  ipcMain.handle('project:list', async () => listProjects())
  ipcMain.handle('project:save', async (_event, patch) => saveProject(patch))
  ipcMain.handle('project:create', async (_event, payload) => createProject(payload))
  ipcMain.handle('project:open', async (_event, projectId) => openProject(projectId))
  ipcMain.handle('project:duplicate', async (_event, projectId) => duplicateProject(projectId))
  ipcMain.handle('project:remove', async (_event, projectId) => removeProject(projectId))
  ipcMain.handle('project:import-background-image', async () => importProjectBackgroundImage())
  ipcMain.handle('project:import-music-bed', async () => importProjectMusicBed())
  ipcMain.handle('project:remove-music-bed', async (_event, bedId) => removeProjectMusicBed(bedId))
  ipcMain.handle('project:analyze-clip-audio', async (_event, clipId) => analyzeProjectClipAudio(clipId))
  ipcMain.handle('project:generate-transcript', async (_event, clipId) => generateProjectClipTranscript(clipId))
  ipcMain.handle('project:import-transcript', async (_event, clipId) => importProjectClipTranscript(clipId))
  ipcMain.handle('project:save-audio-retake', async (_event, payload) => saveProjectClipAudioRetake(payload))
ipcMain.handle('project:export-clip', async (_event, payload) => {
  try {
    return await exportClip(payload)
  } catch (error) {
    await writeRuntimeLog(`project:export-clip failed error=${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
})
ipcMain.handle('project:export-timeline', async (_event, payload) => {
  try {
    return await exportTimeline(payload)
  } catch (error) {
    await writeRuntimeLog(`project:export-timeline failed error=${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
})

  ipcMain.handle('shell:show-in-folder', async (_event, targetPath) => {
    if (!targetPath) {
      shell.openPath(getPaths().capturesRoot)
      return { ok: true }
    }

    shell.showItemInFolder(targetPath)
    return { ok: true }
  })
  ipcMain.handle('shell:copy-text', async (_event, value) => {
    clipboard.writeText(typeof value === 'string' ? value : '')
    return { ok: true }
  })

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  try {
    nativeScreenCaptureState.process?.kill('SIGTERM')
  } catch {}
  stopPointerTracker()
  stopKeyboardTracker()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
