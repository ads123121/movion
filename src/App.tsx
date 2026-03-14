import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import './App.css'
import './studioShell.css'
import type {
  AutoZoomMode,
  BootstrapPayload,
  BackgroundImageImportResult,
  CaptionLabelSize,
  CaptureSource,
  ClipFocusRegion,
  ClipTranscript,
  ClipTranscriptSegment,
  ClipTranscriptWord,
  CursorAnimationStyle,
  CursorClickEvent,
  CursorClickEffect,
  CursorAppearanceAsset,
  CursorCoordinateSpace,
  CursorRenderMode,
  CursorStylePreset,
  CursorTrack,
  CursorTrackPoint,
  CursorVisualKind,
  ImportStateSummary,
  KeyboardShortcutEvent,
  KeyboardShortcutLabelSize,
  LocalProject,
  LocalSettings,
  LocalSettingsPatch,
  MotionPreset,
  ProjectCameraPosition,
  ProjectCameraShape,
  ProjectClipAudioRetake,
  ProjectWorkspacePayload,
  ProjectClip,
  ProjectPatch,
  ProjectSummary,
  ProjectTimelineItem,
  ProjectTimelineTranscriptCut,
  TimelineMusicBed,
  TimelineMusicBedAutomationKeyframe,
  VoiceClarityProfile,
  QualityProfile,
} from './types'
import {
  PREMIUM_CURSOR_APPEARANCE_BY_KIND,
  PREMIUM_CURSOR_APPEARANCE_CATALOG,
} from './cursorAppearancePresets'
import {
  buildAutomaticFocusRegions as buildAutomaticFocusRegionsShared,
  buildFocusMotionSegments as buildFocusMotionSegmentsShared,
  createFocusMotionPoint as createFocusMotionPointShared,
  evaluateFocusMotionEasing as evaluateFocusMotionEasingShared,
  normalizeFocusRegions as normalizeFocusRegionsShared,
} from './shared/focusMotion.js'
import {
  getCursorApproachMetrics as getCursorApproachMetricsShared,
  getCursorPulseEventsForTrack as getCursorPulseEventsForTrackShared,
  inferCursorPulseEvents as inferCursorPulseEventsShared,
} from './shared/cursorTelemetry.js'
import {
  findCursorPointFloorIndex as findCursorPointFloorIndexShared,
  getCursorPointAtTime as getCursorPointAtTimeShared,
  projectDiscreteCursorVisualPoint as projectDiscreteCursorVisualPointShared,
  projectInterpolatedCursorVisualPoint as projectInterpolatedCursorVisualPointShared,
} from './shared/cursorPath.js'
import {
  clampCursorClickEffectStrength,
  CURSOR_CLICK_EFFECT_DURATION_SECONDS,
  getCursorClickEffectOpacity,
  getCursorClickEffectProgress,
  getCursorClickEffectSize,
  LIQUID_GLASS_CURSOR_CLICK_EFFECT_DATA_URL,
} from './shared/cursorClickEffect.js'
import { resolveCursorScaleMetrics } from './shared/cursorScale.js'
import { sampleCursorTrackRange as sampleCursorTrackRangeShared } from './shared/cursorSampling.js'
import {
  compactCursorTrackPoints as compactCursorTrackPointsShared,
  normalizeCursorTrack as normalizeCursorTrackShared,
} from './shared/cursorTrack.js'
import {
  normalizeCursorAppearanceAsset as normalizeCursorAppearanceAssetShared,
  normalizeCursorAppearanceId as normalizeCursorAppearanceIdShared,
  normalizeCursorHotspotRatiosForKind as normalizeCursorHotspotRatiosForKindShared,
  normalizeCursorVisualKind as normalizeCursorVisualKindShared,
  normalizeCursorVisualState as normalizeCursorVisualStateShared,
} from './shared/cursorVisuals.js'

type StudioSection = 'background' | 'capture' | 'camera' | 'cursor' | 'keyboard' | 'captions' | 'audio' | 'export' | 'projects'
type BackgroundMode = 'wallpaper' | 'image' | 'gradient' | 'color'

type StagePlaybackBedEntry = {
  element: HTMLAudioElement
  sourceNode: MediaElementAudioSourceNode
  gainNode: GainNode
  filePath: string
}

type LiveCursorVisualState = {
  x: number
  y: number
  cursorKind: CursorVisualKind
  cursorAppearanceId?: string
  cursorHotspotRatioX?: number
  cursorHotspotRatioY?: number
  referenceWidth?: number
  referenceHeight?: number
}

type ElectronDesktopConstraintMandatory = {
  chromeMediaSource: 'desktop'
  chromeMediaSourceId: string
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  minFrameRate?: number
  maxFrameRate?: number
  googCursorCaptureEnabled?: boolean
}

type ElectronDesktopMediaTrackConstraints = MediaTrackConstraints & {
  mandatory?: ElectronDesktopConstraintMandatory
}

const CURSOR_APPEARANCE_RASTER_SCALE = 12
const CURSOR_APPEARANCE_RASTER_MIN_SIZE = 256
const CURSOR_APPEARANCE_RASTER_MAX_SIZE = 1024
const UI_DATE_LOCALE = 'en-US'

const formatBytes = (value: number) => {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const formatTimer = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

const formatDuration = (seconds: number) => {
  if (!seconds) {
    return '0s'
  }

  if (seconds < 60) {
    return `${seconds}s`
  }

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60

  if (mins < 60) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`
  }

  const hours = Math.floor(mins / 60)
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`
}

const formatGainDb = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`

const formatDateTime = (value: string) => {
  if (!value) {
    return 'Not synced yet'
  }

  return new Intl.DateTimeFormat(UI_DATE_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

const formatEditableSeconds = (value: number | null) => {
  if (value === null) {
    return ''
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

const sanitizeExportName = (value: string) =>
  value
    .replace(/[^a-z0-9\-_. ]+/gi, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

const describeByteSignature = (source: ArrayBuffer | Uint8Array, length = 16) => {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
  return Array.from(bytes.slice(0, length), (value) => value.toString(16).padStart(2, '0')).join(' ')
}

const parseSecondsInput = (value: string) => {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined
  }

  return parsed
}

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const decibelsToGain = (value: number) => Math.pow(10, value / 20)

const disconnectAudioNode = (node: AudioNode | null) => {
  if (!node) {
    return
  }

  try {
    node.disconnect()
  } catch {
    // Audio nodes may already be detached when the graph is rebuilt.
  }
}

const syncMediaElementTime = (element: HTMLMediaElement, targetSeconds: number, toleranceSeconds: number) => {
  try {
    if (Math.abs(element.currentTime - targetSeconds) > toleranceSeconds) {
      element.currentTime = targetSeconds
    }
  } catch {
    return
  }
}

const playMediaElementWhenReady = (
  element: HTMLMediaElement,
  targetSeconds: number,
  toleranceSeconds: number,
  label: string,
) => {
  const startPlayback = () => {
    syncMediaElementTime(element, targetSeconds, toleranceSeconds)
    void element.play().catch((error) => {
      console.warn(`${label} play rejected`, error)
    })
  }

  if (element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
    element.addEventListener('canplay', startPlayback, { once: true })
    return () => element.removeEventListener('canplay', startPlayback)
  }

  startPlayback()
  return undefined
}

const createVoiceClarityPreviewChain = (audioContext: AudioContext, profile: VoiceClarityProfile) => {
  const highpass = audioContext.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = profile === 'strong' ? 90 : 70
  highpass.Q.value = 0.72

  const lowpass = audioContext.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = profile === 'strong' ? 13500 : 15000
  lowpass.Q.value = 0.72

  const compressor = audioContext.createDynamicsCompressor()
  compressor.threshold.value = profile === 'strong' ? -26 : -22
  compressor.knee.value = profile === 'strong' ? 18 : 24
  compressor.ratio.value = profile === 'strong' ? 4.2 : 2.6
  compressor.attack.value = profile === 'strong' ? 0.004 : 0.008
  compressor.release.value = profile === 'strong' ? 0.12 : 0.16

  const makeupGain = audioContext.createGain()
  makeupGain.gain.value = profile === 'strong' ? 1.42 : 1.2

  highpass.connect(lowpass)
  lowpass.connect(compressor)
  compressor.connect(makeupGain)

  return {
    entryNode: highpass,
    exitNode: makeupGain,
    nodes: [highpass, lowpass, compressor, makeupGain],
  }
}

const outputFormatOptions = [
  {
    id: 'mp4',
    label: 'MP4 master',
    detail: 'Master video with audio.',
  },
  {
    id: 'gif',
    label: 'Animated GIF',
    detail: 'Looping silent share asset.',
  },
] as const

const outputAspectOptions = [
  {
    id: 'source',
    label: 'Source canvas',
  },
  {
    id: 'widescreen',
    label: '16:9 widescreen',
  },
  {
    id: 'square',
    label: '1:1 square',
  },
  {
    id: 'portrait',
    label: '9:16 vertical',
  },
  {
    id: 'feed',
    label: '4:5 feed',
  },
] as const

const outputFitModeOptions = [
  {
    id: 'contain',
    label: 'Contain with frame',
  },
  {
    id: 'cover',
    label: 'Cover and crop',
  },
] as const

const autoZoomDetectionOptions: Array<{
  id: AutoZoomMode
  label: string
  detail: string
}> = [
  {
    id: 'off',
    label: 'Off',
    detail: 'Add zoom blocks manually later.',
  },
  {
    id: 'all-clicks',
    label: 'All Clicks',
    detail: 'Build zoom blocks from primary clicks.',
  },
  {
    id: 'long-clicks',
    label: 'Long Clicks',
    detail: 'Only create zooms from held clicks.',
  },
  {
    id: 'ctrl-click',
    label: 'Ctrl+Click',
    detail: 'Only create zooms when Control is held.',
  },
] as const

const bedRoutingOptions = [
  {
    id: 'duck',
    label: 'Duck under voice',
    detail: 'This lane lives in the music bus and is sidechained under narration.',
  },
  {
    id: 'bypass',
    label: 'Bypass ducking',
    detail: 'This lane stays present even while narration is active.',
  },
] as const

const voiceClarityProfileOptions: Array<{
  id: VoiceClarityProfile
  label: string
  detail: string
}> = [
  {
    id: 'balanced',
    label: 'Balanced',
    detail: 'Clean up the isolated microphone stem while keeping the voice natural in stage preview and export.',
  },
  {
    id: 'strong',
    label: 'Strong',
    detail: 'Push harder on denoise and leveling for rougher rooms or noisier mics during preview and export.',
  },
] as const

const defaultCursorStudioSettings: LocalProject['cursor'] = {
  showCursor: true,
  size: 1,
  style: 'windows',
  alwaysPointer: false,
  clickEffect: 'ripple',
  smoothingEnabled: true,
  animationStyle: 'default',
}

const defaultCameraStudioSettings: LocalProject['camera'] = {
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
}

type BackgroundVisualPreset = {
  id: string
  label: string
  primary: string
  secondary: string
  accent: string
  halo: string
  gridOpacity?: number
}

const defaultBackgroundStudioSettings: LocalProject['background'] = {
  mode: 'wallpaper',
  wallpaperId: 'aurora-grid',
  gradientId: 'midnight-bloom',
  colorValue: '#0f1319',
  imagePath: '',
  blur: 0.18,
  padding: 0,
  radius: 0,
  shadow: 0,
}

const defaultShortcutStudioSettings: LocalProject['shortcuts'] = {
  enabled: true,
  showSymbols: false,
  labelSize: 'medium',
}

const defaultCaptionStudioSettings: LocalProject['captions'] = {
  enabled: true,
  wordHighlighting: true,
  showSpeakerLabels: false,
  labelSize: 'medium',
  languageHint: '',
}

const wallpaperPresets: BackgroundVisualPreset[] = [
  {
    id: 'aurora-grid',
    label: 'Aurora Grid',
    primary: '#08111f',
    secondary: '#121a34',
    accent: '#5d7dff',
    halo: '#f5be3d',
    gridOpacity: 0.18,
  },
  {
    id: 'ocean-glow',
    label: 'Ocean Glow',
    primary: '#061a22',
    secondary: '#0d2b39',
    accent: '#4de0ff',
    halo: '#7affc8',
    gridOpacity: 0.12,
  },
  {
    id: 'ember-silk',
    label: 'Ember Silk',
    primary: '#1a0c11',
    secondary: '#32121d',
    accent: '#ff7d66',
    halo: '#ffd36d',
    gridOpacity: 0.08,
  },
  {
    id: 'forest-drive',
    label: 'Forest Drive',
    primary: '#07140d',
    secondary: '#15251c',
    accent: '#58d18d',
    halo: '#d9ff7b',
    gridOpacity: 0.16,
  },
]

const gradientPresets: BackgroundVisualPreset[] = [
  {
    id: 'midnight-bloom',
    label: 'Midnight Bloom',
    primary: '#0d1020',
    secondary: '#1e1730',
    accent: '#6e7cff',
    halo: '#e1a2ff',
  },
  {
    id: 'studio-sunrise',
    label: 'Studio Sunrise',
    primary: '#170f18',
    secondary: '#35181d',
    accent: '#ff8d58',
    halo: '#ffd36d',
  },
  {
    id: 'atlas-cyan',
    label: 'Atlas Cyan',
    primary: '#071621',
    secondary: '#0d2533',
    accent: '#55d3ff',
    halo: '#8fffd9',
  },
  {
    id: 'graphite-lime',
    label: 'Graphite Lime',
    primary: '#101410',
    secondary: '#1a2217',
    accent: '#96ff69',
    halo: '#d7ff91',
  },
]

const backgroundColorChips = ['#0f1319', '#161b29', '#201622', '#0a1e1d', '#1d170c', '#111111']

const cursorStyleOptions: Array<{
  id: CursorStylePreset
  label: string
  detail: string
}> = [
  {
    id: 'windows',
    label: 'Windows',
    detail: 'Sharp white arrow.',
  },
  {
    id: 'mac',
    label: 'Mac',
    detail: 'Soft edge, dark outline.',
  },
  {
    id: 'touch',
    label: 'Touch',
    detail: 'Rounded touch dot.',
  },
]

const cursorClickEffectOptions: Array<{
  id: CursorClickEffect
  label: string
}> = [
  {
    id: 'none',
    label: 'None',
  },
  {
    id: 'ripple',
    label: 'Liquid Glass',
  },
]

const cursorAnimationStyleOptions: Array<{
  id: CursorAnimationStyle
  label: string
}> = [
  {
    id: 'molasses',
    label: 'Glide',
  },
  {
    id: 'default',
    label: 'Balanced',
  },
  {
    id: 'gentle',
    label: 'Cinematic',
  },
  {
    id: 'stiff',
    label: 'Snappy',
  },
]

const keyboardShortcutSizeOptions: Array<{
  id: KeyboardShortcutLabelSize
  label: string
  detail: string
}> = [
  {
    id: 'small',
    label: 'Small',
    detail: 'Dense screens.',
  },
  {
    id: 'medium',
    label: 'Medium',
    detail: 'Default.',
  },
  {
    id: 'large',
    label: 'Large',
    detail: 'Training first.',
  },
] as const

const captionSizeOptions: Array<{
  id: CaptionLabelSize
  label: string
  detail: string
}> = [
  {
    id: 'small',
    label: 'Small',
    detail: 'Picture first.',
  },
  {
    id: 'medium',
    label: 'Medium',
    detail: 'Balanced.',
  },
  {
    id: 'large',
    label: 'Large',
    detail: 'Reading first.',
  },
] as const

const cameraPositionOptions: Array<{
  id: ProjectCameraPosition
  label: string
}> = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-center', label: 'Top center' },
  { id: 'top-right', label: 'Top right' },
  { id: 'center-left', label: 'Center left' },
  { id: 'center', label: 'Center' },
  { id: 'center-right', label: 'Center right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-center', label: 'Bottom center' },
  { id: 'bottom-right', label: 'Bottom right' },
]

const cameraShapeOptions: Array<{
  id: ProjectCameraShape
  label: string
  detail: string
}> = [
  { id: 'circle', label: 'Circle', detail: 'Bubble-style presenter cutout.' },
  { id: 'rounded', label: 'Rounded', detail: 'Mini camera card with softer corners.' },
]

const cursorSampleIntervalMs = 16
const clampUnit = (value: number) => clampNumber(value, 0, 1)

const automationGainRange = {
  min: -18,
  max: 18,
}

function StudioIcon({
  name,
  className,
}: {
  name:
    | 'menu'
    | 'background'
    | 'capture'
    | 'camera'
    | 'cursor'
    | 'keyboard'
    | 'captions'
    | 'audio'
    | 'export'
    | 'projects'
    | 'undo'
    | 'redo'
    | 'play'
    | 'pause'
    | 'back'
    | 'forward'
    | 'folder'
    | 'spark'
  className?: string
}) {
  const commonProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: `studio-icon ${className ?? ''}`.trim(),
    'aria-hidden': true,
  }

  switch (name) {
    case 'menu':
      return (
        <svg {...commonProps}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      )
    case 'background':
      return (
        <svg {...commonProps}>
          <rect x="4" y="5" width="16" height="14" rx="2.6" />
          <path d="M7 15l3.6-3.6L14 14l2.1-2.1L19 15" />
          <circle cx="9" cy="9" r="1.4" />
        </svg>
      )
    case 'capture':
      return (
        <svg {...commonProps}>
          <rect x="4" y="6" width="12" height="12" rx="2.4" />
          <path d="M16 10l4-2.4v8.8L16 14" />
        </svg>
      )
    case 'camera':
      return (
        <svg {...commonProps}>
          <rect x="5" y="7" width="10" height="10" rx="3" />
          <path d="M15 10l4-2.4v8.8L15 14" />
        </svg>
      )
    case 'cursor':
      return (
        <svg {...commonProps}>
          <path d="M6 4l9 9-4.3 1.3L9.4 19 6 4z" />
        </svg>
      )
    case 'keyboard':
      return (
        <svg {...commonProps}>
          <rect x="4" y="7" width="16" height="10" rx="2.6" />
          <path d="M7 10h1" />
          <path d="M10 10h1" />
          <path d="M13 10h1" />
          <path d="M16 10h1" />
          <path d="M7 14h10" />
        </svg>
      )
    case 'captions':
      return (
        <svg {...commonProps}>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="M7 10h10" />
          <path d="M7 14h7" />
          <path d="M15 14h2" />
        </svg>
      )
    case 'audio':
      return (
        <svg {...commonProps}>
          <path d="M5 14h3l4 4V6l-4 4H5z" />
          <path d="M16 9.2a4.8 4.8 0 010 5.6" />
          <path d="M18.9 6.7a8 8 0 010 10.6" />
        </svg>
      )
    case 'export':
      return (
        <svg {...commonProps}>
          <path d="M12 4v10" />
          <path d="M8 8l4-4 4 4" />
          <rect x="5" y="14" width="14" height="6" rx="2.4" />
        </svg>
      )
    case 'projects':
      return (
        <svg {...commonProps}>
          <path d="M5 7h14" />
          <path d="M5 12h14" />
          <path d="M5 17h9" />
          <circle cx="17.5" cy="17.5" r="1.5" />
        </svg>
      )
    case 'undo':
      return (
        <svg {...commonProps}>
          <path d="M9 8L5 12l4 4" />
          <path d="M5 12h8a5 5 0 015 5" />
        </svg>
      )
    case 'redo':
      return (
        <svg {...commonProps}>
          <path d="M15 8l4 4-4 4" />
          <path d="M19 12h-8a5 5 0 00-5 5" />
        </svg>
      )
    case 'play':
      return (
        <svg {...commonProps}>
          <path d="M9 7l8 5-8 5z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...commonProps}>
          <path d="M9 7v10" />
          <path d="M15 7v10" />
        </svg>
      )
    case 'back':
      return (
        <svg {...commonProps}>
          <path d="M11 7l-5 5 5 5" />
          <path d="M18 7l-5 5 5 5" />
        </svg>
      )
    case 'forward':
      return (
        <svg {...commonProps}>
          <path d="M13 7l5 5-5 5" />
          <path d="M6 7l5 5-5 5" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...commonProps}>
          <path d="M4 8.5h5l2 2H20v7.5a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
          <path d="M4 8.5V7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1.5" />
        </svg>
      )
    case 'spark':
      return (
        <svg {...commonProps}>
          <path d="M12 4l1.4 4.6L18 10l-4.6 1.4L12 16l-1.4-4.6L6 10l4.6-1.4z" />
        </svg>
      )
    default:
      return null
  }
}

const normalizeCursorVisualKind = normalizeCursorVisualKindShared
const normalizeCursorAppearanceId = normalizeCursorAppearanceIdShared
const normalizeCursorHotspotRatiosForKind = normalizeCursorHotspotRatiosForKindShared
const normalizeCursorVisualState = normalizeCursorVisualStateShared
const normalizeCursorAppearanceAsset = normalizeCursorAppearanceAssetShared
const normalizeCursorHotspotRatio = (value: number | null | undefined, fallback: number) =>
  Number(clampUnit(Number.isFinite(value) ? Number(value) : fallback).toFixed(4))

type CursorPulseEvent = {
  id: string
  timeSeconds: number
  x: number
  y: number
  strength: number
}

type FocusMotionPoint = {
  timeSeconds: number
  zoom: number
  focusX: number
  focusY: number
}

type FocusMotionEasingId =
  | 'linear'
  | 'cinematicZoom'
  | 'cinematicFocus'
  | 'cinematicReframe'
  | 'cinematicExit'

type FocusMotionSegment = {
  startSeconds: number
  endSeconds: number
  from: FocusMotionPoint
  to: FocusMotionPoint
  zoomEasing: FocusMotionEasingId
  focusEasing: FocusMotionEasingId
}

const AUTO_FOCUS_APPROACH_LOOKBACK_SECONDS = 0.36
const CURSOR_KIND_TRANSITION_SECONDS = 0.09

function getCursorApproachMetrics(points: CursorTrackPoint[], targetTimeSeconds: number) {
  return getCursorApproachMetricsShared(points, targetTimeSeconds, {
    lookbackSeconds: AUTO_FOCUS_APPROACH_LOOKBACK_SECONDS,
    sampleRange: sampleCursorTrackRange,
  })
}

function inferCursorPulseEvents(points: CursorTrackPoint[]) {
  return inferCursorPulseEventsShared(points)
}

function getCursorPulseEventsForTrack(cursorTrack: CursorTrack | null | undefined) {
  return getCursorPulseEventsForTrackShared(cursorTrack)
}

function getCursorPointAtTime(
  points: CursorTrackPoint[],
  timeSeconds: number,
  smoothingEnabled: boolean,
  animationStyle: CursorAnimationStyle,
) {
  return getCursorPointAtTimeShared(points, timeSeconds, {
    smoothingEnabled,
    animationStyle,
    projectDiscretePoint: (point, targetTime) =>
      projectDiscreteCursorVisualPointShared(point, targetTime, {
        includeTimeSeconds: false,
      }),
    projectInterpolatedPoint: (context) =>
      projectInterpolatedCursorVisualPointShared(context, {
        includeTimeSeconds: false,
      }),
  })
}

function sampleCursorTrackRange(
  points: CursorTrackPoint[],
  startSeconds: number,
  endSeconds: number,
): Array<{ timeSeconds: number; x: number; y: number }> {
  return sampleCursorTrackRangeShared(points, startSeconds, endSeconds, {
    getPointAtTime: (sourcePoints, targetTimeSeconds) => {
      const point = getCursorPointAtTime(sourcePoints, targetTimeSeconds, true, 'gentle')

      return point
        ? {
            timeSeconds: targetTimeSeconds,
            ...point,
          }
        : null
    },
    projectPoint: (point, sampledTimeSeconds) => ({
      timeSeconds: sampledTimeSeconds,
      x: point.x,
      y: point.y,
    }),
  })
}

const buildCursorPointerPath = (context: CanvasRenderingContext2D) => {
  context.beginPath()
  context.moveTo(0, 0)
  context.lineTo(0, 24)
  context.lineTo(5.4, 18.6)
  context.lineTo(9.8, 30)
  context.lineTo(13.2, 28.5)
  context.lineTo(8.7, 17.8)
  context.lineTo(18.8, 17)
  context.closePath()
}

const drawArrowCursorGlyph = (
  context: CanvasRenderingContext2D,
  style: CursorStylePreset,
  fillOpacity: number,
  outlineOpacity: number,
  glossOpacity: number,
) => {
  const fillGradient = context.createLinearGradient(-2, -2, 14, 30)
  fillGradient.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, fillOpacity).toFixed(3)})`)
  fillGradient.addColorStop(1, `rgba(234, 240, 255, ${(fillOpacity * 0.92).toFixed(3)})`)

  buildCursorPointerPath(context)
  context.fillStyle = fillGradient
  context.fill()
  context.lineWidth = style === 'mac' ? 2.05 : 2.45
  context.strokeStyle =
    style === 'mac'
      ? `rgba(10, 13, 20, ${outlineOpacity.toFixed(3)})`
      : `rgba(0, 0, 0, ${(outlineOpacity * 0.92).toFixed(3)})`
  context.stroke()

  if (glossOpacity > 0.01) {
    context.save()
    buildCursorPointerPath(context)
    context.clip()
    context.beginPath()
    context.moveTo(1.2, 3.2)
    context.lineTo(1.2, 18.4)
    context.strokeStyle = `rgba(255, 255, 255, ${glossOpacity.toFixed(3)})`
    context.lineWidth = 1.4
    context.stroke()
    context.restore()
  }
}

const drawHandCursorGlyph = (
  context: CanvasRenderingContext2D,
  style: CursorStylePreset,
  fillOpacity: number,
  outlineOpacity: number,
  glossOpacity: number,
) => {
  const handPath = new Path2D(
    'M0 0C-0.3 1.7 0.2 3.2 1.1 4.4L1.1 15.4C1.1 17.6 2.9 19.4 5.1 19.4C5.9 19.4 6.7 19.1 7.3 18.6L7.3 10.4C7.3 9 8.4 7.9 9.8 7.9C11.2 7.9 12.3 9 12.3 10.4L12.3 14.4L14.3 14.4L14.3 7.6C14.3 6.2 15.4 5.1 16.8 5.1C18.2 5.1 19.3 6.2 19.3 7.6L19.3 14.4L21.3 14.4L21.3 9.4C21.3 8.1 22.3 7.1 23.6 7.1C24.9 7.1 25.9 8.1 25.9 9.4L25.9 18.2C25.9 24.2 21.5 28.8 15.5 29.2L11.4 29.4C8.6 29.6 6 28.6 4 26.6L1.6 24.2C0.6 23.2 0 21.8 0 20.4Z',
  )
  const fillGradient = context.createLinearGradient(0, 0, 22, 30)
  fillGradient.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, fillOpacity).toFixed(3)})`)
  fillGradient.addColorStop(1, `rgba(240, 244, 255, ${(fillOpacity * 0.94).toFixed(3)})`)

  context.fillStyle = fillGradient
  context.fill(handPath)
  context.lineWidth = style === 'mac' ? 1.85 : 2.25
  context.strokeStyle =
    style === 'mac'
      ? `rgba(10, 13, 20, ${outlineOpacity.toFixed(3)})`
      : `rgba(0, 0, 0, ${(outlineOpacity * 0.92).toFixed(3)})`
  context.stroke(handPath)

  if (glossOpacity > 0.01) {
    context.save()
    context.clip(handPath)
    context.beginPath()
    context.moveTo(4.8, 2.4)
    context.lineTo(4.8, 18)
    context.strokeStyle = `rgba(255, 255, 255, ${glossOpacity.toFixed(3)})`
    context.lineWidth = 1.2
    context.stroke()
    context.restore()
  }
}

const drawIBeamCursorGlyph = (
  context: CanvasRenderingContext2D,
  style: CursorStylePreset,
  fillOpacity: number,
  outlineOpacity: number,
) => {
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle =
    style === 'mac'
      ? `rgba(10, 13, 20, ${outlineOpacity.toFixed(3)})`
      : `rgba(0, 0, 0, ${(outlineOpacity * 0.94).toFixed(3)})`
  context.lineWidth = style === 'mac' ? 6 : 6.6
  context.beginPath()
  context.moveTo(0, -14)
  context.lineTo(0, 14)
  context.moveTo(-6.6, -13)
  context.lineTo(6.6, -13)
  context.moveTo(-6.6, 13)
  context.lineTo(6.6, 13)
  context.stroke()

  context.strokeStyle = `rgba(255, 255, 255, ${fillOpacity.toFixed(3)})`
  context.lineWidth = style === 'mac' ? 3.2 : 3.6
  context.beginPath()
  context.moveTo(0, -14)
  context.lineTo(0, 14)
  context.moveTo(-6.2, -13)
  context.lineTo(6.2, -13)
  context.moveTo(-6.2, 13)
  context.lineTo(6.2, 13)
  context.stroke()
}

const drawCrosshairCursorGlyph = (
  context: CanvasRenderingContext2D,
  fillOpacity: number,
  outlineOpacity: number,
) => {
  context.lineCap = 'round'
  context.strokeStyle = `rgba(0, 0, 0, ${outlineOpacity.toFixed(3)})`
  context.lineWidth = 5
  context.beginPath()
  context.moveTo(-10, 0)
  context.lineTo(10, 0)
  context.moveTo(0, -10)
  context.lineTo(0, 10)
  context.stroke()

  context.strokeStyle = `rgba(255, 255, 255, ${fillOpacity.toFixed(3)})`
  context.lineWidth = 2.6
  context.beginPath()
  context.moveTo(-10, 0)
  context.lineTo(10, 0)
  context.moveTo(0, -10)
  context.lineTo(0, 10)
  context.stroke()
}

const drawAxisResizeCursorGlyph = (
  context: CanvasRenderingContext2D,
  axis: 'horizontal' | 'vertical',
  fillOpacity: number,
  outlineOpacity: number,
) => {
  context.save()
  if (axis === 'vertical') {
    context.rotate(Math.PI / 2)
  }

  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = `rgba(0, 0, 0, ${outlineOpacity.toFixed(3)})`
  context.lineWidth = 5.4
  context.beginPath()
  context.moveTo(-12, 0)
  context.lineTo(12, 0)
  context.moveTo(-12, 0)
  context.lineTo(-6, -5)
  context.moveTo(-12, 0)
  context.lineTo(-6, 5)
  context.moveTo(12, 0)
  context.lineTo(6, -5)
  context.moveTo(12, 0)
  context.lineTo(6, 5)
  context.stroke()

  context.strokeStyle = `rgba(255, 255, 255, ${fillOpacity.toFixed(3)})`
  context.lineWidth = 2.8
  context.beginPath()
  context.moveTo(-12, 0)
  context.lineTo(12, 0)
  context.moveTo(-12, 0)
  context.lineTo(-6, -5)
  context.moveTo(-12, 0)
  context.lineTo(-6, 5)
  context.moveTo(12, 0)
  context.lineTo(6, -5)
  context.moveTo(12, 0)
  context.lineTo(6, 5)
  context.stroke()
  context.restore()
}

const drawDiagonalResizeCursorGlyph = (
  context: CanvasRenderingContext2D,
  rotationDegrees: number,
  fillOpacity: number,
  outlineOpacity: number,
) => {
  context.save()
  context.rotate((rotationDegrees * Math.PI) / 180)
  drawAxisResizeCursorGlyph(context, 'horizontal', fillOpacity, outlineOpacity)
  context.restore()
}

const drawMoveCursorGlyph = (
  context: CanvasRenderingContext2D,
  fillOpacity: number,
  outlineOpacity: number,
) => {
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = `rgba(0, 0, 0, ${outlineOpacity.toFixed(3)})`
  context.lineWidth = 5.4
  context.beginPath()
  context.moveTo(-11, 0)
  context.lineTo(11, 0)
  context.moveTo(0, -11)
  context.lineTo(0, 11)
  context.moveTo(-11, 0)
  context.lineTo(-6, -5)
  context.moveTo(-11, 0)
  context.lineTo(-6, 5)
  context.moveTo(11, 0)
  context.lineTo(6, -5)
  context.moveTo(11, 0)
  context.lineTo(6, 5)
  context.moveTo(0, -11)
  context.lineTo(-5, -6)
  context.moveTo(0, -11)
  context.lineTo(5, -6)
  context.moveTo(0, 11)
  context.lineTo(-5, 6)
  context.moveTo(0, 11)
  context.lineTo(5, 6)
  context.stroke()

  context.strokeStyle = `rgba(255, 255, 255, ${fillOpacity.toFixed(3)})`
  context.lineWidth = 2.8
  context.beginPath()
  context.moveTo(-11, 0)
  context.lineTo(11, 0)
  context.moveTo(0, -11)
  context.lineTo(0, 11)
  context.moveTo(-11, 0)
  context.lineTo(-6, -5)
  context.moveTo(-11, 0)
  context.lineTo(-6, 5)
  context.moveTo(11, 0)
  context.lineTo(6, -5)
  context.moveTo(11, 0)
  context.lineTo(6, 5)
  context.moveTo(0, -11)
  context.lineTo(-5, -6)
  context.moveTo(0, -11)
  context.lineTo(5, -6)
  context.moveTo(0, 11)
  context.lineTo(-5, 6)
  context.moveTo(0, 11)
  context.lineTo(5, 6)
  context.stroke()
}

const drawNotAllowedCursorGlyph = (
  context: CanvasRenderingContext2D,
  style: CursorStylePreset,
  fillOpacity: number,
  outlineOpacity: number,
  glossOpacity: number,
) => {
  drawArrowCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity)
  context.save()
  context.translate(17.2, 18.8)

  context.beginPath()
  context.arc(0, 0, 6.8, 0, Math.PI * 2)
  context.fillStyle = `rgba(255, 255, 255, ${Math.min(1, fillOpacity).toFixed(3)})`
  context.fill()
  context.lineWidth = 2.2
  context.strokeStyle = `rgba(12, 16, 24, ${outlineOpacity.toFixed(3)})`
  context.stroke()

  context.beginPath()
  context.moveTo(-3.9, 3.9)
  context.lineTo(3.9, -3.9)
  context.lineWidth = 2.4
  context.lineCap = 'round'
  context.strokeStyle = `rgba(218, 61, 61, ${(0.92 * fillOpacity).toFixed(3)})`
  context.stroke()
  context.restore()
}

const drawHelpCursorGlyph = (
  context: CanvasRenderingContext2D,
  style: CursorStylePreset,
  fillOpacity: number,
  outlineOpacity: number,
  glossOpacity: number,
) => {
  drawArrowCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity)
  context.save()
  context.translate(17.1, 18.6)

  context.beginPath()
  context.arc(0, 0, 6.4, 0, Math.PI * 2)
  context.fillStyle = `rgba(255, 255, 255, ${Math.min(1, fillOpacity).toFixed(3)})`
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = `rgba(12, 16, 24, ${outlineOpacity.toFixed(3)})`
  context.stroke()

  context.beginPath()
  context.moveTo(-1.8, -1.3)
  context.bezierCurveTo(-1.8, -3.8, 2.4, -3.8, 2.4, -1)
  context.bezierCurveTo(2.4, 1, 0.3, 1.4, -0.1, 2.7)
  context.lineWidth = 1.9
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = `rgba(70, 108, 243, ${(0.96 * fillOpacity).toFixed(3)})`
  context.stroke()

  context.beginPath()
  context.arc(0.2, 4.4, 1.1, 0, Math.PI * 2)
  context.fillStyle = `rgba(70, 108, 243, ${(0.96 * fillOpacity).toFixed(3)})`
  context.fill()
  context.restore()
}

const drawWaitCursorGlyph = (
  context: CanvasRenderingContext2D,
  style: CursorStylePreset,
  fillOpacity: number,
  outlineOpacity: number,
  glossOpacity: number,
  frameTimeSeconds: number,
) => {
  drawArrowCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity)
  context.save()
  context.translate(17.1, 18.6)
  context.rotate(frameTimeSeconds * 5.4)

  context.beginPath()
  context.arc(0, 0, 6.8, 0, Math.PI * 2)
  context.lineWidth = 2.2
  context.strokeStyle = `rgba(12, 16, 24, ${(outlineOpacity * 0.26).toFixed(3)})`
  context.stroke()

  context.beginPath()
  context.arc(0, 0, 6.8, -Math.PI * 0.5, Math.PI * 0.35)
  context.lineWidth = 2.8
  context.lineCap = 'round'
  context.strokeStyle = `rgba(70, 108, 243, ${(0.94 * fillOpacity).toFixed(3)})`
  context.stroke()
  context.restore()
}

const drawCursorGlyph = (
  context: CanvasRenderingContext2D,
  cursorKind: CursorVisualKind,
  style: CursorStylePreset,
  fillOpacity: number,
  outlineOpacity: number,
  glossOpacity: number,
  frameTimeSeconds = 0,
) => {
  switch (cursorKind) {
    case 'hand':
      drawHandCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity)
      return
    case 'ibeam':
      drawIBeamCursorGlyph(context, style, fillOpacity, outlineOpacity)
      return
    case 'crosshair':
      drawCrosshairCursorGlyph(context, fillOpacity, outlineOpacity)
      return
    case 'resize-ew':
      drawAxisResizeCursorGlyph(context, 'horizontal', fillOpacity, outlineOpacity)
      return
    case 'resize-ns':
      drawAxisResizeCursorGlyph(context, 'vertical', fillOpacity, outlineOpacity)
      return
    case 'resize-nesw':
      drawDiagonalResizeCursorGlyph(context, -45, fillOpacity, outlineOpacity)
      return
    case 'resize-nwse':
      drawDiagonalResizeCursorGlyph(context, 45, fillOpacity, outlineOpacity)
      return
    case 'move':
      drawMoveCursorGlyph(context, fillOpacity, outlineOpacity)
      return
    case 'help':
      drawHelpCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity)
      return
    case 'not-allowed':
      drawNotAllowedCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity)
      return
    case 'wait':
      drawWaitCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity, frameTimeSeconds)
      return
    default:
      drawArrowCursorGlyph(context, style, fillOpacity, outlineOpacity, glossOpacity)
  }
}

const getCursorGlyphHotspotOffset = (
  cursorKind: CursorVisualKind,
  style: CursorStylePreset,
  cursorHotspotRatioX?: number,
  cursorHotspotRatioY?: number,
) => {
  const normalizedHotspotX = normalizeCursorHotspotRatio(cursorHotspotRatioX, 0)
  const normalizedHotspotY = normalizeCursorHotspotRatio(cursorHotspotRatioY, 0)

  const projectHotspotFromRatios = (
    width: number,
    height: number,
    origin: 'top-left' | 'center',
    fallbackOffset: { x: number; y: number },
  ) => {
    if (
      normalizedHotspotX <= 0.0001 &&
      normalizedHotspotY <= 0.0001 &&
      !(cursorKind === 'arrow' || cursorKind === 'wait' || cursorKind === 'help' || cursorKind === 'not-allowed')
    ) {
      return fallbackOffset
    }

    if (origin === 'center') {
      return {
        x: Number(((normalizedHotspotX - 0.5) * width).toFixed(3)),
        y: Number(((normalizedHotspotY - 0.5) * height).toFixed(3)),
      }
    }

    return {
      x: Number((normalizedHotspotX * width).toFixed(3)),
      y: Number((normalizedHotspotY * height).toFixed(3)),
    }
  }

  switch (cursorKind) {
    case 'hand':
      return projectHotspotFromRatios(
        26,
        30,
        'top-left',
        style === 'mac'
          ? { x: 9.4, y: 2.2 }
          : { x: 10.1, y: 2.6 },
      )
    case 'ibeam':
      return projectHotspotFromRatios(13.2, 28, 'center', { x: 0, y: 0 })
    case 'crosshair':
      return projectHotspotFromRatios(20, 20, 'center', { x: 0, y: 0 })
    case 'move':
      return projectHotspotFromRatios(22, 22, 'center', { x: 0, y: 0 })
    case 'resize-ew':
      return projectHotspotFromRatios(24, 10, 'center', { x: 0, y: 0 })
    case 'resize-ns':
      return projectHotspotFromRatios(10, 24, 'center', { x: 0, y: 0 })
    case 'resize-nesw':
      return projectHotspotFromRatios(22, 22, 'center', { x: 0, y: 0 })
    case 'resize-nwse':
      return projectHotspotFromRatios(22, 22, 'center', { x: 0, y: 0 })
    case 'help':
    case 'not-allowed':
    case 'wait':
    case 'arrow':
    default:
      return projectHotspotFromRatios(19, 30, 'top-left', { x: 0, y: 0 })
  }
}

const getCursorKindTransitionState = (
  points: CursorTrackPoint[],
  timeSeconds: number,
  currentKind: CursorVisualKind,
  currentAppearanceId: string,
) => {
  if (points.length < 2) {
    return null
  }

  const currentIndex = findCursorPointFloorIndexShared(points, timeSeconds)

  let effectiveCurrentKind = normalizeCursorVisualKind(points[currentIndex]?.cursorKind ?? currentKind)
  let effectiveCurrentAppearanceId = normalizeCursorAppearanceId(
    points[currentIndex]?.cursorAppearanceId ?? currentAppearanceId,
  )
  if (effectiveCurrentKind !== currentKind) {
    effectiveCurrentKind = currentKind
  }
  if (effectiveCurrentAppearanceId !== currentAppearanceId) {
    effectiveCurrentAppearanceId = currentAppearanceId
  }

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const previousKind = normalizeCursorVisualKind(points[index]?.cursorKind)
    const previousAppearanceId = normalizeCursorAppearanceId(points[index]?.cursorAppearanceId)

    if (previousKind === effectiveCurrentKind && previousAppearanceId === effectiveCurrentAppearanceId) {
      continue
    }

    const transitionStartSeconds = points[index + 1]?.timeSeconds ?? points[currentIndex]?.timeSeconds ?? timeSeconds
    const progress = clampUnit((timeSeconds - transitionStartSeconds) / CURSOR_KIND_TRANSITION_SECONDS)

    if (progress >= 1) {
      return null
    }

    return {
      previousKind,
      previousAppearanceId,
      progress,
      previousHotspotRatioX: normalizeCursorHotspotRatio(points[index]?.cursorHotspotRatioX, 0),
      previousHotspotRatioY: normalizeCursorHotspotRatio(points[index]?.cursorHotspotRatioY, 0),
    }
  }

  return null
}

const lerpNumber = (left: number, right: number, progress: number) => left + (right - left) * progress
const smootherStep = (progress: number) => {
  const clampedProgress = clampUnit(progress)
  return clampedProgress ** 3 * (clampedProgress * (clampedProgress * 6 - 15) + 10)
}

function buildFocusMotionSegments(
  focusRegions: ClipFocusRegion[],
  durationSeconds: number,
  idleFocusX = 0.5,
  idleFocusY = 0.5,
  cursorTrack: CursorTrack | null = null,
) {
  return buildFocusMotionSegmentsShared(focusRegions, durationSeconds, {
    idleFocusX,
    idleFocusY,
    cursorTrack,
    getCursorApproachMetrics,
  })
}

function getFocusMotionStateAtTime(segments: FocusMotionSegment[], timeSeconds: number) {
  if (!segments.length) {
    return null
  }

  const targetTime = Math.max(0, timeSeconds)
  const activeSegment =
    segments.find((segment) => targetTime <= segment.endSeconds) ?? segments[segments.length - 1]

  if (!activeSegment) {
    return null
  }

  if (targetTime <= activeSegment.startSeconds) {
    return activeSegment.from
  }

  const span = Math.max(0.001, activeSegment.endSeconds - activeSegment.startSeconds)
  const progress = clampUnit((targetTime - activeSegment.startSeconds) / span)
  const zoomProgress = evaluateFocusMotionEasingShared(activeSegment.zoomEasing, progress)
  const focusProgress = evaluateFocusMotionEasingShared(activeSegment.focusEasing, progress)

  return createFocusMotionPointShared(targetTime, {
    zoom: lerpNumber(activeSegment.from.zoom, activeSegment.to.zoom, zoomProgress),
    focusX: lerpNumber(activeSegment.from.focusX, activeSegment.to.focusX, focusProgress),
    focusY: lerpNumber(activeSegment.from.focusY, activeSegment.to.focusY, focusProgress),
  })
}

const getFileUrlFromWindowsPath = (filePath: string) => {
  if (!filePath) {
    return ''
  }

  const params = new URLSearchParams({
    path: filePath,
  })
  return `movion-media://local?${params.toString()}`
}

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace('#', '')
  const safeHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized.padEnd(6, '0').slice(0, 6)
  const red = Number.parseInt(safeHex.slice(0, 2), 16)
  const green = Number.parseInt(safeHex.slice(2, 4), 16)
  const blue = Number.parseInt(safeHex.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

const getBackgroundVisualPreset = (
  background: LocalProject['background'],
): BackgroundVisualPreset => {
  const presetCollection = background.mode === 'gradient' ? gradientPresets : wallpaperPresets
  const presetId = background.mode === 'gradient' ? background.gradientId : background.wallpaperId

  return (
    presetCollection.find((preset) => preset.id === presetId) ??
    presetCollection[0]
  )
}

const buildPresetBackgroundImage = (preset: BackgroundVisualPreset) => {
  const layers = [
    `radial-gradient(circle at 18% 18%, ${hexToRgba(preset.halo, 0.42)} 0%, transparent 30%)`,
    `radial-gradient(circle at 84% 16%, ${hexToRgba(preset.accent, 0.3)} 0%, transparent 28%)`,
    `linear-gradient(145deg, ${preset.primary}, ${preset.secondary})`,
  ]

  if (preset.gridOpacity) {
    layers.unshift(
      `linear-gradient(${hexToRgba('#ffffff', preset.gridOpacity)} 1px, transparent 1px)`,
      `linear-gradient(90deg, ${hexToRgba('#ffffff', preset.gridOpacity)} 1px, transparent 1px)`,
    )
  }

  return layers.join(', ')
}

const buildBackgroundLayerStyle = (background: LocalProject['background']): CSSProperties => {
  if (background.mode === 'image' && background.imagePath) {
    return {
      backgroundImage: `url("${getFileUrlFromWindowsPath(background.imagePath)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }

  if (background.mode === 'color') {
    return {
      backgroundColor: background.colorValue,
    }
  }

  const preset = getBackgroundVisualPreset(background)
  const style: CSSProperties = {
    backgroundImage: buildPresetBackgroundImage(preset),
    backgroundSize: preset.gridOpacity ? '36px 36px, 36px 36px, auto, auto, auto' : 'auto',
    backgroundPosition: preset.gridOpacity ? '0 0, 0 0, center, center, center' : 'center',
  }

  return style
}

const getSurfaceInsetPercent = (background: LocalProject['background']) =>
  `${Math.round(clampNumber(background.padding, 0, 0.22) * 100)}%`

const getSurfaceRadiusPercent = (background: LocalProject['background']) =>
  `${Math.round(clampNumber(background.radius, 0, 0.18) * 100)}%`

const hasBackgroundFrameTreatment = (background: LocalProject['background']) =>
  clampNumber(background.padding, 0, 0.22) > 0.001 ||
  clampNumber(background.radius, 0, 0.18) > 0.001 ||
  clampNumber(background.shadow, 0, 0.9) > 0.001

const buildStageSurfaceStyle = (background: LocalProject['background']): CSSProperties => {
  if (!hasBackgroundFrameTreatment(background)) {
    return {
      inset: '0%',
      borderRadius: '0%',
      boxShadow: 'none',
      border: 'none',
      background: 'transparent',
      backdropFilter: 'none',
    }
  }

  return {
    inset: getSurfaceInsetPercent(background),
    borderRadius: getSurfaceRadiusPercent(background),
    boxShadow: `0 ${Math.round(18 + background.shadow * 26)}px ${Math.round(40 + background.shadow * 54)}px ${hexToRgba(
      '#000000',
      0.24 + background.shadow * 0.24,
    )}`,
  }
}

const buildStageBackgroundBlurStyle = (background: LocalProject['background']): CSSProperties => ({
  filter: `blur(${Math.round(background.blur * 64)}px)`,
  transform: 'scale(1.08)',
})

const resolveCameraDeviceLabel = (camera: LocalProject['camera'], devices: MediaDeviceInfo[]) => {
  if (camera.deviceLabel) {
    return camera.deviceLabel
  }

  if (camera.deviceId) {
    return devices.find((device) => device.deviceId === camera.deviceId)?.label || 'Selected camera'
  }

  return devices[0]?.label || 'Built-in camera'
}

const resolveMicrophoneDeviceLabel = (settings: LocalSettings | null, devices: MediaDeviceInfo[]) => {
  if (settings?.capture.microphoneDeviceId) {
    return devices.find((device) => device.deviceId === settings.capture.microphoneDeviceId)?.label || 'Selected microphone'
  }

  return devices[0]?.label || 'Default microphone'
}

const buildStageCameraStyle = (camera: LocalProject['camera']): CSSProperties => {
  const widthPercent = `${Math.round(clampNumber(camera.size, 0.14, 0.38) * 100)}%`
  const inset = `${(4.2 + clampNumber(camera.offset, 0, 1) * 8.6).toFixed(1)}%`
  const isCircle = camera.shape === 'circle'
  const horizontalAnchor = camera.position.endsWith('left')
    ? 'left'
    : camera.position.endsWith('right')
      ? 'right'
      : 'center'
  const verticalAnchor = camera.position.startsWith('top')
    ? 'top'
    : camera.position.startsWith('bottom')
      ? 'bottom'
      : 'center'

  return {
    width: widthPercent,
    aspectRatio: isCircle ? '1 / 1' : '16 / 9',
    borderRadius: isCircle ? '999px' : `${Math.round(clampNumber(camera.roundness, 0.08, 0.48) * 100)}%`,
    boxShadow: `0 ${Math.round(12 + camera.shadow * 18)}px ${Math.round(24 + camera.shadow * 34)}px ${hexToRgba(
      '#000000',
      0.24 + camera.shadow * 0.26,
    )}`,
    border: `1px solid ${hexToRgba('#ffffff', 0.12 + clampNumber(camera.border, 0, 1) * 0.18)}`,
    top: verticalAnchor === 'top' ? inset : verticalAnchor === 'center' ? '50%' : 'auto',
    right: horizontalAnchor === 'right' ? inset : 'auto',
    bottom: verticalAnchor === 'bottom' ? inset : 'auto',
    left: horizontalAnchor === 'left' ? inset : horizontalAnchor === 'center' ? '50%' : 'auto',
    translate: `${horizontalAnchor === 'center' ? '-50%' : '0'} ${verticalAnchor === 'center' ? '-50%' : '0'}`,
  }
}

const fitRectIntoFrame = ({
  sourceWidth,
  sourceHeight,
  frameWidth,
  frameHeight,
  fitMode,
}: {
  sourceWidth: number
  sourceHeight: number
  frameWidth: number
  frameHeight: number
  fitMode: LocalProject['output']['fitMode']
}) => {
  const safeSourceWidth = Math.max(1, sourceWidth)
  const safeSourceHeight = Math.max(1, sourceHeight)
  const safeFrameWidth = Math.max(1, frameWidth)
  const safeFrameHeight = Math.max(1, frameHeight)
  const scale =
    fitMode === 'cover'
      ? Math.max(safeFrameWidth / safeSourceWidth, safeFrameHeight / safeSourceHeight)
      : Math.min(safeFrameWidth / safeSourceWidth, safeFrameHeight / safeSourceHeight)
  const drawWidth = safeSourceWidth * scale
  const drawHeight = safeSourceHeight * scale

  return {
    x: (safeFrameWidth - drawWidth) / 2,
    y: (safeFrameHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  }
}

function WaveformBars({
  peaks,
  className,
}: {
  peaks: number[]
  className?: string
}) {
  if (!peaks.length) {
    return (
      <div className={`waveform empty ${className ?? ''}`.trim()}>
        <span>No waveform analyzed yet</span>
      </div>
    )
  }

  return (
    <div className={`waveform ${className ?? ''}`.trim()} aria-hidden="true">
      {peaks.map((peak, index) => (
        <span
          key={`${index}-${peak}`}
          className="waveform-bar"
          style={{
            height: `${Math.max(10, peak * 100)}%`,
          }}
        />
      ))}
    </div>
  )
}

function mergeSettings(current: LocalSettings, patch: LocalSettingsPatch): LocalSettings {
  return {
    ...current,
    ...patch,
    capture: {
      ...current.capture,
      ...(patch.capture ?? {}),
    },
    importState: {
      ...current.importState,
      ...(patch.importState ?? {}),
    },
    output: {
      ...current.output,
      ...(patch.output ?? {}),
    },
  }
}

function mergeProject(current: LocalProject, patch: ProjectPatch): LocalProject {
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

function replaceClip(project: LocalProject, nextClip: ProjectClip) {
  return project.clips.map((clip) => (clip.id === nextClip.id ? nextClip : clip))
}

function normalizeFocusRegions(focusRegions: ClipFocusRegion[], durationSeconds: number) {
  return normalizeFocusRegionsShared(focusRegions, durationSeconds) as ClipFocusRegion[]
}

function buildAutomaticFocusRegions(
  cursorTrack: CursorTrack | null,
  autoZoomMode: AutoZoomMode,
  durationSeconds: number,
) {
  return buildAutomaticFocusRegionsShared(cursorTrack, autoZoomMode, durationSeconds) as ClipFocusRegion[]
}

const keyboardModifierOrder = ['ctrl', 'shift', 'alt', 'meta']

function formatKeyboardShortcutToken(token: string, showSymbols: boolean) {
  const normalized = token.trim().toLowerCase()

  if (!normalized) {
    return ''
  }

  const symbolMap: Record<string, string> = {
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

  const textMap: Record<string, string> = {
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
    pageup: 'Page Up',
    pagedown: 'Page Down',
    home: 'Home',
    end: 'End',
    insert: 'Insert',
    left: 'Left',
    right: 'Right',
    up: 'Up',
    down: 'Down',
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

function formatKeyboardShortcutLabel(keys: string[], showSymbols: boolean) {
  const orderedKeys = [...keys].sort((left, right) => {
    const leftModifierIndex = keyboardModifierOrder.indexOf(left)
    const rightModifierIndex = keyboardModifierOrder.indexOf(right)

    if (leftModifierIndex !== -1 || rightModifierIndex !== -1) {
      if (leftModifierIndex === -1) {
        return 1
      }

      if (rightModifierIndex === -1) {
        return -1
      }

      return leftModifierIndex - rightModifierIndex
    }

    return left.localeCompare(right)
  })

  const parts = orderedKeys.map((key) => formatKeyboardShortcutToken(key, showSymbols)).filter(Boolean)
  return showSymbols ? parts.join(' ') : parts.join(' + ')
}

function getShortcutOverlayDurationSeconds(shortcut: Pick<KeyboardShortcutEvent, 'durationMs'>) {
  return clampNumber((shortcut.durationMs || 180) / 1000 + 0.64, 0.7, 1.8)
}

function getActiveKeyboardShortcutsAtTime(
  shortcuts: KeyboardShortcutEvent[],
  timeSeconds: number,
  showSymbols: boolean,
) {
  return shortcuts
    .filter((shortcut) => shortcut.visible !== false)
    .filter((shortcut) => {
      const startSeconds = shortcut.timeSeconds
      const endSeconds = shortcut.timeSeconds + getShortcutOverlayDurationSeconds(shortcut)
      return timeSeconds >= startSeconds && timeSeconds <= endSeconds
    })
    .map((shortcut) => ({
      ...shortcut,
      label: formatKeyboardShortcutLabel(shortcut.keys, showSymbols),
    }))
    .filter((shortcut) => shortcut.label)
}

function getActiveTranscriptSegmentAtTime(
  transcript: ClipTranscript | null | undefined,
  timeSeconds: number,
) {
  if (!transcript?.segments?.length) {
    return null
  }

  return (
    transcript.segments.find(
      (segment) =>
        segment.visible !== false &&
        timeSeconds >= segment.startSeconds &&
        timeSeconds <= segment.endSeconds + 0.02,
    ) ?? null
  )
}

function getTranscriptWordsForSegment(
  transcript: ClipTranscript | null | undefined,
  segment: ClipTranscriptSegment | null,
) {
  if (!transcript?.words?.length || !segment) {
    return []
  }

  if (segment.wordIds?.length) {
    const wordsById = new Map(transcript.words.map((word) => [word.id, word] as const))
    return segment.wordIds.map((wordId) => wordsById.get(wordId)).filter(Boolean) as ClipTranscriptWord[]
  }

  return transcript.words.filter(
    (word) =>
      word.startSeconds < segment.endSeconds + 0.04 &&
      word.endSeconds > segment.startSeconds - 0.04,
  )
}

function getActiveTranscriptWordIdAtTime(words: ClipTranscriptWord[], timeSeconds: number) {
  return (
    words.find((word) => timeSeconds >= word.startSeconds && timeSeconds <= word.endSeconds + 0.02)?.id ??
    ''
  )
}

function formatTranscriptSegmentSummary(segment: ClipTranscriptSegment, showSpeakerLabels: boolean) {
  const speakerPrefix =
    showSpeakerLabels && segment.speaker ? `${segment.speaker}: ` : ''

  return `${speakerPrefix}${segment.text}`
}

function normalizeTranscriptCompareText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function shouldUseTranscriptWordHighlighting(segment: ClipTranscriptSegment | null, words: ClipTranscriptWord[]) {
  if (!segment || !words.length) {
    return false
  }

  const segmentText = normalizeTranscriptCompareText(segment.text)
  const wordsText = normalizeTranscriptCompareText(words.map((word) => word.text).join(' '))

  return Boolean(segmentText && wordsText && segmentText === wordsText)
}

function getActiveAudioRetakeAtTime(
  audioRetakes: ProjectClipAudioRetake[] | null | undefined,
  timeSeconds: number,
) {
  if (!audioRetakes?.length) {
    return null
  }

  return (
    audioRetakes.find(
      (retake) =>
        timeSeconds >= retake.startSeconds &&
        timeSeconds <= retake.endSeconds + 0.02,
    ) ?? null
  )
}

function formatSrtTimestamp(seconds: number) {
  const safeMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(safeMilliseconds / 3_600_000)
  const minutes = Math.floor((safeMilliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((safeMilliseconds % 60_000) / 1000)
  const milliseconds = safeMilliseconds % 1000

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

function replaceTimelineItem(project: LocalProject, nextItem: ProjectTimelineItem) {
  return project.timeline.items.map((item) => (item.id === nextItem.id ? nextItem : item))
}

function replaceMusicBed(project: LocalProject, nextBed: LocalProject['audio']['beds'][number]) {
  return project.audio.beds.map((bed) => (bed.id === nextBed.id ? nextBed : bed))
}

function getActiveMusicBed(project: LocalProject | null) {
  if (!project?.audio.beds.length) {
    return null
  }

  return project.audio.beds.find((bed) => bed.id === project.audio.activeBedId) ?? project.audio.beds[0]
}

function getMusicBedSourceDuration(musicBed: TimelineMusicBed) {
  const sourceTrimEnd =
    musicBed.trimEndSeconds === null
      ? musicBed.durationSeconds
      : musicBed.trimEndSeconds

  return Math.max(0, sourceTrimEnd - musicBed.trimStartSeconds)
}

function getMusicBedPlacement(musicBed: TimelineMusicBed, totalDuration: number) {
  const timelineStartSeconds = Math.min(
    Math.max(0, musicBed.timelineStartSeconds),
    Math.max(0, totalDuration),
  )
  const sourceDuration = getMusicBedSourceDuration(musicBed)
  const defaultTimelineEnd = musicBed.loop ? totalDuration : timelineStartSeconds + sourceDuration
  const rawTimelineEnd =
    musicBed.timelineEndSeconds === null
      ? defaultTimelineEnd
      : musicBed.timelineEndSeconds
  const maxTimelineEnd = musicBed.loop
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

function getMusicBedAutomationWindow(musicBed: TimelineMusicBed, totalDuration: number) {
  const placement = getMusicBedPlacement(musicBed, totalDuration)
  const keyframes = normalizeAutomationKeyframes(musicBed.automation.keyframes, {
    startSeconds: placement.timelineStartSeconds,
    endSeconds: placement.timelineEndSeconds,
  })

  if (musicBed.automation.enabled && keyframes.length) {
    const gains = keyframes.map((keyframe) => keyframe.gainDb)

    return {
      startSeconds: keyframes[0].timeSeconds,
      endSeconds: keyframes[keyframes.length - 1].timeSeconds,
      durationSeconds: Math.max(0, keyframes[keyframes.length - 1].timeSeconds - keyframes[0].timeSeconds),
      minGainDb: Math.min(...gains),
      maxGainDb: Math.max(...gains),
    }
  }

  const startSeconds = Math.min(
    Math.max(placement.timelineStartSeconds, musicBed.automation.startSeconds),
    placement.timelineEndSeconds,
  )
  const rawEnd =
    musicBed.automation.endSeconds === null
      ? placement.timelineEndSeconds
      : musicBed.automation.endSeconds
  const endSeconds = Math.min(
    Math.max(startSeconds, rawEnd),
    placement.timelineEndSeconds,
  )

  return {
    startSeconds,
    endSeconds,
    durationSeconds: Math.max(0, endSeconds - startSeconds),
    minGainDb: musicBed.automation.gainDb,
    maxGainDb: musicBed.automation.gainDb,
  }
}

function createAutomationKeyframe(timeSeconds: number, gainDb: number): TimelineMusicBedAutomationKeyframe {
  return {
    id: crypto.randomUUID(),
    timeSeconds: Number(Math.max(0, timeSeconds).toFixed(3)),
    gainDb: Number(clampNumber(gainDb, automationGainRange.min, automationGainRange.max).toFixed(2)),
  }
}

function normalizeAutomationKeyframes(
  keyframes: TimelineMusicBedAutomationKeyframe[],
  bounds: {
    startSeconds: number
    endSeconds: number
  },
) {
  const minTime = Math.max(0, bounds.startSeconds)
  const maxTime = Math.max(minTime, bounds.endSeconds)

  const nextKeyframes = keyframes
    .map((keyframe) => {
      const timeSeconds = Number.isFinite(keyframe?.timeSeconds)
        ? clampNumber(keyframe.timeSeconds, minTime, maxTime)
        : null

      if (timeSeconds === null) {
        return null
      }

      return {
        id: keyframe.id || crypto.randomUUID(),
        timeSeconds: Number(timeSeconds.toFixed(3)),
        gainDb: Number(clampNumber(keyframe.gainDb, automationGainRange.min, automationGainRange.max).toFixed(2)),
      }
    })
    .filter((keyframe): keyframe is TimelineMusicBedAutomationKeyframe => Boolean(keyframe))
    .sort((left, right) => left.timeSeconds - right.timeSeconds)

  const dedupedKeyframes: TimelineMusicBedAutomationKeyframe[] = []

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

function createDefaultAutomationCurve({
  laneStartSeconds,
  laneEndSeconds,
  startSeconds,
  endSeconds,
  gainDb,
  rampSeconds,
}: {
  laneStartSeconds: number
  laneEndSeconds: number
  startSeconds: number
  endSeconds: number | null
  gainDb: number
  rampSeconds: number
}) {
  const effectStart = clampNumber(startSeconds, laneStartSeconds, laneEndSeconds)
  const effectEnd = clampNumber(endSeconds ?? laneEndSeconds, effectStart, laneEndSeconds)
  const holdGain = clampNumber(gainDb, automationGainRange.min, automationGainRange.max)

  if (effectEnd <= effectStart + 0.001) {
    return normalizeAutomationKeyframes(
      [
        createAutomationKeyframe(effectStart, holdGain),
        createAutomationKeyframe(laneEndSeconds, 0),
      ],
      {
        startSeconds: laneStartSeconds,
        endSeconds: laneEndSeconds,
      },
    )
  }

  const ramp = Math.min(
    Math.max(0, rampSeconds),
    Math.max(0, (effectEnd - effectStart) / 2),
  )

  if (ramp <= 0.01) {
    return normalizeAutomationKeyframes(
      [
        createAutomationKeyframe(effectStart, holdGain),
        createAutomationKeyframe(effectEnd, holdGain),
      ],
      {
        startSeconds: laneStartSeconds,
        endSeconds: laneEndSeconds,
      },
    )
  }

  return normalizeAutomationKeyframes(
    [
      createAutomationKeyframe(effectStart, 0),
      createAutomationKeyframe(effectStart + ramp, holdGain),
      createAutomationKeyframe(effectEnd - ramp, holdGain),
      createAutomationKeyframe(effectEnd, 0),
    ],
    {
      startSeconds: laneStartSeconds,
      endSeconds: laneEndSeconds,
    },
  )
}

function serializeAutomationKeyframes(keyframes: TimelineMusicBedAutomationKeyframe[]) {
  return keyframes
    .map((keyframe) => `${keyframe.id}:${keyframe.timeSeconds.toFixed(3)}:${keyframe.gainDb.toFixed(2)}`)
    .join('|')
}

function buildAutomationCurvePath(
  keyframes: TimelineMusicBedAutomationKeyframe[],
  placement: {
    timelineStartSeconds: number
    timelineEndSeconds: number
    durationSeconds: number
  },
) {
  if (!placement.durationSeconds || !keyframes.length) {
    return ''
  }

  return keyframes
    .map((keyframe, index) => {
      const x = ((keyframe.timeSeconds - placement.timelineStartSeconds) / placement.durationSeconds) * 100
      const normalizedGain = (keyframe.gainDb - automationGainRange.min) / (automationGainRange.max - automationGainRange.min)
      const y = 34 - normalizedGain * 28
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function getAutomationGainDbAtTime(
  automation: TimelineMusicBed['automation'],
  placement: {
    timelineStartSeconds: number
    timelineEndSeconds: number
    durationSeconds: number
  },
  timelineSeconds: number,
) {
  if (!automation.enabled || placement.durationSeconds <= 0) {
    return 0
  }

  const boundedSeconds = clampNumber(
    timelineSeconds,
    placement.timelineStartSeconds,
    placement.timelineEndSeconds,
  )
  const normalizedKeyframes = normalizeAutomationKeyframes(automation.keyframes, {
    startSeconds: placement.timelineStartSeconds,
    endSeconds: placement.timelineEndSeconds,
  })

  if (normalizedKeyframes.length >= 2) {
    const firstKeyframe = normalizedKeyframes[0]
    const lastKeyframe = normalizedKeyframes[normalizedKeyframes.length - 1]

    if (boundedSeconds <= firstKeyframe.timeSeconds) {
      return firstKeyframe.gainDb
    }

    if (boundedSeconds >= lastKeyframe.timeSeconds) {
      return lastKeyframe.gainDb
    }

    for (let index = 0; index < normalizedKeyframes.length - 1; index += 1) {
      const current = normalizedKeyframes[index]
      const next = normalizedKeyframes[index + 1]

      if (boundedSeconds < current.timeSeconds || boundedSeconds > next.timeSeconds) {
        continue
      }

      const span = Math.max(0.001, next.timeSeconds - current.timeSeconds)
      const ratio = (boundedSeconds - current.timeSeconds) / span
      return Number((current.gainDb + (next.gainDb - current.gainDb) * ratio).toFixed(3))
    }
  }

  const automationStart = clampNumber(
    Number.isFinite(automation.startSeconds) ? automation.startSeconds : placement.timelineStartSeconds,
    placement.timelineStartSeconds,
    placement.timelineEndSeconds,
  )
  const automationEnd = clampNumber(
    automation.endSeconds === null
      ? placement.timelineEndSeconds
      : Number.isFinite(automation.endSeconds)
        ? automation.endSeconds
        : placement.timelineEndSeconds,
    automationStart,
    placement.timelineEndSeconds,
  )

  if (boundedSeconds < automationStart || boundedSeconds > automationEnd) {
    return 0
  }

  const targetGain = clampNumber(
    Number.isFinite(automation.gainDb) ? automation.gainDb : 0,
    automationGainRange.min,
    automationGainRange.max,
  )
  const rampSeconds = Math.min(
    Math.max(0, Number.isFinite(automation.rampSeconds) ? automation.rampSeconds : 0),
    Math.max(0, (automationEnd - automationStart) / 2),
  )

  if (rampSeconds <= 0.001) {
    return targetGain
  }

  const rampUpEnd = automationStart + rampSeconds
  const rampDownStart = automationEnd - rampSeconds

  if (boundedSeconds <= rampUpEnd) {
    return Number((targetGain * ((boundedSeconds - automationStart) / rampSeconds)).toFixed(3))
  }

  if (boundedSeconds >= rampDownStart) {
    return Number((targetGain * (1 - (boundedSeconds - rampDownStart) / rampSeconds)).toFixed(3))
  }

  return targetGain
}

function getMusicBedPreviewSourceTime(
  musicBed: TimelineMusicBed,
  placement: {
    timelineStartSeconds: number
    timelineEndSeconds: number
    durationSeconds: number
    sourceDuration: number
  },
  timelineSeconds: number,
) {
  if (placement.durationSeconds <= 0 || placement.sourceDuration <= 0) {
    return null
  }

  if (
    timelineSeconds < placement.timelineStartSeconds - 0.001 ||
    timelineSeconds > placement.timelineEndSeconds + 0.001
  ) {
    return null
  }

  const localSeconds = Math.max(0, timelineSeconds - placement.timelineStartSeconds)
  const sourceOffset = musicBed.loop
    ? localSeconds % placement.sourceDuration
    : Math.min(localSeconds, Math.max(0, placement.sourceDuration - 0.001))

  return Number((musicBed.trimStartSeconds + sourceOffset).toFixed(3))
}

function getMusicBedPreviewLinearGain({
  musicBed,
  placement,
  timelineSeconds,
  ducking,
  narratorActive,
}: {
  musicBed: TimelineMusicBed
  placement: {
    timelineStartSeconds: number
    timelineEndSeconds: number
    durationSeconds: number
    sourceDuration: number
  }
  timelineSeconds: number
  ducking: LocalProject['audio']['ducking']
  narratorActive: boolean
}) {
  if (!musicBed.enabled || placement.durationSeconds <= 0) {
    return 0
  }

  if (
    timelineSeconds < placement.timelineStartSeconds - 0.001 ||
    timelineSeconds > placement.timelineEndSeconds + 0.001
  ) {
    return 0
  }

  const localSeconds = Math.max(0, timelineSeconds - placement.timelineStartSeconds)
  const clampedFadeIn = Math.min(placement.durationSeconds, Math.max(0, musicBed.fadeInSeconds || 0))
  const clampedFadeOut = Math.min(
    Math.max(0, placement.durationSeconds - clampedFadeIn),
    Math.max(0, musicBed.fadeOutSeconds || 0),
  )

  let fadeRatio = 1

  if (clampedFadeIn > 0.001 && localSeconds < clampedFadeIn) {
    fadeRatio = Math.min(fadeRatio, localSeconds / clampedFadeIn)
  }

  if (clampedFadeOut > 0.001) {
    const fadeOutStart = Math.max(0, placement.durationSeconds - clampedFadeOut)

    if (localSeconds > fadeOutStart) {
      fadeRatio = Math.min(
        fadeRatio,
        Math.max(0, (placement.durationSeconds - localSeconds) / clampedFadeOut),
      )
    }
  }

  const automationGainDb = getAutomationGainDbAtTime(musicBed.automation, placement, timelineSeconds)
  const duckingReductionDb =
    ducking.enabled && narratorActive && musicBed.routingMode === 'duck'
      ? Math.max(0, ducking.reductionDb)
      : 0

  return decibelsToGain(musicBed.gainDb + automationGainDb - duckingReductionDb) * Math.max(0, fadeRatio)
}

function createTimelineItemFromClip(clip: ProjectClip): ProjectTimelineItem {
  const timestamp = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    clipId: clip.id,
    label: clip.label,
    enabled: true,
    trimStartSeconds: clip.trim.startSeconds,
    trimEndSeconds: clip.trim.endSeconds,
    transcriptCut: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function isHiddenTranscriptCutTimelineItem(item: ProjectTimelineItem) {
  return Boolean(item.transcriptCut && item.enabled === false)
}

function buildTimelineSequence(items: ProjectTimelineItem[], clipsById: Map<string, ProjectClip>) {
  let cursor = 0

  return items.map((item, index) => {
    const clip = clipsById.get(item.clipId)
    const bounds = getTimelineItemBounds(item, clip)
    const startSeconds = cursor
    const endSeconds = cursor + bounds.durationSeconds

    cursor = endSeconds

    return {
      item,
      clip,
      index,
      bounds,
      startSeconds,
      endSeconds,
    }
  })
}

function rangesOverlap(startSeconds: number, endSeconds: number, boundsStart: number, boundsEnd: number) {
  return endSeconds > boundsStart + 0.001 && startSeconds < boundsEnd - 0.001
}

function getTimelineItemDuration(item: ProjectTimelineItem, clip?: ProjectClip) {
  if (!clip) {
    return 0
  }

  const clipEnd = clip.trim.endSeconds ?? clip.durationSeconds
  const effectiveEnd =
    item.trimEndSeconds === null ? clipEnd : Math.min(clip.durationSeconds, item.trimEndSeconds)

  return Math.max(0, effectiveEnd - item.trimStartSeconds)
}

function getTimelineItemBounds(item: ProjectTimelineItem, clip?: ProjectClip) {
  if (!clip) {
    const endSeconds = item.trimEndSeconds ?? item.trimStartSeconds

    return {
      startSeconds: item.trimStartSeconds,
      endSeconds,
      maxSeconds: endSeconds,
      durationSeconds: Math.max(0, endSeconds - item.trimStartSeconds),
    }
  }

  const maxSeconds = clip.trim.endSeconds ?? clip.durationSeconds
  const endSeconds =
    item.trimEndSeconds === null ? maxSeconds : Math.min(maxSeconds, item.trimEndSeconds)
  const startSeconds = Math.min(item.trimStartSeconds, endSeconds)

  return {
    startSeconds,
    endSeconds,
    maxSeconds,
    durationSeconds: Math.max(0, endSeconds - startSeconds),
  }
}

function getProjectLastExportPath(project: LocalProject) {
  return (
    project.timeline.lastExportPath ||
    project.clips.find((clip) => clip.lastExportPath)?.lastExportPath ||
    ''
  )
}

function App() {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null)
  const [settings, setSettings] = useState<LocalSettings | null>(null)
  const [project, setProject] = useState<LocalProject | null>(null)
  const [projectLibrary, setProjectLibrary] = useState<ProjectSummary[]>([])
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [importSummary, setImportSummary] = useState<ImportStateSummary | null>(null)
  const [isRefreshingSources, setIsRefreshingSources] = useState(false)
  const [isScanningImport, setIsScanningImport] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isProjectLibraryBusy, setIsProjectLibraryBusy] = useState(false)
  const [isStartingRecording, setIsStartingRecording] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isSavingProject, setIsSavingProject] = useState(false)
  const [isImportingMusicBed, setIsImportingMusicBed] = useState(false)
  const [isRemovingMusicBed, setIsRemovingMusicBed] = useState(false)
  const [isExportingClip, setIsExportingClip] = useState(false)
  const [isExportingTimeline, setIsExportingTimeline] = useState(false)
  const [isAnalyzingSelectedClipAudio, setIsAnalyzingSelectedClipAudio] = useState(false)
  const [isGeneratingTranscript, setIsGeneratingTranscript] = useState(false)
  const [isRecordingAudioRetake, setIsRecordingAudioRetake] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioRetakeSeconds, setAudioRetakeSeconds] = useState(0)
  const [sessionCursorTrackingAvailable, setSessionCursorTrackingAvailable] = useState(false)
  const [sessionKeyboardTrackingAvailable, setSessionKeyboardTrackingAvailable] = useState(false)
  const [liveCaptureCursorRenderMode, setLiveCaptureCursorRenderMode] = useState<CursorRenderMode>('baked')
  const [selectedKeyboardShortcutId, setSelectedKeyboardShortcutId] = useState('')
  const [selectedTranscriptSegmentId, setSelectedTranscriptSegmentId] = useState('')
  const [transcriptSegmentTextDraft, setTranscriptSegmentTextDraft] = useState('')
  const [isImportingTranscript, setIsImportingTranscript] = useState(false)
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([])
  const [statusLine, setStatusLine] = useState('Ready for a local capture-and-export workflow.')
  const [errorMessage, setErrorMessage] = useState('')
  const [lastSavedPath, setLastSavedPath] = useState('')
  const [lastSavedSize, setLastSavedSize] = useState(0)
  const [lastExportPath, setLastExportPath] = useState('')
  const [projectTitleDraft, setProjectTitleDraft] = useState('')
  const [projectBriefDraft, setProjectBriefDraft] = useState('')
  const [clipNotesDraft, setClipNotesDraft] = useState('')
  const [clipAudioMutedDraft, setClipAudioMutedDraft] = useState(false)
  const [clipAudioGainDraft, setClipAudioGainDraft] = useState(0)
  const [musicBedTrimStartDraft, setMusicBedTrimStartDraft] = useState('0')
  const [musicBedTrimEndDraft, setMusicBedTrimEndDraft] = useState('')
  const [musicBedTimelineStartDraft, setMusicBedTimelineStartDraft] = useState('0')
  const [musicBedTimelineEndDraft, setMusicBedTimelineEndDraft] = useState('')
  const [musicBedFadeInDraft, setMusicBedFadeInDraft] = useState(0.2)
  const [musicBedFadeOutDraft, setMusicBedFadeOutDraft] = useState(0.3)
  const [musicBedGainDraft, setMusicBedGainDraft] = useState(-16)
  const [musicBedRoutingModeDraft, setMusicBedRoutingModeDraft] = useState<TimelineMusicBed['routingMode']>('duck')
  const [musicBedAutomationEnabledDraft, setMusicBedAutomationEnabledDraft] = useState(false)
  const [musicBedAutomationStartDraft, setMusicBedAutomationStartDraft] = useState('0')
  const [musicBedAutomationEndDraft, setMusicBedAutomationEndDraft] = useState('')
  const [musicBedAutomationGainDraft, setMusicBedAutomationGainDraft] = useState(-3)
  const [musicBedAutomationRampDraft, setMusicBedAutomationRampDraft] = useState(0.4)
  const [musicBedAutomationKeyframesDraft, setMusicBedAutomationKeyframesDraft] = useState<TimelineMusicBedAutomationKeyframe[]>([])
  const [selectedAutomationKeyframeId, setSelectedAutomationKeyframeId] = useState('')
  const [musicBedLoopDraft, setMusicBedLoopDraft] = useState(true)
  const [musicBedEnabledDraft, setMusicBedEnabledDraft] = useState(true)
  const [voiceClarityEnabledDraft, setVoiceClarityEnabledDraft] = useState(false)
  const [voiceClarityProfileDraft, setVoiceClarityProfileDraft] = useState<VoiceClarityProfile>('balanced')
  const [duckingEnabledDraft, setDuckingEnabledDraft] = useState(true)
  const [duckingReductionDraft, setDuckingReductionDraft] = useState(10)
  const [duckingAttackDraft, setDuckingAttackDraft] = useState(120)
  const [duckingReleaseDraft, setDuckingReleaseDraft] = useState(420)
  const [trimStartDraft, setTrimStartDraft] = useState('0')
  const [trimEndDraft, setTrimEndDraft] = useState('')
  const [exportNameDraft, setExportNameDraft] = useState('')
  const [timelineExportNameDraft, setTimelineExportNameDraft] = useState('')
  const [projectSeedTitleDraft, setProjectSeedTitleDraft] = useState('')
  const [timelinePlayheadSeconds, setTimelinePlayheadSeconds] = useState(0)
  const [draggedTimelineItemId, setDraggedTimelineItemId] = useState('')
  const [selectedFocusRegionId, setSelectedFocusRegionId] = useState('')
  const [activeStudioSection, setActiveStudioSection] = useState<StudioSection>('capture')
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('wallpaper')
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false)
  const [isStagePlaying, setIsStagePlaying] = useState(false)
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState('')
  const [timelineTrimDraft, setTimelineTrimDraft] = useState({
    startSeconds: 0,
    endSeconds: 0,
  })

  const stageSurfaceRef = useRef<HTMLDivElement | null>(null)
  const captureDeckPreviewRef = useRef<HTMLVideoElement | null>(null)
  const stageLivePreviewRef = useRef<HTMLVideoElement | null>(null)
  const stagePlaybackRef = useRef<HTMLVideoElement | null>(null)
  const stageCursorCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageLiveCursorLayerRef = useRef<HTMLDivElement | null>(null)
  const stageLiveCursorRef = useRef<HTMLDivElement | null>(null)
  const stageLiveCursorImageRef = useRef<HTMLImageElement | null>(null)
  const stageLiveCursorPulseRef = useRef<HTMLDivElement | null>(null)
  const stageLiveCursorIndicatorRef = useRef<HTMLDivElement | null>(null)
  const captureDeckCursorIndicatorRef = useRef<HTMLDivElement | null>(null)
  const liveCameraPreviewRef = useRef<HTMLVideoElement | null>(null)
  const stagePlaybackCameraRef = useRef<HTMLVideoElement | null>(null)
  const stagePlaybackMicrophoneRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const nativeScreenCaptureSessionRef = useRef<{
    sessionId: string
    filePath: string
    mimeType: string
    engine: 'ddagrab' | 'gdigrab'
    encoder: string
  } | null>(null)
  const nativeScreenCaptureStoppingRef = useRef(false)
  const nativeScreenCaptureStopHandlerRef = useRef<(() => void) | null>(null)
  const cameraRecorderRef = useRef<MediaRecorder | null>(null)
  const microphoneRecorderRef = useRef<MediaRecorder | null>(null)
  const systemAudioRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const microphoneStreamRef = useRef<MediaStream | null>(null)
  const stagePlaybackAudioContextRef = useRef<AudioContext | null>(null)
  const stagePlaybackSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const stagePlaybackMicrophoneSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const stagePlaybackSourceGainRef = useRef<GainNode | null>(null)
  const stagePlaybackMicrophoneGainRef = useRef<GainNode | null>(null)
  const stagePlaybackVoiceNodesRef = useRef<AudioNode[]>([])
  const stagePlaybackBedEntriesRef = useRef<Map<string, StagePlaybackBedEntry>>(new Map())
  const previewPlaybackTargetSecondsRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const cameraChunksRef = useRef<BlobPart[]>([])
  const microphoneChunksRef = useRef<BlobPart[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)
  const cameraFinalizePromiseRef = useRef<Promise<{
    blob: Blob
    mimeType: string
    deviceId: string
    deviceLabel: string
  } | null> | null>(null)
  const microphoneFinalizePromiseRef = useRef<Promise<{
    blob: Blob
    mimeType: string
    deviceId: string
    deviceLabel: string
  } | null> | null>(null)
  const systemAudioChunksRef = useRef<BlobPart[]>([])
  const systemAudioFinalizePromiseRef = useRef<Promise<{
    blob: Blob
    mimeType: string
  } | null> | null>(null)
  const audioRetakeRecorderRef = useRef<MediaRecorder | null>(null)
  const audioRetakeFinalizePromiseRef = useRef<Promise<{
    blob: Blob
    mimeType: string
    deviceId: string
    deviceLabel: string
  } | null> | null>(null)
  const audioRetakeStreamRef = useRef<MediaStream | null>(null)
  const audioRetakeChunksRef = useRef<BlobPart[]>([])
  const audioRetakeStartedAtRef = useRef<number | null>(null)
  const audioRetakeTimerRef = useRef<number | null>(null)
  const audioRetakeAutoStopRef = useRef<number | null>(null)
  const audioRetakeTargetRef = useRef<{
    clipId: string
    clipLabel: string
    segmentId: string
    segmentText: string
    startSeconds: number
    endSeconds: number
  } | null>(null)
  const cursorPollingRef = useRef<number | null>(null)
  const cursorTrackPointsRef = useRef<CursorTrackPoint[]>([])
  const cursorClickEventsRef = useRef<CursorClickEvent[]>([])
  const keyboardShortcutEventsRef = useRef<KeyboardShortcutEvent[]>([])
  const cursorPulseEventsRef = useRef<CursorPulseEvent[]>([])
  const cursorAppearanceCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const cursorAppearanceAssetRef = useRef<Map<string, CursorAppearanceAsset>>(new Map())
  const cursorAppearanceKindRef = useRef<Map<CursorVisualKind, CursorAppearanceAsset>>(new Map())
  const cursorAppearanceLoadingRef = useRef<Set<string>>(new Set())
  const liquidGlassCursorClickEffectImageRef = useRef<HTMLImageElement | null>(null)
  const cursorTrackingAvailableRef = useRef(false)
  const keyboardTrackingAvailableRef = useRef(false)
  const cursorPollInFlightRef = useRef(false)
  const liveCursorCoordinateSpaceRef = useRef<CursorCoordinateSpace | null>(null)
  const liveCursorVisualRef = useRef<LiveCursorVisualState | null>(null)
  const liveCursorDecorationFrameRef = useRef<number | null>(null)

  const loadCursorAppearanceImage = useCallback(async (dataUrl: string) => {
    const image = new Image()
    image.decoding = 'async'

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Cursor appearance image could not be decoded.'))
      image.src = dataUrl
    })

    return image
  }, [])

  const rasterizeCursorAppearanceAsset = useCallback(async (
    asset: Partial<CursorAppearanceAsset> | null | undefined,
    preloadedImage?: HTMLImageElement,
  ) => {
    const normalizedAsset = normalizeCursorAppearanceAsset(asset)

    if (!normalizedAsset?.imageDataUrl) {
      return null
    }

    const sourceImage = preloadedImage ?? (await loadCursorAppearanceImage(normalizedAsset.imageDataUrl))

    if (!normalizedAsset.imageDataUrl.startsWith('data:image/svg+xml')) {
      return {
        asset: normalizedAsset,
        image: sourceImage,
      }
    }

    const targetWidth = Math.min(
      CURSOR_APPEARANCE_RASTER_MAX_SIZE,
      Math.max(
        CURSOR_APPEARANCE_RASTER_MIN_SIZE,
        Math.round((normalizedAsset.referenceWidth || sourceImage.width || 32) * CURSOR_APPEARANCE_RASTER_SCALE),
      ),
    )
    const targetHeight = Math.min(
      CURSOR_APPEARANCE_RASTER_MAX_SIZE,
      Math.max(
        CURSOR_APPEARANCE_RASTER_MIN_SIZE,
        Math.round((normalizedAsset.referenceHeight || sourceImage.height || 32) * CURSOR_APPEARANCE_RASTER_SCALE),
      ),
    )
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')

    if (!context) {
      return {
        asset: normalizedAsset,
        image: sourceImage,
      }
    }

    context.clearRect(0, 0, targetWidth, targetHeight)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(sourceImage, 0, 0, targetWidth, targetHeight)

    const rasterizedDataUrl = canvas.toDataURL('image/png')
    const rasterizedImage = await loadCursorAppearanceImage(rasterizedDataUrl)

    return {
      asset: {
        ...normalizedAsset,
        imageDataUrl: rasterizedDataUrl,
      },
      image: rasterizedImage,
    }
  }, [loadCursorAppearanceImage])

  const resolvePremiumCursorAppearanceAsset = useCallback((cursorKind: CursorVisualKind) => {
    const premiumCatalogAsset = PREMIUM_CURSOR_APPEARANCE_BY_KIND.get(cursorKind)

    if (!premiumCatalogAsset) {
      return undefined
    }

    return cursorAppearanceAssetRef.current.get(premiumCatalogAsset.id) ?? premiumCatalogAsset
  }, [])

  const cacheCursorAppearanceImage = useCallback(async (appearanceId: string, dataUrl: string) => {
    const normalizedAppearanceId = normalizeCursorAppearanceId(appearanceId)

    if (
      !normalizedAppearanceId ||
      !dataUrl ||
      cursorAppearanceCacheRef.current.has(normalizedAppearanceId) ||
      cursorAppearanceLoadingRef.current.has(normalizedAppearanceId)
    ) {
      return
    }

    cursorAppearanceLoadingRef.current.add(normalizedAppearanceId)

    try {
      const currentAsset = cursorAppearanceAssetRef.current.get(normalizedAppearanceId)
      let resolvedAsset: CursorAppearanceAsset | null = null
      let resolvedImage: HTMLImageElement

      if (currentAsset) {
        const rasterizedAsset = await rasterizeCursorAppearanceAsset(currentAsset)

        if (rasterizedAsset) {
          resolvedAsset = rasterizedAsset.asset
          resolvedImage = rasterizedAsset.image
        } else {
          resolvedImage = await loadCursorAppearanceImage(dataUrl)
        }
      } else {
        resolvedImage = await loadCursorAppearanceImage(dataUrl)
      }

      cursorAppearanceCacheRef.current.set(normalizedAppearanceId, resolvedImage)

      if (resolvedAsset) {
        cursorAppearanceAssetRef.current.set(normalizedAppearanceId, resolvedAsset)
        cursorAppearanceKindRef.current.set(resolvedAsset.cursorKind, resolvedAsset)
      }
    } catch {
      cursorAppearanceCacheRef.current.delete(normalizedAppearanceId)
    } finally {
      cursorAppearanceLoadingRef.current.delete(normalizedAppearanceId)
    }
  }, [loadCursorAppearanceImage, rasterizeCursorAppearanceAsset])

  useEffect(() => {
    const image = new Image()
    image.decoding = 'async'
    image.src = LIQUID_GLASS_CURSOR_CLICK_EFFECT_DATA_URL
    liquidGlassCursorClickEffectImageRef.current = image

    return () => {
      if (liquidGlassCursorClickEffectImageRef.current === image) {
        liquidGlassCursorClickEffectImageRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      console.info('bootstrap effect entered')
      if (!window.forkApi) {
        console.error('forkApi bridge is unavailable in renderer')
        setErrorMessage('Electron bridge is unavailable. Start the app with npm run dev.')
        return
      }

      const bootstrap = await window.forkApi.app.bootstrap()
      const availableSources = await window.forkApi.sources.list()
      console.info(`bootstrap loaded ${availableSources.length} source(s)`)

      if (cancelled) {
        return
      }

      startTransition(() => {
        setBoot(bootstrap)
        setSettings(bootstrap.settings)
        setProject(bootstrap.activeProject)
        setProjectLibrary(bootstrap.projects)
        setProjectTitleDraft(bootstrap.activeProject.title)
        setProjectBriefDraft(bootstrap.activeProject.brief)
        setImportSummary(bootstrap.importState)
        setSources(availableSources)
        setStatusLine(
          `Studio shell online. ${availableSources.length} capture source(s) and ${bootstrap.activeProject.clips.length} local clip(s) ready.`,
        )
      })
    }

    load().catch((error: unknown) => {
      console.error('bootstrap failed in renderer', error)
      if (!cancelled) {
        setErrorMessage(error instanceof Error ? error.message : 'Bootstrap failed')
      }
    })

    return () => {
      cancelled = true
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
      }
      if (cursorPollingRef.current) {
        window.clearInterval(cursorPollingRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadMediaDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) {
          setCameraDevices(devices.filter((device) => device.kind === 'videoinput'))
          setMicrophoneDevices(devices.filter((device) => device.kind === 'audioinput'))
        }
      } catch {
        if (!cancelled) {
          setCameraDevices([])
          setMicrophoneDevices([])
        }
      }
    }

    void loadMediaDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', loadMediaDevices)

    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener?.('devicechange', loadMediaDevices)
    }
  }, [])

  const qualityProfiles = boot?.qualityProfiles ?? []
  const motionPresets = boot?.motionPresets ?? []

  const activeProfile = useMemo<QualityProfile | undefined>(
    () => qualityProfiles.find((profile) => profile.id === settings?.capture.qualityProfileId),
    [qualityProfiles, settings?.capture.qualityProfileId],
  )

  const activeMotionPreset = useMemo<MotionPreset | undefined>(
    () => motionPresets.find((preset) => preset.id === settings?.capture.motionPresetId),
    [motionPresets, settings?.capture.motionPresetId],
  )

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === settings?.capture.selectedSourceId),
    [settings?.capture.selectedSourceId, sources],
  )

  const selectedClip = useMemo(() => {
    if (!project) {
      return undefined
    }

    return (
      project.clips.find((clip) => clip.id === project.timeline.activeClipId) ??
      project.clips[0]
    )
  }, [project])

  const clipsById = useMemo(
    () => new Map((project?.clips ?? []).map((clip) => [clip.id, clip])),
    [project?.clips],
  )

  const visibleTimelineItems = useMemo(
    () => (project?.timeline.items ?? []).filter((item) => !isHiddenTranscriptCutTimelineItem(item)),
    [project?.timeline.items],
  )

  const selectedTimelineItem = useMemo(() => {
    if (!project) {
      return undefined
    }

    return (
      visibleTimelineItems.find((item) => item.id === project.timeline.activeItemId) ??
      visibleTimelineItems.find((item) => item.clipId === project.timeline.activeClipId) ??
      visibleTimelineItems[0] ??
      project.timeline.items.find((item) => item.id === project.timeline.activeItemId) ??
      project.timeline.items[0]
    )
  }, [project, visibleTimelineItems])

  const selectedTimelineClip = useMemo(
    () => (selectedTimelineItem ? clipsById.get(selectedTimelineItem.clipId) : undefined),
    [clipsById, selectedTimelineItem],
  )

  const selectedClipMotionPreset = useMemo(
    () =>
      selectedClip
        ? motionPresets.find((preset) => preset.id === selectedClip.captureProfile.motionPresetId)
        : undefined,
    [motionPresets, selectedClip],
  )

  const selectedClipFocusRegions = useMemo(
    () => normalizeFocusRegions(selectedClip?.focusRegions ?? [], selectedClip?.durationSeconds ?? 0),
    [selectedClip?.durationSeconds, selectedClip?.focusRegions],
  )

  const selectedClipKeyboardShortcuts = useMemo(
    () => selectedClip?.keyboardShortcuts ?? [],
    [selectedClip?.keyboardShortcuts],
  )

  const selectedClipTranscript = useMemo<ClipTranscript>(
    () =>
      selectedClip?.transcript ?? {
        status: 'idle',
        provider: 'none',
        model: '',
        language: '',
        generatedAt: '',
        error: '',
        text: '',
        segments: [],
        words: [],
      },
    [selectedClip?.transcript],
  )

  const selectedClipTranscriptSegments = useMemo(
    () => selectedClipTranscript.segments ?? [],
    [selectedClipTranscript],
  )

  const selectedClipTranscriptSourceLabel = useMemo(() => {
    if (selectedClipTranscript.provider === 'imported') {
      return selectedClipTranscript.model === 'webvtt' ? 'Imported VTT' : 'Imported SRT'
    }

    if (selectedClipTranscript.provider === 'openai') {
      return selectedClipTranscript.model ? `OpenAI · ${selectedClipTranscript.model}` : 'OpenAI transcript'
    }

    return 'No transcript source'
  }, [selectedClipTranscript.model, selectedClipTranscript.provider])

  const selectedKeyboardShortcut = useMemo(
    () =>
      selectedClipKeyboardShortcuts.find((shortcut) => shortcut.id === selectedKeyboardShortcutId) ??
      selectedClipKeyboardShortcuts[0] ??
      null,
    [selectedClipKeyboardShortcuts, selectedKeyboardShortcutId],
  )

  const selectedTranscriptSegment = useMemo(
    () =>
      selectedClipTranscriptSegments.find((segment) => segment.id === selectedTranscriptSegmentId) ??
      selectedClipTranscriptSegments[0] ??
      null,
    [selectedClipTranscriptSegments, selectedTranscriptSegmentId],
  )
  const selectedClipAudioRetakes = useMemo(
    () => selectedClip?.audioRetakes ?? [],
    [selectedClip?.audioRetakes],
  )
  const selectedTranscriptAudioRetake = useMemo(
    () =>
      selectedTranscriptSegment
        ? selectedClipAudioRetakes.find((retake) => retake.segmentId === selectedTranscriptSegment.id) ?? null
        : null,
    [selectedClipAudioRetakes, selectedTranscriptSegment],
  )
  const selectedTranscriptRetakeLimitSeconds = useMemo(
    () =>
      selectedTranscriptSegment
        ? Math.min(15, Math.max(0, selectedTranscriptSegment.endSeconds - selectedTranscriptSegment.startSeconds))
        : 0,
    [selectedTranscriptSegment],
  )

  const selectedFocusRegion = useMemo(
    () =>
      selectedClipFocusRegions.find((region) => region.id === selectedFocusRegionId) ??
      selectedClipFocusRegions[0] ??
      null,
    [selectedClipFocusRegions, selectedFocusRegionId],
  )

  const activeCursorSettings = useMemo(
    () => project?.cursor ?? defaultCursorStudioSettings,
    [project?.cursor],
  )

  useEffect(() => {
    const appearances = selectedClip?.cursorTrack?.appearances ?? []

    for (const asset of appearances) {
      rememberCursorAppearanceAsset(asset)
      void cacheCursorAppearanceImage(asset.id, asset.imageDataUrl)
    }
  }, [cacheCursorAppearanceImage, selectedClip?.cursorTrack?.appearances])

  useEffect(() => {
    for (const asset of PREMIUM_CURSOR_APPEARANCE_CATALOG) {
      rememberCursorAppearanceAsset(asset)
      void cacheCursorAppearanceImage(asset.id, asset.imageDataUrl)
    }
  }, [cacheCursorAppearanceImage])

  const activeShortcutSettings = useMemo(
    () => project?.shortcuts ?? defaultShortcutStudioSettings,
    [project?.shortcuts],
  )

  const activeCaptionSettings = useMemo(
    () => project?.captions ?? defaultCaptionStudioSettings,
    [project?.captions],
  )

  const activeCameraSettings = useMemo(
    () => project?.camera ?? defaultCameraStudioSettings,
    [project?.camera],
  )

  const activeBackgroundSettings = useMemo(
    () => project?.background ?? defaultBackgroundStudioSettings,
    [project?.background],
  )

  const totalClipDuration = useMemo(
    () => project?.clips.reduce((total, clip) => total + clip.durationSeconds, 0) ?? 0,
    [project],
  )

  const totalExportCount = useMemo(
    () =>
      (project?.clips.reduce((total, clip) => total + clip.exports.length, 0) ?? 0) +
      (project?.timeline.exports.length ?? 0),
    [project],
  )
  const lastArtifactName = useMemo(() => {
    const artifactPath = lastExportPath || lastSavedPath

    if (!artifactPath) {
      return 'No local artifact'
    }

    const parts = artifactPath.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || artifactPath
  }, [lastExportPath, lastSavedPath])
  const deliveryStatusLabel = lastExportPath
    ? 'Latest export'
    : lastSavedPath
      ? 'Latest capture'
      : 'Nothing saved'

  const activeProjectSummary = useMemo(
    () => projectLibrary.find((item) => item.isActive) ?? projectLibrary[0],
    [projectLibrary],
  )

  const activeOutputFormat = useMemo(
    () => outputFormatOptions.find((option) => option.id === project?.output.format),
    [project?.output.format],
  )

  const musicBeds = useMemo(() => project?.audio.beds ?? [], [project?.audio.beds])
  const activeMusicBed = getActiveMusicBed(project)
  const enabledMusicBedCount = musicBeds.filter((bed) => bed.enabled).length
  const duckedMusicBedCount = musicBeds.filter((bed) => bed.enabled && bed.routingMode === 'duck').length
  const bypassMusicBedCount = musicBeds.filter((bed) => bed.enabled && bed.routingMode === 'bypass').length

  const captureCursorTelemetryLabel = useMemo(() => {
    if (!selectedSource) {
      return 'No source'
    }

    if (isRecording) {
      return sessionCursorTrackingAvailable
        ? 'Tracking live'
        : 'Tracking off'
    }

    return selectedSource.kind === 'screen'
      ? 'Tracking ready'
      : 'Static preset'
  }, [isRecording, selectedSource, sessionCursorTrackingAvailable])

  const captureKeyboardTelemetryLabel = useMemo(() => {
    if (!selectedSource) {
      return 'No keys'
    }

    if (isRecording) {
      return sessionKeyboardTrackingAvailable
        ? 'Keys live'
        : 'Keys off'
    }

    return 'Keys ready'
  }, [isRecording, selectedSource, sessionKeyboardTrackingAvailable])

  const projectWorkspaceLocked =
    isProjectLibraryBusy ||
    isRecording ||
    isRecordingAudioRetake ||
    isStartingRecording ||
    isImportingMusicBed ||
    isRemovingMusicBed ||
    isExportingClip ||
    isExportingTimeline

  const totalSequenceDuration = useMemo(
    () =>
      project?.timeline.items.reduce((total, item) => {
        if (!item.enabled) {
          return total
        }

        return total + getTimelineItemDuration(item, clipsById.get(item.clipId))
      }, 0) ?? 0,
    [clipsById, project?.timeline.items],
  )

  const audioStageDuration = useMemo(() => {
    const baseDuration = Math.max(totalSequenceDuration, 1)
    const latestBedEnd = musicBeds.reduce((latestSeconds, bed) => {
      const sourceDuration = getMusicBedSourceDuration(bed)
      const candidateEnd =
        bed.timelineEndSeconds === null
          ? (bed.loop ? baseDuration : bed.timelineStartSeconds + sourceDuration)
          : bed.timelineEndSeconds

      return Math.max(latestSeconds, bed.timelineStartSeconds, candidateEnd)
    }, 0)

    return Math.max(baseDuration, latestBedEnd)
  }, [musicBeds, totalSequenceDuration])

  const activeMusicBedDraftPlacement = useMemo(() => {
    if (!activeMusicBed) {
      return null
    }

    const parsedTimelineStart = parseSecondsInput(musicBedTimelineStartDraft)
    const parsedTimelineEnd = parseSecondsInput(musicBedTimelineEndDraft)
    const timelineStartSeconds =
      parsedTimelineStart === undefined
        ? activeMusicBed.timelineStartSeconds
        : parsedTimelineStart ?? 0
    const timelineEndSeconds =
      parsedTimelineEnd === undefined
        ? activeMusicBed.timelineEndSeconds
        : parsedTimelineEnd === null
          ? null
          : Math.max(timelineStartSeconds, parsedTimelineEnd)

    return getMusicBedPlacement(
      {
        ...activeMusicBed,
        timelineStartSeconds,
        timelineEndSeconds,
        loop: musicBedLoopDraft,
      },
      audioStageDuration,
    )
  }, [
    activeMusicBed,
    audioStageDuration,
    musicBedLoopDraft,
    musicBedTimelineEndDraft,
    musicBedTimelineStartDraft,
  ])

  const automationDraftKeyframes = useMemo(() => {
    if (!activeMusicBedDraftPlacement) {
      return []
    }

    return normalizeAutomationKeyframes(musicBedAutomationKeyframesDraft, {
      startSeconds: activeMusicBedDraftPlacement.timelineStartSeconds,
      endSeconds: activeMusicBedDraftPlacement.timelineEndSeconds,
    })
  }, [activeMusicBedDraftPlacement, musicBedAutomationKeyframesDraft])

  const selectedAutomationKeyframe = useMemo(
    () =>
      automationDraftKeyframes.find((keyframe) => keyframe.id === selectedAutomationKeyframeId) ??
      automationDraftKeyframes[0],
    [automationDraftKeyframes, selectedAutomationKeyframeId],
  )

  const automationDraftSummary = useMemo(() => {
    if (!activeMusicBedDraftPlacement || !automationDraftKeyframes.length) {
      return null
    }

    const gains = automationDraftKeyframes.map((keyframe) => keyframe.gainDb)

    return {
      startSeconds: automationDraftKeyframes[0].timeSeconds,
      endSeconds: automationDraftKeyframes[automationDraftKeyframes.length - 1].timeSeconds,
      minGainDb: Math.min(...gains),
      maxGainDb: Math.max(...gains),
    }
  }, [activeMusicBedDraftPlacement, automationDraftKeyframes])

  const automationDraftCurvePath = useMemo(() => {
    if (!activeMusicBedDraftPlacement) {
      return ''
    }

    return buildAutomationCurvePath(automationDraftKeyframes, activeMusicBedDraftPlacement)
  }, [activeMusicBedDraftPlacement, automationDraftKeyframes])

  const activeMusicBedAutomationKeyframesSignature = useMemo(
    () => serializeAutomationKeyframes(activeMusicBed?.automation.keyframes ?? []),
    [activeMusicBed?.automation.keyframes],
  )

  const automationDraftKeyframesSignature = useMemo(
    () => serializeAutomationKeyframes(musicBedAutomationKeyframesDraft),
    [musicBedAutomationKeyframesDraft],
  )

  const totalTimelineCanvasDuration = useMemo(
    () =>
      visibleTimelineItems.reduce(
        (total, item) => total + getTimelineItemDuration(item, clipsById.get(item.clipId)),
        0,
      ),
    [clipsById, visibleTimelineItems],
  )

  const timelineSequence = useMemo(
    () => buildTimelineSequence(visibleTimelineItems, clipsById),
    [clipsById, visibleTimelineItems],
  )

  const selectedTimelineSegment = useMemo(
    () =>
      selectedTimelineItem
        ? timelineSequence.find((segment) => segment.item.id === selectedTimelineItem.id)
        : undefined,
    [selectedTimelineItem, timelineSequence],
  )

  const previewTimelineSegment = useMemo(() => {
    if (!timelineSequence.length) {
      return undefined
    }

    const clampedSeconds = clampNumber(
      timelinePlayheadSeconds,
      0,
      Math.max(timelineSequence[timelineSequence.length - 1]?.endSeconds ?? 0, 0),
    )

    return (
      timelineSequence.find((segment, index) => {
        if (clampedSeconds < segment.startSeconds) {
          return false
        }

        if (clampedSeconds < segment.endSeconds) {
          return true
        }

        return index === timelineSequence.length - 1 && clampedSeconds <= segment.endSeconds + 0.001
      }) ?? timelineSequence[0]
    )
  }, [timelinePlayheadSeconds, timelineSequence])

  const previewSequenceMode = Boolean(previewTimelineSegment)

  const previewClipContext = useMemo(() => {
    if (isRecording) {
      return null
    }

    if (previewTimelineSegment?.clip) {
      return {
        clip: previewTimelineSegment.clip,
        timelineItem: previewTimelineSegment.item,
        timelineIndex: previewTimelineSegment.index,
        timelineItemCount: timelineSequence.length,
        fileUrl: getFileUrlFromWindowsPath(previewTimelineSegment.clip.filePath),
        cameraFileUrl: getFileUrlFromWindowsPath(previewTimelineSegment.clip.cameraTake?.filePath || ''),
        microphoneFileUrl: getFileUrlFromWindowsPath(previewTimelineSegment.clip.microphoneTake?.filePath || ''),
        sourceStartSeconds: previewTimelineSegment.bounds.startSeconds,
        sourceEndSeconds: previewTimelineSegment.bounds.endSeconds,
        localPlayheadSeconds: clampNumber(
          timelinePlayheadSeconds - previewTimelineSegment.startSeconds,
          0,
          previewTimelineSegment.bounds.durationSeconds,
        ),
        durationSeconds: previewTimelineSegment.bounds.durationSeconds,
        isTimelinePreview: true,
      }
    }

    if (!selectedClip) {
      return null
    }

    const sourceStartSeconds = selectedClip.trim.startSeconds
    const sourceEndSeconds = selectedClip.trim.endSeconds ?? selectedClip.durationSeconds
    const durationSeconds = Math.max(0, sourceEndSeconds - sourceStartSeconds)

    return {
      clip: selectedClip,
      timelineItem: null,
      timelineIndex: 0,
      timelineItemCount: 0,
      fileUrl: getFileUrlFromWindowsPath(selectedClip.filePath),
      cameraFileUrl: getFileUrlFromWindowsPath(selectedClip.cameraTake?.filePath || ''),
      microphoneFileUrl: getFileUrlFromWindowsPath(selectedClip.microphoneTake?.filePath || ''),
      sourceStartSeconds,
      sourceEndSeconds,
      localPlayheadSeconds: clampNumber(timelinePlayheadSeconds, 0, durationSeconds),
      durationSeconds,
      isTimelinePreview: false,
    }
  }, [isRecording, previewTimelineSegment, selectedClip, timelinePlayheadSeconds, timelineSequence.length])

  const previewPlaybackTargetSeconds = useMemo(
    () =>
      previewClipContext
        ? Number((previewClipContext.sourceStartSeconds + previewClipContext.localPlayheadSeconds).toFixed(3))
        : 0,
    [previewClipContext],
  )
  useEffect(() => {
    previewPlaybackTargetSecondsRef.current = previewPlaybackTargetSeconds
  }, [previewPlaybackTargetSeconds])
  const previewActiveAudioRetake = useMemo(
    () => getActiveAudioRetakeAtTime(previewClipContext?.clip.audioRetakes, previewPlaybackTargetSeconds),
    [previewClipContext?.clip.audioRetakes, previewPlaybackTargetSeconds],
  )
  const previewMicrophonePlayback = useMemo(() => {
    if (!previewClipContext) {
      return null
    }

    if (previewActiveAudioRetake?.filePath) {
      return {
        fileUrl: getFileUrlFromWindowsPath(previewActiveAudioRetake.filePath),
        sourceSeconds: clampNumber(
          previewPlaybackTargetSeconds - previewActiveAudioRetake.startSeconds,
          0,
          previewActiveAudioRetake.durationSeconds || Math.max(0, previewActiveAudioRetake.endSeconds - previewActiveAudioRetake.startSeconds),
        ),
        mode: 'retake' as const,
        retake: previewActiveAudioRetake,
      }
    }

    if (previewClipContext.clip.microphoneTake?.filePath) {
      return {
        fileUrl: getFileUrlFromWindowsPath(previewClipContext.clip.microphoneTake.filePath),
        sourceSeconds: previewPlaybackTargetSeconds,
        mode: 'stem' as const,
        retake: null,
      }
    }

    return null
  }, [previewActiveAudioRetake, previewClipContext, previewPlaybackTargetSeconds])

  const previewFocusMotionSegments = useMemo(() => {
    if (!previewClipContext) {
      return []
    }

    return buildFocusMotionSegments(
      normalizeFocusRegions(previewClipContext.clip.focusRegions ?? [], previewClipContext.clip.durationSeconds),
      previewClipContext.clip.durationSeconds,
      0.5,
      0.5,
      previewClipContext.clip.cursorTrack ?? null,
    )
  }, [previewClipContext])

  const previewFocusRegion = useMemo(
    () => getFocusMotionStateAtTime(previewFocusMotionSegments, previewPlaybackTargetSeconds),
    [previewFocusMotionSegments, previewPlaybackTargetSeconds],
  )
  const previewCursorTrack = useMemo(
    () => (isRecording ? null : previewClipContext?.clip.cursorTrack ?? null),
    [isRecording, previewClipContext?.clip.cursorTrack],
  )
  const previewClipCursorRenderMode = previewClipContext?.clip.cursorRenderMode ?? 'baked'
  const previewCursorPulseEvents = useMemo(
    () => getCursorPulseEventsForTrack(previewCursorTrack),
    [previewCursorTrack],
  )

  useEffect(() => {
    const appearances = previewClipContext?.clip.cursorTrack?.appearances ?? []

    for (const asset of appearances) {
      rememberCursorAppearanceAsset(asset)
      void cacheCursorAppearanceImage(asset.id, asset.imageDataUrl)
    }
  }, [cacheCursorAppearanceImage, previewClipContext?.clip.cursorTrack?.appearances])

  const previewActiveKeyboardShortcuts = useMemo(() => {
    if (!activeShortcutSettings.enabled) {
      return []
    }

    if (isRecording) {
      return []
    }

    if (!previewClipContext) {
      return []
    }

    return getActiveKeyboardShortcutsAtTime(
      previewClipContext.clip.keyboardShortcuts ?? [],
      previewPlaybackTargetSeconds,
      activeShortcutSettings.showSymbols,
    )
  }, [activeShortcutSettings.enabled, activeShortcutSettings.showSymbols, isRecording, previewClipContext, previewPlaybackTargetSeconds])

  const previewActiveTranscriptSegment = useMemo(() => {
    if (!activeCaptionSettings.enabled || isRecording || !previewClipContext) {
      return null
    }

    return getActiveTranscriptSegmentAtTime(previewClipContext.clip.transcript, previewPlaybackTargetSeconds)
  }, [activeCaptionSettings.enabled, isRecording, previewClipContext, previewPlaybackTargetSeconds])

  const previewActiveTranscriptWords = useMemo(
    () => getTranscriptWordsForSegment(previewClipContext?.clip.transcript, previewActiveTranscriptSegment),
    [previewClipContext?.clip.transcript, previewActiveTranscriptSegment],
  )

  const previewCanHighlightTranscriptWords = useMemo(
    () => shouldUseTranscriptWordHighlighting(previewActiveTranscriptSegment, previewActiveTranscriptWords),
    [previewActiveTranscriptSegment, previewActiveTranscriptWords],
  )

  const previewActiveTranscriptWordId = useMemo(
    () =>
      activeCaptionSettings.wordHighlighting && previewCanHighlightTranscriptWords
        ? getActiveTranscriptWordIdAtTime(previewActiveTranscriptWords, previewPlaybackTargetSeconds)
        : '',
    [activeCaptionSettings.wordHighlighting, previewActiveTranscriptWords, previewCanHighlightTranscriptWords, previewPlaybackTargetSeconds],
  )

  const previewKeyboardShortcutSummary = useMemo(() => {
    if (!previewClipContext?.clip.keyboardShortcuts?.length) {
      return {
        label: 'No keys',
        detail: 'No shortcut data.',
      }
    }

    const visibleCount = previewClipContext.clip.keyboardShortcuts.filter((shortcut) => shortcut.visible !== false).length

    if (!activeShortcutSettings.enabled) {
      return {
        label: 'Overlay off',
        detail: `${visibleCount} stored`,
      }
    }

    return {
      label: `${visibleCount} cue${visibleCount === 1 ? '' : 's'}`,
      detail: activeShortcutSettings.showSymbols
        ? 'Symbols'
        : 'Text',
    }
  }, [activeShortcutSettings.enabled, activeShortcutSettings.showSymbols, previewClipContext?.clip.keyboardShortcuts])

  const previewCaptionSummary = useMemo(() => {
    if (!previewClipContext?.clip.transcript?.segments?.length) {
      return {
        label: 'No transcript',
        detail: 'Import or generate.',
      }
    }

    const visibleCount = previewClipContext.clip.transcript.segments.filter((segment) => segment.visible !== false).length

    if (!activeCaptionSettings.enabled) {
      return {
        label: 'Captions hidden',
        detail: `${visibleCount} stored`,
      }
    }

    if (!previewActiveTranscriptSegment) {
      return {
        label: `${visibleCount} armed`,
        detail: activeCaptionSettings.wordHighlighting
          ? 'Word ready'
          : 'Overlay ready',
      }
    }

    return {
      label: activeCaptionSettings.wordHighlighting ? 'Word live' : 'Caption live',
      detail: formatTranscriptSegmentSummary(previewActiveTranscriptSegment, activeCaptionSettings.showSpeakerLabels),
    }
  }, [
    activeCaptionSettings.enabled,
    activeCaptionSettings.showSpeakerLabels,
    activeCaptionSettings.wordHighlighting,
    previewActiveTranscriptSegment,
    previewClipContext?.clip.transcript?.segments,
  ])

  const filteredSelectedTranscriptSegments = useMemo(() => {
    if (!selectedClipTranscriptSegments.length) {
      return []
    }

    const query = transcriptSearchQuery.trim().toLowerCase()

    if (!query) {
      return selectedClipTranscriptSegments
    }

    return selectedClipTranscriptSegments.filter((segment) =>
      `${segment.speaker} ${segment.text}`.toLowerCase().includes(query),
    )
  }, [selectedClipTranscriptSegments, transcriptSearchQuery])

  const selectedClipTimelineItems = useMemo(() => {
    if (!project || !selectedClip) {
      return []
    }

    return project.timeline.items.filter((item) => item.clipId === selectedClip.id)
  }, [project, selectedClip])

  const transcriptSequenceStateBySegmentId = useMemo(() => {
    const stateBySegmentId = new Map<string, 'live' | 'cut' | 'mixed' | 'outside'>()

    if (!selectedClip || !selectedClipTranscriptSegments.length || !selectedClipTimelineItems.length) {
      return stateBySegmentId
    }

    for (const segment of selectedClipTranscriptSegments) {
      const hiddenCut = selectedClipTimelineItems.some(
        (item) => item.enabled === false && item.transcriptCut?.segmentId === segment.id,
      )
      const liveOverlap = selectedClipTimelineItems.some((item) => {
        if (item.enabled === false) {
          return false
        }

        const bounds = getTimelineItemBounds(item, selectedClip)
        return rangesOverlap(segment.startSeconds, segment.endSeconds, bounds.startSeconds, bounds.endSeconds)
      })

      stateBySegmentId.set(
        segment.id,
        hiddenCut ? (liveOverlap ? 'mixed' : 'cut') : liveOverlap ? 'live' : 'outside',
      )
    }

    return stateBySegmentId
  }, [selectedClip, selectedClipTimelineItems, selectedClipTranscriptSegments])

  const selectedTranscriptTimelineAction = useMemo(() => {
    if (!selectedClip || !selectedTranscriptSegment) {
        return {
          mode: 'unavailable' as const,
          item: null as ProjectTimelineItem | null,
          message: 'Select a line.',
        }
      }

    if (!selectedClipTimelineItems.length) {
      return {
        mode: 'unavailable' as const,
        item: null as ProjectTimelineItem | null,
        message: 'Add this clip to the sequence first.',
      }
    }

    const selectedShotOnClip =
      selectedTimelineItem && selectedTimelineItem.clipId === selectedClip.id ? selectedTimelineItem : null

    const matchingLiveItem = selectedClipTimelineItems.find((item) => {
      if (item.enabled === false) {
        return false
      }

      const bounds = getTimelineItemBounds(item, selectedClip)
      return rangesOverlap(selectedTranscriptSegment.startSeconds, selectedTranscriptSegment.endSeconds, bounds.startSeconds, bounds.endSeconds)
    })

    const hiddenCutItem = selectedClipTimelineItems.find(
      (item) => item.enabled === false && item.transcriptCut?.segmentId === selectedTranscriptSegment.id,
    )

    if (selectedShotOnClip && selectedShotOnClip.enabled !== false) {
      const selectedBounds = getTimelineItemBounds(selectedShotOnClip, selectedClip)

      if (
        rangesOverlap(
          selectedTranscriptSegment.startSeconds,
          selectedTranscriptSegment.endSeconds,
          selectedBounds.startSeconds,
          selectedBounds.endSeconds,
        )
      ) {
        return {
          mode: 'cut' as const,
          item: selectedShotOnClip,
          message: `Cut from "${selectedShotOnClip.label}".`,
        }
      }
    }

    if (hiddenCutItem) {
      return {
        mode: 'restore' as const,
        item: hiddenCutItem,
        message: `Restore from "${hiddenCutItem.transcriptCut?.sourceLabel || hiddenCutItem.label}".`,
      }
    }

    if (matchingLiveItem) {
      return {
        mode: 'cut' as const,
        item: matchingLiveItem,
        message: `Cut from "${matchingLiveItem.label}".`,
      }
    }

      return {
        mode: 'unavailable' as const,
        item: null as ProjectTimelineItem | null,
        message:
          selectedShotOnClip && selectedShotOnClip.enabled !== false
            ? 'Choose a shot that covers this line.'
            : 'No live shot covers this line.',
      }
  }, [selectedClip, selectedClipTimelineItems, selectedTimelineItem, selectedTranscriptSegment])

  const previewClipAudioSettings = useMemo(() => {
    if (!previewClipContext) {
      return null
    }

    if (selectedClip && previewClipContext.clip.id === selectedClip.id) {
      return {
        ...previewClipContext.clip.audio,
        muted: clipAudioMutedDraft,
        gainDb: clipAudioGainDraft,
      }
    }

    return previewClipContext.clip.audio
  }, [clipAudioGainDraft, clipAudioMutedDraft, previewClipContext, selectedClip])

  const previewBedTimelineDuration = Math.max(
    totalTimelineCanvasDuration,
    selectedClip?.durationSeconds ?? 0,
    audioStageDuration,
    4,
  )
  const previewHasSourceAudio = Boolean(previewClipAudioSettings?.hasAudio && !previewClipAudioSettings.muted)
  const previewHasVoiceStem = Boolean(previewClipContext?.clip.microphoneTake?.filePath || previewClipContext?.clip.audioRetakes?.length)
  const previewSupportsMusicBeds = Boolean(previewSequenceMode && enabledMusicBedCount)
  const previewMusicBeds = useMemo(
    () =>
      previewSupportsMusicBeds
        ? musicBeds.filter(
            (bed) =>
              bed.enabled &&
              bed.filePath &&
              getMusicBedPlacement(bed, previewBedTimelineDuration).durationSeconds > 0,
          )
        : [],
    [musicBeds, previewBedTimelineDuration, previewSupportsMusicBeds],
  )
  const previewHasMusicBeds = previewMusicBeds.length > 0
  const previewPlaybackHasAudio = previewHasSourceAudio || previewHasVoiceStem || previewHasMusicBeds

  const previewAudioStageSummary = useMemo(() => {
    if (!previewClipContext) {
      return {
        label: 'Standby',
        detail: 'Load a clip.',
      }
    }

    const voiceLabel = voiceClarityEnabledDraft ? 'Clean mic' : 'Voice stem'
    const retakeLabel = previewActiveAudioRetake ? 'Retake' : ''
    const bedSummary = previewHasMusicBeds
      ? `${previewMusicBeds.length} bed${previewMusicBeds.length === 1 ? '' : 's'}`
      : ''
    const compactDetail = [voiceLabel, retakeLabel, bedSummary].filter(Boolean).join(' / ')

    if (!previewPlaybackHasAudio) {
      return {
        label: 'Silent',
        detail: 'No audio',
      }
    }

    if (previewHasSourceAudio && previewHasVoiceStem) {
      return {
        label: previewHasMusicBeds ? 'Full mix' : 'Clip + voice',
        detail: compactDetail || 'Voice ready',
      }
    }

    if (previewHasVoiceStem) {
      return {
        label: previewHasMusicBeds ? 'Voice + beds' : 'Voice focus',
        detail: compactDetail || voiceLabel,
      }
    }

    if (previewHasMusicBeds) {
      return {
        label: 'Music beds',
        detail: bedSummary || 'Beds live',
      }
    }

    return {
      label: 'Clip audio',
      detail: `${formatGainDb(previewClipAudioSettings?.gainDb ?? 0)}`,
    }
  }, [
    previewClipAudioSettings?.gainDb,
    previewClipContext,
    previewHasMusicBeds,
    previewHasSourceAudio,
    previewHasVoiceStem,
    previewActiveAudioRetake,
    previewPlaybackHasAudio,
    previewMusicBeds.length,
    voiceClarityEnabledDraft,
  ])

  const stageBackgroundLayerStyle = useMemo(
    () => buildBackgroundLayerStyle(activeBackgroundSettings),
    [activeBackgroundSettings],
  )

  const stageBackgroundBlurStyle = useMemo(
    () => buildStageBackgroundBlurStyle(activeBackgroundSettings),
    [activeBackgroundSettings],
  )

  const stageSurfaceStyle = useMemo(
    () => buildStageSurfaceStyle(activeBackgroundSettings),
    [activeBackgroundSettings],
  )

  const stageCameraStyle = useMemo(
    () => buildStageCameraStyle(activeCameraSettings),
    [activeCameraSettings],
  )

  const stageCameraFeedStyle = useMemo(
    () => ({
      transform: activeCameraSettings.mirror ? 'scaleX(-1)' : 'none',
    }),
    [activeCameraSettings.mirror],
  )

  const stageMediaFitMode = project?.output.fitMode === 'contain' ? 'contain' : 'cover'
  const stageMediaFitStyle = useMemo<CSSProperties>(
    () => ({
      objectFit: stageMediaFitMode,
    }),
    [stageMediaFitMode],
  )

  const stagePreviewMotionStyle = useMemo<CSSProperties>(() => {
    if (!previewFocusRegion || previewFocusRegion.zoom <= 1.001) {
      return {}
    }

    const zoom = clampNumber(previewFocusRegion.zoom, 1.05, 4)
    const translateX = (0.5 - previewFocusRegion.focusX) * (zoom - 1) * 100
    const translateY = (0.5 - previewFocusRegion.focusY) * (zoom - 1) * 100

    return {
      transform: `translate(${translateX.toFixed(2)}%, ${translateY.toFixed(2)}%) scale(${zoom.toFixed(3)})`,
      transition: isStagePlaying ? 'none' : undefined,
    }
  }, [isStagePlaying, previewFocusRegion])

  const activeCameraDeviceLabel = useMemo(
    () => resolveCameraDeviceLabel(activeCameraSettings, cameraDevices),
    [activeCameraSettings, cameraDevices],
  )

  const activeMicrophoneDeviceLabel = useMemo(
    () => resolveMicrophoneDeviceLabel(settings, microphoneDevices),
    [microphoneDevices, settings],
  )

  const previewCameraVisible = Boolean(
    activeCameraSettings.enabled && !isRecording && previewClipContext?.clip.cameraTake?.filePath,
  )

  const enabledTimelineItemCount = useMemo(
    () => project?.timeline.items.filter((item) => item.enabled).length ?? 0,
    [project?.timeline.items],
  )

  const previewTimelineDuration = useMemo(
    () => Math.max(totalTimelineCanvasDuration, selectedClip?.durationSeconds ?? 0, audioStageDuration, 4),
    [audioStageDuration, selectedClip?.durationSeconds, totalTimelineCanvasDuration],
  )

  const timelineFocusBlocks = useMemo(() => {
    const safeDuration = Math.max(previewTimelineDuration, 0.1)

    if (timelineSequence.length) {
      return timelineSequence.flatMap((segment) => {
        if (!segment.clip) {
          return []
        }

        const targetClip = segment.clip
        const focusRegions = normalizeFocusRegions(targetClip.focusRegions ?? [], targetClip.durationSeconds)

        return focusRegions.flatMap((region) => {
          const overlapStart = Math.max(region.startSeconds, segment.bounds.startSeconds)
          const overlapEnd = Math.min(region.endSeconds, segment.bounds.endSeconds)
          const durationSeconds = overlapEnd - overlapStart

          if (durationSeconds < 0.05) {
            return []
          }

          const startSeconds = segment.startSeconds + (overlapStart - segment.bounds.startSeconds)

          return [
            {
              key: `${segment.item.id}:${region.id}`,
              region,
              itemId: segment.item.id,
              clipId: targetClip.id,
              leftPercent: (startSeconds / safeDuration) * 100,
              widthPercent: Math.max((durationSeconds / safeDuration) * 100, 5.5),
            },
          ]
        })
      })
    }

    if (!selectedClipFocusRegions.length) {
      return []
    }

    const visibleStartSeconds = selectedClip?.trim.startSeconds ?? 0
    const visibleEndSeconds = selectedClip?.trim.endSeconds ?? selectedClip?.durationSeconds ?? 0

    return selectedClipFocusRegions.flatMap((region) => {
      const overlapStart = Math.max(region.startSeconds, visibleStartSeconds)
      const overlapEnd = Math.min(region.endSeconds, visibleEndSeconds)
      const durationSeconds = overlapEnd - overlapStart

      if (durationSeconds < 0.05) {
        return []
      }

      return [
        {
          key: region.id,
          region,
          itemId: '',
          clipId: selectedClip?.id ?? '',
          leftPercent: (overlapStart / safeDuration) * 100,
          widthPercent: Math.max((durationSeconds / safeDuration) * 100, 5.5),
        },
      ]
    })
  }, [
    previewTimelineDuration,
    selectedClip?.durationSeconds,
    selectedClip?.id,
    selectedClip?.trim.endSeconds,
    selectedClip?.trim.startSeconds,
    selectedClipFocusRegions,
    timelineSequence,
  ])

  const previewPlayheadRatio = useMemo(
    () => clampUnit(previewTimelineDuration ? timelinePlayheadSeconds / previewTimelineDuration : 0),
    [previewTimelineDuration, timelinePlayheadSeconds],
  )

  const previewRulerMarks = useMemo(() => {
    const steps = Math.min(5, Math.max(2, Math.ceil(previewTimelineDuration) + 1))

    return Array.from({ length: steps }, (_, index) => {
      const ratio = steps === 1 ? 0 : index / (steps - 1)
      return {
        label: formatTimer(Math.round(previewTimelineDuration * ratio)),
        leftPercent: ratio * 100,
      }
    })
  }, [previewTimelineDuration])

  const previewMediaLabel = isRecording
    ? selectedSource?.name || 'Live capture'
    : previewClipContext?.isTimelinePreview
      ? `Sequence ${String((previewClipContext.timelineIndex ?? 0) + 1).padStart(2, '0')}`
      : selectedClip?.label || selectedSource?.name || 'Preview'

  const previewMediaDetail = isRecording
    ? `${activeMotionPreset?.label ?? activeProfile?.label ?? 'Capture'}`
    : previewClipContext?.isTimelinePreview && previewClipContext.timelineItem
      ? `${previewClipContext.timelineItem.label} / ${previewClipContext.clip.captureProfile.motionPresetLabel}`
      : selectedClip
        ? `${selectedClip.captureProfile.motionPresetLabel}`
        : 'Arm a source to record.'

  const stageFocusEditingEnabled = Boolean(
    selectedFocusRegion &&
      !isRecording &&
      (!previewSequenceMode || previewClipContext?.clip.id === selectedClip?.id),
  )
  const stageLiveCursorTelemetryVisible = Boolean(
    isRecording && liveCaptureCursorRenderMode === 'overlay' && sessionCursorTrackingAvailable,
  )
  const stagePlaybackCursorOverlayVisible = Boolean(
    activeCursorSettings.showCursor &&
      !isRecording &&
      previewClipCursorRenderMode === 'overlay' &&
      previewClipContext?.fileUrl &&
      previewCursorTrack?.points?.length,
  )
  const stageShouldHideNativeCursor = Boolean(
    !stageFocusEditingEnabled &&
      activeCursorSettings.showCursor &&
      (
        stageLiveCursorTelemetryVisible ||
        (
          !isRecording &&
          previewClipContext?.fileUrl
        )
      ),
  )
  const stageSurfaceClassName = `stage-surface ${stageFocusEditingEnabled ? 'focus-editable' : ''} ${stageShouldHideNativeCursor ? 'cursor-hidden' : ''}`.trim()

  const hideCursorIndicatorNode = (node: HTMLDivElement | null) => {
    if (!node) {
      return
    }

    node.style.display = 'none'
  }

  const positionCursorIndicatorNode = (
    node: HTMLDivElement | null,
    x: number,
    y: number,
    unit: '%' | 'px' = '%',
  ) => {
    if (!node) {
      return
    }

    node.style.display = 'block'
    node.style.left = unit === '%' ? `${x}%` : `${x}px`
    node.style.top = unit === '%' ? `${y}%` : `${y}px`
  }

  const cancelLiveCursorDecorationFrame = useCallback(() => {
    if (liveCursorDecorationFrameRef.current !== null) {
      window.cancelAnimationFrame(liveCursorDecorationFrameRef.current)
      liveCursorDecorationFrameRef.current = null
    }
  }, [])

  const resolveStageLiveCursorMetrics = useCallback(() => {
    const host = stageLiveCursorLayerRef.current
    const mediaElement = stageLivePreviewRef.current
    const coordinateSpace = liveCursorCoordinateSpaceRef.current
    const frameWidth = host?.clientWidth || mediaElement?.clientWidth || 0
    const frameHeight = host?.clientHeight || mediaElement?.clientHeight || 0
    const sourceWidth = mediaElement?.videoWidth || coordinateSpace?.width || 0
    const sourceHeight = mediaElement?.videoHeight || coordinateSpace?.height || 0

    if (!host || frameWidth <= 0 || frameHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
      return null
    }

    return {
      viewport: fitRectIntoFrame({
        sourceWidth,
        sourceHeight,
        frameWidth,
        frameHeight,
        fitMode: stageMediaFitMode,
      }),
      coordinateSpace: coordinateSpace ?? {
        width: sourceWidth,
        height: sourceHeight,
      },
    }
  }, [stageMediaFitMode])

  const hideLiveCursorDecorations = useCallback(() => {
    cancelLiveCursorDecorationFrame()
    hideCursorIndicatorNode(captureDeckCursorIndicatorRef.current)
    hideCursorIndicatorNode(stageLiveCursorIndicatorRef.current)

    const stageCursor = stageLiveCursorRef.current
    if (stageCursor) {
      stageCursor.style.display = 'none'
    }

    const pulse = stageLiveCursorPulseRef.current
    if (pulse) {
      pulse.classList.remove('active')
      pulse.style.display = 'none'
    }
  }, [cancelLiveCursorDecorationFrame])

  const syncLiveCursorDecorations = useCallback(() => {
    const liveCursorVisual = liveCursorVisualRef.current
    const shouldShowTelemetryIndicator = isRecording && Boolean(liveCursorVisual)

    if (shouldShowTelemetryIndicator && liveCursorVisual) {
      positionCursorIndicatorNode(
        captureDeckCursorIndicatorRef.current,
        clampUnit(liveCursorVisual.x) * 100,
        clampUnit(liveCursorVisual.y) * 100,
      )
    } else {
      hideCursorIndicatorNode(captureDeckCursorIndicatorRef.current)
    }

    if (!stageLiveCursorTelemetryVisible || !liveCursorVisual) {
      hideCursorIndicatorNode(stageLiveCursorIndicatorRef.current)
      const stageCursor = stageLiveCursorRef.current
      if (stageCursor) {
        stageCursor.style.display = 'none'
      }
      return
    }

    const metrics = resolveStageLiveCursorMetrics()
    const stageCursor = stageLiveCursorRef.current
    const stageCursorImage = stageLiveCursorImageRef.current

    if (!metrics || !stageCursor || !stageCursorImage) {
      hideCursorIndicatorNode(stageLiveCursorIndicatorRef.current)
      if (stageCursor) {
        stageCursor.style.display = 'none'
      }
      return
    }

    const { viewport, coordinateSpace } = metrics
    const cursorX = viewport.x + clampUnit(liveCursorVisual.x) * viewport.width
    const cursorY = viewport.y + clampUnit(liveCursorVisual.y) * viewport.height

    if (!activeCursorSettings.showCursor) {
      positionCursorIndicatorNode(stageLiveCursorIndicatorRef.current, cursorX, cursorY, 'px')
      stageCursor.style.display = 'none'
      return
    }

    hideCursorIndicatorNode(stageLiveCursorIndicatorRef.current)

    const resolvedCursorKind =
      activeCursorSettings.alwaysPointer
        ? 'arrow'
        : normalizeCursorVisualKind(liveCursorVisual.cursorKind)
    const normalizedAppearanceId = normalizeCursorAppearanceId(liveCursorVisual.cursorAppearanceId)
    const exactAppearanceAsset = normalizedAppearanceId
      ? cursorAppearanceAssetRef.current.get(normalizedAppearanceId)
      : undefined
    const premiumAppearanceAsset =
      activeCursorSettings.style === 'windows' && !activeCursorSettings.alwaysPointer
        ? resolvePremiumCursorAppearanceAsset(resolvedCursorKind)
        : undefined
    const fallbackAppearanceAsset =
      activeCursorSettings.style === 'windows' && !activeCursorSettings.alwaysPointer
        ? cursorAppearanceKindRef.current.get(resolvedCursorKind)
        : undefined
    const preferredAppearanceAsset =
      activeCursorSettings.style === 'windows' && !activeCursorSettings.alwaysPointer
        ? premiumAppearanceAsset ?? exactAppearanceAsset ?? fallbackAppearanceAsset
        : exactAppearanceAsset ?? premiumAppearanceAsset ?? fallbackAppearanceAsset
    const metricAppearanceAsset =
      exactAppearanceAsset ?? fallbackAppearanceAsset ?? preferredAppearanceAsset
    const imageDataUrl = preferredAppearanceAsset?.imageDataUrl ?? exactAppearanceAsset?.imageDataUrl

    if (!imageDataUrl) {
      stageCursor.style.display = 'none'
      return
    }

    const hotspotRatios = normalizeCursorHotspotRatiosForKind(
      resolvedCursorKind,
      metricAppearanceAsset?.hotspotRatioX ?? liveCursorVisual.cursorHotspotRatioX,
      metricAppearanceAsset?.hotspotRatioY ?? liveCursorVisual.cursorHotspotRatioY,
    )
    const referenceWidth = Math.max(
      1,
      Number(metricAppearanceAsset?.referenceWidth) ||
        Number(liveCursorVisual.referenceWidth) ||
        Number(preferredAppearanceAsset?.referenceWidth) ||
        32,
    )
    const referenceHeight = Math.max(
      1,
      Number(metricAppearanceAsset?.referenceHeight) ||
        Number(liveCursorVisual.referenceHeight) ||
        Number(preferredAppearanceAsset?.referenceHeight) ||
        32,
    )
    const { scaleX: pointerScaleX, scaleY: pointerScaleY } = resolveCursorScaleMetrics({
      baseScale: activeCursorSettings.size,
      frameWidth: viewport.width,
      frameHeight: viewport.height,
      coordinateSpaceWidth: Math.max(1, coordinateSpace.width),
      coordinateSpaceHeight: Math.max(1, coordinateSpace.height),
    })
    const displayWidth = referenceWidth * pointerScaleX
    const displayHeight = referenceHeight * pointerScaleY
    const hotspotX = hotspotRatios.hotspotRatioX * displayWidth
    const hotspotY = hotspotRatios.hotspotRatioY * displayHeight

    stageCursorImage.src = imageDataUrl
    stageCursor.style.display = 'block'
    stageCursor.style.width = `${displayWidth}px`
    stageCursor.style.height = `${displayHeight}px`
    stageCursor.style.transform = `translate(${cursorX - hotspotX}px, ${cursorY - hotspotY}px)`
  }, [
    activeCursorSettings.alwaysPointer,
    activeCursorSettings.showCursor,
    activeCursorSettings.size,
    activeCursorSettings.style,
    isRecording,
    resolvePremiumCursorAppearanceAsset,
    resolveStageLiveCursorMetrics,
    stageLiveCursorTelemetryVisible,
  ])

  const scheduleLiveCursorDecorationsSync = useCallback(() => {
    if (liveCursorDecorationFrameRef.current !== null) {
      return
    }

    liveCursorDecorationFrameRef.current = window.requestAnimationFrame(() => {
      liveCursorDecorationFrameRef.current = null
      syncLiveCursorDecorations()
    })
  }, [syncLiveCursorDecorations])

  const triggerLiveCursorPulse = useCallback((x: number, y: number, strength: number) => {
    if (
      !stageLiveCursorTelemetryVisible ||
      !activeCursorSettings.showCursor ||
      activeCursorSettings.clickEffect !== 'ripple'
    ) {
      return
    }

    const pulse = stageLiveCursorPulseRef.current
    const metrics = resolveStageLiveCursorMetrics()

    if (!pulse || !metrics) {
      return
    }

    const { viewport, coordinateSpace } = metrics
    const pulseX = viewport.x + clampUnit(x) * viewport.width
    const pulseY = viewport.y + clampUnit(y) * viewport.height
    const { scale: pulseScale } = resolveCursorScaleMetrics({
      baseScale: activeCursorSettings.size,
      frameWidth: viewport.width,
      frameHeight: viewport.height,
      coordinateSpaceWidth: Math.max(1, coordinateSpace.width),
      coordinateSpaceHeight: Math.max(1, coordinateSpace.height),
    })
    const pulseStrength = clampCursorClickEffectStrength(strength)
    const pulseSize = Math.max(18, 28 * pulseScale * pulseStrength)

    pulse.style.display = 'block'
    pulse.style.left = `${pulseX}px`
    pulse.style.top = `${pulseY}px`
    pulse.style.width = `${pulseSize}px`
    pulse.style.height = `${pulseSize}px`
    pulse.style.marginLeft = `${-(pulseSize / 2)}px`
    pulse.style.marginTop = `${-(pulseSize / 2)}px`
    pulse.style.setProperty('--stage-live-cursor-pulse-strength', pulseStrength.toFixed(3))
    pulse.classList.remove('active')
    void pulse.offsetWidth
    pulse.classList.add('active')
  }, [
    activeCursorSettings.clickEffect,
    activeCursorSettings.showCursor,
    activeCursorSettings.size,
    resolveStageLiveCursorMetrics,
    stageLiveCursorTelemetryVisible,
  ])

  const stagePosterThumbnail = previewClipContext?.clip.thumbnailDataUrl || selectedSource?.thumbnailDataUrl || ''
  const stagePosterLabel = previewClipContext?.clip.label || previewMediaLabel
  const previewSequenceSummary = previewClipContext?.isTimelinePreview
    ? `Shot ${previewClipContext.timelineIndex + 1}/${previewClipContext.timelineItemCount}`
    : ''
  const previewStageSummaryDetail = isRecording
    ? `${activeProfile?.label ?? 'Capture'} / ${activeMotionPreset?.label ?? 'Motion'}`
    : selectedClip
      ? `${selectedClip.captureProfile.motionPresetLabel}`
      : previewMediaDetail

  const canSplitSelectedTimelineItem = useMemo(() => {
    if (!selectedTimelineSegment) {
      return false
    }

    const localPlayhead = timelinePlayheadSeconds - selectedTimelineSegment.startSeconds

    return (
      localPlayhead > 0.15 &&
      localPlayhead < selectedTimelineSegment.bounds.durationSeconds - 0.15
    )
  }, [selectedTimelineSegment, timelinePlayheadSeconds])

  useEffect(() => {
    const playbackElement = stagePlaybackRef.current

    if (!playbackElement || stagePlaybackAudioContextRef.current) {
      return
    }

    const StageAudioContext =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!StageAudioContext) {
      return
    }

    const microphoneElement = new Audio()
    microphoneElement.preload = 'auto'

    const audioContext = new StageAudioContext()

    stagePlaybackMicrophoneRef.current = microphoneElement
    stagePlaybackAudioContextRef.current = audioContext
    stagePlaybackSourceNodeRef.current = audioContext.createMediaElementSource(playbackElement)
    stagePlaybackMicrophoneSourceNodeRef.current = audioContext.createMediaElementSource(microphoneElement)
    stagePlaybackSourceGainRef.current = audioContext.createGain()
    stagePlaybackMicrophoneGainRef.current = audioContext.createGain()
    stagePlaybackSourceGainRef.current.gain.value = 0
    stagePlaybackMicrophoneGainRef.current.gain.value = 0

    void audioContext.suspend().catch(() => undefined)

    const bedEntries = stagePlaybackBedEntriesRef.current

    return () => {
      microphoneElement.pause()
      microphoneElement.removeAttribute('src')
      microphoneElement.load()

      stagePlaybackVoiceNodesRef.current.forEach((node) => disconnectAudioNode(node))
      stagePlaybackVoiceNodesRef.current = []

      disconnectAudioNode(stagePlaybackSourceNodeRef.current)
      disconnectAudioNode(stagePlaybackMicrophoneSourceNodeRef.current)
      disconnectAudioNode(stagePlaybackSourceGainRef.current)
      disconnectAudioNode(stagePlaybackMicrophoneGainRef.current)
      bedEntries.forEach((entry) => {
        entry.element.pause()
        entry.element.removeAttribute('src')
        entry.element.load()
        disconnectAudioNode(entry.sourceNode)
        disconnectAudioNode(entry.gainNode)
      })
      bedEntries.clear()

      stagePlaybackSourceNodeRef.current = null
      stagePlaybackMicrophoneSourceNodeRef.current = null
      stagePlaybackSourceGainRef.current = null
      stagePlaybackMicrophoneGainRef.current = null
      stagePlaybackMicrophoneRef.current = null

      void audioContext.close().catch(() => undefined)
      stagePlaybackAudioContextRef.current = null
    }
  }, [])

  useEffect(() => {
    const audioContext = stagePlaybackAudioContextRef.current
    const sourceNode = stagePlaybackSourceNodeRef.current
    const microphoneNode = stagePlaybackMicrophoneSourceNodeRef.current
    const sourceGain = stagePlaybackSourceGainRef.current
    const microphoneGain = stagePlaybackMicrophoneGainRef.current
    const playbackElement = stagePlaybackRef.current

    if (!audioContext || !sourceNode || !microphoneNode || !sourceGain || !microphoneGain) {
      if (playbackElement) {
        playbackElement.muted = !previewHasSourceAudio
      }
      return
    }

    if (!playbackElement) {
      return
    }

    stagePlaybackVoiceNodesRef.current.forEach((node) => disconnectAudioNode(node))
    stagePlaybackVoiceNodesRef.current = []
    disconnectAudioNode(sourceNode)
    disconnectAudioNode(microphoneNode)
    disconnectAudioNode(sourceGain)
    disconnectAudioNode(microphoneGain)

    sourceGain.gain.value = previewHasSourceAudio ? decibelsToGain(previewClipAudioSettings?.gainDb ?? 0) : 0
    sourceNode.connect(sourceGain)
    sourceGain.connect(audioContext.destination)

    if (previewHasVoiceStem) {
      microphoneNode.connect(microphoneGain)

      if (voiceClarityEnabledDraft) {
        const voiceChain = createVoiceClarityPreviewChain(audioContext, voiceClarityProfileDraft)
        stagePlaybackVoiceNodesRef.current = voiceChain.nodes
        disconnectAudioNode(microphoneGain)
        microphoneNode.disconnect()
        microphoneNode.connect(voiceChain.entryNode)
        voiceChain.exitNode.connect(microphoneGain)
      }

      microphoneGain.gain.value = 1
      microphoneGain.connect(audioContext.destination)
    } else {
      microphoneGain.gain.value = 0
    }

    playbackElement.muted = false

    console.info(
      `stage audio preview route=${previewHasSourceAudio ? 'source' : 'silent'}${previewHasVoiceStem ? `+${previewMicrophonePlayback?.mode === 'retake' ? 'retake' : 'mic'}` : ''}${previewHasMusicBeds ? `+beds(${previewMusicBeds.length})` : ''} clarity=${voiceClarityEnabledDraft ? voiceClarityProfileDraft : 'off'}`,
    )
  }, [
    previewClipAudioSettings?.gainDb,
    previewHasMusicBeds,
    previewHasSourceAudio,
    previewHasVoiceStem,
    previewMicrophonePlayback?.mode,
    previewMusicBeds.length,
    voiceClarityEnabledDraft,
    voiceClarityProfileDraft,
  ])

  useEffect(() => {
    const audioContext = stagePlaybackAudioContextRef.current

    if (!audioContext) {
      return
    }

    const entries = stagePlaybackBedEntriesRef.current
    const activeBedIds = new Set(previewMusicBeds.map((bed) => bed.id))

    entries.forEach((entry, bedId) => {
      if (activeBedIds.has(bedId)) {
        return
      }

      entry.element.pause()
      entry.element.removeAttribute('src')
      entry.element.load()
      disconnectAudioNode(entry.sourceNode)
      disconnectAudioNode(entry.gainNode)
      entries.delete(bedId)
    })

    previewMusicBeds.forEach((bed) => {
      const currentEntry = entries.get(bed.id)

      if (currentEntry?.filePath === bed.filePath) {
        return
      }

      if (currentEntry) {
        currentEntry.element.pause()
        currentEntry.element.removeAttribute('src')
        currentEntry.element.load()
        disconnectAudioNode(currentEntry.sourceNode)
        disconnectAudioNode(currentEntry.gainNode)
        entries.delete(bed.id)
      }

      const element = new Audio()
      element.preload = 'auto'
      element.src = getFileUrlFromWindowsPath(bed.filePath)

      const sourceNode = audioContext.createMediaElementSource(element)
      const gainNode = audioContext.createGain()
      gainNode.gain.value = 0
      sourceNode.connect(gainNode)
      gainNode.connect(audioContext.destination)

      entries.set(bed.id, {
        element,
        sourceNode,
        gainNode,
        filePath: bed.filePath,
      })
    })
  }, [previewMusicBeds])

  useEffect(() => {
    const entries = stagePlaybackBedEntriesRef.current

    if (!entries.size) {
      return
    }

    entries.forEach((entry) => {
      if (!previewSupportsMusicBeds || isRecording || !isStagePlaying) {
        entry.element.pause()
        return
      }
    })

    if (!previewSupportsMusicBeds || isRecording) {
      return
    }

    previewMusicBeds.forEach((bed) => {
      const entry = entries.get(bed.id)

      if (!entry) {
        return
      }

      const placement = getMusicBedPlacement(bed, previewTimelineDuration)
      const targetSeconds = getMusicBedPreviewSourceTime(bed, placement, timelinePlayheadSeconds)

      if (targetSeconds === null) {
        entry.element.pause()
        return
      }

      const syncPlaybackTime = () => {
        syncMediaElementTime(entry.element, targetSeconds, isStagePlaying ? 0.16 : 0.04)
      }

      if (entry.element.readyState < HTMLMediaElement.HAVE_METADATA) {
        entry.element.addEventListener('loadedmetadata', syncPlaybackTime, { once: true })
      } else {
        syncPlaybackTime()
      }

      if (!isStagePlaying) {
        entry.element.pause()
        return
      }

      void entry.element.play().catch(() => undefined)
    })
  }, [
    isRecording,
    isStagePlaying,
    previewMusicBeds,
    previewSupportsMusicBeds,
    previewTimelineDuration,
    timelinePlayheadSeconds,
  ])

  useEffect(() => {
    const entries = stagePlaybackBedEntriesRef.current

    if (!entries.size) {
      return
    }

    if (!previewSupportsMusicBeds || isRecording) {
      entries.forEach((entry) => {
        entry.gainNode.gain.value = 0
      })
      return
    }

    let animationFrame = 0
    let previousTick = performance.now()

    const updateBedGains = (tick: number) => {
      const deltaMs = Math.max(16, tick - previousTick)
      previousTick = tick
      const narratorActive = isStagePlaying && (previewHasSourceAudio || previewHasVoiceStem)

      previewMusicBeds.forEach((bed) => {
        const entry = entries.get(bed.id)

        if (!entry) {
          return
        }

        const placement = getMusicBedPlacement(bed, previewTimelineDuration)
        const targetGain = isStagePlaying
          ? getMusicBedPreviewLinearGain({
              musicBed: bed,
              placement,
              timelineSeconds: timelinePlayheadSeconds,
              ducking: {
                enabled: duckingEnabledDraft,
                reductionDb: duckingReductionDraft,
                attackMs: duckingAttackDraft,
                releaseMs: duckingReleaseDraft,
              },
              narratorActive,
            })
          : 0
        const currentGain = entry.gainNode.gain.value
        const smoothingMs =
          targetGain < currentGain
            ? narratorActive && bed.routingMode === 'duck' && duckingEnabledDraft
              ? duckingAttackDraft
              : 70
            : narratorActive && bed.routingMode === 'duck' && duckingEnabledDraft
              ? duckingReleaseDraft
              : 90
        const smoothingRatio = Math.min(1, deltaMs / Math.max(16, smoothingMs))

        entry.gainNode.gain.value = Number(
          (currentGain + (targetGain - currentGain) * smoothingRatio).toFixed(5),
        )
      })

      if (isStagePlaying) {
        animationFrame = window.requestAnimationFrame(updateBedGains)
      }
    }

    animationFrame = window.requestAnimationFrame(updateBedGains)

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    duckingAttackDraft,
    duckingEnabledDraft,
    duckingReductionDraft,
    duckingReleaseDraft,
    isRecording,
    isStagePlaying,
    previewHasSourceAudio,
    previewHasVoiceStem,
    previewMusicBeds,
    previewSupportsMusicBeds,
    previewTimelineDuration,
    timelinePlayheadSeconds,
  ])

  useEffect(() => {
    const playbackElement = stagePlaybackRef.current

    if (!playbackElement) {
      return
    }

    if (isRecording || !previewClipContext?.fileUrl) {
      playbackElement.pause()
      playbackElement.removeAttribute('src')
      playbackElement.load()
      return
    }

    if (playbackElement.src !== previewClipContext.fileUrl) {
      playbackElement.src = previewClipContext.fileUrl
      playbackElement.load()
    }
  }, [isRecording, previewClipContext?.fileUrl])

  useEffect(() => {
    const playbackElement = stagePlaybackRef.current
    const audioContext = stagePlaybackAudioContextRef.current

    if (!playbackElement || isRecording || !previewClipContext?.fileUrl) {
      return
    }

    if (!Number.isFinite(previewPlaybackTargetSeconds)) {
      return
    }

    if (isStagePlaying) {
      return
    }

    const syncPlaybackTime = () => {
      syncMediaElementTime(
        playbackElement,
        previewPlaybackTargetSeconds,
        0.04,
      )
    }

    if (playbackElement.readyState < HTMLMediaElement.HAVE_METADATA) {
      playbackElement.addEventListener('loadedmetadata', syncPlaybackTime, { once: true })
      return () => playbackElement.removeEventListener('loadedmetadata', syncPlaybackTime)
    }

    syncPlaybackTime()

    playbackElement.pause()
    void audioContext?.suspend().catch(() => undefined)
  }, [
    isRecording,
    isStagePlaying,
    previewClipContext?.fileUrl,
    previewPlaybackTargetSeconds,
  ])

  useEffect(() => {
    const playbackElement = stagePlaybackRef.current
    const audioContext = stagePlaybackAudioContextRef.current

    if (!playbackElement || isRecording || !previewClipContext?.fileUrl) {
      return
    }

    if (!isStagePlaying) {
      playbackElement.pause()
      void audioContext?.suspend().catch(() => undefined)
      return
    }

    void audioContext?.resume().catch((error) => {
      console.warn('stage preview audio resume rejected', error)
    })

    return playMediaElementWhenReady(
      playbackElement,
      previewPlaybackTargetSecondsRef.current,
      0.16,
      'stage preview',
    )
  }, [isRecording, isStagePlaying, previewClipContext?.fileUrl])

  useEffect(() => {
    const canvas = stageCursorCanvasRef.current
    const mediaElement = stagePlaybackRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const clearCanvas = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        context.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    if (isRecording || !stagePlaybackCursorOverlayVisible || !mediaElement) {
      clearCanvas()
      return
    }

    const frameMediaElement = mediaElement as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: unknown) => void) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }
    const shouldAnimate = isStagePlaying
    let disposed = false
    let frameHandle: number | null = null
    let frameMode: 'animation' | 'video' | null = null

    const cancelScheduledFrame = () => {
      if (frameHandle === null) {
        return
      }

      if (frameMode === 'video') {
        frameMediaElement.cancelVideoFrameCallback?.(frameHandle)
      } else {
        window.cancelAnimationFrame(frameHandle)
      }

      frameHandle = null
      frameMode = null
    }

    const syncCanvasDimensions = () => {
      const sourceWidth = mediaElement.videoWidth
      const sourceHeight = mediaElement.videoHeight
      const layoutWidth =
        canvas.clientWidth ||
        mediaElement.clientWidth ||
        canvas.parentElement?.clientWidth ||
        0
      const layoutHeight =
        canvas.clientHeight ||
        mediaElement.clientHeight ||
        canvas.parentElement?.clientHeight ||
        0

      if (!sourceWidth || !sourceHeight || layoutWidth <= 0 || layoutHeight <= 0) {
        clearCanvas()
        return null
      }

      const pixelRatio = Math.min(window.devicePixelRatio || 1, isRecording ? 1.5 : 2)
      const targetWidth = Math.max(1, Math.round(layoutWidth * pixelRatio))
      const targetHeight = Math.max(1, Math.round(layoutHeight * pixelRatio))

      if (canvas.width !== targetWidth) {
        canvas.width = targetWidth
      }

      if (canvas.height !== targetHeight) {
        canvas.height = targetHeight
      }

      return {
        renderWidth: targetWidth,
        renderHeight: targetHeight,
        sourceWidth,
        sourceHeight,
      }
    }

    const drawFrame = () => {
      if (disposed) {
        return
      }

      const metrics = syncCanvasDimensions()
      if (!metrics) {
        return
      }

      const frameTimeSeconds =
        isStagePlaying && Number.isFinite(mediaElement.currentTime)
          ? mediaElement.currentTime
          : previewPlaybackTargetSecondsRef.current

      drawStageCursorOverlayFrame(
        context,
        metrics.renderWidth,
        metrics.renderHeight,
        frameTimeSeconds,
        metrics.sourceWidth,
        metrics.sourceHeight,
      )
    }

    const scheduleNextFrame = () => {
      if (disposed || !shouldAnimate) {
        return
      }

      if (typeof frameMediaElement.requestVideoFrameCallback === 'function') {
        frameMode = 'video'
        frameHandle = frameMediaElement.requestVideoFrameCallback(() => {
          drawFrame()
          scheduleNextFrame()
        })
        return
      }

      frameMode = 'animation'
      frameHandle = window.requestAnimationFrame(() => {
        drawFrame()
        scheduleNextFrame()
      })
    }

    const handleReady = () => {
      drawFrame()
      scheduleNextFrame()
    }

    if (mediaElement.readyState < HTMLMediaElement.HAVE_METADATA) {
      mediaElement.addEventListener('loadedmetadata', handleReady, { once: true })

      return () => {
        disposed = true
        cancelScheduledFrame()
        mediaElement.removeEventListener('loadedmetadata', handleReady)
        clearCanvas()
      }
    }

    handleReady()

    return () => {
      disposed = true
      cancelScheduledFrame()
      clearCanvas()
    }
  }, [
    activeCursorSettings.alwaysPointer,
    activeCursorSettings.animationStyle,
    activeCursorSettings.clickEffect,
    activeCursorSettings.showCursor,
    activeCursorSettings.size,
    activeCursorSettings.smoothingEnabled,
    activeCursorSettings.style,
    isRecording,
    isStagePlaying,
    previewPlaybackTargetSeconds,
    stageMediaFitMode,
    stagePlaybackCursorOverlayVisible,
  ])

  useEffect(() => {
    const canvas = stageCursorCanvasRef.current
    const playbackElement = stagePlaybackRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const clearCanvas = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        context.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    if (isRecording || isStagePlaying || !stagePlaybackCursorOverlayVisible || !playbackElement) {
      if (!stagePlaybackCursorOverlayVisible) {
        clearCanvas()
      }
      return
    }

    const drawCurrentFrame = () => {
      const sourceWidth = playbackElement.videoWidth
      const sourceHeight = playbackElement.videoHeight
      const layoutWidth =
        canvas.clientWidth ||
        playbackElement.clientWidth ||
        canvas.parentElement?.clientWidth ||
        0
      const layoutHeight =
        canvas.clientHeight ||
        playbackElement.clientHeight ||
        canvas.parentElement?.clientHeight ||
        0

      if (!sourceWidth || !sourceHeight || layoutWidth <= 0 || layoutHeight <= 0) {
        clearCanvas()
        return
      }

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const renderWidth = Math.max(1, Math.round(layoutWidth * pixelRatio))
      const renderHeight = Math.max(1, Math.round(layoutHeight * pixelRatio))

      if (canvas.width !== renderWidth) {
        canvas.width = renderWidth
      }

      if (canvas.height !== renderHeight) {
        canvas.height = renderHeight
      }

      drawStageCursorOverlayFrame(
        context,
        renderWidth,
        renderHeight,
        previewPlaybackTargetSeconds,
        sourceWidth,
        sourceHeight,
      )
    }

    if (playbackElement.readyState < HTMLMediaElement.HAVE_METADATA) {
      playbackElement.addEventListener('loadedmetadata', drawCurrentFrame, { once: true })
      return () => playbackElement.removeEventListener('loadedmetadata', drawCurrentFrame)
    }

    drawCurrentFrame()
  }, [
    isRecording,
    isStagePlaying,
    previewClipContext?.fileUrl,
    previewPlaybackTargetSeconds,
    stageMediaFitMode,
    stagePlaybackCursorOverlayVisible,
  ])

  useEffect(() => {
    if (!isRecording) {
      hideLiveCursorDecorations()
      return
    }

    const syncNow = () => {
      scheduleLiveCursorDecorationsSync()
    }

    const livePreviewElement = stageLivePreviewRef.current
    const resizeTargets = [stageLiveCursorLayerRef.current, stageLivePreviewRef.current]
    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            syncNow()
          })
        : null

    resizeTargets.forEach((target) => {
      if (target) {
        resizeObserver?.observe(target)
      }
    })
    window.addEventListener('resize', syncNow)
    livePreviewElement?.addEventListener('loadedmetadata', syncNow)
    syncNow()

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncNow)
      livePreviewElement?.removeEventListener('loadedmetadata', syncNow)
      hideLiveCursorDecorations()
    }
  }, [
    activeCursorSettings.alwaysPointer,
    activeCursorSettings.clickEffect,
    activeCursorSettings.showCursor,
    activeCursorSettings.size,
    activeCursorSettings.style,
    hideLiveCursorDecorations,
    isRecording,
    scheduleLiveCursorDecorationsSync,
    stageLiveCursorTelemetryVisible,
    stageMediaFitMode,
  ])

  useEffect(() => {
    const microphoneElement = stagePlaybackMicrophoneRef.current

    if (!microphoneElement) {
      return
    }

    if (isRecording || !previewMicrophonePlayback?.fileUrl) {
      microphoneElement.pause()
      microphoneElement.removeAttribute('src')
      microphoneElement.load()
      return
    }

    if (microphoneElement.src !== previewMicrophonePlayback.fileUrl) {
      microphoneElement.src = previewMicrophonePlayback.fileUrl
      microphoneElement.load()
    }
  }, [isRecording, previewMicrophonePlayback?.fileUrl])

  useEffect(() => {
    const microphoneElement = stagePlaybackMicrophoneRef.current
    const audioContext = stagePlaybackAudioContextRef.current

    if (!microphoneElement || isRecording || !previewMicrophonePlayback?.fileUrl) {
      return
    }

    if (!Number.isFinite(previewMicrophonePlayback.sourceSeconds)) {
      return
    }

    if (isStagePlaying) {
      return
    }

    const syncPlaybackTime = () => {
      syncMediaElementTime(
        microphoneElement,
        previewMicrophonePlayback.sourceSeconds,
        0.04,
      )
    }

    if (microphoneElement.readyState < HTMLMediaElement.HAVE_METADATA) {
      microphoneElement.addEventListener('loadedmetadata', syncPlaybackTime, { once: true })
      return () => microphoneElement.removeEventListener('loadedmetadata', syncPlaybackTime)
    }

    syncPlaybackTime()

    microphoneElement.pause()
    void audioContext?.suspend().catch(() => undefined)
  }, [
    isRecording,
    isStagePlaying,
    previewMicrophonePlayback?.fileUrl,
    previewMicrophonePlayback?.sourceSeconds,
  ])

  useEffect(() => {
    const microphoneElement = stagePlaybackMicrophoneRef.current
    const audioContext = stagePlaybackAudioContextRef.current

    if (!microphoneElement || isRecording || !previewMicrophonePlayback?.fileUrl) {
      return
    }

    if (!isStagePlaying) {
      microphoneElement.pause()
      void audioContext?.suspend().catch(() => undefined)
      return
    }

    void audioContext?.resume().catch((error) => {
      console.warn('stage microphone audio resume rejected', error)
    })

    return playMediaElementWhenReady(
      microphoneElement,
      previewMicrophonePlayback.sourceSeconds,
      0.16,
      'stage microphone',
    )
  }, [
    isRecording,
    isStagePlaying,
    previewMicrophonePlayback?.fileUrl,
    previewMicrophonePlayback?.sourceSeconds,
  ])

  useEffect(() => {
    if (!isStagePlaying || isRecording || !previewClipContext?.fileUrl) {
      return
    }

    const playbackElement = stagePlaybackRef.current

    if (!playbackElement) {
      return
    }

    let animationFrame = 0

    const syncPlayheadFromMedia = () => {
      const currentTime = Number.isFinite(playbackElement.currentTime)
        ? playbackElement.currentTime
        : previewClipContext.sourceStartSeconds
      const localSeconds = clampNumber(
        currentTime - previewClipContext.sourceStartSeconds,
        0,
        previewClipContext.durationSeconds,
      )
      const nextPlayheadSeconds = Number(
        (
          previewClipContext.isTimelinePreview
            ? previewClipContext.sourceStartSeconds + localSeconds
            : localSeconds
        ).toFixed(2),
      )

      setTimelinePlayheadSeconds((currentSeconds) =>
        Math.abs(currentSeconds - nextPlayheadSeconds) > 0.01 ? nextPlayheadSeconds : currentSeconds,
      )

      if (localSeconds >= previewClipContext.durationSeconds - 0.02 || playbackElement.ended) {
        window.setTimeout(() => setIsStagePlaying(false), 0)
        return
      }

      animationFrame = window.requestAnimationFrame(syncPlayheadFromMedia)
    }

    animationFrame = window.requestAnimationFrame(syncPlayheadFromMedia)

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    isRecording,
    isStagePlaying,
    previewClipContext?.durationSeconds,
    previewClipContext?.fileUrl,
    previewClipContext?.isTimelinePreview,
    previewClipContext?.sourceStartSeconds,
  ])

  useEffect(() => {
    const playbackElement = stagePlaybackCameraRef.current

    if (!playbackElement) {
      return
    }

    if (isRecording || !activeCameraSettings.enabled || !previewClipContext?.cameraFileUrl) {
      playbackElement.pause()
      playbackElement.removeAttribute('src')
      playbackElement.load()
      return
    }

    if (playbackElement.src !== previewClipContext.cameraFileUrl) {
      playbackElement.src = previewClipContext.cameraFileUrl
      playbackElement.load()
    }
  }, [activeCameraSettings.enabled, isRecording, previewClipContext?.cameraFileUrl])

  useEffect(() => {
    const playbackElement = stagePlaybackCameraRef.current

    if (!playbackElement || isRecording || !activeCameraSettings.enabled || !previewClipContext?.cameraFileUrl) {
      return
    }

    playbackElement.muted = true

    if (!Number.isFinite(previewPlaybackTargetSeconds)) {
      return
    }

    if (isStagePlaying) {
      return
    }

    const syncPlaybackTime = () => {
      try {
        if (Math.abs(playbackElement.currentTime - previewPlaybackTargetSeconds) > 0.04) {
          playbackElement.currentTime = previewPlaybackTargetSeconds
        }
      } catch {
        return
      }
    }

    if (playbackElement.readyState < HTMLMediaElement.HAVE_METADATA) {
      playbackElement.addEventListener('loadedmetadata', syncPlaybackTime, { once: true })
      return () => playbackElement.removeEventListener('loadedmetadata', syncPlaybackTime)
    }

    syncPlaybackTime()

    playbackElement.pause()
  }, [
    activeCameraSettings.enabled,
    isRecording,
    isStagePlaying,
    previewClipContext?.cameraFileUrl,
    previewPlaybackTargetSeconds,
  ])

  useEffect(() => {
    const playbackElement = stagePlaybackCameraRef.current

    if (!playbackElement || isRecording || !activeCameraSettings.enabled || !previewClipContext?.cameraFileUrl) {
      return
    }

    playbackElement.muted = true

    if (!isStagePlaying) {
      playbackElement.pause()
      return
    }

    return playMediaElementWhenReady(
      playbackElement,
      previewPlaybackTargetSecondsRef.current,
      0.16,
      'stage camera',
    )
  }, [
    activeCameraSettings.enabled,
    isRecording,
    isStagePlaying,
    previewClipContext?.cameraFileUrl,
  ])

  useEffect(() => {
    if (!project) {
      return
    }

    setProjectTitleDraft(project.title)
    setProjectBriefDraft(project.brief)
    setTimelineExportNameDraft(sanitizeExportName(project.title.toLowerCase()) || 'timeline-export')
    setLastSavedPath(project.clips[0]?.filePath ?? '')
    setLastSavedSize(project.clips[0]?.size ?? 0)
    setLastExportPath(getProjectLastExportPath(project))
    setBackgroundMode(project.background.mode)
  }, [project?.id])

  useEffect(() => {
    if (!selectedClipFocusRegions.length) {
      if (selectedFocusRegionId) {
        setSelectedFocusRegionId('')
      }
      return
    }

    if (!selectedClipFocusRegions.some((region) => region.id === selectedFocusRegionId)) {
      setSelectedFocusRegionId(selectedClipFocusRegions[0].id)
    }
  }, [selectedClipFocusRegions, selectedFocusRegionId])

  useEffect(() => {
    if (!selectedClipKeyboardShortcuts.length) {
      if (selectedKeyboardShortcutId) {
        setSelectedKeyboardShortcutId('')
      }
      return
    }

    if (!selectedClipKeyboardShortcuts.some((shortcut) => shortcut.id === selectedKeyboardShortcutId)) {
      setSelectedKeyboardShortcutId(selectedClipKeyboardShortcuts[0].id)
    }
  }, [selectedClipKeyboardShortcuts, selectedKeyboardShortcutId])

  useEffect(() => {
    if (!selectedClipTranscriptSegments.length) {
      if (selectedTranscriptSegmentId) {
        setSelectedTranscriptSegmentId('')
      }
      return
    }

    if (!selectedClipTranscriptSegments.some((segment) => segment.id === selectedTranscriptSegmentId)) {
      setSelectedTranscriptSegmentId(selectedClipTranscriptSegments[0].id)
    }
  }, [selectedClipTranscriptSegments, selectedTranscriptSegmentId])

  useEffect(() => {
    setTranscriptSegmentTextDraft(selectedTranscriptSegment?.text ?? '')
  }, [selectedTranscriptSegment?.id, selectedTranscriptSegment?.text])

  useEffect(() => {
    if (!project) {
      return
    }

    setBackgroundMode(project.background.mode)
  }, [project?.background.mode])

  useEffect(() => {
    if (!selectedClip) {
      setClipNotesDraft('')
      setClipAudioMutedDraft(false)
      setClipAudioGainDraft(0)
      setTrimStartDraft('0')
      setTrimEndDraft('')
      setExportNameDraft('')
      setTranscriptSearchQuery('')
      return
    }

    setClipNotesDraft(selectedClip.notes)
    setClipAudioMutedDraft(selectedClip.audio.muted)
    setClipAudioGainDraft(selectedClip.audio.gainDb)
    setTrimStartDraft(formatEditableSeconds(selectedClip.trim.startSeconds))
    setTrimEndDraft(formatEditableSeconds(selectedClip.trim.endSeconds))
    setExportNameDraft(sanitizeExportName(selectedClip.label.toLowerCase()) || `clip-${selectedClip.id}`)
    setTranscriptSearchQuery('')
  }, [selectedClip?.id])

  useEffect(() => {
    if (!selectedClip) {
      setClipAudioMutedDraft(false)
      setClipAudioGainDraft(0)
      return
    }

    setClipAudioMutedDraft(selectedClip.audio.muted)
    setClipAudioGainDraft(selectedClip.audio.gainDb)
  }, [selectedClip?.id, selectedClip?.audio.muted, selectedClip?.audio.gainDb])

  useEffect(() => {
    if (!activeMusicBed) {
      setMusicBedTrimStartDraft('0')
      setMusicBedTrimEndDraft('')
      setMusicBedTimelineStartDraft('0')
      setMusicBedTimelineEndDraft('')
      setMusicBedFadeInDraft(0.2)
      setMusicBedFadeOutDraft(0.3)
      setMusicBedGainDraft(-16)
      setMusicBedRoutingModeDraft('duck')
      setMusicBedAutomationEnabledDraft(false)
      setMusicBedAutomationStartDraft('0')
      setMusicBedAutomationEndDraft('')
      setMusicBedAutomationGainDraft(-3)
      setMusicBedAutomationRampDraft(0.4)
      setMusicBedAutomationKeyframesDraft([])
      setSelectedAutomationKeyframeId('')
      setMusicBedLoopDraft(true)
      setMusicBedEnabledDraft(true)
      return
    }

    setMusicBedTrimStartDraft(formatEditableSeconds(activeMusicBed.trimStartSeconds))
    setMusicBedTrimEndDraft(formatEditableSeconds(activeMusicBed.trimEndSeconds))
    setMusicBedTimelineStartDraft(formatEditableSeconds(activeMusicBed.timelineStartSeconds))
    setMusicBedTimelineEndDraft(formatEditableSeconds(activeMusicBed.timelineEndSeconds))
    setMusicBedFadeInDraft(activeMusicBed.fadeInSeconds)
    setMusicBedFadeOutDraft(activeMusicBed.fadeOutSeconds)
    setMusicBedGainDraft(activeMusicBed.gainDb)
    setMusicBedRoutingModeDraft(activeMusicBed.routingMode)
    setMusicBedAutomationEnabledDraft(activeMusicBed.automation.enabled)
    setMusicBedAutomationStartDraft(formatEditableSeconds(activeMusicBed.automation.startSeconds))
    setMusicBedAutomationEndDraft(formatEditableSeconds(activeMusicBed.automation.endSeconds))
    setMusicBedAutomationGainDraft(activeMusicBed.automation.gainDb)
    setMusicBedAutomationRampDraft(activeMusicBed.automation.rampSeconds)
    setMusicBedAutomationKeyframesDraft(activeMusicBed.automation.keyframes.map((keyframe) => ({ ...keyframe })))
    setSelectedAutomationKeyframeId(activeMusicBed.automation.keyframes[0]?.id ?? '')
    setMusicBedLoopDraft(activeMusicBed.loop)
    setMusicBedEnabledDraft(activeMusicBed.enabled)
  }, [project?.id, activeMusicBed?.id])

  useEffect(() => {
    if (!musicBedAutomationKeyframesDraft.length) {
      if (selectedAutomationKeyframeId) {
        setSelectedAutomationKeyframeId('')
      }
      return
    }

    if (!musicBedAutomationKeyframesDraft.some((keyframe) => keyframe.id === selectedAutomationKeyframeId)) {
      setSelectedAutomationKeyframeId(musicBedAutomationKeyframesDraft[0].id)
    }
  }, [musicBedAutomationKeyframesDraft, selectedAutomationKeyframeId])

  useEffect(() => {
    if (!project) {
      return
    }

    setVoiceClarityEnabledDraft(project.audio.voiceClarity.enabled)
    setVoiceClarityProfileDraft(project.audio.voiceClarity.profile)
    setDuckingEnabledDraft(project.audio.ducking.enabled)
    setDuckingReductionDraft(project.audio.ducking.reductionDb)
    setDuckingAttackDraft(project.audio.ducking.attackMs)
    setDuckingReleaseDraft(project.audio.ducking.releaseMs)
  }, [project?.id])

  useEffect(() => {
    setTimelinePlayheadSeconds((currentSeconds) =>
      clampNumber(currentSeconds, 0, Math.max(totalTimelineCanvasDuration, selectedClip?.durationSeconds ?? 0)),
    )
  }, [selectedClip?.durationSeconds, totalTimelineCanvasDuration])

  useEffect(() => {
    if (!selectedTimelineItem || !selectedTimelineClip) {
      setTimelineTrimDraft({
        startSeconds: 0,
        endSeconds: 0,
      })
      return
    }

    const bounds = getTimelineItemBounds(selectedTimelineItem, selectedTimelineClip)

    setTimelineTrimDraft({
      startSeconds: bounds.startSeconds,
      endSeconds: bounds.endSeconds,
    })
  }, [selectedTimelineClip, selectedTimelineItem])

  useEffect(() => {
    if (!selectedTimelineSegment) {
      return
    }

    setTimelinePlayheadSeconds((currentSeconds) => {
      if (
        currentSeconds >= selectedTimelineSegment.startSeconds &&
        currentSeconds <= selectedTimelineSegment.endSeconds
      ) {
        return currentSeconds
      }

      return selectedTimelineSegment.startSeconds
    })
  }, [selectedTimelineSegment?.item.id])

  const persistSettings = async (patch: LocalSettingsPatch) => {
    if (!settings) {
      return
    }

    const optimistic = mergeSettings(settings, patch)
    setSettings(optimistic)

    try {
      const saved = await window.forkApi.settings.save(patch)
      setSettings(saved)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings')
    }
  }

  const refreshProjectLibrary = async () => {
    try {
      const nextProjects = await window.forkApi.project.list()
      setProjectLibrary(nextProjects)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh project library')
    }
  }

  const persistProject = async (patch: ProjectPatch, successMessage?: string) => {
    if (!project) {
      return null
    }

    setIsSavingProject(true)

    try {
      const saved = await window.forkApi.project.save(patch)
      setProject(saved)
      void refreshProjectLibrary()
      if (successMessage) {
        setStatusLine(successMessage)
      }
      return saved
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save project')
      return null
    } finally {
      setIsSavingProject(false)
    }
  }

  const buildSelectedClipUpdate = () => {
    if (!project || !selectedClip) {
      return null
    }

    const parsedTrimStart = parseSecondsInput(trimStartDraft)
    const parsedTrimEnd = parseSecondsInput(trimEndDraft)

    if (parsedTrimStart === undefined || parsedTrimEnd === undefined) {
      return {
        invalid: true,
      }
    }

    const durationCap = selectedClip.durationSeconds > 0 ? selectedClip.durationSeconds : null
    const normalizedStart =
      durationCap === null
        ? parsedTrimStart ?? 0
        : Math.min(durationCap, parsedTrimStart ?? 0)
    const normalizedEndRaw =
      parsedTrimEnd === null
        ? durationCap
        : durationCap === null
          ? parsedTrimEnd
          : Math.min(durationCap, parsedTrimEnd)
    const normalizedEnd =
      normalizedEndRaw === null ? null : Math.max(normalizedStart, normalizedEndRaw)
    const normalizedGain = clampNumber(clipAudioGainDraft, -18, 12)

    const nextClip: ProjectClip = {
      ...selectedClip,
      notes: clipNotesDraft,
      trim: {
        startSeconds: normalizedStart,
        endSeconds: normalizedEnd,
      },
      audio: {
        ...selectedClip.audio,
        muted: clipAudioMutedDraft,
        gainDb: normalizedGain,
      },
    }

    const changed =
      nextClip.notes !== selectedClip.notes ||
      nextClip.trim.startSeconds !== selectedClip.trim.startSeconds ||
      nextClip.trim.endSeconds !== selectedClip.trim.endSeconds ||
      nextClip.audio.muted !== selectedClip.audio.muted ||
      nextClip.audio.gainDb !== selectedClip.audio.gainDb

    return {
      invalid: false,
      changed,
      trim: nextClip.trim,
      clips: replaceClip(project, nextClip),
    }
  }

  const updateSelectedClipCaptureProfile = async (motionPresetId: string) => {
    if (!project || !selectedClip) {
      return
    }

    const preset = motionPresets.find((candidate) => candidate.id === motionPresetId)

    if (!preset || selectedClip.captureProfile.motionPresetId === preset.id) {
      return
    }

    await persistProject(
      {
        clips: replaceClip(project, {
          ...selectedClip,
          updatedAt: new Date().toISOString(),
          captureProfile: {
            ...selectedClip.captureProfile,
            motionPresetId: preset.id,
            motionPresetLabel: preset.label,
          },
        }),
      },
      `Motion treatment updated to ${preset.label}.`,
    )
  }

  const persistSelectedClipFocusRegions = async (
    nextFocusRegions: ClipFocusRegion[],
    successMessage?: string,
  ) => {
    if (!project || !selectedClip) {
      return null
    }

    const nextClip: ProjectClip = {
      ...selectedClip,
      updatedAt: new Date().toISOString(),
      focusRegions: normalizeFocusRegions(nextFocusRegions, selectedClip.durationSeconds),
    }

    return persistProject(
      {
        clips: replaceClip(project, nextClip),
      },
      successMessage,
    )
  }

  const buildClipWithFocusRegions = (targetClip: ProjectClip, nextFocusRegions: ClipFocusRegion[]) => ({
    ...targetClip,
    updatedAt: new Date().toISOString(),
    focusRegions: normalizeFocusRegions(nextFocusRegions, targetClip.durationSeconds),
  })

  const applyFocusRegionPatchLocally = (
    baseProject: LocalProject,
    targetClip: ProjectClip,
    nextFocusRegions: ClipFocusRegion[],
    timelinePatch?: ProjectPatch['timeline'],
  ) => {
    const nextClip = buildClipWithFocusRegions(targetClip, nextFocusRegions)
    setProject(
      mergeProject(baseProject, {
        clips: replaceClip(baseProject, nextClip),
        ...(timelinePatch ? { timeline: timelinePatch } : {}),
      }),
    )
  }

  const persistFocusRegionsForClip = async (
    targetClip: ProjectClip,
    nextFocusRegions: ClipFocusRegion[],
    successMessage?: string,
    timelinePatch?: ProjectPatch['timeline'],
  ) => {
    if (!project) {
      return null
    }

    const nextClip = buildClipWithFocusRegions(targetClip, nextFocusRegions)

    return persistProject(
      {
        clips: replaceClip(project, nextClip),
        ...(timelinePatch ? { timeline: timelinePatch } : {}),
      },
      successMessage,
    )
  }

  const handleAddFocusRegion = async () => {
    if (!selectedClip) {
      return
    }

    const visibleStartSeconds =
      previewClipContext?.clip.id === selectedClip.id
        ? previewClipContext.sourceStartSeconds
        : selectedClip.trim.startSeconds
    const visibleEndSeconds =
      previewClipContext?.clip.id === selectedClip.id
        ? previewClipContext.sourceEndSeconds
        : selectedClip.trim.endSeconds ?? selectedClip.durationSeconds
    const focusTimeSeconds =
      previewClipContext?.clip.id === selectedClip.id
        ? previewPlaybackTargetSeconds
        : clampNumber(timelinePlayheadSeconds, visibleStartSeconds, visibleEndSeconds)
    const defaultDuration = Math.min(1.75, Math.max(0.18, visibleEndSeconds - visibleStartSeconds))
    const startSeconds = clampNumber(
      focusTimeSeconds - defaultDuration / 2,
      visibleStartSeconds,
      Math.max(visibleStartSeconds, visibleEndSeconds - 0.18),
    )
    const endSeconds = clampNumber(
      startSeconds + defaultDuration,
      startSeconds + 0.18,
      visibleEndSeconds,
    )
    const nextRegion: ClipFocusRegion = {
      id: crypto.randomUUID(),
      label: `Zoom ${selectedClipFocusRegions.length + 1}`,
      startSeconds,
      endSeconds,
      zoom: selectedFocusRegion?.zoom ?? 2,
      focusX: liveCursorVisualRef.current?.x ?? 0.5,
      focusY: liveCursorVisualRef.current?.y ?? 0.5,
    }

    setSelectedFocusRegionId(nextRegion.id)
    await persistSelectedClipFocusRegions(
      [...selectedClipFocusRegions, nextRegion],
      'Manual zoom block added at the playhead.',
    )
  }

  const handleUpdateSelectedFocusRegion = async (patch: Partial<ClipFocusRegion>) => {
    if (!selectedFocusRegion) {
      return
    }

    const nextFocusRegions = selectedClipFocusRegions.map((region) =>
      region.id === selectedFocusRegion.id
        ? {
            ...region,
            ...patch,
          }
        : region,
    )

    await persistSelectedClipFocusRegions(nextFocusRegions)
  }

  const handleRemoveSelectedFocusRegion = async () => {
    if (!selectedFocusRegion) {
      return
    }

    const nextFocusRegions = selectedClipFocusRegions.filter((region) => region.id !== selectedFocusRegion.id)
    setSelectedFocusRegionId(nextFocusRegions[0]?.id ?? '')
    await persistSelectedClipFocusRegions(
      nextFocusRegions,
      `Removed "${selectedFocusRegion.label}" from manual zooms.`,
    )
  }

  const handleApplySelectedZoomLevelToAll = async () => {
    if (!selectedFocusRegion || !selectedClipFocusRegions.length) {
      return
    }

    const nextFocusRegions = selectedClipFocusRegions.map((region) => ({
      ...region,
      zoom: selectedFocusRegion.zoom,
    }))

    await persistSelectedClipFocusRegions(
      nextFocusRegions,
      `Applied ${selectedFocusRegion.zoom.toFixed(1)}x across all manual zoom blocks.`,
    )
  }

  const handleRemoveAllFocusRegions = async () => {
    if (!selectedClipFocusRegions.length) {
      return
    }

    setSelectedFocusRegionId('')
    await persistSelectedClipFocusRegions([], 'Removed all manual zoom blocks from the selected clip.')
  }

  const createTimelineFocusRegionAtRatio = async (ratio: number) => {
    if (!project || !selectedClip) {
      return
    }

    const globalSeconds = clampNumber(ratio, 0, 1) * previewTimelineDuration
    const targetSegment = timelineSequence.find(
      (segment) => globalSeconds >= segment.startSeconds && globalSeconds <= segment.endSeconds,
    )
    const targetClip = targetSegment?.clip ?? selectedClip

    if (!targetClip) {
      return
    }

    const targetFocusRegions = normalizeFocusRegions(targetClip.focusRegions ?? [], targetClip.durationSeconds)
    const focusTimeSeconds = targetSegment
      ? clampNumber(
          targetSegment.bounds.startSeconds + (globalSeconds - targetSegment.startSeconds),
          targetSegment.bounds.startSeconds,
          targetSegment.bounds.endSeconds,
        )
      : clampNumber(globalSeconds, targetClip.trim.startSeconds, targetClip.trim.endSeconds ?? targetClip.durationSeconds)
    const visibleStartSeconds = targetSegment?.bounds.startSeconds ?? targetClip.trim.startSeconds
    const visibleEndSeconds = targetSegment?.bounds.endSeconds ?? targetClip.trim.endSeconds ?? targetClip.durationSeconds
    const defaultDuration = Math.min(1.75, Math.max(0.18, visibleEndSeconds - visibleStartSeconds))
    const startSeconds = clampNumber(
      focusTimeSeconds - defaultDuration / 2,
      visibleStartSeconds,
      Math.max(visibleStartSeconds, visibleEndSeconds - 0.18),
    )
    const endSeconds = clampNumber(
      startSeconds + defaultDuration,
      startSeconds + 0.18,
      visibleEndSeconds,
    )
    const nextRegion: ClipFocusRegion = {
      id: crypto.randomUUID(),
      label: `Zoom ${targetFocusRegions.length + 1}`,
      startSeconds,
      endSeconds,
      zoom: selectedFocusRegion?.zoom ?? 2,
      focusX: liveCursorVisualRef.current?.x ?? 0.5,
      focusY: liveCursorVisualRef.current?.y ?? 0.5,
    }
    const timelinePatch =
      targetSegment
        ? {
            activeItemId: targetSegment.item.id,
            activeClipId: targetClip.id,
          }
        : undefined

    setSelectedFocusRegionId(nextRegion.id)
    await persistFocusRegionsForClip(
      targetClip,
      [...targetFocusRegions, nextRegion],
      'Manual zoom block added on the motion lane.',
      timelinePatch,
    )
  }

  const handleMotionBandCreate = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement

    if (target.closest('.timeline-block') || target.closest('.timeline-focus-block')) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0
    await createTimelineFocusRegionAtRatio(ratio)
  }

  const beginTimelineFocusRegionDrag = (
    event: MouseEvent<HTMLElement>,
    block: (typeof timelineFocusBlocks)[number],
    mode: 'move' | 'resize-start' | 'resize-end',
  ) => {
    if (!project || !block.clipId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const targetClip = clipsById.get(block.clipId)

    if (!targetClip) {
      return
    }

    const baseProject = project
    const baseFocusRegions = normalizeFocusRegions(targetClip.focusRegions ?? [], targetClip.durationSeconds)
    const baseRegion = baseFocusRegions.find((region) => region.id === block.region.id)

    if (!baseRegion) {
      return
    }

    const timelinePatch = {
      activeItemId: block.itemId || baseProject.timeline.activeItemId,
      activeClipId: targetClip.id,
    }
    const bandElement = (event.currentTarget.closest('.timeline-band.motion-band') as HTMLElement | null) ?? event.currentTarget
    const bandWidth = Math.max(1, bandElement.getBoundingClientRect().width)
    const startClientX = event.clientX
    let latestFocusRegions = baseFocusRegions

    setSelectedFocusRegionId(baseRegion.id)
    applyFocusRegionPatchLocally(baseProject, targetClip, baseFocusRegions, timelinePatch)

    const handlePointerMove = (pointerEvent: globalThis.MouseEvent) => {
      const deltaSeconds = ((pointerEvent.clientX - startClientX) / bandWidth) * previewTimelineDuration
      const regionDuration = baseRegion.endSeconds - baseRegion.startSeconds
      let nextStartSeconds = baseRegion.startSeconds
      let nextEndSeconds = baseRegion.endSeconds

      if (mode === 'move') {
        nextStartSeconds = clampNumber(baseRegion.startSeconds + deltaSeconds, 0, Math.max(0, targetClip.durationSeconds - regionDuration))
        nextEndSeconds = nextStartSeconds + regionDuration
      } else if (mode === 'resize-start') {
        nextStartSeconds = clampNumber(baseRegion.startSeconds + deltaSeconds, 0, baseRegion.endSeconds - 0.08)
      } else {
        nextEndSeconds = clampNumber(baseRegion.endSeconds + deltaSeconds, baseRegion.startSeconds + 0.08, targetClip.durationSeconds)
      }

      latestFocusRegions = baseFocusRegions.map((region) =>
        region.id === baseRegion.id
          ? {
              ...region,
              startSeconds: Number(nextStartSeconds.toFixed(3)),
              endSeconds: Number(nextEndSeconds.toFixed(3)),
            }
          : region,
      )

      applyFocusRegionPatchLocally(baseProject, targetClip, latestFocusRegions, timelinePatch)
    }

    const handlePointerUp = () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      void persistFocusRegionsForClip(targetClip, latestFocusRegions, 'Manual zoom block updated.', timelinePatch)
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
  }

  const setSelectedFocusTargetFromClientPoint = async (clientX: number, clientY: number, persist = true) => {
    if (!project || !selectedClip || !selectedFocusRegion || !stageSurfaceRef.current) {
      return
    }

    const rect = stageSurfaceRef.current.getBoundingClientRect()
    const focusX = clampNumber((clientX - rect.left) / rect.width, 0, 1)
    const focusY = clampNumber((clientY - rect.top) / rect.height, 0, 1)
    const nextFocusRegions = selectedClipFocusRegions.map((region) =>
      region.id === selectedFocusRegion.id
        ? {
            ...region,
            focusX: Number(focusX.toFixed(4)),
            focusY: Number(focusY.toFixed(4)),
          }
        : region,
    )

    applyFocusRegionPatchLocally(project, selectedClip, nextFocusRegions)

    if (persist) {
      await persistSelectedClipFocusRegions(nextFocusRegions, 'Zoom target updated on the preview stage.')
    }
  }

  const handleStageSurfaceFocusPick = async (event: MouseEvent<HTMLDivElement>) => {
    if (!selectedFocusRegion || !stageFocusEditingEnabled) {
      return
    }

    const target = event.target as HTMLElement

    if (target.closest('.stage-focus-target')) {
      return
    }

    await setSelectedFocusTargetFromClientPoint(event.clientX, event.clientY, true)
  }

  const beginStageFocusTargetDrag = (event: MouseEvent<HTMLButtonElement>) => {
    if (!selectedFocusRegion || !stageFocusEditingEnabled) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const handlePointerMove = (pointerEvent: globalThis.MouseEvent) => {
      void setSelectedFocusTargetFromClientPoint(pointerEvent.clientX, pointerEvent.clientY, false)
    }

    const handlePointerUp = (pointerEvent: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      void setSelectedFocusTargetFromClientPoint(pointerEvent.clientX, pointerEvent.clientY, true)
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
  }

  const analyzeSelectedClipAudio = async () => {
    if (!selectedClip) {
      return
    }

    setIsAnalyzingSelectedClipAudio(true)
    setErrorMessage('')

    try {
      const saved = await window.forkApi.project.analyzeClipAudio(selectedClip.id)
      const refreshedClip = saved.clips.find((clip) => clip.id === selectedClip.id)

      setProject(saved)
      void refreshProjectLibrary()
      setStatusLine(
        refreshedClip?.audio.hasAudio
          ? `Audio lane analyzed for "${refreshedClip.label}".`
          : `No embedded audio track detected for "${selectedClip.label}".`,
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Audio analysis failed')
    } finally {
      setIsAnalyzingSelectedClipAudio(false)
    }
  }

  const handleRemoveSelectedClip = async () => {
    if (!project || !selectedClip) {
      return
    }

    const approved = window.confirm(
      `Remove clip "${selectedClip.label}" from this project? The source file on disk will stay in Captures, but the clip and its linked timeline items will be removed from the project.`,
    )

    if (!approved) {
      return
    }

    const nextClips = project.clips.filter((clip) => clip.id !== selectedClip.id)
    const nextTimelineItems = project.timeline.items.filter((item) => item.clipId !== selectedClip.id)
    const nextActiveClip = nextClips[0]
    const nextActiveItem =
      nextTimelineItems.find((item) => item.clipId === nextActiveClip?.id) ??
      nextTimelineItems[0]

    const saved = await persistProject(
      {
        clips: nextClips,
        timeline: {
          items: nextTimelineItems,
          activeClipId: nextActiveClip?.id ?? '',
          activeItemId: nextActiveItem?.id ?? '',
        },
      },
      nextClips.length
        ? `Removed clip "${selectedClip.label}" from the project.`
        : 'Removed the final clip from the project.',
    )

    if (!saved) {
      return
    }

    setProject(saved)
    void refreshProjectLibrary()

    if (lastSavedPath === selectedClip.filePath) {
      setLastSavedPath('')
      setLastSavedSize(0)
    }

    if (lastExportPath === selectedClip.lastExportPath) {
      setLastExportPath('')
    }
  }

  const buildAutomationCurveFromQuickDrafts = () => {
    if (!activeMusicBedDraftPlacement) {
      return []
    }

    const parsedAutomationStart = parseSecondsInput(musicBedAutomationStartDraft)
    const parsedAutomationEnd = parseSecondsInput(musicBedAutomationEndDraft)

    if (parsedAutomationStart === undefined || parsedAutomationEnd === undefined) {
      return null
    }

    const startSeconds = parsedAutomationStart ?? activeMusicBedDraftPlacement.timelineStartSeconds
    const endSeconds =
      parsedAutomationEnd === null
        ? activeMusicBedDraftPlacement.timelineEndSeconds
        : Math.max(startSeconds, parsedAutomationEnd)

    return createDefaultAutomationCurve({
      laneStartSeconds: activeMusicBedDraftPlacement.timelineStartSeconds,
      laneEndSeconds: activeMusicBedDraftPlacement.timelineEndSeconds,
      startSeconds,
      endSeconds,
      gainDb: musicBedAutomationGainDraft,
      rampSeconds: musicBedAutomationRampDraft,
    })
  }

  const commitAutomationKeyframesDraft = (nextKeyframes: TimelineMusicBedAutomationKeyframe[]) => {
    setMusicBedAutomationKeyframesDraft(nextKeyframes)
    setSelectedAutomationKeyframeId(nextKeyframes[0]?.id ?? '')
  }

  const handleToggleAutomationCurve = (enabled: boolean) => {
    setMusicBedAutomationEnabledDraft(enabled)

    if (!enabled || automationDraftKeyframes.length) {
      return
    }

    const seededCurve = buildAutomationCurveFromQuickDrafts()

    if (!seededCurve?.length) {
      return
    }

    setMusicBedAutomationKeyframesDraft(seededCurve)
    setSelectedAutomationKeyframeId(seededCurve[Math.min(1, seededCurve.length - 1)]?.id ?? seededCurve[0]?.id ?? '')
  }

  const handleResetAutomationCurve = () => {
    const seededCurve = buildAutomationCurveFromQuickDrafts()

    if (!seededCurve?.length) {
      setErrorMessage('Fix quick curve timings before rebuilding the automation curve.')
      return
    }

    setMusicBedAutomationEnabledDraft(true)
    setMusicBedAutomationKeyframesDraft(seededCurve)
    setSelectedAutomationKeyframeId(seededCurve[Math.min(1, seededCurve.length - 1)]?.id ?? seededCurve[0]?.id ?? '')
    setErrorMessage('')
  }

  const handleAddAutomationKeyframe = (timeSeconds = timelinePlayheadSeconds, gainDb = selectedAutomationKeyframe?.gainDb ?? 0) => {
    if (!activeMusicBedDraftPlacement) {
      return
    }

    const nextKeyframe = createAutomationKeyframe(
      clampNumber(timeSeconds, activeMusicBedDraftPlacement.timelineStartSeconds, activeMusicBedDraftPlacement.timelineEndSeconds),
      gainDb,
    )
    const nextKeyframes = normalizeAutomationKeyframes(
      [...automationDraftKeyframes, nextKeyframe],
      {
        startSeconds: activeMusicBedDraftPlacement.timelineStartSeconds,
        endSeconds: activeMusicBedDraftPlacement.timelineEndSeconds,
      },
    )

    setMusicBedAutomationEnabledDraft(true)
    setMusicBedAutomationKeyframesDraft(nextKeyframes)
    setSelectedAutomationKeyframeId(nextKeyframe.id)
  }

  const handleUpdateAutomationKeyframe = (
    keyframeId: string,
    patch: Partial<Pick<TimelineMusicBedAutomationKeyframe, 'timeSeconds' | 'gainDb'>>,
  ) => {
    if (!activeMusicBedDraftPlacement) {
      return
    }

    const nextKeyframes = normalizeAutomationKeyframes(
      automationDraftKeyframes.map((keyframe) =>
        keyframe.id === keyframeId
          ? {
              ...keyframe,
              ...patch,
            }
          : keyframe,
      ),
      {
        startSeconds: activeMusicBedDraftPlacement.timelineStartSeconds,
        endSeconds: activeMusicBedDraftPlacement.timelineEndSeconds,
      },
    )

    setMusicBedAutomationKeyframesDraft(nextKeyframes)
    setSelectedAutomationKeyframeId(
      nextKeyframes.find((keyframe) => keyframe.id === keyframeId)?.id ?? nextKeyframes[0]?.id ?? '',
    )
  }

  const handleRemoveAutomationKeyframe = () => {
    if (!selectedAutomationKeyframeId || automationDraftKeyframes.length <= 2) {
      return
    }

    const nextKeyframes = automationDraftKeyframes.filter((keyframe) => keyframe.id !== selectedAutomationKeyframeId)
    commitAutomationKeyframesDraft(nextKeyframes)
  }

  const handleAutomationEditorClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!musicBedAutomationEnabledDraft || !activeMusicBedDraftPlacement) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const xRatio = clampUnit((event.clientX - bounds.left) / bounds.width)
    const yRatio = clampUnit((event.clientY - bounds.top) / bounds.height)
    const timeSeconds =
      activeMusicBedDraftPlacement.timelineStartSeconds +
      xRatio * activeMusicBedDraftPlacement.durationSeconds
    const gainDb =
      automationGainRange.max -
      yRatio * (automationGainRange.max - automationGainRange.min)

    handleAddAutomationKeyframe(timeSeconds, gainDb)
  }

  const buildProjectAudioUpdate = () => {
    if (!project) {
      return null
    }

    const nextVoiceClarity = {
      enabled: voiceClarityEnabledDraft,
      profile: voiceClarityProfileDraft,
    }
    const nextDucking = {
      enabled: duckingEnabledDraft,
      reductionDb: clampNumber(duckingReductionDraft, 0, 18),
      attackMs: clampNumber(duckingAttackDraft, 20, 600),
      releaseMs: clampNumber(duckingReleaseDraft, 80, 2000),
    }
    const activeBed = getActiveMusicBed(project)

    if (!activeBed) {
      const changed =
        nextVoiceClarity.enabled !== project.audio.voiceClarity.enabled ||
        nextVoiceClarity.profile !== project.audio.voiceClarity.profile ||
        nextDucking.enabled !== project.audio.ducking.enabled ||
        nextDucking.reductionDb !== project.audio.ducking.reductionDb ||
        nextDucking.attackMs !== project.audio.ducking.attackMs ||
        nextDucking.releaseMs !== project.audio.ducking.releaseMs

      return {
        invalid: false,
        changed,
        audio: {
          beds: [],
          activeBedId: '',
          voiceClarity: nextVoiceClarity,
          ducking: nextDucking,
        },
      }
    }

    const parsedTrimStart = parseSecondsInput(musicBedTrimStartDraft)
    const parsedTrimEnd = parseSecondsInput(musicBedTrimEndDraft)
    const parsedTimelineStart = parseSecondsInput(musicBedTimelineStartDraft)
    const parsedTimelineEnd = parseSecondsInput(musicBedTimelineEndDraft)
    const parsedAutomationStart = parseSecondsInput(musicBedAutomationStartDraft)
    const parsedAutomationEnd = parseSecondsInput(musicBedAutomationEndDraft)

    if (
      parsedTrimStart === undefined ||
      parsedTrimEnd === undefined ||
      parsedTimelineStart === undefined ||
      parsedTimelineEnd === undefined ||
      parsedAutomationStart === undefined ||
      parsedAutomationEnd === undefined
    ) {
      return {
        invalid: true,
      }
    }

    const durationCap = activeBed.durationSeconds > 0 ? activeBed.durationSeconds : null
    const trimStartSeconds =
      durationCap === null
        ? parsedTrimStart ?? 0
        : Math.min(durationCap, parsedTrimStart ?? 0)
    const trimEndRaw =
      parsedTrimEnd === null
        ? durationCap
        : durationCap === null
          ? parsedTrimEnd
          : Math.min(durationCap, parsedTrimEnd)
    const trimEndSeconds =
      trimEndRaw === null ? null : Math.max(trimStartSeconds, trimEndRaw)
    const timelineStartSeconds = parsedTimelineStart ?? 0
    const timelineEndSeconds =
      parsedTimelineEnd === null ? null : Math.max(timelineStartSeconds, parsedTimelineEnd)
    const automationStartSeconds = parsedAutomationStart ?? timelineStartSeconds
    const automationEndSeconds =
      parsedAutomationEnd === null ? null : Math.max(automationStartSeconds, parsedAutomationEnd)
    const previewPlacement = getMusicBedPlacement(
      {
        ...activeBed,
        timelineStartSeconds,
        timelineEndSeconds,
        loop: musicBedLoopDraft,
      },
      audioStageDuration,
    )
    const nextAutomationKeyframes = musicBedAutomationEnabledDraft
      ? normalizeAutomationKeyframes(
          musicBedAutomationKeyframesDraft.length
            ? musicBedAutomationKeyframesDraft
            : createDefaultAutomationCurve({
                laneStartSeconds: previewPlacement.timelineStartSeconds,
                laneEndSeconds: previewPlacement.timelineEndSeconds,
                startSeconds: automationStartSeconds,
                endSeconds: automationEndSeconds,
                gainDb: clampNumber(musicBedAutomationGainDraft, automationGainRange.min, automationGainRange.max),
                rampSeconds: clampNumber(musicBedAutomationRampDraft, 0, 6),
              }),
          {
            startSeconds: previewPlacement.timelineStartSeconds,
            endSeconds: previewPlacement.timelineEndSeconds,
          },
        )
      : []
    const nextMusicBed = {
      ...activeBed,
      trimStartSeconds,
      trimEndSeconds,
      timelineStartSeconds,
      timelineEndSeconds,
      fadeInSeconds: clampNumber(musicBedFadeInDraft, 0, 6),
      fadeOutSeconds: clampNumber(musicBedFadeOutDraft, 0, 6),
      gainDb: clampNumber(musicBedGainDraft, -24, 12),
      routingMode: musicBedRoutingModeDraft,
      automation: {
        enabled: musicBedAutomationEnabledDraft,
        startSeconds: automationStartSeconds,
        endSeconds: automationEndSeconds,
        gainDb: clampNumber(musicBedAutomationGainDraft, automationGainRange.min, automationGainRange.max),
        rampSeconds: clampNumber(musicBedAutomationRampDraft, 0, 6),
        keyframes: nextAutomationKeyframes,
      },
      loop: musicBedLoopDraft,
      enabled: musicBedEnabledDraft,
      updatedAt: new Date().toISOString(),
    }
    const nextBeds = replaceMusicBed(project, nextMusicBed)
    const changed =
      nextMusicBed.trimStartSeconds !== activeBed.trimStartSeconds ||
      nextMusicBed.trimEndSeconds !== activeBed.trimEndSeconds ||
      nextMusicBed.timelineStartSeconds !== activeBed.timelineStartSeconds ||
      nextMusicBed.timelineEndSeconds !== activeBed.timelineEndSeconds ||
      nextMusicBed.fadeInSeconds !== activeBed.fadeInSeconds ||
      nextMusicBed.fadeOutSeconds !== activeBed.fadeOutSeconds ||
      nextMusicBed.gainDb !== activeBed.gainDb ||
      nextMusicBed.routingMode !== activeBed.routingMode ||
      nextMusicBed.automation.enabled !== activeBed.automation.enabled ||
      nextMusicBed.automation.startSeconds !== activeBed.automation.startSeconds ||
      nextMusicBed.automation.endSeconds !== activeBed.automation.endSeconds ||
      nextMusicBed.automation.gainDb !== activeBed.automation.gainDb ||
      nextMusicBed.automation.rampSeconds !== activeBed.automation.rampSeconds ||
      serializeAutomationKeyframes(nextMusicBed.automation.keyframes) !== serializeAutomationKeyframes(activeBed.automation.keyframes) ||
      nextMusicBed.loop !== activeBed.loop ||
      nextMusicBed.enabled !== activeBed.enabled ||
      nextVoiceClarity.enabled !== project.audio.voiceClarity.enabled ||
      nextVoiceClarity.profile !== project.audio.voiceClarity.profile ||
      nextDucking.enabled !== project.audio.ducking.enabled ||
      nextDucking.reductionDb !== project.audio.ducking.reductionDb ||
      nextDucking.attackMs !== project.audio.ducking.attackMs ||
      nextDucking.releaseMs !== project.audio.ducking.releaseMs

    return {
      invalid: false,
      changed,
      audio: {
        beds: nextBeds,
        activeBedId: project.audio.activeBedId || activeBed.id,
        voiceClarity: nextVoiceClarity,
        ducking: nextDucking,
      },
    }
  }

  const flushPendingProjectDrafts = async () => {
    if (!project) {
      return true
    }

    const nextPatch: ProjectPatch = {}
    let hasChanges = false

    if (projectTitleDraft !== project.title || projectBriefDraft !== project.brief) {
      nextPatch.title = projectTitleDraft
      nextPatch.brief = projectBriefDraft
      hasChanges = true
    }

    const clipUpdate = buildSelectedClipUpdate()

    if (clipUpdate?.invalid) {
      setErrorMessage('Fix clip trim values before switching projects.')
      return false
    }

    if (clipUpdate?.changed) {
      nextPatch.clips = clipUpdate.clips
      hasChanges = true
    }

    const audioUpdate = buildProjectAudioUpdate()

    if (audioUpdate?.invalid) {
      setErrorMessage('Fix sequence audio trim values before switching projects.')
      return false
    }

    if (audioUpdate?.changed) {
      nextPatch.audio = audioUpdate.audio
      hasChanges = true
    }

    if (!hasChanges) {
      return true
    }

    const saved = await persistProject(nextPatch, 'Current project autosaved before workspace switch.')
    return Boolean(saved)
  }

  const applyProjectWorkspace = (
    workspace: ProjectWorkspacePayload,
    successMessage: string,
  ) => {
    const latestClip = workspace.activeProject.clips[0]

    setProject(workspace.activeProject)
    setProjectLibrary(workspace.projects)
    setLastSavedPath(latestClip?.filePath ?? '')
    setLastSavedSize(latestClip?.size ?? 0)
    setLastExportPath(getProjectLastExportPath(workspace.activeProject))
    setStatusLine(successMessage)
  }

  const runProjectWorkspaceAction = async (
    action: () => Promise<ProjectWorkspacePayload>,
    successMessage: (workspace: ProjectWorkspacePayload) => string,
  ) => {
    const isReady = await flushPendingProjectDrafts()

    if (!isReady) {
      return false
    }

    setIsProjectLibraryBusy(true)
    setErrorMessage('')

    try {
      const workspace = await action()
      applyProjectWorkspace(workspace, successMessage(workspace))
      return true
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Project workspace update failed')
      return false
    } finally {
      setIsProjectLibraryBusy(false)
    }
  }

  useEffect(() => {
    if (!project || !project.recovery.autosaveEnabled) {
      return
    }

    if (projectTitleDraft === project.title && projectBriefDraft === project.brief) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void persistProject(
        {
          title: projectTitleDraft,
          brief: projectBriefDraft,
        },
        'Project metadata autosaved.',
      )
    }, 420)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [project?.id, project?.title, project?.brief, project?.recovery.autosaveEnabled, projectTitleDraft, projectBriefDraft])

  useEffect(() => {
    if (!project || !selectedClip || !project.recovery.autosaveEnabled) {
      return
    }

    const update = buildSelectedClipUpdate()

    if (!update || update.invalid || !update.changed) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void persistProject(
        {
          clips: update.clips,
        },
        `Clip "${selectedClip.label}" autosaved.`,
      )
    }, 480)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    project?.id,
    project?.clips,
    project?.recovery.autosaveEnabled,
    selectedClip?.id,
    selectedClip?.notes,
    selectedClip?.trim.startSeconds,
    selectedClip?.trim.endSeconds,
    selectedClip?.audio.muted,
    selectedClip?.audio.gainDb,
    clipNotesDraft,
    clipAudioMutedDraft,
    clipAudioGainDraft,
    trimStartDraft,
    trimEndDraft,
  ])

  useEffect(() => {
    if (!project || !project.recovery.autosaveEnabled) {
      return
    }

    const update = buildProjectAudioUpdate()

    if (!update || update.invalid || !update.changed) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void persistProject(
        {
          audio: update.audio,
        },
        'Sequence audio autosaved.',
      )
    }, 520)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    project?.id,
    project?.audio.activeBedId,
    project?.audio.beds.length,
    activeMusicBed?.id,
    activeMusicBed?.trimStartSeconds,
    activeMusicBed?.trimEndSeconds,
    activeMusicBed?.timelineStartSeconds,
    activeMusicBed?.timelineEndSeconds,
    activeMusicBed?.fadeInSeconds,
    activeMusicBed?.fadeOutSeconds,
    activeMusicBed?.gainDb,
    activeMusicBed?.routingMode,
    activeMusicBed?.automation.enabled,
    activeMusicBed?.automation.startSeconds,
    activeMusicBed?.automation.endSeconds,
    activeMusicBed?.automation.gainDb,
    activeMusicBed?.automation.rampSeconds,
    activeMusicBedAutomationKeyframesSignature,
    activeMusicBed?.loop,
    activeMusicBed?.enabled,
    project?.audio.ducking.enabled,
    project?.audio.ducking.reductionDb,
    project?.audio.ducking.attackMs,
    project?.audio.ducking.releaseMs,
    project?.recovery.autosaveEnabled,
    musicBedTrimStartDraft,
    musicBedTrimEndDraft,
    musicBedTimelineStartDraft,
    musicBedTimelineEndDraft,
    musicBedFadeInDraft,
    musicBedFadeOutDraft,
    musicBedGainDraft,
    musicBedRoutingModeDraft,
    musicBedAutomationEnabledDraft,
    musicBedAutomationStartDraft,
    musicBedAutomationEndDraft,
    musicBedAutomationGainDraft,
    musicBedAutomationRampDraft,
    automationDraftKeyframesSignature,
    musicBedLoopDraft,
    musicBedEnabledDraft,
    duckingEnabledDraft,
    duckingReductionDraft,
    duckingAttackDraft,
    duckingReleaseDraft,
  ])

  const refreshSources = async () => {
    setIsRefreshingSources(true)
    setErrorMessage('')

    try {
      const nextSources = await window.forkApi.sources.list()
      setSources(nextSources)
      setStatusLine(`Source inventory refreshed. ${nextSources.length} source(s) available.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh sources')
    } finally {
      setIsRefreshingSources(false)
    }
  }

  const scanImportState = async () => {
    setIsScanningImport(true)
    setErrorMessage('')

    try {
      const summary = await window.forkApi.importState.scan()
      setImportSummary(summary)
      setStatusLine(
        summary.detected
          ? `Legacy install detected. ${summary.projectCount} project file(s), ${summary.presetCount} preset file(s).`
          : 'No compatible legacy install was detected on this machine.',
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Import scan failed')
    } finally {
      setIsScanningImport(false)
    }
  }

  const importLegacyState = async () => {
    setIsImporting(true)
    setErrorMessage('')

    try {
      const imported = await window.forkApi.importState.run()
      setImportSummary(imported.summary)
      setSettings(imported.settings)
      setStatusLine('Legacy state was copied into the Movion workspace.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  const handleCreateProject = async () => {
    if (projectWorkspaceLocked) {
      return
    }

    const created = await runProjectWorkspaceAction(
      () =>
        window.forkApi.project.create({
          title: projectSeedTitleDraft.trim() || undefined,
        }),
      (workspace) => `Project "${workspace.activeProject.title}" is ready for capture.`,
    )

    if (created) {
      setProjectSeedTitleDraft('')
    }
  }

  const handleOpenProject = async (projectId: string) => {
    if (projectWorkspaceLocked || projectId === project?.id) {
      return
    }

    await runProjectWorkspaceAction(
      () => window.forkApi.project.open(projectId),
      (workspace) => `Opened project "${workspace.activeProject.title}".`,
    )
  }

  const handleDuplicateProject = async (projectId: string) => {
    if (projectWorkspaceLocked) {
      return
    }

    await runProjectWorkspaceAction(
      () => window.forkApi.project.duplicate(projectId),
      (workspace) => `Duplicated project into "${workspace.activeProject.title}".`,
    )
  }

  const handleDeleteProject = async (projectSummary: ProjectSummary) => {
    if (projectWorkspaceLocked) {
      return
    }

    const approved = window.confirm(
      `Delete project "${projectSummary.title}"? The stored project JSON will be removed, but captured video files stay on disk.`,
    )

    if (!approved) {
      return
    }

    await runProjectWorkspaceAction(
      () => window.forkApi.project.remove(projectSummary.id),
      (workspace) => `Project removed. Active workspace is now "${workspace.activeProject.title}".`,
    )
  }

  const stopRecorderTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startRecorderTimer = () => {
    stopRecorderTimer()
    setRecordingSeconds(0)
    timerRef.current = window.setInterval(() => {
      const elapsedSeconds = recordingStartedAtRef.current
        ? Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
        : 0
      setRecordingSeconds(elapsedSeconds)
    }, 200)
  }

  const stopCursorTelemetry = () => {
    if (cursorPollingRef.current) {
      window.clearInterval(cursorPollingRef.current)
      cursorPollingRef.current = null
    }

    cursorPollInFlightRef.current = false
  }

  const resetCursorTelemetry = () => {
    stopCursorTelemetry()
    cursorTrackPointsRef.current = []
    cursorClickEventsRef.current = []
    keyboardShortcutEventsRef.current = []
    cursorPulseEventsRef.current = []
    cursorAppearanceCacheRef.current.clear()
    cursorAppearanceAssetRef.current.clear()
    cursorAppearanceKindRef.current.clear()
    cursorAppearanceLoadingRef.current.clear()
    cursorTrackingAvailableRef.current = false
    keyboardTrackingAvailableRef.current = false
    liveCursorCoordinateSpaceRef.current = null
    liveCursorVisualRef.current = null
    setLiveCaptureCursorRenderMode('baked')
    setSessionCursorTrackingAvailable(false)
    setSessionKeyboardTrackingAvailable(false)
    hideLiveCursorDecorations()
  }

  const maybeAppendCursorPulse = (nextPoint: CursorTrackPoint) => {
    const points = cursorTrackPointsRef.current
    const pointCount = points.length

    if (
      pointCount < 3 ||
      activeCursorSettings.clickEffect === 'none' ||
      cursorClickEventsRef.current.length > 0
    ) {
      return
    }

    const recentPoints = points.slice(-3)
    const inferredPulse = inferCursorPulseEvents(recentPoints).at(-1)
    const latestPulse = cursorPulseEventsRef.current.at(-1)

    if (
      !inferredPulse ||
      (latestPulse && inferredPulse.timeSeconds - latestPulse.timeSeconds < 0.38) ||
      Math.abs(inferredPulse.timeSeconds - nextPoint.timeSeconds) > 0.22
    ) {
      return
    }

    cursorPulseEventsRef.current.push(inferredPulse)
  }

  const collectCursorSample = async () => {
    if (
      (!cursorTrackingAvailableRef.current && !keyboardTrackingAvailableRef.current) ||
      cursorPollInFlightRef.current ||
      !recordingStartedAtRef.current
    ) {
      return
    }

    cursorPollInFlightRef.current = true

    try {
      const snapshot = await window.forkApi.capture.getCursorSnapshot()

      if (snapshot.cursorAppearanceId && snapshot.cursorImageDataUrl) {
        rememberCursorAppearanceAsset({
          id: snapshot.cursorAppearanceId,
          cursorKind: normalizeCursorVisualKind(snapshot.cursorKind),
          imageDataUrl: snapshot.cursorImageDataUrl,
          hotspotRatioX: snapshot.cursorHotspotRatioX,
          hotspotRatioY: snapshot.cursorHotspotRatioY,
          referenceWidth: snapshot.cursorReferenceWidth,
          referenceHeight: snapshot.cursorReferenceHeight,
        })
        void cacheCursorAppearanceImage(snapshot.cursorAppearanceId, snapshot.cursorImageDataUrl)
      }

      if (!recordingStartedAtRef.current) {
        return
      }

      if (snapshot.trackingAvailable) {
        const nextPoint: CursorTrackPoint = {
          timeSeconds: Number(((Date.now() - recordingStartedAtRef.current) / 1000).toFixed(3)),
          x: clampUnit(snapshot.x),
          y: clampUnit(snapshot.y),
          ...normalizeCursorVisualState({
            cursorKind: snapshot.cursorKind,
            cursorAppearanceId: snapshot.cursorAppearanceId,
            cursorHotspotRatioX: snapshot.cursorHotspotRatioX,
            cursorHotspotRatioY: snapshot.cursorHotspotRatioY,
          }),
        }
        const previousPoint = cursorTrackPointsRef.current.at(-1)

        if (previousPoint && nextPoint.timeSeconds <= previousPoint.timeSeconds) {
          cursorTrackPointsRef.current[cursorTrackPointsRef.current.length - 1] = nextPoint
        } else {
          cursorTrackPointsRef.current.push(nextPoint)
          maybeAppendCursorPulse(nextPoint)
        }

        liveCursorVisualRef.current = {
          x: nextPoint.x,
          y: nextPoint.y,
          cursorKind: normalizeCursorVisualKind(nextPoint.cursorKind),
          cursorAppearanceId: nextPoint.cursorAppearanceId,
          cursorHotspotRatioX: nextPoint.cursorHotspotRatioX,
          cursorHotspotRatioY: nextPoint.cursorHotspotRatioY,
          referenceWidth: snapshot.cursorReferenceWidth,
          referenceHeight: snapshot.cursorReferenceHeight,
        }
        scheduleLiveCursorDecorationsSync()
      } else {
        liveCursorVisualRef.current = null
        scheduleLiveCursorDecorationsSync()
      }

      if (Array.isArray(snapshot.clicks) && recordingStartedAtRef.current) {
        for (const click of snapshot.clicks) {
          const occurredAtMs = Number.isFinite(click?.occurredAtMs) ? Number(click.occurredAtMs) : Date.now()
          const timeSeconds = Number(((occurredAtMs - recordingStartedAtRef.current) / 1000).toFixed(3))

          if (timeSeconds < 0) {
            continue
          }

          const nextClick: CursorClickEvent = {
            timeSeconds,
            x: clampUnit(click.x),
            y: clampUnit(click.y),
            button: click.button === 'right' ? 'right' : 'left',
            ctrlKey: Boolean(click.ctrlKey),
            durationMs: Number.isFinite(click.durationMs) ? Math.max(0, Number(click.durationMs)) : 0,
          }
          const previousClick = cursorClickEventsRef.current.at(-1)

          if (
            previousClick &&
            previousClick.button === nextClick.button &&
            Math.abs(previousClick.timeSeconds - nextClick.timeSeconds) < 0.04
          ) {
            continue
          }

          cursorClickEventsRef.current.push(nextClick)
          const nextPulse = {
            id: `click-${nextClick.button}-${nextClick.timeSeconds.toFixed(3)}`,
            timeSeconds: nextClick.timeSeconds,
            x: nextClick.x,
            y: nextClick.y,
            strength: nextClick.button === 'right' ? 1.15 : 1,
          }
          cursorPulseEventsRef.current.push(nextPulse)
          triggerLiveCursorPulse(nextClick.x, nextClick.y, nextPulse.strength)
        }
      }

      if (Array.isArray(snapshot.shortcuts) && recordingStartedAtRef.current) {
        for (const shortcut of snapshot.shortcuts) {
          const occurredAtMs = Number.isFinite(shortcut?.occurredAtMs) ? Number(shortcut.occurredAtMs) : Date.now()
          const timeSeconds = Number(((occurredAtMs - recordingStartedAtRef.current) / 1000).toFixed(3))
          const keys = Array.isArray(shortcut?.keys)
            ? shortcut.keys
                .map((key) => (typeof key === 'string' ? key.trim().toLowerCase() : ''))
                .filter(Boolean)
            : []

          if (timeSeconds < 0 || !keys.length) {
            continue
          }

          const previousShortcut = keyboardShortcutEventsRef.current.at(-1)

          if (
            previousShortcut &&
            Math.abs(previousShortcut.timeSeconds - timeSeconds) < 0.05 &&
            previousShortcut.keys.join('+') === keys.join('+')
          ) {
            continue
          }

          keyboardShortcutEventsRef.current.push({
            id: `shortcut-${timeSeconds.toFixed(3)}-${keys.join('-')}`,
            timeSeconds,
            durationMs: Number.isFinite(shortcut?.durationMs) ? Math.max(40, Number(shortcut.durationMs)) : 180,
            keys,
            visible: true,
          })
        }
      }
    } catch (error) {
      console.warn('Cursor telemetry sampling failed', error)
      stopCursorTelemetry()
      cursorTrackingAvailableRef.current = false
      keyboardTrackingAvailableRef.current = false
      liveCursorVisualRef.current = null
      setSessionCursorTrackingAvailable(false)
      setSessionKeyboardTrackingAvailable(false)
      hideLiveCursorDecorations()
    } finally {
      cursorPollInFlightRef.current = false
    }
  }

  const startCursorTelemetry = async (trackingAvailable: boolean, keyboardTrackingAvailable: boolean) => {
    cursorTrackPointsRef.current = []
    keyboardShortcutEventsRef.current = []
    cursorAppearanceAssetRef.current.clear()
    cursorAppearanceKindRef.current.clear()
    liveCursorVisualRef.current = null
    hideLiveCursorDecorations()
    cursorTrackingAvailableRef.current = trackingAvailable
    keyboardTrackingAvailableRef.current = keyboardTrackingAvailable
    setSessionCursorTrackingAvailable(trackingAvailable)
    setSessionKeyboardTrackingAvailable(keyboardTrackingAvailable)

    if (!trackingAvailable && !keyboardTrackingAvailable) {
      return
    }

    await collectCursorSample()
    cursorPollingRef.current = window.setInterval(() => {
      void collectCursorSample()
    }, cursorSampleIntervalMs)

    void (async () => {
      try {
        const catalog = await window.forkApi.capture.getCursorAppearanceCatalog()

        for (const assetCandidate of catalog) {
          const normalizedAsset = normalizeCursorAppearanceAsset(assetCandidate)

          if (!normalizedAsset) {
            continue
          }

          cursorAppearanceAssetRef.current.set(normalizedAsset.id, normalizedAsset)
          cursorAppearanceKindRef.current.set(normalizedAsset.cursorKind, normalizedAsset)
          void cacheCursorAppearanceImage(normalizedAsset.id, normalizedAsset.imageDataUrl)
        }
      } catch (error) {
        console.warn('Cursor appearance catalog preload failed', error)
      }
    })()
  }

  const buildRecordedCursorTrack = (
    sourceKind: ProjectClip['source']['kind'],
    coordinateSpace: CursorCoordinateSpace | null = liveCursorCoordinateSpaceRef.current,
  ): CursorTrack | null => {
    const rawPoints = compactCursorTrackPointsShared(cursorTrackPointsRef.current)
    const clicks = cursorClickEventsRef.current
    const usePremiumCursorCatalog = activeCursorSettings.style === 'windows'
    const premiumAppearances = PREMIUM_CURSOR_APPEARANCE_CATALOG.map((asset) => {
      const cachedPremiumAsset = cursorAppearanceAssetRef.current.get(asset.id) ?? asset
      const observedAsset = cursorAppearanceKindRef.current.get(asset.cursorKind)
      const observedImage = observedAsset
        ? cursorAppearanceCacheRef.current.get(observedAsset.id)
        : cursorAppearanceCacheRef.current.get(cachedPremiumAsset.id)

      return {
        ...cachedPremiumAsset,
        hotspotRatioX: observedAsset?.hotspotRatioX ?? cachedPremiumAsset.hotspotRatioX,
        hotspotRatioY: observedAsset?.hotspotRatioY ?? cachedPremiumAsset.hotspotRatioY,
        referenceWidth:
          observedAsset?.referenceWidth ??
          cachedPremiumAsset.referenceWidth ??
          observedImage?.width ??
          asset.referenceWidth,
        referenceHeight:
          observedAsset?.referenceHeight ??
          cachedPremiumAsset.referenceHeight ??
          observedImage?.height ??
          asset.referenceHeight,
      }
    })
    const premiumAppearanceByKind = new Map(
      premiumAppearances.map((asset) => [asset.cursorKind, asset] as const),
    )
    const points = usePremiumCursorCatalog
      ? rawPoints.map((point) => {
          const resolvedCursorKind = activeCursorSettings.alwaysPointer
            ? 'arrow'
            : normalizeCursorVisualKind(point.cursorKind)
          const premiumAsset =
            premiumAppearanceByKind.get(resolvedCursorKind) ??
            premiumAppearanceByKind.get('arrow')

          if (!premiumAsset) {
            return point
          }

          return {
            ...point,
            cursorKind: resolvedCursorKind,
            cursorAppearanceId: premiumAsset.id,
            cursorHotspotRatioX: premiumAsset.hotspotRatioX,
            cursorHotspotRatioY: premiumAsset.hotspotRatioY,
          }
        })
      : rawPoints
    const appearances = usePremiumCursorCatalog
      ? premiumAppearances
      : [...cursorAppearanceAssetRef.current.values()]

    if (!points.length) {
      return null
    }

    return normalizeCursorTrackShared({
      sourceKind,
      sampleIntervalMs: cursorSampleIntervalMs,
      points,
      clicks: [...clicks],
      appearances,
      ...(coordinateSpace?.width && coordinateSpace?.height
        ? {
            coordinateSpace: {
              width: Math.max(1, Math.round(coordinateSpace.width)),
              height: Math.max(1, Math.round(coordinateSpace.height)),
            },
          }
        : {}),
    }, sourceKind, null)
  }

  const buildRecordedKeyboardShortcuts = (): KeyboardShortcutEvent[] => [...keyboardShortcutEventsRef.current]

  const rememberCursorAppearanceAsset = (asset: Partial<CursorAppearanceAsset> | null | undefined) => {
    const normalizedAsset = normalizeCursorAppearanceAsset(asset)

    if (!normalizedAsset) {
      return
    }

    cursorAppearanceAssetRef.current.set(normalizedAsset.id, normalizedAsset)
    cursorAppearanceKindRef.current.set(normalizedAsset.cursorKind, normalizedAsset)
  }

  type CursorOverlayViewport = {
    x: number
    y: number
    width: number
    height: number
  }

  type CursorOverlayDrawMode = 'cinematic' | 'efficient'

  const drawCursorOverlay = (
    context: CanvasRenderingContext2D,
    renderWidth: number,
    renderHeight: number,
    frameTimeSeconds: number,
    cursorPoints: CursorTrackPoint[] = cursorTrackPointsRef.current,
    cursorPulses: CursorPulseEvent[] = cursorPulseEventsRef.current,
    options?: {
      drawMode?: CursorOverlayDrawMode
      viewport?: CursorOverlayViewport
      coordinateSpace?: CursorCoordinateSpace | null
    },
  ) => {
    const cursorPoint = getCursorPointAtTime(
      cursorPoints,
      frameTimeSeconds,
      activeCursorSettings.smoothingEnabled,
      activeCursorSettings.animationStyle,
    )

    if (!cursorPoint) {
      return
    }

    const drawMode = options?.drawMode ?? 'cinematic'
    const cursorViewport = options?.viewport ?? {
      x: 0,
      y: 0,
      width: renderWidth,
      height: renderHeight,
    }
    const cursorCoordinateSpace = options?.coordinateSpace
    const cursorX = cursorViewport.x + cursorPoint.x * cursorViewport.width
    const cursorY = cursorViewport.y + cursorPoint.y * cursorViewport.height
    const resolvedCursorKind =
      activeCursorSettings.alwaysPointer
        ? 'arrow'
        : normalizeCursorVisualKind(cursorPoint.cursorKind)
    const cursorKindTransition =
      activeCursorSettings.alwaysPointer
        ? null
        : getCursorKindTransitionState(
            cursorPoints,
            frameTimeSeconds,
            resolvedCursorKind,
            normalizeCursorAppearanceId(cursorPoint.cursorAppearanceId),
          )
    const { scaleX: pointerScaleX, scaleY: pointerScaleY, scale: pointerScale } = resolveCursorScaleMetrics({
      baseScale: activeCursorSettings.size,
      frameWidth: cursorViewport.width,
      frameHeight: cursorViewport.height,
      coordinateSpaceWidth:
        cursorCoordinateSpace?.width && cursorCoordinateSpace.width > 0
          ? cursorCoordinateSpace.width
          : cursorViewport.width,
      coordinateSpaceHeight:
        cursorCoordinateSpace?.height && cursorCoordinateSpace.height > 0
          ? cursorCoordinateSpace.height
          : cursorViewport.height,
    })
    const trailingPoint =
      drawMode === 'cinematic'
        ? getCursorPointAtTime(
            cursorPoints,
            Math.max(0, frameTimeSeconds - 0.028),
            activeCursorSettings.smoothingEnabled,
            activeCursorSettings.animationStyle,
          )
        : null
    const tailPoint =
      drawMode === 'cinematic'
        ? getCursorPointAtTime(
            cursorPoints,
            Math.max(0, frameTimeSeconds - 0.068),
            activeCursorSettings.smoothingEnabled,
            activeCursorSettings.animationStyle,
          )
        : null
    const velocityNormX =
      trailingPoint && frameTimeSeconds >= 0.028
        ? (cursorPoint.x - trailingPoint.x) / 0.028
        : 0
    const velocityNormY =
      trailingPoint && frameTimeSeconds >= 0.028
        ? (cursorPoint.y - trailingPoint.y) / 0.028
        : 0
    const velocityPixelsPerSecond = Math.hypot(
      velocityNormX * cursorViewport.width,
      velocityNormY * cursorViewport.height,
      )
    const motionIntensity = clampNumber(velocityPixelsPerSecond / 1650, 0, 1)
    const cursorTiltDegrees = clampNumber(velocityNormX * 5.6 + velocityNormY * 1.4, -8.5, 8.5)
    const recentPulseStrength = cursorPulses.reduce((peak, pulse) => {
      if (frameTimeSeconds < pulse.timeSeconds || frameTimeSeconds - pulse.timeSeconds > 0.18) {
        return peak
      }

      const pulseProgress = clampUnit((frameTimeSeconds - pulse.timeSeconds) / 0.18)
      return Math.max(peak, (1 - pulseProgress) * pulse.strength)
    }, 0)
    const cursorPressScale = 1 - recentPulseStrength * 0.045

    context.save()
    context.translate(cursorX, cursorY)

    if (activeCursorSettings.clickEffect === 'ripple') {
      const clickEffectImage = liquidGlassCursorClickEffectImageRef.current
      const activePulses = cursorPulses.filter(
        (pulse) =>
          frameTimeSeconds >= pulse.timeSeconds &&
          frameTimeSeconds - pulse.timeSeconds <= CURSOR_CLICK_EFFECT_DURATION_SECONDS,
      )

      for (const pulse of activePulses) {
        const progress = getCursorClickEffectProgress(frameTimeSeconds - pulse.timeSeconds)
        const strength = clampCursorClickEffectStrength(pulse.strength)
        const opacity = getCursorClickEffectOpacity(progress)
        const pulseOffsetX = (pulse.x - cursorPoint.x) * cursorViewport.width
        const pulseOffsetY = (pulse.y - cursorPoint.y) * cursorViewport.height
        const drawSize = getCursorClickEffectSize(pointerScale, strength, progress)

        if (clickEffectImage?.complete && clickEffectImage.naturalWidth > 0 && clickEffectImage.naturalHeight > 0) {
          context.save()
          context.globalAlpha *= opacity
          context.drawImage(
            clickEffectImage,
            pulseOffsetX - drawSize / 2,
            pulseOffsetY - drawSize / 2,
            drawSize,
            drawSize,
          )
          context.restore()
          continue
        }

        const haloRadius = Math.max(8, drawSize * 0.5)
        const halo = context.createRadialGradient(
          pulseOffsetX,
          pulseOffsetY,
          haloRadius * 0.12,
          pulseOffsetX,
          pulseOffsetY,
          haloRadius,
        )
        halo.addColorStop(0, `rgba(255, 255, 255, ${(opacity * 0.52).toFixed(3)})`)
        halo.addColorStop(0.38, `rgba(164, 204, 255, ${(opacity * 0.24).toFixed(3)})`)
        halo.addColorStop(1, 'rgba(164, 204, 255, 0)')
        context.beginPath()
        context.arc(pulseOffsetX, pulseOffsetY, haloRadius, 0, Math.PI * 2)
        context.fillStyle = halo
        context.fill()
      }
    }

    if (activeCursorSettings.showCursor && drawMode === 'cinematic') {
      const haloRadius = (18 + motionIntensity * 18 + recentPulseStrength * 12) * pointerScale
      const halo = context.createRadialGradient(0, 0, 2, 0, 0, haloRadius)
      halo.addColorStop(0, `rgba(88, 121, 255, ${(0.18 + motionIntensity * 0.08).toFixed(3)})`)
      halo.addColorStop(0.52, `rgba(88, 121, 255, ${(0.08 + recentPulseStrength * 0.05).toFixed(3)})`)
      halo.addColorStop(1, 'rgba(88, 121, 255, 0)')
      context.beginPath()
      context.arc(0, 0, haloRadius, 0, Math.PI * 2)
      context.fillStyle = halo
      context.fill()
    }

    if (!activeCursorSettings.showCursor) {
      context.restore()
      return
    }

    if (activeCursorSettings.style === 'touch') {
      const touchRadius = (10 + motionIntensity * 1.6) * pointerScale
      context.shadowColor = `rgba(0, 0, 0, ${(0.24 + motionIntensity * 0.08).toFixed(3)})`
      context.shadowBlur = (16 + motionIntensity * 10) * pointerScale
      context.shadowOffsetX = velocityNormX * 2.5 * pointerScaleX
      context.shadowOffsetY = (5 + motionIntensity * 2.4) * pointerScaleY

      context.beginPath()
      context.arc(0, 0, touchRadius, 0, Math.PI * 2)
      context.fillStyle = 'rgba(255, 255, 255, 0.96)'
      context.fill()
      context.lineWidth = 2 * pointerScale
      context.strokeStyle = 'rgba(7, 10, 18, 0.72)'
      context.stroke()
      context.restore()
      return
    }

    const drawAccentDot = (alpha: number) => {
      context.beginPath()
      context.arc(16.5, 3.5, 3.2, 0, Math.PI * 2)
      context.fillStyle = `rgba(92, 122, 255, ${alpha.toFixed(3)})`
      context.fill()
    }

    const drawCursorBody = (
      cursorKind: CursorVisualKind,
      fillOpacity: number,
      outlineAlpha: number,
      glossAlpha: number,
      accentAlpha: number,
      cursorAppearanceId?: string,
      cursorHotspotRatioX?: number,
      cursorHotspotRatioY?: number,
    ) => {
      const resolvedAppearanceId = normalizeCursorAppearanceId(cursorAppearanceId)
      const exactAppearanceAsset = resolvedAppearanceId
        ? cursorAppearanceAssetRef.current.get(resolvedAppearanceId)
        : undefined
      const premiumAppearanceAsset =
        activeCursorSettings.style === 'windows' && !activeCursorSettings.alwaysPointer
          ? resolvePremiumCursorAppearanceAsset(cursorKind)
          : undefined
      const fallbackAppearanceAsset =
        activeCursorSettings.style === 'windows' && !activeCursorSettings.alwaysPointer
          ? cursorAppearanceKindRef.current.get(cursorKind)
          : undefined
      const preferredAppearanceAsset =
        activeCursorSettings.style === 'windows' && !activeCursorSettings.alwaysPointer
          ? premiumAppearanceAsset ?? exactAppearanceAsset ?? fallbackAppearanceAsset
          : exactAppearanceAsset
      const metricAppearanceAsset =
        exactAppearanceAsset ?? fallbackAppearanceAsset ?? preferredAppearanceAsset
      const resolvedAppearanceImage = preferredAppearanceAsset
        ? cursorAppearanceCacheRef.current.get(preferredAppearanceAsset.id)
        : undefined
      const metricAppearanceImage = metricAppearanceAsset
        ? cursorAppearanceCacheRef.current.get(metricAppearanceAsset.id)
        : undefined

      if (resolvedAppearanceImage) {
        const metricHotspotRatios = normalizeCursorHotspotRatiosForKind(
          cursorKind,
          metricAppearanceAsset?.hotspotRatioX ?? cursorHotspotRatioX,
          metricAppearanceAsset?.hotspotRatioY ?? cursorHotspotRatioY,
        )
        const resolvedReferenceWidth = Math.max(
          1,
          Number(metricAppearanceAsset?.referenceWidth) ||
            metricAppearanceImage?.width ||
            Number(preferredAppearanceAsset?.referenceWidth) ||
            resolvedAppearanceImage.width,
        )
        const resolvedReferenceHeight = Math.max(
          1,
          Number(metricAppearanceAsset?.referenceHeight) ||
            metricAppearanceImage?.height ||
            Number(preferredAppearanceAsset?.referenceHeight) ||
            resolvedAppearanceImage.height,
        )
        const hotspotX = metricHotspotRatios.hotspotRatioX * resolvedReferenceWidth
        const hotspotY = metricHotspotRatios.hotspotRatioY * resolvedReferenceHeight

        context.save()
        context.globalAlpha *= fillOpacity
        context.translate(-hotspotX, -hotspotY)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.scale(
          resolvedReferenceWidth / Math.max(1, resolvedAppearanceImage.width),
          resolvedReferenceHeight / Math.max(1, resolvedAppearanceImage.height),
        )
        context.drawImage(resolvedAppearanceImage, 0, 0)
        context.restore()
        return
      }

      const hotspotOffset = getCursorGlyphHotspotOffset(
        cursorKind,
        activeCursorSettings.style,
        cursorHotspotRatioX,
        cursorHotspotRatioY,
      )
      context.save()
      context.translate(-hotspotOffset.x, -hotspotOffset.y)
      drawCursorGlyph(
        context,
        cursorKind,
        activeCursorSettings.style,
        fillOpacity,
        outlineAlpha,
        glossAlpha,
        frameTimeSeconds,
      )

      if (cursorKind === 'arrow' && accentAlpha > 0.001) {
        drawAccentDot(accentAlpha)
      }

      context.restore()
    }

    const drawTrailCursor = (
      sample: {
        x: number
        y: number
        cursorKind?: CursorVisualKind
        cursorAppearanceId?: string
        cursorHotspotRatioX?: number
        cursorHotspotRatioY?: number
      } | null,
      opacity: number,
      scaleMultiplier: number,
      blurMultiplier: number,
    ) => {
      if (!sample) {
        return
      }

      const deltaX = (sample.x - cursorPoint.x) * cursorViewport.width
      const deltaY = (sample.y - cursorPoint.y) * cursorViewport.height
      const trailDistance = Math.hypot(deltaX, deltaY)

      if (trailDistance < 0.9) {
        return
      }

      context.save()
      context.translate(deltaX * 0.54, deltaY * 0.54)
      context.rotate(Math.atan2(deltaY, deltaX))
      const smearLength = clampNumber(
        trailDistance * (0.62 + blurMultiplier * 0.08),
        8 * pointerScale,
        34 * pointerScale * scaleMultiplier,
      )
      const smearRadius = (2.8 + motionIntensity * 2.2) * pointerScale * scaleMultiplier
      const smearGradient = context.createLinearGradient(-smearLength / 2, 0, smearLength / 2, 0)
      smearGradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
      smearGradient.addColorStop(0.22, `rgba(34, 40, 68, ${(opacity * 0.16).toFixed(3)})`)
      smearGradient.addColorStop(0.55, `rgba(255, 255, 255, ${(opacity * 0.18).toFixed(3)})`)
      smearGradient.addColorStop(0.82, `rgba(92, 122, 255, ${(opacity * 0.14).toFixed(3)})`)
      smearGradient.addColorStop(1, 'rgba(92, 122, 255, 0)')
      context.shadowColor = `rgba(32, 38, 66, ${(opacity * 0.14).toFixed(3)})`
      context.shadowBlur = 10 * blurMultiplier * pointerScale
      context.shadowOffsetX = 0
      context.shadowOffsetY = 0
      context.beginPath()
      context.ellipse(0, 0, smearLength / 2, smearRadius, 0, 0, Math.PI * 2)
      context.fillStyle = smearGradient
      context.fill()

      context.beginPath()
      context.arc(
        smearLength * 0.18,
        0,
        Math.max(1.3, 2.2 * pointerScale * scaleMultiplier),
        0,
        Math.PI * 2,
      )
      context.fillStyle = `rgba(255, 255, 255, ${(opacity * 0.12).toFixed(3)})`
      context.fill()
      context.restore()
    }

    if (drawMode === 'cinematic') {
      drawTrailCursor(tailPoint, 0.16 + motionIntensity * 0.06, 1.02, 1.25)
      drawTrailCursor(trailingPoint, 0.3 + motionIntensity * 0.08, 1.01, 1.05)

      context.shadowColor = `rgba(0, 0, 0, ${(0.3 + motionIntensity * 0.08).toFixed(3)})`
      context.shadowBlur = (16 + motionIntensity * 8) * pointerScale
      context.shadowOffsetX = velocityNormX * 2.8 * pointerScaleX
      context.shadowOffsetY = (4 + motionIntensity * 2.8) * pointerScaleY
      context.rotate((cursorTiltDegrees * Math.PI) / 180)
      context.scale(
        pointerScaleX * (1 + motionIntensity * 0.028) * cursorPressScale,
        pointerScaleY * (1 - motionIntensity * 0.016 + recentPulseStrength * 0.01),
      )
    } else {
      context.shadowColor = 'rgba(0, 0, 0, 0.22)'
      context.shadowBlur = 4 * pointerScale
      context.shadowOffsetX = 0
      context.shadowOffsetY = 1.25 * pointerScaleY
      context.scale(pointerScaleX * cursorPressScale, pointerScaleY * cursorPressScale)
    }
    if (cursorKindTransition) {
      const fadeOut = 1 - smootherStep(cursorKindTransition.progress)
      const fadeIn = smootherStep(cursorKindTransition.progress)
      drawCursorBody(
        cursorKindTransition.previousKind,
        0.99 * fadeOut,
        0.88 * fadeOut,
        (0.24 + motionIntensity * 0.12) * fadeOut,
        0.92 * fadeOut,
        cursorKindTransition.previousAppearanceId,
        cursorKindTransition.previousHotspotRatioX,
        cursorKindTransition.previousHotspotRatioY,
      )
      drawCursorBody(
        resolvedCursorKind,
        0.99 * fadeIn,
        0.88 * fadeIn,
        (0.24 + motionIntensity * 0.12) * fadeIn,
        0.92 * fadeIn,
        cursorPoint.cursorAppearanceId,
        cursorPoint.cursorHotspotRatioX,
        cursorPoint.cursorHotspotRatioY,
      )
    } else {
      drawCursorBody(
        resolvedCursorKind,
        0.99,
        0.88,
        0.24 + motionIntensity * 0.12,
        0.92,
        cursorPoint.cursorAppearanceId,
        cursorPoint.cursorHotspotRatioX,
        cursorPoint.cursorHotspotRatioY,
      )
    }

    context.restore()
  }

  const drawStageCursorOverlayFrame = useEffectEvent(
    (
      context: CanvasRenderingContext2D,
      renderWidth: number,
      renderHeight: number,
      frameTimeSeconds: number,
      sourceWidth: number,
      sourceHeight: number,
    ) => {
      context.clearRect(0, 0, renderWidth, renderHeight)

      const cursorViewport = fitRectIntoFrame({
        sourceWidth,
        sourceHeight,
        frameWidth: renderWidth,
        frameHeight: renderHeight,
        fitMode: stageMediaFitMode,
      })

      if (isRecording) {
        if (!cursorTrackPointsRef.current.length) {
          return
        }

        drawCursorOverlay(
          context,
          renderWidth,
          renderHeight,
          frameTimeSeconds,
          cursorTrackPointsRef.current,
          cursorPulseEventsRef.current,
          {
            drawMode: 'efficient',
            viewport: cursorViewport,
            coordinateSpace:
              liveCursorCoordinateSpaceRef.current ?? {
                width: sourceWidth,
                height: sourceHeight,
              },
          },
        )
        return
      }

      if (previewClipCursorRenderMode !== 'overlay' || !previewCursorTrack?.points?.length) {
        return
      }

      drawCursorOverlay(
        context,
        renderWidth,
        renderHeight,
        frameTimeSeconds,
        previewCursorTrack.points,
        previewCursorPulseEvents,
        {
          drawMode: 'efficient',
          viewport: cursorViewport,
          coordinateSpace:
            previewCursorTrack.coordinateSpace ?? {
              width: sourceWidth,
              height: sourceHeight,
            },
        },
      )
    },
  )

  const releaseCurrentStream = () => {
    setLiveCaptureCursorRenderMode('baked')
    nativeScreenCaptureSessionRef.current = null
    nativeScreenCaptureStoppingRef.current = false
    nativeScreenCaptureStopHandlerRef.current = null

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }

    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach((track) => track.stop())
      microphoneStreamRef.current = null
    }

    captureDeckPreviewRef.current?.pause()
    if (captureDeckPreviewRef.current) {
      captureDeckPreviewRef.current.srcObject = null
    }

    stageLivePreviewRef.current?.pause()
    if (stageLivePreviewRef.current) {
      stageLivePreviewRef.current.srcObject = null
    }

    if (liveCameraPreviewRef.current) {
      liveCameraPreviewRef.current.pause()
      liveCameraPreviewRef.current.srcObject = null
    }

    cameraRecorderRef.current = null
    cameraFinalizePromiseRef.current = null
    cameraChunksRef.current = []
    microphoneRecorderRef.current = null
    microphoneFinalizePromiseRef.current = null
    microphoneChunksRef.current = []
    systemAudioRecorderRef.current = null
    systemAudioFinalizePromiseRef.current = null
    systemAudioChunksRef.current = []

    recordingStartedAtRef.current = null
    resetCursorTelemetry()
  }

  const listSupportedVideoMimeTypes = (
    hasAudioTrack: boolean,
    contentKind: 'screen' | 'camera' = 'screen',
  ) => {
    const screenPreferredMimeTypes = hasAudioTrack
      ? [
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp9,opus',
          'video/webm',
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=h264,mp4a.40.2',
          'video/mp4',
        ]
      : [
          'video/webm;codecs=vp8',
          'video/webm;codecs=vp9',
          'video/webm',
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4;codecs=h264',
          'video/mp4',
        ]
    const cameraPreferredMimeTypes = hasAudioTrack
      ? [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=h264,mp4a.40.2',
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp9,opus',
          'video/mp4',
          'video/webm',
        ]
      : [
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4;codecs=h264',
          'video/webm;codecs=vp8',
          'video/webm;codecs=vp9',
          'video/mp4',
          'video/webm',
        ]
    const preferredMimeTypes =
      contentKind === 'camera' ? cameraPreferredMimeTypes : screenPreferredMimeTypes

    return preferredMimeTypes.filter((candidate) => MediaRecorder.isTypeSupported(candidate))
  }

  const pickSupportedVideoMimeType = async ({
    hasAudioTrack,
    contentKind = 'screen',
    width,
    height,
    frameRate,
    videoBitsPerSecond,
  }: {
    hasAudioTrack: boolean
    contentKind?: 'screen' | 'camera'
    width: number
    height: number
    frameRate: number
    videoBitsPerSecond?: number
  }) => {
    const supportedMimeTypes = listSupportedVideoMimeTypes(hasAudioTrack, contentKind)

    if (!supportedMimeTypes.length) {
      return ''
    }

    const safeWidth = Math.max(1, Math.round(width || 1))
    const safeHeight = Math.max(1, Math.round(height || 1))
    const safeFrameRate = Math.max(1, Math.round(frameRate || 30))
    const safeBitrate = Math.max(250_000, Math.round(videoBitsPerSecond || 2_500_000))
    const mediaCapabilitiesApi = navigator.mediaCapabilities

    if (!mediaCapabilitiesApi?.encodingInfo) {
      return supportedMimeTypes[0] ?? ''
    }

    const scoredCandidates = await Promise.all(
      supportedMimeTypes.map(async (mimeType, index) => {
        try {
          const result = await mediaCapabilitiesApi.encodingInfo({
            type: 'record',
            video: {
              contentType: mimeType,
              width: safeWidth,
              height: safeHeight,
              bitrate: safeBitrate,
              framerate: safeFrameRate,
            },
          })

          const score =
            (result.supported ? 100 : 0) +
            (result.smooth ? 40 : 0) +
            (result.powerEfficient ? 20 : 0) +
            (contentKind === 'screen'
              ? (mimeType.includes('vp8') ? 20 : 0) +
                (mimeType.includes('vp9') ? 14 : 0) +
                (mimeType.includes('webm') ? 8 : 0) -
                (mimeType.includes('avc1') || mimeType.includes('h264') ? 6 : 0)
              : (mimeType.includes('avc1') || mimeType.includes('h264') ? 10 : 0) +
                (mimeType.includes('vp8') ? 4 : 0)) -
            index

          return {
            mimeType,
            score,
            supported: result.supported,
            smooth: result.smooth,
            powerEfficient: result.powerEfficient,
          }
        } catch (error) {
          console.warn(`mediaCapabilities.encodingInfo failed for ${mimeType}`, error)
          return {
            mimeType,
            score: 10 - index,
            supported: true,
            smooth: false,
            powerEfficient: false,
          }
        }
      }),
    )

    const bestCandidate =
      scoredCandidates
        .filter((candidate) => candidate.supported)
        .sort((left, right) => right.score - left.score)[0] ?? null

    if (bestCandidate) {
      console.info(
        `capture media capability selected content=${contentKind} mime=${bestCandidate.mimeType} smooth=${bestCandidate.smooth} powerEfficient=${bestCandidate.powerEfficient} width=${safeWidth} height=${safeHeight} fps=${safeFrameRate} bitrate=${safeBitrate}`,
      )
      return bestCandidate.mimeType
    }

    return supportedMimeTypes[0] ?? ''
  }

  const pickSupportedAudioMimeType = () => {
    const preferredMimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
    ]

    return preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
  }

  const createConfiguredMediaRecorder = (
    stream: MediaStream,
    options: MediaRecorderOptions,
    label: string,
  ) => {
    const normalizedOptions = Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined && value !== ''),
    ) as MediaRecorderOptions
    const attemptedStrategies = new Set<string>()
    const candidateOptions: Array<{
      strategy: string
      options: MediaRecorderOptions | null
    }> = []
    const pushCandidate = (strategy: string, candidate: MediaRecorderOptions | null) => {
      const key = JSON.stringify(candidate ?? {})

      if (attemptedStrategies.has(`${strategy}:${key}`)) {
        return
      }

      attemptedStrategies.add(`${strategy}:${key}`)
      candidateOptions.push({ strategy, options: candidate })
    }

    const {
      mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond,
    } = normalizedOptions

    pushCandidate('configured', Object.keys(normalizedOptions).length ? normalizedOptions : null)

    if (Number.isFinite(Number(audioBitsPerSecond)) && Number(audioBitsPerSecond) > 0) {
      pushCandidate('no-audio-bitrate', {
        ...(mimeType ? { mimeType } : {}),
        ...(Number.isFinite(Number(videoBitsPerSecond)) && Number(videoBitsPerSecond) > 0
          ? { videoBitsPerSecond: Number(videoBitsPerSecond) }
          : {}),
      })
    }

    if (mimeType) {
      pushCandidate('bitrate-only', {
        ...(Number.isFinite(Number(videoBitsPerSecond)) && Number(videoBitsPerSecond) > 0
          ? { videoBitsPerSecond: Number(videoBitsPerSecond) }
          : {}),
        ...(Number.isFinite(Number(audioBitsPerSecond)) && Number(audioBitsPerSecond) > 0
          ? { audioBitsPerSecond: Number(audioBitsPerSecond) }
          : {}),
      })
      pushCandidate('bitrate-only-no-audio', {
        ...(Number.isFinite(Number(videoBitsPerSecond)) && Number(videoBitsPerSecond) > 0
          ? { videoBitsPerSecond: Number(videoBitsPerSecond) }
          : {}),
      })
      pushCandidate('mime-only', { mimeType })
    }

    pushCandidate('browser-default', null)

    for (const candidate of candidateOptions) {
      try {
        const recorder = candidate.options
          ? new MediaRecorder(stream, candidate.options)
          : new MediaRecorder(stream)
        console.info(
          `${label} recorder accepted strategy=${candidate.strategy} mime=${candidate.options?.mimeType || 'browser-default'} videoBits=${candidate.options?.videoBitsPerSecond || 0} audioBits=${candidate.options?.audioBitsPerSecond || 0}`,
        )
        return recorder
      } catch (error) {
        console.warn(`${label} recorder rejected strategy=${candidate.strategy}`, error)
      }
    }

    return new MediaRecorder(stream)
  }

  const buildVideoRecorderOptions = ({
    mimeType,
    videoBitsPerSecond,
    audioBitsPerSecond,
  }: {
    mimeType: string
    videoBitsPerSecond?: number
    audioBitsPerSecond?: number
  }): MediaRecorderOptions => ({
    ...(mimeType ? { mimeType } : {}),
    ...(Number.isFinite(videoBitsPerSecond) && Number(videoBitsPerSecond) > 0
      ? { videoBitsPerSecond: Math.round(Number(videoBitsPerSecond)) }
      : {}),
    ...(Number.isFinite(audioBitsPerSecond) && Number(audioBitsPerSecond) > 0
      ? { audioBitsPerSecond: Math.round(Number(audioBitsPerSecond)) }
      : {}),
  })

  const buildAudioRecorderOptions = (mimeType: string, audioBitsPerSecond?: number): MediaRecorderOptions => ({
    ...(mimeType ? { mimeType } : {}),
    ...(Number.isFinite(audioBitsPerSecond) && Number(audioBitsPerSecond) > 0
      ? { audioBitsPerSecond: Math.round(Number(audioBitsPerSecond)) }
      : {}),
  })

  const handleStopRecording = () => {
    const recorder = mediaRecorderRef.current
    const cameraRecorder = cameraRecorderRef.current
    const microphoneRecorder = microphoneRecorderRef.current

    if (cameraRecorder && cameraRecorder.state !== 'inactive') {
      cameraRecorder.stop()
    }

    if (microphoneRecorder && microphoneRecorder.state !== 'inactive') {
      microphoneRecorder.stop()
    }

    if (nativeScreenCaptureStopHandlerRef.current) {
      nativeScreenCaptureStopHandlerRef.current()
      return
    }

    if (!recorder || recorder.state === 'inactive') {
      return
    }

    recorder.stop()
  }

  const handleStartRecording = async () => {
    if (!settings || !activeProfile || !selectedSource || !project) {
      return
    }

    if (!settings.capture.selectedSourceId) {
      setErrorMessage('Choose a screen or window source before recording.')
      return
    }

    setIsStartingRecording(true)
    setErrorMessage('')

    try {
      resetCursorTelemetry()

      const primedCapture = window.forkApi.capture.primeSync({
        sourceId: settings.capture.selectedSourceId,
        includeSystemAudio: settings.capture.includeSystemAudio,
      })
      const nativeScreenCaptureEligible = Boolean(
        boot?.ffmpeg.available &&
          primedCapture.sourceKind === 'screen' &&
          /Windows/i.test(navigator.userAgent),
      )
      const previewStagePixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const previewStageWidth =
        stageSurfaceRef.current?.clientWidth && stageSurfaceRef.current.clientWidth > 0
          ? Math.round(stageSurfaceRef.current.clientWidth * previewStagePixelRatio)
          : 0
      const previewStageHeight =
        stageSurfaceRef.current?.clientHeight && stageSurfaceRef.current.clientHeight > 0
          ? Math.round(stageSurfaceRef.current.clientHeight * previewStagePixelRatio)
          : 0
      const nativePreviewMaxWidth = Math.max(1, Math.min(activeProfile.width, 2560))
      const nativePreviewMaxHeight = Math.max(1, Math.min(activeProfile.height, 1440))
      const nativePreviewTargetWidth =
        previewStageWidth > 0
          ? Math.round(previewStageWidth * 1.35)
          : Math.min(activeProfile.width, 1920)
      const nativePreviewTargetHeight =
        previewStageHeight > 0
          ? Math.round(previewStageHeight * 1.35)
          : Math.min(activeProfile.height, 1080)
      const previewCaptureWidth = nativeScreenCaptureEligible
        ? clampNumber(
            nativePreviewTargetWidth,
            Math.min(1280, nativePreviewMaxWidth),
            nativePreviewMaxWidth,
          )
        : activeProfile.width
      const previewCaptureHeight = nativeScreenCaptureEligible
        ? clampNumber(
            nativePreviewTargetHeight,
            Math.min(720, nativePreviewMaxHeight),
            nativePreviewMaxHeight,
          )
        : activeProfile.height
      const previewCaptureFps = nativeScreenCaptureEligible ? Math.min(activeProfile.fps, 60) : activeProfile.fps

      const baseDisplayMediaConstraints = {
        video: {
          frameRate: previewCaptureFps,
          width: { ideal: previewCaptureWidth },
          height: { ideal: previewCaptureHeight },
        },
        audio: settings.capture.includeSystemAudio,
      } satisfies DisplayMediaStreamOptions
      console.info(
        `capture preview constraints nativePreferred=${nativeScreenCaptureEligible} stage=${previewStageWidth}x${previewStageHeight} width=${previewCaptureWidth} height=${previewCaptureHeight} fps=${previewCaptureFps}`,
      )

      let displayStream: MediaStream
      let captureSourcePath = 'display-media'
      const cursorlessVideoConstraints = {
        ...baseDisplayMediaConstraints.video,
        cursor: 'never',
      } as MediaTrackConstraints

      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          ...baseDisplayMediaConstraints,
          video: cursorlessVideoConstraints,
        })
        console.info(
          `capture source stream path=display-media source=${primedCapture.sourceId} kind=${primedCapture.sourceKind}`,
        )
      } catch (error) {
        console.info(
          `capture getDisplayMedia cursor=never failed reason=${error instanceof Error ? error.message : String(error)}`,
        )
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia(baseDisplayMediaConstraints)
          captureSourcePath = 'display-media-default'
          console.info(
            `capture source stream path=display-media-default source=${primedCapture.sourceId} kind=${primedCapture.sourceKind}`,
          )
        } catch (fallbackError) {
          console.info(
            `capture getDisplayMedia default failed reason=${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
          )
          const desktopVideoConstraints: ElectronDesktopMediaTrackConstraints = {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: primedCapture.sourceId,
              minWidth: activeProfile.width,
              maxWidth: activeProfile.width,
              minHeight: activeProfile.height,
              maxHeight: activeProfile.height,
              minFrameRate: activeProfile.fps,
              maxFrameRate: activeProfile.fps,
              googCursorCaptureEnabled: false,
            },
          }
          const desktopAudioConstraints =
            settings.capture.includeSystemAudio && primedCapture.sourceKind === 'screen'
              ? ({
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: primedCapture.sourceId,
                  },
                } as ElectronDesktopMediaTrackConstraints)
              : false

          displayStream = await navigator.mediaDevices.getUserMedia({
            video: desktopVideoConstraints,
            audio: desktopAudioConstraints,
          } as MediaStreamConstraints)
          captureSourcePath = 'desktop-source'
          console.info(
            `capture source stream path=desktop-source source=${primedCapture.sourceId} kind=${primedCapture.sourceKind}`,
          )
        }
      }

      streamRef.current = displayStream
      let cursorCaptureMode = 'unknown'
      let sourceCursorSuppressed = false
      const displayVideoTrack = displayStream.getVideoTracks()[0]
      let displayTrackSettings: (MediaTrackSettings & {
        cursor?: string
        logicalSurface?: boolean
        displaySurface?: string
        screenPixelRatio?: number
      }) | null = null
      if (displayVideoTrack) {
        if ('contentHint' in displayVideoTrack) {
          try {
            displayVideoTrack.contentHint = nativeScreenCaptureEligible ? 'motion' : 'detail'
          } catch (error) {
            console.warn(
              `capture display track contentHint=${nativeScreenCaptureEligible ? 'motion' : 'detail'} failed`,
              error,
            )
          }
        }

        try {
          await displayVideoTrack.applyConstraints({
            frameRate: previewCaptureFps,
            width: { ideal: previewCaptureWidth },
            height: { ideal: previewCaptureHeight },
            cursor: 'never',
          } as MediaTrackConstraints)
        } catch (error) {
          console.info(
            `capture applyConstraints cursor=never failed reason=${error instanceof Error ? error.message : String(error)}`,
          )
        }

        displayTrackSettings = displayVideoTrack.getSettings() as MediaTrackSettings & {
          cursor?: string
          logicalSurface?: boolean
          displaySurface?: string
          screenPixelRatio?: number
        }
        cursorCaptureMode =
          typeof displayTrackSettings.cursor === 'string' ? displayTrackSettings.cursor : 'unknown'
        sourceCursorSuppressed = cursorCaptureMode === 'never'
        console.info(
          `capture display track settings width=${displayTrackSettings.width || 0} height=${displayTrackSettings.height || 0} fps=${displayTrackSettings.frameRate || 0} surface=${displayTrackSettings.displaySurface || 'unknown'} logicalSurface=${displayTrackSettings.logicalSurface === true ? 'true' : displayTrackSettings.logicalSurface === false ? 'false' : 'unknown'} screenPixelRatio=${displayTrackSettings.screenPixelRatio || 0} cursor=${cursorCaptureMode}`,
        )
      }

      const preparedCapture = await window.forkApi.capture.prepare({
        sourceId: settings.capture.selectedSourceId,
        includeSystemAudio: settings.capture.includeSystemAudio,
      })
      const trackWidth = Number(displayTrackSettings?.width)
      const trackHeight = Number(displayTrackSettings?.height)
      const trackScreenPixelRatio = Number(displayTrackSettings?.screenPixelRatio)
      const derivedCursorCoordinateSpace =
        Number.isFinite(trackWidth) &&
        trackWidth > 0 &&
        Number.isFinite(trackHeight) &&
        trackHeight > 0 &&
        Number.isFinite(trackScreenPixelRatio) &&
        trackScreenPixelRatio > 0
          ? {
              width: Math.max(
                1,
                Math.round(trackWidth / trackScreenPixelRatio),
              ),
              height: Math.max(
                1,
                Math.round(trackHeight / trackScreenPixelRatio),
              ),
            }
          : null
      const effectiveCursorCoordinateSpace =
        derivedCursorCoordinateSpace ?? preparedCapture.cursorCoordinateSpace ?? null
      liveCursorCoordinateSpaceRef.current = effectiveCursorCoordinateSpace
      console.info(
        `capture cursor coordinateSpace=${effectiveCursorCoordinateSpace?.width || 0}x${effectiveCursorCoordinateSpace?.height || 0}`,
      )

      const nextLiveCaptureCursorRenderMode: CursorRenderMode =
        sourceCursorSuppressed && activeCursorSettings.showCursor && preparedCapture.cursorTrackingAvailable
          ? 'overlay'
          : 'baked'
      setLiveCaptureCursorRenderMode(nextLiveCaptureCursorRenderMode)
      console.info(
        `capture stream assessment path=${captureSourcePath} sourceCursorSuppressed=${sourceCursorSuppressed} liveCursorMode=${nextLiveCaptureCursorRenderMode}`,
      )

      chunksRef.current = []

      let activeMicrophoneLabel = ''
      let activeMicrophoneStream: MediaStream | null = null

      if (settings.capture.includeMicrophone) {
        const requestedMicrophoneId = settings.capture.microphoneDeviceId || microphoneDevices[0]?.deviceId || ''
        activeMicrophoneStream = await navigator.mediaDevices.getUserMedia({
          audio: requestedMicrophoneId
            ? {
                deviceId: { ideal: requestedMicrophoneId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
          video: false,
        })
        microphoneStreamRef.current = activeMicrophoneStream
        activeMicrophoneLabel =
          activeMicrophoneStream.getAudioTracks()[0]?.label || resolveMicrophoneDeviceLabel(settings, microphoneDevices)

        const refreshedAudioDevices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        setCameraDevices(refreshedAudioDevices.filter((device) => device.kind === 'videoinput'))
        setMicrophoneDevices(refreshedAudioDevices.filter((device) => device.kind === 'audioinput'))
      }

      if (captureDeckPreviewRef.current) {
        captureDeckPreviewRef.current.pause()
        captureDeckPreviewRef.current.srcObject = null
      }

      if (stageLivePreviewRef.current) {
        stageLivePreviewRef.current.srcObject = displayStream
        stageLivePreviewRef.current.muted = true
        await stageLivePreviewRef.current.play().catch(() => undefined)
      }

      const recordingStream = displayStream
      console.info(
        `capture recorder using raw display stream source=${displayVideoTrack?.getSettings?.().width || activeProfile.width}x${displayVideoTrack?.getSettings?.().height || activeProfile.height} fps=${activeProfile.fps} cursorMode=${sourceCursorSuppressed ? 'suppressed' : 'baked-at-source'}`,
      )

      if (activeMicrophoneStream) {
        microphoneChunksRef.current = []
        const microphoneMimeType = pickSupportedAudioMimeType()
        const microphoneRecorder = createConfiguredMediaRecorder(
          activeMicrophoneStream,
          buildAudioRecorderOptions(microphoneMimeType, 128_000),
          'microphone',
        )
        microphoneRecorderRef.current = microphoneRecorder

        let microphoneRecordedChunkCount = 0
        let microphoneRecordedBytes = 0
        const activeMicrophoneDeviceId =
          settings.capture.microphoneDeviceId || activeMicrophoneStream.getAudioTracks()[0]?.getSettings?.().deviceId || ''

        microphoneFinalizePromiseRef.current = new Promise((resolve) => {
          let settled = false
          const settle = (value: {
            blob: Blob
            mimeType: string
            deviceId: string
            deviceLabel: string
          } | null) => {
            if (settled) {
              return
            }

            settled = true
            resolve(value)
          }

          microphoneRecorder.onstart = () => {
            console.info(
              `microphone recorder started actualAudioBitrate=${microphoneRecorder.audioBitsPerSecond || 0} mime=${microphoneRecorder.mimeType || 'browser-default'}`,
            )
          }

          microphoneRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              microphoneChunksRef.current.push(event.data)
              microphoneRecordedChunkCount += 1
              microphoneRecordedBytes += event.data.size
            }
          }

          microphoneRecorder.onerror = (event) => {
            console.error(`microphone recorder error: ${event.error?.message ?? 'Unknown failure'}`)
            settle(null)
          }

          microphoneRecorder.onstop = async () => {
            try {
              await new Promise((resolveStop) => window.setTimeout(resolveStop, 0))
              const blob = new Blob(microphoneChunksRef.current, {
                type: microphoneRecorder.mimeType || 'audio/webm',
              })

              console.info(
                `microphone recorder finalized chunks=${microphoneRecordedChunkCount} bytes=${microphoneRecordedBytes} blobBytes=${blob.size} mime=${blob.type || 'audio/webm'}`,
              )

              if (!blob.size) {
                settle(null)
                return
              }

              settle({
                blob,
                mimeType: blob.type || microphoneRecorder.mimeType || 'audio/webm',
                deviceId: activeMicrophoneDeviceId,
                deviceLabel: activeMicrophoneLabel || activeMicrophoneDeviceLabel,
              })
            } catch {
              settle(null)
            }
          }
        })
      }

      let activeCameraDeviceId = ''
      let activeCameraDeviceLabel = ''

      if (activeCameraSettings.enabled) {
        const requestedDeviceId = activeCameraSettings.deviceId || cameraDevices[0]?.deviceId || ''
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: requestedDeviceId
            ? {
                deviceId: { ideal: requestedDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 30 },
              }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 30 },
              },
          audio: false,
        })

        cameraStreamRef.current = cameraStream
        cameraChunksRef.current = []

        const cameraTrack = cameraStream.getVideoTracks()[0]
        if (cameraTrack && 'contentHint' in cameraTrack) {
          try {
            cameraTrack.contentHint = 'motion'
          } catch (error) {
            console.warn('camera track contentHint=motion failed', error)
          }
        }
        activeCameraDeviceId = requestedDeviceId || cameraTrack?.getSettings?.().deviceId || ''
        activeCameraDeviceLabel = cameraTrack?.label || resolveCameraDeviceLabel(activeCameraSettings, cameraDevices)

        if (liveCameraPreviewRef.current) {
          liveCameraPreviewRef.current.srcObject = cameraStream
          liveCameraPreviewRef.current.muted = true
          await liveCameraPreviewRef.current.play().catch(() => undefined)
        }

        const refreshedDevices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        setCameraDevices(refreshedDevices.filter((device) => device.kind === 'videoinput'))
        setMicrophoneDevices(refreshedDevices.filter((device) => device.kind === 'audioinput'))

        const cameraMimeType = await pickSupportedVideoMimeType({
          hasAudioTrack: false,
          contentKind: 'camera',
          width: 1280,
          height: 720,
          frameRate: 30,
          videoBitsPerSecond: 6_000_000,
        })
        const cameraRecorder = createConfiguredMediaRecorder(
          cameraStream,
          buildVideoRecorderOptions({
            mimeType: cameraMimeType,
            videoBitsPerSecond: 6_000_000,
          }),
          'camera',
        )
        cameraRecorderRef.current = cameraRecorder

        let cameraRecordedChunkCount = 0
        let cameraRecordedBytes = 0

        cameraFinalizePromiseRef.current = new Promise((resolve) => {
          let settled = false
          const settle = (value: {
            blob: Blob
            mimeType: string
            deviceId: string
            deviceLabel: string
          } | null) => {
            if (settled) {
              return
            }

            settled = true
            resolve(value)
          }

          cameraRecorder.onstart = () => {
            console.info(
              `camera recorder started actualVideoBitrate=${cameraRecorder.videoBitsPerSecond || 0} mime=${cameraRecorder.mimeType || 'browser-default'}`,
            )
          }

          cameraRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              cameraChunksRef.current.push(event.data)
              cameraRecordedChunkCount += 1
              cameraRecordedBytes += event.data.size
            }
          }

          cameraRecorder.onerror = (event) => {
            console.error(`camera recorder error: ${event.error?.message ?? 'Unknown failure'}`)
            settle(null)
          }

          cameraRecorder.onstop = async () => {
            try {
              await new Promise((resolveStop) => window.setTimeout(resolveStop, 0))
              const blob = new Blob(cameraChunksRef.current, {
                type: cameraRecorder.mimeType || 'video/webm',
              })

              console.info(
                `camera recorder finalized chunks=${cameraRecordedChunkCount} bytes=${cameraRecordedBytes} blobBytes=${blob.size} mime=${blob.type || 'video/webm'}`,
              )

              if (!blob.size) {
                settle(null)
                return
              }

              settle({
                blob,
                mimeType: blob.type || cameraRecorder.mimeType || 'video/webm',
                deviceId: activeCameraDeviceId,
                deviceLabel: activeCameraDeviceLabel,
              })
            } catch {
              settle(null)
            }
          }
        })
      }

      const captureFileName = `take-${sanitizeExportName(selectedSource.name.toLowerCase()) || 'capture'}-${new Date()
        .toISOString()
        .replaceAll(':', '-')
        .slice(0, 19)}`
      const captureLabel = `${selectedSource.name} / ${activeMotionPreset?.label ?? 'motion take'}`
      const stopSupplementalRecorders = () => {
        const currentCameraRecorder = cameraRecorderRef.current
        const currentMicrophoneRecorder = microphoneRecorderRef.current
        const currentSystemAudioRecorder = systemAudioRecorderRef.current

        if (currentCameraRecorder && currentCameraRecorder.state !== 'inactive') {
          currentCameraRecorder.stop()
        }

        if (currentMicrophoneRecorder && currentMicrophoneRecorder.state !== 'inactive') {
          currentMicrophoneRecorder.stop()
        }

        if (currentSystemAudioRecorder && currentSystemAudioRecorder.state !== 'inactive') {
          currentSystemAudioRecorder.stop()
        }
      }
      const startSupplementalRecorders = () => {
        if (cameraRecorderRef.current && cameraRecorderRef.current.state === 'inactive') {
          cameraRecorderRef.current.start(1000)
        }

        if (microphoneRecorderRef.current && microphoneRecorderRef.current.state === 'inactive') {
          microphoneRecorderRef.current.start(1000)
        }

        if (systemAudioRecorderRef.current && systemAudioRecorderRef.current.state === 'inactive') {
          systemAudioRecorderRef.current.start(1000)
        }
      }
      const finalizeCaptureTake = async ({
        mimeType,
        buffer,
        existingFilePath,
        recordedSourceCursorSuppressed,
        recordedDurationSeconds,
      }: {
        mimeType: string
        buffer?: ArrayBuffer
        existingFilePath?: string
        recordedSourceCursorSuppressed: boolean
        recordedDurationSeconds?: number
      }) => {
        const durationSeconds =
          Number.isFinite(recordedDurationSeconds) && Number(recordedDurationSeconds) > 0
            ? Number(Number(recordedDurationSeconds).toFixed(3))
            : recordingStartedAtRef.current
              ? Number(Math.max(0.05, (Date.now() - recordingStartedAtRef.current) / 1000).toFixed(3))
              : Number(Math.max(0.05, recordingSeconds).toFixed(3))
        const cursorTrack = buildRecordedCursorTrack(selectedSource.kind)
        const keyboardShortcuts = buildRecordedKeyboardShortcuts()
        const autoFocusRegions = buildAutomaticFocusRegions(
          cursorTrack,
          settings.capture.autoZoomMode,
          durationSeconds,
        )
        const cameraRecording = cameraFinalizePromiseRef.current
          ? await cameraFinalizePromiseRef.current
          : null
        const microphoneRecording = microphoneFinalizePromiseRef.current
          ? await microphoneFinalizePromiseRef.current
          : null
        const systemAudioRecording = systemAudioFinalizePromiseRef.current
          ? await systemAudioFinalizePromiseRef.current
          : null
        const cameraPayload =
          cameraRecording && cameraRecording.blob.size
            ? {
                buffer: await cameraRecording.blob.arrayBuffer(),
                mimeType: cameraRecording.mimeType,
                fileName: `${captureFileName}-camera`,
                deviceId: cameraRecording.deviceId,
                deviceLabel: cameraRecording.deviceLabel,
              }
            : null
        const microphonePayload =
          microphoneRecording && microphoneRecording.blob.size
            ? {
                buffer: await microphoneRecording.blob.arrayBuffer(),
                mimeType: microphoneRecording.mimeType,
                fileName: `${captureFileName}-microphone`,
                deviceId: microphoneRecording.deviceId,
                deviceLabel: microphoneRecording.deviceLabel,
              }
            : null
        const systemAudioPayload =
          systemAudioRecording && systemAudioRecording.blob.size
            ? {
                buffer: await systemAudioRecording.blob.arrayBuffer(),
                mimeType: systemAudioRecording.mimeType,
                fileName: `${captureFileName}-system-audio`,
              }
            : null
        const saved = await window.forkApi.capture.saveRecording({
          ...(buffer ? { buffer } : {}),
          ...(existingFilePath ? { existingFilePath } : {}),
          mimeType,
          fileName: captureFileName,
          systemAudio: systemAudioPayload,
          camera: cameraPayload,
          microphone: microphonePayload,
          clip: {
            label: captureLabel,
            thumbnailDataUrl: selectedSource.thumbnailDataUrl,
            durationSeconds,
            source: {
              id: selectedSource.id,
              name: selectedSource.name,
              kind: selectedSource.kind,
            },
            captureProfile: {
              qualityProfileId: activeProfile.id,
              qualityProfileLabel: activeProfile.label,
              motionPresetId: activeMotionPreset?.id ?? settings.capture.motionPresetId,
              motionPresetLabel: activeMotionPreset?.label ?? 'Custom Motion',
              includeSystemAudio: settings.capture.includeSystemAudio,
            },
            cursorRenderMode:
              recordedSourceCursorSuppressed && activeCursorSettings.showCursor && cursorTrack ? 'overlay' : 'baked',
            cursorTrack,
            keyboardShortcuts,
            focusRegions: autoFocusRegions,
            notes: '',
          },
        })

        setProject(saved.project)
        void refreshProjectLibrary()
        setLastSavedPath(saved.filePath)
        setLastSavedSize(saved.size)
        setStatusLine(
          cursorTrack
            ? `Capture saved and attached to the active project: ${saved.clip.label}. ${cursorTrack.points.length} cursor sample(s) captured${keyboardShortcuts.length ? `, ${keyboardShortcuts.length} keyboard shortcut timestamp(s) logged` : ''}${autoFocusRegions.length ? ` and ${autoFocusRegions.length} smart zoom block(s) seeded` : ''}${saved.clip.cameraTake ? ', with camera overlay' : ''}${saved.clip.microphoneTake ? ', plus isolated voice stem' : settings.capture.includeMicrophone ? ', but the microphone stem could not be isolated' : ''}.`
            : `Capture saved and attached to the active project: ${saved.clip.label}${keyboardShortcuts.length ? ` with ${keyboardShortcuts.length} keyboard shortcut timestamp(s)` : ''}${saved.clip.cameraTake ? ' with camera overlay' : ''}${saved.clip.microphoneTake ? ' plus isolated voice stem' : settings.capture.includeMicrophone ? ' without an isolated microphone stem' : ''}.`,
        )
      }

      let nativeScreenCaptureStarted: Awaited<
        ReturnType<typeof window.forkApi.capture.startNativeScreenRecording>
      > | null = null

      if (nativeScreenCaptureEligible) {
        try {
          nativeScreenCaptureStarted = await window.forkApi.capture.startNativeScreenRecording({
            sourceId: primedCapture.sourceId,
            width: activeProfile.width,
            height: activeProfile.height,
            fps: activeProfile.fps,
            videoBitsPerSecond: activeProfile.videoBitsPerSecond,
            fileName: captureFileName,
          })
          nativeScreenCaptureSessionRef.current = nativeScreenCaptureStarted
          console.info(
            `native capture engaged engine=${nativeScreenCaptureStarted.engine} encoder=${nativeScreenCaptureStarted.encoder} path=${nativeScreenCaptureStarted.filePath}`,
          )
        } catch (error) {
          console.warn(
            `native capture unavailable, falling back to browser recorder reason=${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      if (nativeScreenCaptureStarted && recordingStream.getAudioTracks().length > 0) {
        systemAudioChunksRef.current = []
        const systemAudioStream = new MediaStream(recordingStream.getAudioTracks())
        const systemAudioMimeType = pickSupportedAudioMimeType()
        const systemAudioRecorder = createConfiguredMediaRecorder(
          systemAudioStream,
          buildAudioRecorderOptions(systemAudioMimeType, 192_000),
          'system-audio',
        )
        systemAudioRecorderRef.current = systemAudioRecorder

        let systemAudioRecordedChunkCount = 0
        let systemAudioRecordedBytes = 0

        systemAudioFinalizePromiseRef.current = new Promise((resolve) => {
          let settled = false
          const settle = (value: { blob: Blob; mimeType: string } | null) => {
            if (settled) {
              return
            }

            settled = true
            resolve(value)
          }

          systemAudioRecorder.onstart = () => {
            console.info(
              `system audio recorder started actualAudioBitrate=${systemAudioRecorder.audioBitsPerSecond || 0} mime=${systemAudioRecorder.mimeType || 'browser-default'}`,
            )
          }

          systemAudioRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              systemAudioChunksRef.current.push(event.data)
              systemAudioRecordedChunkCount += 1
              systemAudioRecordedBytes += event.data.size
            }
          }

          systemAudioRecorder.onerror = (event) => {
            console.error(`system audio recorder error: ${event.error?.message ?? 'Unknown failure'}`)
            settle(null)
          }

          systemAudioRecorder.onstop = async () => {
            try {
              await new Promise((resolveStop) => window.setTimeout(resolveStop, 0))
              const blob = new Blob(systemAudioChunksRef.current, {
                type: systemAudioRecorder.mimeType || 'audio/webm',
              })

              console.info(
                `system audio recorder finalized chunks=${systemAudioRecordedChunkCount} bytes=${systemAudioRecordedBytes} blobBytes=${blob.size} mime=${blob.type || 'audio/webm'}`,
              )

              if (!blob.size) {
                settle(null)
                return
              }

              settle({
                blob,
                mimeType: blob.type || systemAudioRecorder.mimeType || 'audio/webm',
              })
            } catch {
              settle(null)
            } finally {
              systemAudioStream.getTracks().forEach((track) => track.stop())
            }
          }
        })
      } else {
        systemAudioRecorderRef.current = null
        systemAudioFinalizePromiseRef.current = null
        systemAudioChunksRef.current = []
      }

      const stopNativeScreenCaptureAndFinalize = () => {
        if (nativeScreenCaptureStoppingRef.current) {
          return
        }

        nativeScreenCaptureStoppingRef.current = true
        nativeScreenCaptureStopHandlerRef.current = null
        stopSupplementalRecorders()
        stopRecorderTimer()
        stopCursorTelemetry()
        setIsRecording(false)

        void (async () => {
          try {
            await new Promise((resolve) => window.setTimeout(resolve, 0))
            const session = nativeScreenCaptureSessionRef.current

            if (!session) {
              throw new Error('Native screen capture session is missing.')
            }

            const nativeCaptureResult = await window.forkApi.capture.stopNativeScreenRecording({
              sessionId: session.sessionId,
            })
            console.info(
              `native capture finalized engine=${nativeCaptureResult.engine} encoder=${nativeCaptureResult.encoder} path=${nativeCaptureResult.filePath} bytes=${nativeCaptureResult.size}`,
            )

            await finalizeCaptureTake({
              existingFilePath: nativeCaptureResult.filePath,
              mimeType: nativeCaptureResult.mimeType,
              recordedSourceCursorSuppressed: true,
              recordedDurationSeconds: nativeCaptureResult.durationSeconds,
            })
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Recording finished, but the file could not be saved as a renderable take.'
            setErrorMessage(message)
            setStatusLine('Capture stopped, but the take was not finalized into a usable media file.')
          } finally {
            nativeScreenCaptureSessionRef.current = null
            nativeScreenCaptureStoppingRef.current = false
            releaseCurrentStream()
          }
        })()
      }

      displayStream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (nativeScreenCaptureStopHandlerRef.current) {
            nativeScreenCaptureStopHandlerRef.current()
            return
          }

          const currentRecorder = mediaRecorderRef.current
          stopSupplementalRecorders()
          if (currentRecorder && currentRecorder.state !== 'inactive') {
            currentRecorder.stop()
          }
        })
      })

      if (nativeScreenCaptureStarted) {
        recordingStartedAtRef.current =
          Number.isFinite(nativeScreenCaptureStarted.startedAtMs) && nativeScreenCaptureStarted.startedAtMs > 0
            ? nativeScreenCaptureStarted.startedAtMs
            : Date.now()
        startRecorderTimer()
        setIsRecording(true)
        startSupplementalRecorders()
        await startCursorTelemetry(
          preparedCapture.cursorTrackingAvailable,
          preparedCapture.keyboardTrackingAvailable,
        )
        mediaRecorderRef.current = null
        nativeScreenCaptureStopHandlerRef.current = stopNativeScreenCaptureAndFinalize
        setStatusLine(
          preparedCapture.cursorTrackingAvailable
            ? `Recording ${activeProfile.label} with ${activeMotionPreset?.label ?? 'custom motion'} via native Windows capture${activeCameraSettings.enabled ? ` and ${activeCameraDeviceLabel || 'camera presenter'}` : ''}${settings.capture.includeMicrophone ? ` plus ${activeMicrophoneLabel || activeMicrophoneDeviceLabel}` : ''}${preparedCapture.keyboardTrackingAvailable ? ', live cursor telemetry, and keyboard shortcut tracking.' : ' and live cursor telemetry.'}`
            : `Recording ${activeProfile.label} with ${activeMotionPreset?.label ?? 'custom motion'} via native Windows capture${activeCameraSettings.enabled ? ` and ${activeCameraDeviceLabel || 'camera presenter'}` : ''}${settings.capture.includeMicrophone ? ` plus ${activeMicrophoneLabel || activeMicrophoneDeviceLabel}` : ''}${preparedCapture.keyboardTrackingAvailable ? ' and keyboard shortcut tracking in video-only mode.' : ' in video-only mode.'}`,
        )
        return
      }

      const hasAudioTrack = recordingStream.getAudioTracks().length > 0
      const mimeType = await pickSupportedVideoMimeType({
        hasAudioTrack,
        contentKind: 'screen',
        width: Number(displayVideoTrack?.getSettings?.().width) || activeProfile.width,
        height: Number(displayVideoTrack?.getSettings?.().height) || activeProfile.height,
        frameRate: Number(displayVideoTrack?.getSettings?.().frameRate) || activeProfile.fps,
        videoBitsPerSecond: activeProfile.videoBitsPerSecond,
      })
      console.info(
        `capture recorder configured audioTracks=${recordingStream.getAudioTracks().length} videoTracks=${recordingStream.getVideoTracks().length} mime=${mimeType || 'browser-default'} targetVideoBitrate=${activeProfile.videoBitsPerSecond} targetAudioBitrate=${hasAudioTrack ? 192000 : 0}`,
      )

      const recorder = createConfiguredMediaRecorder(
        recordingStream,
        buildVideoRecorderOptions({
          mimeType,
          videoBitsPerSecond: activeProfile.videoBitsPerSecond,
          audioBitsPerSecond: hasAudioTrack ? 192_000 : undefined,
        }),
        'capture',
      )

      mediaRecorderRef.current = recorder

      let recordedChunkCount = 0
      let recordedBytes = 0
      let resolveRecorderStarted: (() => void) | null = null
      let rejectRecorderStarted: ((error: Error) => void) | null = null
      const recorderStartedPromise = new Promise<void>((resolve, reject) => {
        resolveRecorderStarted = resolve
        rejectRecorderStarted = reject
      })

      recorder.onstart = () => {
        recordingStartedAtRef.current = Date.now()
        startRecorderTimer()
        setIsRecording(true)
        console.info(
          `capture recorder started actualVideoBitrate=${recorder.videoBitsPerSecond || 0} actualAudioBitrate=${recorder.audioBitsPerSecond || 0} mime=${recorder.mimeType || 'browser-default'}`,
        )
        resolveRecorderStarted?.()
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
          recordedChunkCount += 1
          recordedBytes += event.data.size
        }
      }

      recorder.onerror = (event) => {
        setErrorMessage(`Recorder error: ${event.error?.message ?? 'Unknown failure'}`)
        rejectRecorderStarted?.(new Error(event.error?.message ?? 'Unknown failure'))
      }

      recorder.onstop = async () => {
        stopRecorderTimer()
        stopCursorTelemetry()
        setIsRecording(false)
        mediaRecorderRef.current = null

        try {
          await new Promise((resolve) => window.setTimeout(resolve, 0))

          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || 'video/webm',
          })
          console.info(
            `capture recorder finalized chunks=${recordedChunkCount} bytes=${recordedBytes} blobBytes=${blob.size} mime=${blob.type || 'video/webm'}`,
          )

          if (!blob.size) {
            throw new Error('Recording finished without any video data. Start a new take and try again.')
          }

          const arrayBuffer = await blob.arrayBuffer()
          console.info(
            `capture recorder payload bytes=${arrayBuffer.byteLength} head=${describeByteSignature(arrayBuffer) || 'empty'}`,
          )

          await finalizeCaptureTake({
            buffer: arrayBuffer,
            mimeType: blob.type,
            recordedSourceCursorSuppressed: sourceCursorSuppressed,
          })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Recording finished, but the file could not be saved as a renderable take.'
          setErrorMessage(message)
          setStatusLine('Capture stopped, but the take was not finalized into a usable media file.')
        } finally {
          releaseCurrentStream()
        }
      }

      startSupplementalRecorders()
      recorder.start(1000)
      await recorderStartedPromise
      await startCursorTelemetry(
        preparedCapture.cursorTrackingAvailable,
        preparedCapture.keyboardTrackingAvailable,
      )
      setStatusLine(
        preparedCapture.cursorTrackingAvailable
          ? `Recording ${activeProfile.label} with ${activeMotionPreset?.label ?? 'custom motion'}${activeCameraSettings.enabled ? ` and ${activeCameraDeviceLabel || 'camera presenter'}` : ''}${settings.capture.includeMicrophone ? ` plus ${activeMicrophoneLabel || activeMicrophoneDeviceLabel}` : ''}${preparedCapture.keyboardTrackingAvailable ? ', live cursor telemetry, and keyboard shortcut tracking.' : ' and live cursor telemetry.'}`
          : `Recording ${activeProfile.label} with ${activeMotionPreset?.label ?? 'custom motion'}${activeCameraSettings.enabled ? ` and ${activeCameraDeviceLabel || 'camera presenter'}` : ''}${settings.capture.includeMicrophone ? ` plus ${activeMicrophoneLabel || activeMicrophoneDeviceLabel}` : ''}${preparedCapture.keyboardTrackingAvailable ? ' and keyboard shortcut tracking in video-only mode.' : ' in video-only mode.'}`,
      )
    } catch (error) {
      if (nativeScreenCaptureSessionRef.current && !nativeScreenCaptureStoppingRef.current) {
        try {
          nativeScreenCaptureStoppingRef.current = true
          await window.forkApi.capture.stopNativeScreenRecording({
            sessionId: nativeScreenCaptureSessionRef.current.sessionId,
          })
        } catch (nativeStopError) {
          console.warn('native capture startup cleanup failed', nativeStopError)
        }
      }
      releaseCurrentStream()
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start recording')
    } finally {
      setIsStartingRecording(false)
    }
  }

  const selectClip = async (clipId: string) => {
    if (!project) {
      return
    }

    const linkedTimelineItem =
      project.timeline.items.find((item) => item.clipId === clipId && !isHiddenTranscriptCutTimelineItem(item)) ??
      project.timeline.items.find((item) => item.clipId === clipId)

    const optimisticProject = mergeProject(project, {
      timeline: {
        activeClipId: clipId,
        activeItemId: linkedTimelineItem?.id ?? project.timeline.activeItemId,
      },
    })

    setProject(optimisticProject)
    const saved = await persistProject(
      {
        timeline: {
          activeClipId: clipId,
          activeItemId: linkedTimelineItem?.id ?? project.timeline.activeItemId,
        },
      },
      'Clip focused in project timeline.',
    )

    if (saved) {
      setProject(saved)
    }
  }

  const applyTimelinePatch = async (
    timelinePatch: ProjectPatch['timeline'],
    successMessage?: string,
  ) => {
    if (!project) {
      return null
    }

    const optimisticProject = mergeProject(project, {
      timeline: timelinePatch,
    })

    setProject(optimisticProject)
    return persistProject(
      {
        timeline: timelinePatch,
      },
      successMessage,
    )
  }

  const selectTimelineItem = async (itemId: string) => {
    if (!project) {
      return
    }

    const item = project.timeline.items.find((candidate) => candidate.id === itemId)
    if (!item) {
      return
    }

    await applyTimelinePatch(
      {
        activeItemId: item.id,
        activeClipId: item.clipId,
      },
      `Timeline item "${item.label}" focused.`,
    )
  }

  const addClipToTimeline = async (clip: ProjectClip) => {
    if (!project) {
      return
    }

    const nextItem = createTimelineItemFromClip(clip)
    await applyTimelinePatch(
      {
        items: [...project.timeline.items, nextItem],
        activeItemId: nextItem.id,
        activeClipId: clip.id,
      },
      `Added "${clip.label}" to timeline.`,
    )
  }

  const duplicateTimelineItem = async (itemId: string) => {
    if (!project) {
      return
    }

    const itemIndex = project.timeline.items.findIndex((item) => item.id === itemId)
    if (itemIndex === -1) {
      return
    }

    const sourceItem = project.timeline.items[itemIndex]
    const duplicateItem: ProjectTimelineItem = {
      ...sourceItem,
      id: crypto.randomUUID(),
      label: `${sourceItem.label} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const nextItems = [...project.timeline.items]
    nextItems.splice(itemIndex + 1, 0, duplicateItem)

    await applyTimelinePatch(
      {
        items: nextItems,
        activeItemId: duplicateItem.id,
        activeClipId: duplicateItem.clipId,
      },
      'Timeline item duplicated.',
    )
  }

  const reorderTimelineItem = async (itemId: string, targetIndex: number) => {
    if (!project) {
      return
    }

    const index = project.timeline.items.findIndex((item) => item.id === itemId)

    if (
      index === -1 ||
      targetIndex < 0 ||
      targetIndex >= project.timeline.items.length ||
      targetIndex === index
    ) {
      return
    }

    const nextItems = [...project.timeline.items]
    const [movedItem] = nextItems.splice(index, 1)
    nextItems.splice(targetIndex, 0, movedItem)

    await applyTimelinePatch(
      {
        items: nextItems,
      },
      'Timeline order updated.',
    )
  }

  const moveTimelineItem = async (itemId: string, direction: -1 | 1) => {
    if (!project) {
      return
    }

    const index = project.timeline.items.findIndex((item) => item.id === itemId)
    await reorderTimelineItem(itemId, index + direction)
  }

  const removeTimelineItem = async (itemId: string) => {
    if (!project) {
      return
    }

    const nextItems = project.timeline.items.filter((item) => item.id !== itemId)
    const nextActiveItem = nextItems[0]

    await applyTimelinePatch(
      {
        items: nextItems,
        activeItemId: nextActiveItem?.id ?? '',
        activeClipId: nextActiveItem?.clipId ?? project.timeline.activeClipId,
      },
      'Timeline item removed.',
    )
  }

  const commitTimelineItemLabel = async (itemId: string, rawLabel: string) => {
    if (!project) {
      return
    }

    const item = project.timeline.items.find((candidate) => candidate.id === itemId)
    if (!item) {
      return
    }

    const nextLabel = rawLabel.trim() || item.label
    if (nextLabel === item.label) {
      return
    }

    await applyTimelinePatch(
      {
        items: replaceTimelineItem(project, {
          ...item,
          label: nextLabel,
          updatedAt: new Date().toISOString(),
        }),
      },
      'Timeline label updated.',
    )
  }

  const setTimelineItemTrim = async (
    itemId: string,
    nextStartCandidate: number,
    nextEndCandidate: number | null,
    successMessage = 'Timeline trim updated.',
  ) => {
    if (!project) {
      return
    }

    const item = project.timeline.items.find((candidate) => candidate.id === itemId)
    const clip = item ? clipsById.get(item.clipId) : undefined

    if (!item || !clip) {
      return
    }

    const maxDuration = clip.trim.endSeconds ?? clip.durationSeconds
    const nextStart = clampNumber(nextStartCandidate, 0, maxDuration)
    const nextEndRaw =
      nextEndCandidate === null
        ? maxDuration
        : clampNumber(nextEndCandidate, nextStart, maxDuration)
    const nextEnd = nextEndRaw >= maxDuration ? maxDuration : nextEndRaw

    if (nextStart === item.trimStartSeconds && nextEnd === item.trimEndSeconds) {
      return
    }

    await applyTimelinePatch(
      {
        items: replaceTimelineItem(project, {
          ...item,
          trimStartSeconds: nextStart,
          trimEndSeconds: nextEnd,
          updatedAt: new Date().toISOString(),
        }),
      },
      successMessage,
    )
  }

  const commitTimelineTrim = async (
    itemId: string,
    field: 'trimStartSeconds' | 'trimEndSeconds',
    rawValue: string,
  ) => {
    if (!project) {
      return
    }

    const item = project.timeline.items.find((candidate) => candidate.id === itemId)
    const clip = item ? clipsById.get(item.clipId) : undefined
    if (!item || !clip) {
      return
    }

    const parsedValue = parseSecondsInput(rawValue)
    if (parsedValue === undefined) {
      setErrorMessage('Timeline trim values must be positive numbers.')
      return
    }

    await setTimelineItemTrim(
      itemId,
      field === 'trimStartSeconds' ? parsedValue ?? 0 : item.trimStartSeconds,
      field === 'trimEndSeconds' ? parsedValue : item.trimEndSeconds,
    )
  }

  const toggleTimelineItem = async (itemId: string, enabled: boolean) => {
    if (!project) {
      return
    }

    const item = project.timeline.items.find((candidate) => candidate.id === itemId)
    if (!item || item.enabled === enabled) {
      return
    }

    await applyTimelinePatch(
      {
        items: replaceTimelineItem(project, {
          ...item,
          enabled,
          updatedAt: new Date().toISOString(),
        }),
      },
      enabled ? 'Timeline item enabled.' : 'Timeline item muted from sequence export.',
    )
  }

  const commitSelectedTimelineTrimDraft = async () => {
    if (!selectedTimelineItem) {
      return
    }

    await setTimelineItemTrim(
      selectedTimelineItem.id,
      timelineTrimDraft.startSeconds,
      timelineTrimDraft.endSeconds,
      'Timeline trim handles updated.',
    )
  }

  const resetSelectedTimelineTrim = async () => {
    if (!selectedTimelineItem || !selectedTimelineClip) {
      return
    }

    const maxDuration = selectedTimelineClip.trim.endSeconds ?? selectedTimelineClip.durationSeconds

    setTimelineTrimDraft({
      startSeconds: 0,
      endSeconds: maxDuration,
    })

    await setTimelineItemTrim(selectedTimelineItem.id, 0, maxDuration, 'Timeline trim reset to full take.')
  }

  const splitTimelineItemAtPlayhead = async (itemId: string) => {
    if (!project) {
      return
    }

    const segment = timelineSequence.find((candidate) => candidate.item.id === itemId)

    if (!segment || !segment.clip) {
      return
    }

    const localPlayhead = timelinePlayheadSeconds - segment.startSeconds

    if (localPlayhead <= 0.15 || localPlayhead >= segment.bounds.durationSeconds - 0.15) {
      setErrorMessage('Move the playhead inside the selected item before splitting.')
      return
    }

    const splitPoint = Number((segment.bounds.startSeconds + localPlayhead).toFixed(3))
    const timestamp = new Date().toISOString()
    const nextItems = [...project.timeline.items]
    const firstItem: ProjectTimelineItem = {
      ...segment.item,
      trimEndSeconds: splitPoint,
      updatedAt: timestamp,
    }
    const secondItem: ProjectTimelineItem = {
      ...segment.item,
      id: crypto.randomUUID(),
      label: `${segment.item.label} Part 2`,
      trimStartSeconds: splitPoint,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    nextItems.splice(segment.index, 1, firstItem, secondItem)
    setTimelinePlayheadSeconds(segment.startSeconds + getTimelineItemDuration(firstItem, segment.clip))

    await applyTimelinePatch(
      {
        items: nextItems,
        activeItemId: secondItem.id,
        activeClipId: secondItem.clipId,
      },
      'Timeline item split at playhead.',
    )
  }

  const updateTimelineTrimDraft = (
    field: 'startSeconds' | 'endSeconds',
    rawValue: number,
  ) => {
    if (!selectedTimelineClip) {
      return
    }

    const maxDuration = selectedTimelineClip.trim.endSeconds ?? selectedTimelineClip.durationSeconds

    setTimelineTrimDraft((currentDraft) => {
      if (field === 'startSeconds') {
        const nextStart = clampNumber(rawValue, 0, currentDraft.endSeconds)
        return {
          ...currentDraft,
          startSeconds: nextStart,
        }
      }

      const nextEnd = clampNumber(rawValue, currentDraft.startSeconds, maxDuration)
      return {
        ...currentDraft,
        endSeconds: nextEnd,
      }
    })
  }

  const handleTimelineTrimDraftCommitKey = async (key: string) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) {
      return
    }

    await commitSelectedTimelineTrimDraft()
  }

  const handleImportMusicBed = async () => {
    setIsImportingMusicBed(true)
    setErrorMessage('')

    try {
      const result = await window.forkApi.project.importMusicBed()

      if (result.cancelled || !result.project) {
        return
      }

      setProject(result.project)
      void refreshProjectLibrary()
      setStatusLine(`Sequence bed imported: ${getActiveMusicBed(result.project)?.label ?? 'Imported bed'}.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Music bed import failed')
    } finally {
      setIsImportingMusicBed(false)
    }
  }

  const handleSelectMusicBed = async (bedId: string) => {
    if (!project || bedId === project.audio.activeBedId) {
      return
    }

    const audioUpdate = buildProjectAudioUpdate()

    if (audioUpdate?.invalid) {
      setErrorMessage('Fix sequence audio trim values before switching beds.')
      return
    }

    const nextAudio = audioUpdate
      ? {
          ...audioUpdate.audio,
          activeBedId: bedId,
        }
      : {
          ...project.audio,
          activeBedId: bedId,
        }
    const nextBed = project.audio.beds.find((bed) => bed.id === bedId)

    await persistProject(
      {
        audio: nextAudio,
      },
      nextBed ? `Focused sequence bed "${nextBed.label}".` : 'Sequence bed focus updated.',
    )
  }

  const handleRemoveMusicBed = async () => {
    if (!activeMusicBed) {
      return
    }

    setIsRemovingMusicBed(true)
    setErrorMessage('')

    try {
      const saved = await window.forkApi.project.removeMusicBed(activeMusicBed.id)
      setProject(saved)
      void refreshProjectLibrary()
      setStatusLine(`Sequence bed removed: ${activeMusicBed.label}.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to remove sequence bed')
    } finally {
      setIsRemovingMusicBed(false)
    }
  }

  const handleProjectOutputChange = async (patch: ProjectPatch['output']) => {
    if (!project) {
      return
    }

    setProject(
      mergeProject(project, {
        output: patch,
      }),
    )
    await persistProject(
      {
        output: patch,
      },
      'Render defaults updated.',
    )
  }

  const handleProjectCursorChange = async (patch: ProjectPatch['cursor']) => {
    if (!project) {
      return
    }

    setProject(
      mergeProject(project, {
        cursor: patch,
      }),
    )
    await persistProject(
      {
        cursor: patch,
      },
      'Cursor styling updated for the active workspace.',
    )
  }

  const handleProjectShortcutsChange = async (patch: ProjectPatch['shortcuts']) => {
    if (!project) {
      return
    }

    setProject(
      mergeProject(project, {
        shortcuts: patch,
      }),
    )
    await persistProject(
      {
        shortcuts: patch,
      },
      'Keyboard shortcut overlay updated for the active workspace.',
    )
  }

  const handleProjectCaptionsChange = async (patch: ProjectPatch['captions']) => {
    if (!project) {
      return
    }

    setProject(
      mergeProject(project, {
        captions: patch,
      }),
    )
    await persistProject(
      {
        captions: patch,
      },
      'Transcript and caption settings updated for the active workspace.',
    )
  }

  const handleProjectCameraChange = async (patch: ProjectPatch['camera']) => {
    if (!project) {
      return
    }

    setProject(
      mergeProject(project, {
        camera: patch,
      }),
    )
    await persistProject(
      {
        camera: patch,
      },
      'Camera layer updated for the active workspace.',
    )
  }

  const handleProjectBackgroundChange = async (patch: ProjectPatch['background']) => {
    if (!project) {
      return
    }

    setProject(
      mergeProject(project, {
        background: patch,
      }),
    )
    await persistProject(
      {
        background: patch,
      },
      'Background styling updated for the active workspace.',
    )
  }

  const handleImportBackgroundImage = async () => {
    setErrorMessage('')

    try {
      const result: BackgroundImageImportResult = await window.forkApi.project.importBackgroundImage()

      if (result.cancelled || !result.project) {
        return
      }

      setProject(result.project)
      void refreshProjectLibrary()
      setStatusLine('Background image imported into the active workspace.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Background image import failed')
    }
  }

  const handleClearBackgroundImage = async () => {
    await handleProjectBackgroundChange({
      imagePath: '',
      mode: 'wallpaper',
    })
  }

  const persistSelectedClipKeyboardShortcuts = async (
    nextShortcuts: KeyboardShortcutEvent[],
    statusMessage: string,
  ) => {
    if (!project || !selectedClip) {
      return
    }

    const nextClip: ProjectClip = {
      ...selectedClip,
      keyboardShortcuts: nextShortcuts,
      updatedAt: new Date().toISOString(),
    }
    const nextClips = replaceClip(project, nextClip)

    setProject(
      mergeProject(project, {
        clips: nextClips,
      }),
    )

    await persistProject(
      {
        clips: nextClips,
      },
      statusMessage,
    )
  }

  const persistSelectedClipTranscript = async (
    nextTranscript: ClipTranscript,
    statusMessage: string,
  ) => {
    if (!project || !selectedClip) {
      return
    }

    const nextClip: ProjectClip = {
      ...selectedClip,
      transcript: nextTranscript,
      updatedAt: new Date().toISOString(),
    }
    const nextClips = replaceClip(project, nextClip)

    setProject(
      mergeProject(project, {
        clips: nextClips,
      }),
    )

    await persistProject(
      {
        clips: nextClips,
      },
      statusMessage,
    )
  }

  const persistSelectedClipAudioRetakes = async (
    nextAudioRetakes: ProjectClipAudioRetake[],
    statusMessage: string,
  ) => {
    if (!project || !selectedClip) {
      return
    }

    const nextClip: ProjectClip = {
      ...selectedClip,
      audioRetakes: nextAudioRetakes,
      updatedAt: new Date().toISOString(),
    }
    const nextClips = replaceClip(project, nextClip)

    setProject(
      mergeProject(project, {
        clips: nextClips,
      }),
    )

    await persistProject(
      {
        clips: nextClips,
      },
      statusMessage,
    )
  }

  const stopAudioRetakeClock = () => {
    if (audioRetakeTimerRef.current) {
      window.clearInterval(audioRetakeTimerRef.current)
      audioRetakeTimerRef.current = null
    }

    if (audioRetakeAutoStopRef.current) {
      window.clearTimeout(audioRetakeAutoStopRef.current)
      audioRetakeAutoStopRef.current = null
    }
  }

  const releaseAudioRetakeResources = () => {
    stopAudioRetakeClock()
    audioRetakeRecorderRef.current = null
    audioRetakeFinalizePromiseRef.current = null
    audioRetakeChunksRef.current = []
    audioRetakeStartedAtRef.current = null
    audioRetakeTargetRef.current = null

    if (audioRetakeStreamRef.current) {
      audioRetakeStreamRef.current.getTracks().forEach((track) => track.stop())
      audioRetakeStreamRef.current = null
    }
  }

  useEffect(
    () => () => {
      if (audioRetakeTimerRef.current) {
        window.clearInterval(audioRetakeTimerRef.current)
      }
      if (audioRetakeAutoStopRef.current) {
        window.clearTimeout(audioRetakeAutoStopRef.current)
      }
      if (audioRetakeStreamRef.current) {
        audioRetakeStreamRef.current.getTracks().forEach((track) => track.stop())
      }
    },
    [],
  )

  const handleToggleKeyboardShortcutVisibility = async (shortcutId: string, visible: boolean) => {
    if (!selectedClip) {
      return
    }

    await persistSelectedClipKeyboardShortcuts(
      selectedClip.keyboardShortcuts.map((shortcut) =>
        shortcut.id === shortcutId
          ? {
              ...shortcut,
              visible,
            }
          : shortcut,
      ),
      visible ? 'Keyboard shortcut timestamp armed for preview and export.' : 'Keyboard shortcut timestamp hidden from preview and export.',
    )
  }

  const handleSetAllKeyboardShortcutsVisibility = async (visible: boolean) => {
    if (!selectedClip?.keyboardShortcuts.length) {
      return
    }

    await persistSelectedClipKeyboardShortcuts(
      selectedClip.keyboardShortcuts.map((shortcut) => ({
        ...shortcut,
        visible,
      })),
      visible ? 'All keyboard shortcuts restored on the selected take.' : 'All keyboard shortcuts hidden on the selected take.',
    )
  }

  const handleToggleTranscriptSegmentVisibility = async (segmentId: string, visible: boolean) => {
    if (!selectedClipTranscriptSegments.length) {
      return
    }

    await persistSelectedClipTranscript(
      {
        ...selectedClipTranscript,
        status: selectedClipTranscriptSegments.some((segment) => segment.visible !== false || segment.id === segmentId)
          ? 'ready'
          : selectedClipTranscript.status,
        segments: selectedClipTranscriptSegments.map((segment) =>
          segment.id === segmentId
            ? {
                ...segment,
                visible,
              }
            : segment,
        ),
      },
      visible ? 'Caption line restored for stage preview and export.' : 'Caption line hidden from stage preview and export.',
    )
  }

  const handleSetAllTranscriptSegmentsVisibility = async (visible: boolean) => {
    if (!selectedClipTranscriptSegments.length) {
      return
    }

    await persistSelectedClipTranscript(
      {
        ...selectedClipTranscript,
        segments: selectedClipTranscriptSegments.map((segment) => ({
          ...segment,
          visible,
        })),
      },
      visible ? 'All caption lines restored on the selected take.' : 'All caption lines hidden on the selected take.',
    )
  }

  const handleClearSelectedTranscript = async () => {
    if (!project || !selectedClip) {
      return
    }

    const nextClip: ProjectClip = {
      ...selectedClip,
      audioRetakes: [],
      updatedAt: new Date().toISOString(),
      transcript: {
        status: 'idle',
        provider: 'none',
        model: '',
        language: '',
        generatedAt: '',
        error: '',
        text: '',
        segments: [],
        words: [],
      },
    }
    const nextClips = replaceClip(project, nextClip)

    setSelectedTranscriptSegmentId('')

    setProject(
      mergeProject(project, {
        clips: nextClips,
      }),
    )

    await persistProject(
      {
        clips: nextClips,
      },
      'Transcript and linked audio retakes cleared from the selected take.',
    )
  }

  const handleGenerateSelectedClipTranscript = async () => {
    if (!selectedClip) {
      return
    }

    setIsGeneratingTranscript(true)
    setErrorMessage('')

    try {
      const saved = await window.forkApi.project.generateTranscript(selectedClip.id)
      setProject(saved)
      void refreshProjectLibrary()
      setStatusLine(`Transcript generated for ${selectedClip.label}.`)
      setActiveStudioSection('captions')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Transcript generation failed')
    } finally {
      setIsGeneratingTranscript(false)
    }
  }

  const handleImportSelectedClipTranscript = async () => {
    if (!selectedClip) {
      return
    }

    setIsImportingTranscript(true)
    setErrorMessage('')

    try {
      const saved = await window.forkApi.project.importTranscript(selectedClip.id)
      setProject(saved)
      void refreshProjectLibrary()
      setStatusLine(`Timed captions imported for ${selectedClip.label}.`)
      setActiveStudioSection('captions')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Transcript import failed')
    } finally {
      setIsImportingTranscript(false)
    }
  }

  const handleJumpToTranscriptSegment = (segment: ClipTranscriptSegment) => {
    if (!selectedClip) {
      return
    }

    setIsStagePlaying(false)

    const matchingTimelineSegment =
      (selectedTimelineSegment?.clip?.id === selectedClip.id ? selectedTimelineSegment : undefined) ??
      timelineSequence.find((candidate) => candidate.clip?.id === selectedClip.id)

    if (previewSequenceMode && matchingTimelineSegment) {
      const clipLocalSeconds = clampNumber(
        segment.startSeconds - matchingTimelineSegment.bounds.startSeconds,
        0,
        matchingTimelineSegment.bounds.durationSeconds,
      )
      setTimelinePlayheadSeconds(Number((matchingTimelineSegment.startSeconds + clipLocalSeconds).toFixed(3)))

      if (matchingTimelineSegment.item.id !== selectedTimelineItem?.id) {
        void selectTimelineItem(matchingTimelineSegment.item.id)
      }
      return
    }

    const clipPlayheadSeconds = clampNumber(
      segment.startSeconds - selectedClip.trim.startSeconds,
      0,
      previewTimelineDuration,
    )

    setTimelinePlayheadSeconds(Number(clipPlayheadSeconds.toFixed(3)))
  }

  const handleTrimSelectedClipToTranscriptSegment = async () => {
    if (!project || !selectedClip || !selectedTranscriptSegment) {
      return
    }

    const nextTrimStart = clampNumber(selectedTranscriptSegment.startSeconds, 0, selectedClip.durationSeconds)
    const nextTrimEnd = clampNumber(selectedTranscriptSegment.endSeconds, nextTrimStart, selectedClip.durationSeconds)

    const nextClip: ProjectClip = {
      ...selectedClip,
      updatedAt: new Date().toISOString(),
      trim: {
        startSeconds: Number(nextTrimStart.toFixed(3)),
        endSeconds: Number(nextTrimEnd.toFixed(3)),
      },
    }
    const nextClips = replaceClip(project, nextClip)

    setTrimStartDraft(formatEditableSeconds(nextClip.trim.startSeconds))
    setTrimEndDraft(formatEditableSeconds(nextClip.trim.endSeconds))
    setTimelinePlayheadSeconds(0)

    setProject(
      mergeProject(project, {
        clips: nextClips,
      }),
    )

    await persistProject(
      {
        clips: nextClips,
      },
      'Clip trim snapped to the selected transcript line.',
    )
  }

  const getTranscriptSegmentsWithinSelectedClipTrim = () => {
    if (!selectedClipTranscriptSegments.length || !selectedClip) {
      return []
    }

    const trimStart = selectedClip.trim.startSeconds
    const trimEnd = selectedClip.trim.endSeconds ?? selectedClip.durationSeconds

    return selectedClipTranscriptSegments
      .filter((segment) => segment.visible !== false)
      .map((segment) => {
        const overlapStart = Math.max(trimStart, segment.startSeconds)
        const overlapEnd = Math.min(trimEnd, segment.endSeconds)

        if (overlapEnd - overlapStart < 0.04) {
          return null
        }

        return {
          ...segment,
          startSeconds: Number((overlapStart - trimStart).toFixed(3)),
          endSeconds: Number((overlapEnd - trimStart).toFixed(3)),
        }
      })
      .filter(Boolean) as ClipTranscriptSegment[]
  }

  const handleSaveSelectedTranscriptSegmentText = async () => {
    if (!selectedTranscriptSegment) {
      return
    }

    const nextText = transcriptSegmentTextDraft.trim()

    if (!nextText) {
      setErrorMessage('Transcript line text cannot be empty.')
      return
    }

    const nextSegments = selectedClipTranscriptSegments.map((segment) =>
      segment.id === selectedTranscriptSegment.id
        ? {
            ...segment,
            text: nextText,
          }
        : segment,
    )
    const nextAudioRetakes = selectedClipAudioRetakes.map((retake) =>
      retake.segmentId === selectedTranscriptSegment.id
        ? {
            ...retake,
            segmentText: nextText,
            updatedAt: new Date().toISOString(),
          }
        : retake,
    )

    if (!project || !selectedClip) {
      return
    }

    const nextClip: ProjectClip = {
      ...selectedClip,
      updatedAt: new Date().toISOString(),
      audioRetakes: nextAudioRetakes,
      transcript: {
        ...selectedClipTranscript,
        status: 'ready',
        text: nextSegments.map((segment) => segment.text).join(' ').trim(),
        segments: nextSegments,
      },
    }
    const nextClips = replaceClip(project, nextClip)

    setProject(
      mergeProject(project, {
        clips: nextClips,
      }),
    )

    await persistProject(
      {
        clips: nextClips,
      },
      'Transcript line corrected. Captions and linked audio retakes will reflect the updated wording.',
    )
  }

  const handleStartSelectedTranscriptAudioRetake = async () => {
    if (!selectedClip || !selectedTranscriptSegment || isRecording || isStartingRecording || isRecordingAudioRetake) {
      return
    }

    if (selectedTranscriptRetakeLimitSeconds < 0.08) {
      setErrorMessage('Selected transcript line is too short for a reliable audio retake.')
      return
    }

    if (selectedTranscriptRetakeLimitSeconds > 15) {
      setErrorMessage('Audio retakes currently support transcript lines up to 15 seconds.')
      return
    }

    setErrorMessage('')

    try {
      const requestedDeviceId = settings?.capture.microphoneDeviceId || microphoneDevices[0]?.deviceId || ''
      const audioConstraints = requestedDeviceId
        ? {
            deviceId: { ideal: requestedDeviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      })
      const refreshedDevices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
      const nextCameraDevices = refreshedDevices.filter((device) => device.kind === 'videoinput')
      const nextMicrophoneDevices = refreshedDevices.filter((device) => device.kind === 'audioinput')

      setCameraDevices(nextCameraDevices)
      setMicrophoneDevices(nextMicrophoneDevices)

      const activeTrack = stream.getAudioTracks()[0]
      const activeDeviceId = requestedDeviceId || activeTrack?.getSettings?.().deviceId || ''
      const activeDeviceLabel = activeTrack?.label || resolveMicrophoneDeviceLabel(settings, nextMicrophoneDevices)
      const mimeType = pickSupportedAudioMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      audioRetakeStreamRef.current = stream
      audioRetakeRecorderRef.current = recorder
      audioRetakeChunksRef.current = []
      audioRetakeTargetRef.current = {
        clipId: selectedClip.id,
        clipLabel: selectedClip.label,
        segmentId: selectedTranscriptSegment.id,
        segmentText: selectedTranscriptSegment.text,
        startSeconds: selectedTranscriptSegment.startSeconds,
        endSeconds: selectedTranscriptSegment.endSeconds,
      }

      let recordedChunkCount = 0
      let recordedBytes = 0

      audioRetakeFinalizePromiseRef.current = new Promise((resolve) => {
        let settled = false
        const settle = (value: {
          blob: Blob
          mimeType: string
          deviceId: string
          deviceLabel: string
        } | null) => {
          if (settled) {
            return
          }

          settled = true
          resolve(value)
        }

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioRetakeChunksRef.current.push(event.data)
            recordedChunkCount += 1
            recordedBytes += event.data.size
          }
        }

        recorder.onerror = (event) => {
          console.error(`audio retake recorder error: ${event.error?.message ?? 'Unknown failure'}`)
          settle(null)
        }

        recorder.onstop = async () => {
          try {
            await new Promise((resolveStop) => window.setTimeout(resolveStop, 0))
            const blob = new Blob(audioRetakeChunksRef.current, {
              type: recorder.mimeType || 'audio/webm',
            })

            console.info(
              `audio retake recorder finalized chunks=${recordedChunkCount} bytes=${recordedBytes} blobBytes=${blob.size} mime=${blob.type || 'audio/webm'}`,
            )

            if (!blob.size) {
              settle(null)
              return
            }

            settle({
              blob,
              mimeType: blob.type || recorder.mimeType || 'audio/webm',
              deviceId: activeDeviceId,
              deviceLabel: activeDeviceLabel,
            })
          } catch {
            settle(null)
          }
        }
      })

      audioRetakeStartedAtRef.current = Date.now()
      setAudioRetakeSeconds(0)
      setIsRecordingAudioRetake(true)
      setStatusLine(
        `Recording audio retake for ${formatEditableSeconds(selectedTranscriptSegment.startSeconds)}s-${formatEditableSeconds(selectedTranscriptSegment.endSeconds)}s on "${selectedClip.label}".`,
      )

      stopAudioRetakeClock()
      audioRetakeTimerRef.current = window.setInterval(() => {
        const elapsedSeconds = audioRetakeStartedAtRef.current
          ? Math.max(0, Math.round((Date.now() - audioRetakeStartedAtRef.current) / 1000))
          : 0
        setAudioRetakeSeconds(Math.min(Math.ceil(selectedTranscriptRetakeLimitSeconds), elapsedSeconds))
      }, 200)
      audioRetakeAutoStopRef.current = window.setTimeout(() => {
        void handleStopSelectedTranscriptAudioRetake()
      }, Math.max(250, Math.ceil(selectedTranscriptRetakeLimitSeconds * 1000)))

      recorder.start(250)
    } catch (error) {
      releaseAudioRetakeResources()
      setIsRecordingAudioRetake(false)
      setAudioRetakeSeconds(0)
      setErrorMessage(error instanceof Error ? error.message : 'Audio retake recording failed to start')
    }
  }

  const handleStopSelectedTranscriptAudioRetake = async () => {
    const recorder = audioRetakeRecorderRef.current
    const target = audioRetakeTargetRef.current

    if (!recorder || !target) {
      return
    }

    stopAudioRetakeClock()
    setIsRecordingAudioRetake(false)

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }

    try {
      const recording = audioRetakeFinalizePromiseRef.current
        ? await audioRetakeFinalizePromiseRef.current
        : null

      if (!recording?.blob.size) {
        throw new Error('Audio retake finished without microphone data. Check microphone access and try again.')
      }

      const fileName = `retake-${sanitizeExportName(target.clipLabel.toLowerCase()) || 'clip'}-${target.segmentId.slice(0, 8)}-${new Date()
        .toISOString()
        .replaceAll(':', '-')
        .slice(0, 19)}`

      const saved = await window.forkApi.project.saveAudioRetake({
        clipId: target.clipId,
        segmentId: target.segmentId,
        segmentText: target.segmentText,
        startSeconds: target.startSeconds,
        endSeconds: target.endSeconds,
        buffer: await recording.blob.arrayBuffer(),
        mimeType: recording.mimeType,
        fileName,
        deviceId: recording.deviceId,
        deviceLabel: recording.deviceLabel,
      })

      setProject(saved)
      void refreshProjectLibrary()
      setStatusLine(
        `Audio retake saved for ${formatEditableSeconds(target.startSeconds)}s-${formatEditableSeconds(target.endSeconds)}s on "${target.clipLabel}".`,
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Audio retake save failed')
    } finally {
      releaseAudioRetakeResources()
      setAudioRetakeSeconds(0)
    }
  }

  const handleRemoveSelectedTranscriptAudioRetake = async () => {
    if (!selectedTranscriptAudioRetake) {
      return
    }

    await persistSelectedClipAudioRetakes(
      selectedClipAudioRetakes.filter((retake) => retake.id !== selectedTranscriptAudioRetake.id),
      'Audio retake removed from the selected transcript line.',
    )
  }

  const handleCopyTranscriptAsText = async () => {
    const segments = getTranscriptSegmentsWithinSelectedClipTrim()

    if (!segments.length) {
      setErrorMessage('There is no visible transcript text to copy from the selected take.')
      return
    }

    const payload = segments
      .map((segment) => formatTranscriptSegmentSummary(segment, activeCaptionSettings.showSpeakerLabels))
      .join('\n')

    try {
      await window.forkApi.shell.copyText(payload)
      setStatusLine('Transcript copied to the clipboard as plain text.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to copy transcript as text')
    }
  }

  const handleCopyTranscriptAsSrt = async () => {
    const segments = getTranscriptSegmentsWithinSelectedClipTrim()

    if (!segments.length) {
      setErrorMessage('There are no visible transcript lines to copy as SRT.')
      return
    }

    const payload = segments
      .map(
        (segment, index) =>
          `${index + 1}\n${formatSrtTimestamp(segment.startSeconds)} --> ${formatSrtTimestamp(segment.endSeconds)}\n${formatTranscriptSegmentSummary(segment, activeCaptionSettings.showSpeakerLabels)}`,
      )
      .join('\n\n')

    try {
      await window.forkApi.shell.copyText(payload)
      setStatusLine('Transcript copied to the clipboard as SRT.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to copy transcript as SRT')
    }
  }

  const handleCutSelectedTranscriptSegmentFromTimeline = async () => {
    if (
      !project ||
      !selectedClip ||
      !selectedTranscriptSegment ||
      selectedTranscriptTimelineAction.mode !== 'cut' ||
      !selectedTranscriptTimelineAction.item
    ) {
      return
    }

    const sourceItem = selectedTranscriptTimelineAction.item
    const sourceBounds = getTimelineItemBounds(sourceItem, selectedClip)
    const cutStartSeconds = Number(
      clampNumber(
        selectedTranscriptSegment.startSeconds,
        sourceBounds.startSeconds,
        sourceBounds.endSeconds,
      ).toFixed(3),
    )
    const cutEndSeconds = Number(
      clampNumber(
        selectedTranscriptSegment.endSeconds,
        cutStartSeconds,
        sourceBounds.endSeconds,
      ).toFixed(3),
    )

    if (cutEndSeconds - cutStartSeconds < 0.08) {
      setErrorMessage('The selected transcript line is too short inside this shot to create a reliable cut.')
      return
    }

    const itemIndex = project.timeline.items.findIndex((item) => item.id === sourceItem.id)

    if (itemIndex === -1) {
      setErrorMessage('The target timeline shot could not be found. Try selecting the shot again.')
      return
    }

    const timestamp = new Date().toISOString()
    const cutMeta: ProjectTimelineTranscriptCut = {
      sourceItemId: sourceItem.id,
      sourceLabel: sourceItem.label,
      segmentId: selectedTranscriptSegment.id,
      segmentText: selectedTranscriptSegment.text.trim(),
      segmentStartSeconds: cutStartSeconds,
      segmentEndSeconds: cutEndSeconds,
      createdAt: timestamp,
    }

    const nextItems = [...project.timeline.items]
    const replacements: ProjectTimelineItem[] = []
    const hasLeadingSlice = cutStartSeconds - sourceBounds.startSeconds >= 0.08
    const hasTrailingSlice = sourceBounds.endSeconds - cutEndSeconds >= 0.08

    if (hasLeadingSlice) {
      replacements.push({
        ...sourceItem,
        trimStartSeconds: sourceItem.trimStartSeconds,
        trimEndSeconds: cutStartSeconds,
        transcriptCut: null,
        updatedAt: timestamp,
      })
    }

    const cutLabelPreview = selectedTranscriptSegment.text.trim().replace(/\s+/g, ' ').slice(0, 40)

    replacements.push({
      ...sourceItem,
      id: crypto.randomUUID(),
      label: cutLabelPreview ? `Cut · ${cutLabelPreview}` : `${sourceItem.label} · Transcript cut`,
      enabled: false,
      trimStartSeconds: cutStartSeconds,
      trimEndSeconds: cutEndSeconds,
      transcriptCut: cutMeta,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    if (hasTrailingSlice) {
      replacements.push({
        ...sourceItem,
        id: crypto.randomUUID(),
        trimStartSeconds: cutEndSeconds,
        trimEndSeconds: sourceItem.trimEndSeconds,
        transcriptCut: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }

    nextItems.splice(itemIndex, 1, ...replacements)

    const nextActiveItem =
      [...replacements].reverse().find((item) => !isHiddenTranscriptCutTimelineItem(item)) ??
      nextItems.slice(itemIndex + replacements.length).find((item) => !isHiddenTranscriptCutTimelineItem(item)) ??
      [...nextItems.slice(0, itemIndex)].reverse().find((item) => !isHiddenTranscriptCutTimelineItem(item)) ??
      null

    await applyTimelinePatch(
      {
        items: nextItems,
        activeItemId: nextActiveItem?.id ?? '',
        activeClipId: nextActiveItem?.clipId ?? selectedClip.id,
      },
      'Transcript line cut from the sequence. Use Restore cut to bring it back.',
    )
  }

  const handleRestoreSelectedTranscriptCut = async () => {
    if (
      !project ||
      selectedTranscriptTimelineAction.mode !== 'restore' ||
      !selectedTranscriptTimelineAction.item
    ) {
      return
    }

    const cutItem = selectedTranscriptTimelineAction.item
    const timestamp = new Date().toISOString()
    const restoredItem: ProjectTimelineItem = {
      ...cutItem,
      enabled: true,
      label: cutItem.transcriptCut?.sourceLabel || cutItem.label,
      transcriptCut: null,
      updatedAt: timestamp,
    }

    await applyTimelinePatch(
      {
        items: replaceTimelineItem(project, restoredItem),
        activeItemId: restoredItem.id,
        activeClipId: restoredItem.clipId,
      },
      'Transcript cut restored to the sequence.',
    )
  }

  const handleRecoveryToggle = async (enabled: boolean) => {
    if (!project) {
      return
    }

    setProject(
      mergeProject(project, {
        recovery: {
          autosaveEnabled: enabled,
        },
      }),
    )
    await persistProject(
      {
        recovery: {
          autosaveEnabled: enabled,
        },
      },
      enabled ? 'Autosave enabled.' : 'Autosave paused. Manual state remains intact.',
    )
  }

  const handleExportSelectedClip = async () => {
    if (!boot || !selectedClip) {
      return
    }

    if (!boot.ffmpeg.available) {
      setErrorMessage('FFmpeg is unavailable. Export cannot run until ffmpeg.exe is detected.')
      return
    }

    const update = buildSelectedClipUpdate()

    if (update?.invalid) {
      setErrorMessage('Trim values must be positive numbers.')
      return
    }

    if (update?.changed) {
      const saved = await persistProject(
        {
          clips: update.clips,
        },
        'Clip trim and notes committed before export.',
      )

      if (!saved) {
        return
      }
    }

    setIsExportingClip(true)
    setErrorMessage('')

    try {
      const trimStartSeconds =
        update && !update.invalid && 'trim' in update
          ? (update.trim?.startSeconds ?? selectedClip.trim.startSeconds)
          : selectedClip.trim.startSeconds
      const trimEndSeconds =
        update && !update.invalid && 'trim' in update
          ? (update.trim?.endSeconds ?? selectedClip.trim.endSeconds)
          : selectedClip.trim.endSeconds
      const exported = await window.forkApi.project.exportClip({
        clipId: selectedClip.id,
        trimStartSeconds,
        trimEndSeconds,
        outputName: sanitizeExportName(exportNameDraft) || undefined,
      })

      setProject(exported.project)
      void refreshProjectLibrary()
      setLastExportPath(exported.filePath)
      setStatusLine(`${exported.exportRecord.format.toUpperCase()} export ready: ${exported.filePath}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setIsExportingClip(false)
    }
  }

  const handleExportTimeline = async () => {
    if (!boot || !project) {
      return
    }

    if (!boot.ffmpeg.available) {
      setErrorMessage('FFmpeg is unavailable. Sequence export cannot run until ffmpeg.exe is detected.')
      return
    }

    if (!project.timeline.items.some((item) => item.enabled)) {
      setErrorMessage('Enable at least one timeline item before exporting the sequence.')
      return
    }

    const audioUpdate = buildProjectAudioUpdate()

    if (audioUpdate?.invalid) {
      setErrorMessage('Fix sequence audio trim values before exporting.')
      return
    }

    if (audioUpdate?.changed) {
      const saved = await persistProject(
        {
          audio: audioUpdate.audio,
        },
        'Sequence audio committed before export.',
      )

      if (!saved) {
        return
      }
    }

    setIsExportingTimeline(true)
    setErrorMessage('')

    try {
      const exported = await window.forkApi.project.exportTimeline({
        outputName: sanitizeExportName(timelineExportNameDraft) || undefined,
      })

      setProject(exported.project)
      void refreshProjectLibrary()
      setLastExportPath(exported.filePath)
      setStatusLine(`Sequence ${exported.exportRecord.format.toUpperCase()} ready: ${exported.filePath}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Timeline export failed')
    } finally {
      setIsExportingTimeline(false)
    }
  }

  const railItems: Array<{
    id: StudioSection
    label: string
    description: string
    icon: Parameters<typeof StudioIcon>[0]['name']
  }> = [
    { id: 'background', label: 'Background', description: 'Atmosphere and framing', icon: 'background' },
    { id: 'capture', label: 'Capture', description: 'Sources and recording', icon: 'capture' },
    { id: 'camera', label: 'Camera', description: 'Facecam composition', icon: 'camera' },
    { id: 'cursor', label: 'Cursor', description: 'Pointer emphasis', icon: 'cursor' },
    { id: 'keyboard', label: 'Keyboard', description: 'Shortcut callouts', icon: 'keyboard' },
    { id: 'captions', label: 'Captions', description: 'Transcript overlays', icon: 'captions' },
    { id: 'audio', label: 'Audio', description: 'Voice and beds', icon: 'audio' },
    { id: 'export', label: 'Export', description: 'Render and delivery', icon: 'export' },
    { id: 'projects', label: 'Workspaces', description: 'Library and branching', icon: 'projects' },
  ]

  const activeRailItem = railItems.find((item) => item.id === activeStudioSection) ?? railItems[0]
  const selectedClipFocusRegionCount = selectedClip?.focusRegions?.length ?? 0
  const projectClipCount = project?.clips.length ?? 0
  const projectMetaLabel = `${projectClipCount} clip${projectClipCount === 1 ? '' : 's'} / ${formatDuration(totalClipDuration)}${enabledTimelineItemCount ? ` / ${enabledTimelineItemCount} live` : ''}`
  const activeClipLabel = selectedClip?.label ?? 'No clip selected'
  const activeClipMeta = selectedClip
    ? `${formatDuration(selectedClip.durationSeconds)} / ${selectedTimelineItem ? 'In sequence' : 'Clip only'}`
    : 'Load or select a take'
  const motionSummaryLabel = selectedClipFocusRegionCount
    ? `${selectedClipFocusRegionCount} zoom block${selectedClipFocusRegionCount === 1 ? '' : 's'}`
    : 'No zoom blocks'
  const motionSupportLabel = selectedClip?.cursorTrack?.points?.length
    ? 'Tracked'
    : selectedSource
      ? 'Guided'
      : 'Manual'
  const previewDeskPrimaryBadge = selectedClip?.label ?? previewMediaLabel
  const previewDeskSecondaryBadge = selectedClipMotionPreset?.label ?? activeMotionPreset?.label ?? 'Motion ready'
  const timelineLiveItemsLabel = `${enabledTimelineItemCount} live item${enabledTimelineItemCount === 1 ? '' : 's'}`
  const selectedTimelineOrderLabel = selectedTimelineSegment
    ? `Shot ${selectedTimelineSegment.index + 1} of ${Math.max(timelineSequence.length, 1)}`
    : enabledTimelineItemCount
      ? `${enabledTimelineItemCount} live`
      : 'Select a clip'
  const stagePrimaryActionLabel = selectedTimelineItem ? 'Apply trim' : 'Crop frame'
  const stageSecondaryActionLabel = selectedTimelineItem ? 'Reset trim' : 'Auto zoom'
  const stagePlayActionLabel = isStagePlaying ? 'Pause' : 'Play'
  const timelineDurationBadge = previewTimelineDuration ? `${formatDuration(previewTimelineDuration)} sequence` : 'No sequence'
  const clipLaneLabel = selectedTimelineItem ? 'Order and trim' : selectedClip ? 'Select or add clips' : 'Load a clip'
  const motionLaneLabel = selectedFocusRegion
    ? selectedFocusRegion.label
    : selectedClip
      ? 'Zoom blocks and focus'
      : 'Load a clip'
  const stageStateLabel = isRecording
    ? 'Recording'
    : selectedClip
      ? 'Preview ready'
      : selectedSource
        ? 'Capture ready'
        : 'Choose source'
  const stageStateDetail = isRecording
    ? 'Capture in progress.'
    : selectedClip
      ? selectedTimelineItem
        ? 'Sequence loaded.'
        : 'Clip loaded.'
      : selectedSource
        ? 'Ready to record.'
        : 'Pick a source.'
  const stageArtifactCaption = lastExportPath ? 'Last export' : lastSavedPath ? 'Last capture' : 'Artifact'
  const stageArtifactDetail = lastExportPath || lastSavedPath ? lastArtifactName : 'Nothing saved yet'
  const stageEngineLabel = boot?.ffmpeg.available ? 'Ready' : 'Needed'
  const stageEngineDetail = boot?.ffmpeg.available
    ? `${activeOutputFormat?.label ?? project?.output.format?.toUpperCase() ?? 'MP4'} export ready.`
    : 'Install FFmpeg to export.'

  const backgroundModes: Array<{
    id: BackgroundMode
    label: string
  }> = [
    { id: 'wallpaper', label: 'Wallpaper' },
    { id: 'image', label: 'Image' },
    { id: 'gradient', label: 'Gradient' },
    { id: 'color', label: 'Color' },
  ]

  const handleToggleStagePlayback = () => {
    if (!previewTimelineDuration) {
      return
    }

    if (!isStagePlaying && previewPlaybackHasAudio) {
      void stagePlaybackAudioContextRef.current?.resume().catch(() => undefined)
    }

    if (isStagePlaying) {
      void stagePlaybackAudioContextRef.current?.suspend().catch(() => undefined)
    }

    setIsStagePlaying((currentState) => !currentState)
  }

  const nudgePlayhead = (deltaSeconds: number) => {
    setIsStagePlaying(false)
    setTimelinePlayheadSeconds((currentSeconds) =>
      clampNumber(Number((currentSeconds + deltaSeconds).toFixed(2)), 0, previewTimelineDuration),
    )
  }

  const handlePreviewCrop = async () => {
    if (selectedTimelineItem) {
      await commitSelectedTimelineTrimDraft()
      return
    }

    const update = buildSelectedClipUpdate()

    if (update?.invalid) {
      setErrorMessage('Fix clip trim values before committing crop.')
      return
    }

    if (update?.changed) {
      await persistProject(
        {
          clips: update.clips,
        },
        'Clip trim committed.',
      )
    }
  }

  const handlePreviewAuto = async () => {
    if (selectedTimelineItem) {
      await resetSelectedTimelineTrim()
      return
    }

    if (!selectedClip || !project) {
      return
    }

    await persistProject(
      {
        clips: replaceClip(project, {
          ...selectedClip,
          trim: {
            startSeconds: 0,
            endSeconds: selectedClip.durationSeconds,
          },
        }),
      },
      'Clip trim reset to the full take.',
    )
  }

  if (!settings || !boot || !project) {
    return (
      <main className="app-shell loading-shell">
        <section className="loading-card">
          <p className="eyebrow">Movion</p>
          <h1>Bootstrapping local studio shell</h1>
          <p>Preparing capture pipeline, project autosave, import scanner, and export engine.</p>
        </section>
      </main>
    )
  }

  const useLegacyShell = window.location.hash === '#legacy-shell'

  if (useLegacyShell) {
    return (
    <main className="app-shell">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">Editorial Motion Capture</p>
          <h1>Movion</h1>
          <p className="hero-copy">
            A local-first studio shell for recording, collecting takes, trimming them into
            reusable clips, and exporting clean MP4 deliverables without depending on the
            original product runtime.
          </p>
        </div>

        <div className="hero-metrics" aria-label="Project metrics">
          <article>
            <span>Projects</span>
            <strong>{projectLibrary.length}</strong>
          </article>
          <article>
            <span>Clips</span>
            <strong>{project.clips.length}</strong>
          </article>
          <article>
            <span>Sequence</span>
            <strong>{enabledTimelineItemCount} items / {formatDuration(totalSequenceDuration)}</strong>
          </article>
          <article>
            <span>Exports</span>
            <strong>
              {totalExportCount}
              {activeProjectSummary?.lastOpenedAt
                ? ` / ${formatDateTime(activeProjectSummary.lastOpenedAt)}`
                : ''}
            </strong>
          </article>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="rail rail-left">
          <div className="panel panel-projects">
            <div className="panel-heading">
              <p className="panel-kicker">Studio Projects</p>
              <h2>Branch, switch, and version your work</h2>
            </div>
            <p className="panel-copy">
              Keep separate motion sessions for different videos, reuse captured takes without
              merging everything into one workspace, and branch current edits into variants.
            </p>

            <div className="project-seed-row">
              <label className="field-block">
                <span>New project name</span>
                <input
                  value={projectSeedTitleDraft}
                  onChange={(event) => setProjectSeedTitleDraft(event.target.value)}
                  placeholder="Optional title for the next workspace"
                />
              </label>
            </div>

            <div className="panel-actions">
              <button
                type="button"
                className="primary"
                onClick={handleCreateProject}
                disabled={projectWorkspaceLocked}
              >
                {projectWorkspaceLocked ? 'Workspace locked...' : 'Create new project'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => project && void handleDuplicateProject(project.id)}
                disabled={projectWorkspaceLocked || !project}
              >
                Duplicate active
              </button>
            </div>

            {projectLibrary.length ? (
              <div className="project-stack">
                {projectLibrary.map((projectSummary) => (
                  <article
                    key={projectSummary.id}
                    className={`project-card ${projectSummary.isActive ? 'active' : ''}`}
                  >
                    <button
                      type="button"
                      className="project-card-main"
                      onClick={() => void handleOpenProject(projectSummary.id)}
                      disabled={projectWorkspaceLocked || projectSummary.isActive}
                    >
                      <div className="project-card-media">
                        {projectSummary.coverThumbnailDataUrl ? (
                          <img
                            src={projectSummary.coverThumbnailDataUrl}
                            alt={projectSummary.title}
                          />
                        ) : (
                          <div className="project-card-fallback">
                            <span>
                              {projectSummary.isActive ? 'Active studio' : 'Ready to open'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="project-card-body">
                        <div className="project-card-heading">
                          <strong>{projectSummary.title}</strong>
                          <span>{projectSummary.isActive ? 'Active' : 'Standby'}</span>
                        </div>
                        <p>
                          {projectSummary.brief ||
                            'A local capture workspace for clips, sequence edits, and exports.'}
                        </p>
                        <div className="project-card-meta">
                          <span>{projectSummary.clipCount} clip(s)</span>
                          <span>
                            {projectSummary.enabledTimelineItemCount}/{projectSummary.timelineItemCount} live
                            items
                          </span>
                          <span>{formatDuration(projectSummary.totalTimelineDuration)}</span>
                        </div>
                      </div>
                    </button>

                    <div className="project-card-actions">
                      <button
                        type="button"
                        className="secondary ghost"
                        onClick={() => void handleDuplicateProject(projectSummary.id)}
                        disabled={projectWorkspaceLocked}
                      >
                        Branch
                      </button>
                      <button
                        type="button"
                        className="secondary ghost"
                        onClick={() => void handleDeleteProject(projectSummary)}
                        disabled={projectWorkspaceLocked || projectLibrary.length === 1}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <strong>No saved projects yet</strong>
                <span>Create a new workspace to split captures into clean, reusable motion sessions.</span>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <p className="panel-kicker">Project Cockpit</p>
              <h2>Session identity</h2>
            </div>

            <label className="field-block">
              <span>Project title</span>
              <input
                value={projectTitleDraft}
                onChange={(event) => setProjectTitleDraft(event.target.value)}
                placeholder="Name this recording session"
              />
            </label>

            <label className="field-block">
              <span>Brief</span>
              <textarea
                rows={5}
                value={projectBriefDraft}
                onChange={(event) => setProjectBriefDraft(event.target.value)}
                placeholder="Capture goals, talking points, or edit intent"
              />
            </label>

            <dl className="stat-list">
              <div>
                <dt>Created</dt>
                <dd>{formatDateTime(project.createdAt)}</dd>
              </div>
              <div>
                <dt>Last saved</dt>
                <dd>{isSavingProject ? 'Writing project state...' : formatDateTime(project.recovery.lastSavedAt)}</dd>
              </div>
              <div>
                <dt>Active clip</dt>
                <dd>{selectedClip?.label ?? 'None yet'}</dd>
              </div>
              <div>
                <dt>Capture root</dt>
                <dd>{boot.paths.capturesRoot}</dd>
              </div>
            </dl>

            <label className="toggle-row">
              <span>Autosave project changes</span>
              <input
                type="checkbox"
                checked={project.recovery.autosaveEnabled}
                onChange={(event) => {
                  void handleRecoveryToggle(event.target.checked)
                }}
              />
            </label>
          </div>

          <div className="panel panel-import">
            <div className="panel-heading">
              <p className="panel-kicker">Import State</p>
              <h2>Legacy import scan</h2>
            </div>
            <p className="panel-copy">
              Detect a compatible previous install, count project and preset files, and copy
              available state into the Movion workspace without depending on the original app.
            </p>

            <div className="panel-actions">
              <button type="button" onClick={scanImportState} disabled={isScanningImport}>
                {isScanningImport ? 'Scanning...' : 'Scan current setup'}
              </button>
              <button type="button" onClick={importLegacyState} disabled={isImporting}>
                {isImporting ? 'Importing...' : 'Import local state'}
              </button>
            </div>

            <dl className="stat-list">
              <div>
                <dt>Detected</dt>
                <dd>{importSummary?.detected ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Source version</dt>
                <dd>{importSummary?.sourceVersion || 'Unknown'}</dd>
              </div>
              <div>
                <dt>Projects</dt>
                <dd>{importSummary?.projectCount ?? 0}</dd>
              </div>
              <div>
                <dt>Presets</dt>
                <dd>{importSummary?.presetCount ?? 0}</dd>
              </div>
              <div>
                <dt>Window state</dt>
                <dd>{importSummary?.hasWindowState ? 'Present' : 'Missing'}</dd>
              </div>
              <div>
                <dt>Last scan</dt>
                <dd>{formatDateTime(importSummary?.scannedAt ?? '')}</dd>
              </div>
            </dl>
          </div>
        </aside>

        <section className="stage-column">
          <div className="panel stage-panel">
            <div className="stage-topline">
              <div>
                <p className="panel-kicker">Capture Deck</p>
                <h2>Preview and transport</h2>
              </div>
              <div className="recording-pill" data-live={isRecording}>
                <span>{isRecording ? 'Live' : 'Idle'}</span>
                <strong>{formatTimer(recordingSeconds)}</strong>
              </div>
            </div>

            <div className="preview-frame">
              {selectedSource ? (
                <img
                  src={selectedSource.thumbnailDataUrl}
                  alt={selectedSource.name}
                  className="source-thumbnail"
                />
              ) : (
                <div className="empty-preview">
                  <p>Choose a screen or window source</p>
                </div>
              )}
              <video
                ref={captureDeckPreviewRef}
                className="live-preview"
                autoPlay
              />
              <div className="preview-overlay-stack">
                <div
                  className="preview-badge"
                  data-ready={!isRecording && selectedSource?.kind === 'screen'}
                  data-live={isRecording && sessionCursorTrackingAvailable}
                >
                  <span>Cursor telemetry</span>
                  <strong>{captureCursorTelemetryLabel}</strong>
                </div>
                <div
                  className="preview-badge"
                  data-ready={!isRecording}
                  data-live={isRecording && sessionKeyboardTrackingAvailable}
                >
                  <span>Keyboard shortcuts</span>
                  <strong>{captureKeyboardTelemetryLabel}</strong>
                </div>
              </div>
              <div ref={captureDeckCursorIndicatorRef} className="preview-cursor-indicator" aria-hidden="true">
                <span />
              </div>
            </div>

            <div className="transport-row">
              <button
                type="button"
                className="primary"
                onClick={handleStartRecording}
                disabled={isRecording || isStartingRecording || !selectedSource}
              >
                {isStartingRecording ? 'Preparing capture...' : 'Start recording'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleStopRecording}
                disabled={!isRecording}
              >
                Stop and save
              </button>
              <button
                type="button"
                className="secondary ghost"
                onClick={() => void window.forkApi.shell.showInFolder(lastSavedPath || boot.paths.capturesRoot)}
              >
                Open captures
              </button>
              <button
                type="button"
                className="secondary ghost"
                onClick={() => void window.forkApi.shell.showInFolder(lastExportPath || boot.paths.exportsRoot)}
              >
                Open exports
              </button>
              <button
                type="button"
                className="secondary ghost"
                onClick={() => void window.forkApi.shell.showInFolder(boot.paths.runtimeLogFile)}
              >
                Open logs
              </button>
            </div>

            <div className="status-strip">
              <span>{statusLine}</span>
              <strong>
                {lastExportPath
                  ? `Last export: ${lastExportPath}`
                  : lastSavedPath
                    ? `Last capture: ${formatBytes(lastSavedSize)} at ${lastSavedPath}`
                    : 'No local artifact yet'}
              </strong>
            </div>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <p className="panel-kicker">Capture Inventory</p>
              <h2>Available sources</h2>
            </div>
            <div className="panel-actions compact">
              <button type="button" onClick={refreshSources} disabled={isRefreshingSources}>
                {isRefreshingSources ? 'Refreshing...' : 'Refresh sources'}
              </button>
            </div>
            <div className="source-grid">
              {sources.map((source) => {
                const active = source.id === settings.capture.selectedSourceId
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={`source-card ${active ? 'active' : ''}`}
                    onClick={() =>
                      void persistSettings({
                        capture: {
                          selectedSourceId: source.id,
                        },
                      })
                    }
                  >
                    <img src={source.thumbnailDataUrl} alt={source.name} />
                    <div>
                      <strong>{source.name}</strong>
                      <span>
                        {source.kind}
                        {source.displayId ? ` | display ${source.displayId}` : ''}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="panel">
            <div className="stage-topline">
              <div>
                <p className="panel-kicker">Project Clips</p>
                <h2>Take library</h2>
              </div>
              <div className="header-actions">
                <div className="mini-badge">
                  <span>Library size</span>
                  <strong>{project.clips.length} clip(s) / {formatDuration(totalClipDuration)}</strong>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => selectedClip && void addClipToTimeline(selectedClip)}
                  disabled={!selectedClip}
                >
                  Add selected clip
                </button>
              </div>
            </div>

            {project.clips.length ? (
              <div className="clip-grid">
                {project.clips.map((clip) => {
                  const active = clip.id === selectedClip?.id
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      className={`clip-card ${active ? 'active' : ''}`}
                      onClick={() => void selectClip(clip.id)}
                    >
                      {clip.thumbnailDataUrl ? (
                        <img src={clip.thumbnailDataUrl} alt={clip.label} />
                      ) : (
                        <div className="clip-thumb-fallback">
                          <span>{clip.source.kind.toUpperCase()}</span>
                        </div>
                      )}
                      <div className="clip-card-body">
                        <strong>{clip.label}</strong>
                        <span>{clip.source.name}</span>
                        <span>
                          {formatDuration(clip.durationSeconds)} | {clip.captureProfile.qualityProfileLabel}
                        </span>
                        <span>
                          Motion: {clip.captureProfile.motionPresetLabel}
                        </span>
                        <span>
                          {clip.audio.hasAudio
                            ? clip.audio.muted
                              ? 'Audio muted'
                              : `Audio ${formatGainDb(clip.audio.gainDb)}`
                            : 'No audio track'}
                        </span>
                        <span>
                          {clip.cursorTrack
                            ? `${clip.cursorTrack.points.length} cursor sample(s)`
                            : 'No cursor telemetry'}
                        </span>
                        <span>{clip.exports.length} export(s)</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No clips yet</strong>
                <span>Record the first take to start building a reusable local project timeline.</span>
              </div>
            )}
          </div>

          <div className="panel timeline-panel">
            <div className="stage-topline">
              <div>
                <p className="panel-kicker">Sequence Timeline</p>
                <h2>Arrange the final cut</h2>
              </div>
              <div className="mini-badge">
                <span>Sequence</span>
                <strong>{enabledTimelineItemCount} enabled / {formatDuration(totalSequenceDuration)}</strong>
              </div>
            </div>

            {project.timeline.items.length ? (
              <>
                <div className="timeline-director">
                  <div className="timeline-playhead-header">
                    <div>
                      <span>Sequence playhead</span>
                      <strong>
                        {formatDuration(timelinePlayheadSeconds)} /{' '}
                        {formatDuration(totalTimelineCanvasDuration)}
                      </strong>
                    </div>
                    <div className="timeline-director-actions">
                      <button
                        type="button"
                        className="secondary ghost"
                        onClick={() =>
                          setTimelinePlayheadSeconds((currentSeconds) =>
                            clampNumber(currentSeconds - 0.25, 0, totalTimelineCanvasDuration),
                          )
                        }
                      >
                        -0.25s
                      </button>
                      <button
                        type="button"
                        className="secondary ghost"
                        onClick={() =>
                          setTimelinePlayheadSeconds((currentSeconds) =>
                            clampNumber(currentSeconds + 0.25, 0, totalTimelineCanvasDuration),
                          )
                        }
                      >
                        +0.25s
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          selectedTimelineItem && void splitTimelineItemAtPlayhead(selectedTimelineItem.id)
                        }
                        disabled={!selectedTimelineItem || !canSplitSelectedTimelineItem}
                      >
                        Split at playhead
                      </button>
                    </div>
                  </div>

                  <label className="timeline-playhead-field">
                    <span>Scrub sequence</span>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(totalTimelineCanvasDuration, 0.01)}
                      step="0.01"
                      value={Math.min(timelinePlayheadSeconds, Math.max(totalTimelineCanvasDuration, 0.01))}
                      onChange={(event) => setTimelinePlayheadSeconds(Number(event.target.value))}
                    />
                  </label>

                  <div className="timeline-visual-canvas">
                    <div
                      className="timeline-playhead-marker"
                      style={{
                        left: totalTimelineCanvasDuration
                          ? `${(timelinePlayheadSeconds / totalTimelineCanvasDuration) * 100}%`
                          : '0%',
                      }}
                    />
                    <div className="timeline-segment-row">
                      {timelineSequence.map((segment) => (
                        <button
                          key={segment.item.id}
                          type="button"
                          className={`timeline-segment ${segment.item.id === selectedTimelineItem?.id ? 'active' : ''} ${segment.item.enabled ? '' : 'muted'}`}
                          style={{ flexGrow: Math.max(segment.bounds.durationSeconds, 0.4) }}
                          onClick={() => {
                            setTimelinePlayheadSeconds(segment.startSeconds)
                            void selectTimelineItem(segment.item.id)
                          }}
                        >
                          <span>{String(segment.index + 1).padStart(2, '0')}</span>
                          <strong>{segment.item.label}</strong>
                          <small>{formatDuration(segment.bounds.durationSeconds)}</small>
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedTimelineItem && selectedTimelineClip ? (
                    <div className="timeline-trim-dock">
                      <div className="timeline-trim-copy">
                        <span>Selected shot</span>
                        <strong>{selectedTimelineItem.label}</strong>
                        <p>
                          {selectedTimelineClip.label} | local playhead{' '}
                          {formatDuration(
                            Math.max(
                              0,
                              timelinePlayheadSeconds - (selectedTimelineSegment?.startSeconds ?? 0),
                            ),
                          )}
                        </p>
                        {selectedTimelineClip.audio.waveformPeaks.length ? (
                          <WaveformBars
                            peaks={selectedTimelineClip.audio.waveformPeaks}
                            className="timeline-waveform"
                          />
                        ) : null}
                      </div>

                      <div className="timeline-trim-sliders">
                        <label className="timeline-range-field">
                          <span>In handle</span>
                          <input
                            type="range"
                            min="0"
                            max={selectedTimelineClip.trim.endSeconds ?? selectedTimelineClip.durationSeconds}
                            step="0.05"
                            value={timelineTrimDraft.startSeconds}
                            onChange={(event) =>
                              updateTimelineTrimDraft('startSeconds', Number(event.target.value))
                            }
                            onPointerUp={() => void commitSelectedTimelineTrimDraft()}
                            onKeyUp={(event) => void handleTimelineTrimDraftCommitKey(event.key)}
                          />
                          <strong>{formatEditableSeconds(timelineTrimDraft.startSeconds)}s</strong>
                        </label>

                        <label className="timeline-range-field">
                          <span>Out handle</span>
                          <input
                            type="range"
                            min={timelineTrimDraft.startSeconds}
                            max={selectedTimelineClip.trim.endSeconds ?? selectedTimelineClip.durationSeconds}
                            step="0.05"
                            value={timelineTrimDraft.endSeconds}
                            onChange={(event) =>
                              updateTimelineTrimDraft('endSeconds', Number(event.target.value))
                            }
                            onPointerUp={() => void commitSelectedTimelineTrimDraft()}
                            onKeyUp={(event) => void handleTimelineTrimDraftCommitKey(event.key)}
                          />
                          <strong>{formatEditableSeconds(timelineTrimDraft.endSeconds)}s</strong>
                        </label>
                      </div>

                      <div className="timeline-trim-actions">
                        <button
                          type="button"
                          className="secondary ghost"
                          onClick={() => void resetSelectedTimelineTrim()}
                        >
                          Reset trim
                        </button>
                        <button
                          type="button"
                          className="secondary ghost"
                          onClick={() => void selectClip(selectedTimelineItem.clipId)}
                        >
                          Jump to clip inspector
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="timeline-stack">
                  {project.timeline.items.map((item, index) => {
                    const clip = clipsById.get(item.clipId)
                    const active = item.id === selectedTimelineItem?.id
                    const bounds = getTimelineItemBounds(item, clip)
                    const segment = timelineSequence.find((entry) => entry.item.id === item.id)
                    const trimStartPercent =
                      bounds.maxSeconds > 0 ? (bounds.startSeconds / bounds.maxSeconds) * 100 : 0
                    const trimWidthPercent =
                      bounds.maxSeconds > 0 ? (bounds.durationSeconds / bounds.maxSeconds) * 100 : 100
                    const localPlayheadPercent =
                      active && segment && bounds.durationSeconds > 0
                        ? clampNumber(
                            ((timelinePlayheadSeconds - segment.startSeconds) / bounds.durationSeconds) * 100,
                            0,
                            100,
                          )
                        : 0

                    return (
                      <article
                        key={item.id}
                        className={`timeline-item-card ${active ? 'active' : ''} ${item.enabled ? '' : 'muted'} ${item.transcriptCut && item.enabled === false ? 'transcript-cut' : ''} ${draggedTimelineItemId === item.id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={(event) => {
                          setDraggedTimelineItemId(item.id)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', item.id)
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          const sourceItemId =
                            draggedTimelineItemId || event.dataTransfer.getData('text/plain')

                          setDraggedTimelineItemId('')
                          if (!sourceItemId || sourceItemId === item.id) {
                            return
                          }

                          void reorderTimelineItem(sourceItemId, index)
                        }}
                        onDragEnd={() => setDraggedTimelineItemId('')}
                      >
                        <button
                          type="button"
                          className="timeline-item-main"
                          onClick={() => void selectTimelineItem(item.id)}
                        >
                          <span className="timeline-order">{String(index + 1).padStart(2, '0')}</span>
                          <div className="timeline-item-copy">
                            <strong>{item.label}</strong>
                            <span>{clip?.label ?? 'Missing clip reference'}</span>
                            <span>
                              {formatDuration(bounds.durationSeconds)} | {item.enabled ? 'live in export' : 'muted'}
                            </span>
                            {item.transcriptCut && item.enabled === false ? (
                              <span className="timeline-item-cut-note">
                                Transcript cut hidden from playback/export. Restore it from the Captions panel.
                              </span>
                            ) : null}
                            <div className="timeline-item-bar">
                              <span className="timeline-item-bar-track" />
                              <span
                                className="timeline-item-bar-window"
                                style={{
                                  left: `${trimStartPercent}%`,
                                  width: `${Math.max(trimWidthPercent, 2)}%`,
                                }}
                              />
                              {active ? (
                                <span
                                  className="timeline-item-bar-cursor"
                                  style={{ left: `${localPlayheadPercent}%` }}
                                />
                              ) : null}
                            </div>
                          </div>
                        </button>

                        <div className="timeline-item-controls">
                          <label className="timeline-toggle">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={(event) => void toggleTimelineItem(item.id, event.target.checked)}
                            />
                            <span>Include</span>
                          </label>

                          <label className="timeline-inline-field">
                            <span>Label</span>
                            <input
                              key={`${item.id}-label-${item.updatedAt}`}
                              defaultValue={item.label}
                              onBlur={(event) => void commitTimelineItemLabel(item.id, event.currentTarget.value)}
                            />
                          </label>

                          <label className="timeline-inline-field compact">
                            <span>In</span>
                            <input
                              key={`${item.id}-start-${item.updatedAt}`}
                              type="number"
                              min="0"
                              step="0.1"
                              defaultValue={formatEditableSeconds(item.trimStartSeconds)}
                              onBlur={(event) => void commitTimelineTrim(item.id, 'trimStartSeconds', event.currentTarget.value)}
                            />
                          </label>

                          <label className="timeline-inline-field compact">
                            <span>Out</span>
                            <input
                              key={`${item.id}-end-${item.updatedAt}`}
                              type="number"
                              min="0"
                              step="0.1"
                              defaultValue={formatEditableSeconds(item.trimEndSeconds)}
                              placeholder="full"
                              onBlur={(event) => void commitTimelineTrim(item.id, 'trimEndSeconds', event.currentTarget.value)}
                            />
                          </label>

                          <div className="timeline-item-actions">
                            <button
                              type="button"
                              className="secondary ghost"
                              onClick={() => void moveTimelineItem(item.id, -1)}
                              disabled={index === 0}
                            >
                              Move left
                            </button>
                            <button
                              type="button"
                              className="secondary ghost"
                              onClick={() => void moveTimelineItem(item.id, 1)}
                              disabled={index === project.timeline.items.length - 1}
                            >
                              Move right
                            </button>
                            <button
                              type="button"
                              className="secondary ghost"
                              onClick={() => void duplicateTimelineItem(item.id)}
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="secondary ghost"
                              onClick={() => void removeTimelineItem(item.id)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <strong>No timeline items yet</strong>
                <span>Add a clip to the sequence to build the final story arc and export it as one video.</span>
              </div>
            )}
          </div>
        </section>

        <aside className="rail rail-right">
          <div className="panel">
            <div className="panel-heading">
              <p className="panel-kicker">Capture Tuning</p>
              <h2>Profiles and motion</h2>
            </div>

            <div className="detail-block">
              <span>Quality profiles</span>
            </div>
            <div className="preset-stack">
              {qualityProfiles.map((profile) => {
                const active = profile.id === settings.capture.qualityProfileId
                return (
                  <button
                    key={profile.id}
                    type="button"
                    className={`preset-card ${active ? 'active' : ''}`}
                    onClick={() =>
                      void persistSettings({
                        capture: {
                          qualityProfileId: profile.id,
                        },
                      })
                    }
                  >
                    <strong>
                      {profile.label} | {profile.width}x{profile.height} | {profile.fps} fps
                    </strong>
                    <span>{profile.detail}</span>
                  </button>
                )
              })}
            </div>

            <div className="detail-block section-gap">
              <span>Motion presets</span>
            </div>
            <div className="preset-stack">
              {motionPresets.map((preset) => {
                const active = preset.id === settings.capture.motionPresetId
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-card ${active ? 'active' : ''}`}
                    onClick={() =>
                      void persistSettings({
                        capture: {
                          motionPresetId: preset.id,
                        },
                      })
                    }
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.description}</span>
                  </button>
                )
              })}
            </div>

            <label className="toggle-row">
              <span>Include system audio</span>
              <input
                type="checkbox"
                checked={settings.capture.includeSystemAudio}
                onChange={(event) =>
                  void persistSettings({
                    capture: {
                      includeSystemAudio: event.target.checked,
                    },
                  })
                }
              />
            </label>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <p className="panel-kicker">Clip Inspector</p>
              <h2>{selectedClip ? selectedClip.label : 'No clip selected'}</h2>
            </div>

            {selectedClip ? (
              <>
                <dl className="stat-list">
                  <div>
                    <dt>Source</dt>
                    <dd>{selectedClip.source.name}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{formatDuration(selectedClip.durationSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Preset</dt>
                    <dd>{selectedClip.captureProfile.motionPresetLabel}</dd>
                  </div>
                  <div>
                    <dt>Exports</dt>
                    <dd>{selectedClip.exports.length}</dd>
                  </div>
                  <div>
                    <dt>Audio</dt>
                    <dd>
                      {selectedClip.audio.hasAudio
                        ? selectedClip.audio.muted
                          ? 'Muted'
                          : formatGainDb(selectedClip.audio.gainDb)
                        : 'No track'}
                    </dd>
                  </div>
                  <div>
                    <dt>Cursor track</dt>
                    <dd>
                      {selectedClip.cursorTrack
                        ? `${selectedClip.cursorTrack.points.length} sample(s)`
                        : 'No telemetry'}
                    </dd>
                  </div>
                  <div>
                    <dt>Mic stem</dt>
                    <dd>{selectedClip.microphoneTake ? selectedClip.microphoneTake.deviceLabel || 'Isolated' : 'None'}</dd>
                  </div>
                </dl>

                <div className="mini-badge telemetry-badge">
                  <span>Cursor telemetry</span>
                  <strong>
                    {selectedClip.cursorTrack
                      ? `${selectedClip.cursorTrack.points.length} sample(s) from ${selectedClip.cursorTrack.sourceKind} capture`
                      : 'This take will render with preset-only motion.'}
                  </strong>
                </div>

                <div className="mini-badge telemetry-badge">
                  <span>Audio lane</span>
                  <strong>
                    {selectedClip.audio.hasAudio
                      ? selectedClip.audio.waveformPeaks.length
                        ? `${selectedClip.audio.waveformPeaks.length} waveform buckets ready`
                        : 'Audio track detected, waveform pending analysis'
                      : 'No embedded audio detected yet'}
                  </strong>
                </div>

                <div className="mini-badge telemetry-badge">
                  <span>Voice stem</span>
                  <strong>
                    {selectedClip.microphoneTake
                      ? `${selectedClip.microphoneTake.deviceLabel || 'Mic stem'} isolated for live audition and export cleanup`
                      : 'No isolated microphone stem on this take'}
                  </strong>
                </div>

                <WaveformBars
                  peaks={selectedClip.audio.waveformPeaks}
                  className="clip-waveform"
                />

                <div className="field-grid">
                  <label className="field-block">
                    <span>Trim start (seconds)</span>
                    <input
                      value={trimStartDraft}
                      onChange={(event) => setTrimStartDraft(event.target.value)}
                      placeholder="0"
                    />
                  </label>

                  <label className="field-block">
                    <span>Trim end (seconds)</span>
                    <input
                      value={trimEndDraft}
                      onChange={(event) => setTrimEndDraft(event.target.value)}
                      placeholder="Full clip"
                    />
                  </label>
                </div>

                <label className="field-block">
                  <span>Motion treatment</span>
                  <select
                    value={selectedClip.captureProfile.motionPresetId}
                    onChange={(event) => void updateSelectedClipCaptureProfile(event.target.value)}
                  >
                    {motionPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    {selectedClip.cursorTrack
                      ? `${selectedClip.cursorTrack.points.length} cursor sample(s) will steer this treatment during clip and sequence exports.`
                      : selectedClipMotionPreset?.description ??
                        'The current motion treatment will be applied during clip and sequence exports.'}
                  </small>
                </label>

                <div className="field-grid">
                  <label className="toggle-row audio-toggle">
                    <span>Mute clip audio</span>
                    <input
                      type="checkbox"
                      checked={clipAudioMutedDraft}
                      onChange={(event) => setClipAudioMutedDraft(event.target.checked)}
                      disabled={!selectedClip.audio.hasAudio}
                    />
                  </label>

                  <label className="field-block">
                    <span>Clip gain</span>
                    <input
                      type="range"
                      min="-18"
                      max="12"
                      step="0.5"
                      value={clipAudioGainDraft}
                      onChange={(event) => setClipAudioGainDraft(Number(event.target.value))}
                      disabled={!selectedClip.audio.hasAudio || clipAudioMutedDraft}
                    />
                    <small>
                      {selectedClip.audio.hasAudio
                        ? `Current gain: ${formatGainDb(clipAudioGainDraft)}`
                        : 'Analyze or capture a clip with audio to enable gain staging.'}
                    </small>
                  </label>
                </div>

                <label className="field-block">
                  <span>Clip notes</span>
                  <textarea
                    rows={5}
                    value={clipNotesDraft}
                    onChange={(event) => setClipNotesDraft(event.target.value)}
                    placeholder="Hook, narration beats, retake notes, edit ideas"
                  />
                </label>

                <label className="field-block">
                  <span>Export file name</span>
                  <input
                    value={exportNameDraft}
                    onChange={(event) => setExportNameDraft(event.target.value)}
                    placeholder="clip-export"
                  />
                </label>

                <div className="panel-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void analyzeSelectedClipAudio()}
                    disabled={isAnalyzingSelectedClipAudio}
                  >
                    {isAnalyzingSelectedClipAudio ? 'Analyzing audio...' : 'Analyze audio lane'}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={handleExportSelectedClip}
                    disabled={isExportingClip || !boot.ffmpeg.available}
                  >
                    {isExportingClip
                      ? `Rendering ${project.output.format.toUpperCase()}...`
                      : `Export selected clip as ${project.output.format.toUpperCase()}`}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void window.forkApi.shell.showInFolder(
                        selectedClip.lastExportPath || boot.paths.exportsRoot,
                      )
                    }
                  >
                    Open latest export
                  </button>
                  <button
                    type="button"
                    className="secondary ghost"
                    onClick={() => void handleRemoveSelectedClip()}
                  >
                    Remove selected clip
                  </button>
                </div>

                {selectedClip.exports.length ? (
                  <div className="export-log">
                    {selectedClip.exports.slice(0, 4).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="export-log-row"
                        onClick={() => void window.forkApi.shell.showInFolder(item.filePath)}
                      >
                        <strong>{formatDateTime(item.createdAt)}</strong>
                        <span>
                          {item.format.toUpperCase()} | {formatBytes(item.size)} | trim {formatEditableSeconds(item.trimStartSeconds)} to{' '}
                          {item.trimEndSeconds === null ? 'full' : formatEditableSeconds(item.trimEndSeconds)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <strong>No exports yet</strong>
                    <span>Trim and render this take into a delivery-ready export.</span>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state compact">
                <strong>No clip selected</strong>
                <span>Record a take to unlock trim, notes, and export controls.</span>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <p className="panel-kicker">Sequence Audio</p>
              <h2>Layered beds, voice cleanup and ducking</h2>
            </div>

            <div className="panel-actions">
              <button
                type="button"
                className="primary"
                onClick={handleImportMusicBed}
                disabled={isImportingMusicBed}
              >
                {isImportingMusicBed ? 'Importing bed...' : musicBeds.length ? 'Add audio bed' : 'Import first bed'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleRemoveMusicBed}
                disabled={!activeMusicBed || isRemovingMusicBed}
              >
                {isRemovingMusicBed ? 'Removing...' : 'Remove selected'}
              </button>
              <button
                type="button"
                className="secondary ghost"
                onClick={() =>
                  void window.forkApi.shell.showInFolder(
                    activeMusicBed?.filePath || boot.paths.audioRoot,
                  )
                }
              >
                Open audio folder
              </button>
            </div>

            <div className="mini-badge telemetry-badge">
              <span>Sequence mix</span>
              <strong>
                {musicBeds.length
                  ? `${enabledMusicBedCount}/${musicBeds.length} bed(s) live | ${activeMusicBed?.label ?? 'No active bed'}`
                  : 'No background beds armed for sequence exports.'}
              </strong>
            </div>

            {musicBeds.length ? (
              <div className="audio-stage">
                <div className="audio-stage-header">
                  <div>
                    <span>Audio stage</span>
                    <strong>{formatDuration(audioStageDuration)} canvas</strong>
                  </div>
                  <small>Each bed can start later, end earlier, and fade independently across the sequence.</small>
                </div>

                <div className="audio-stage-ruler">
                  <span>0s</span>
                  <span>{formatDuration(audioStageDuration)}</span>
                </div>

                <div className="audio-stage-lanes">
                  {musicBeds.map((bed) => {
                    const placement = getMusicBedPlacement(bed, audioStageDuration)
                    const automationWindow = getMusicBedAutomationWindow(bed, audioStageDuration)
                    const automationKeyframes = normalizeAutomationKeyframes(bed.automation.keyframes, {
                      startSeconds: placement.timelineStartSeconds,
                      endSeconds: placement.timelineEndSeconds,
                    })
                    const automationCurvePath = buildAutomationCurvePath(automationKeyframes, placement)
                    const leftPercent = (placement.timelineStartSeconds / audioStageDuration) * 100
                    const widthPercent = Math.max((placement.durationSeconds / audioStageDuration) * 100, 2)
                    const fadeInPercent =
                      placement.durationSeconds <= 0
                        ? 0
                        : Math.min(50, (Math.min(bed.fadeInSeconds, placement.durationSeconds) / placement.durationSeconds) * 100)
                    const fadeOutPercent =
                      placement.durationSeconds <= 0
                        ? 0
                        : Math.min(50, (Math.min(bed.fadeOutSeconds, placement.durationSeconds) / placement.durationSeconds) * 100)
                    const automationLeftPercent =
                      placement.durationSeconds <= 0
                        ? 0
                        : ((automationWindow.startSeconds - placement.timelineStartSeconds) / placement.durationSeconds) * 100
                    const automationWidthPercent =
                      placement.durationSeconds <= 0
                        ? 0
                        : Math.max((automationWindow.durationSeconds / placement.durationSeconds) * 100, 4)

                    return (
                      <button
                        key={bed.id}
                        type="button"
                        className={`audio-stage-lane ${bed.id === activeMusicBed?.id ? 'active' : ''} ${bed.enabled ? '' : 'muted'}`.trim()}
                        onClick={() => void handleSelectMusicBed(bed.id)}
                      >
                        <div className="audio-stage-copy">
                          <span>{bed.enabled ? 'Live lane' : 'Muted lane'}</span>
                          <strong>{bed.label}</strong>
                          <small>
                            {formatEditableSeconds(placement.timelineStartSeconds)}s to {formatEditableSeconds(placement.timelineEndSeconds)}s | {bed.routingMode === 'duck' ? 'ducked' : 'bypass'} | {formatGainDb(bed.gainDb)}
                          </small>
                        </div>

                        <div className="audio-stage-track">
                          <span className="audio-stage-grid" />
                          <span
                            className="audio-stage-window"
                            style={{
                              left: `${leftPercent}%`,
                              width: `${widthPercent}%`,
                            }}
                          >
                            <span className="audio-stage-window-label">{bed.sourceName}</span>
                            {bed.automation.enabled && automationWindow.durationSeconds > 0 ? (
                              <span
                                className="audio-stage-automation"
                                style={{
                                  left: `${automationLeftPercent}%`,
                                  width: `${automationWidthPercent}%`,
                                }}
                              >
                                <svg
                                  className="audio-stage-automation-svg"
                                  viewBox="0 0 100 40"
                                  preserveAspectRatio="none"
                                  aria-hidden="true"
                                >
                                  <path className="audio-stage-automation-baseline" d="M 0 20 L 100 20" />
                                  {automationCurvePath ? (
                                    <path className="audio-stage-automation-curve" d={automationCurvePath} />
                                  ) : null}
                                </svg>
                                <span className="audio-stage-automation-label">
                                  {automationKeyframes.length} point{automationKeyframes.length === 1 ? '' : 's'} | {automationWindow.minGainDb >= 0 ? '+' : ''}
                                  {automationWindow.minGainDb.toFixed(1)} to {automationWindow.maxGainDb >= 0 ? '+' : ''}
                                  {automationWindow.maxGainDb.toFixed(1)} dB
                                </span>
                              </span>
                            ) : null}
                            {fadeInPercent > 0 ? (
                              <span
                                className="audio-stage-fade in"
                                style={{
                                  width: `${fadeInPercent}%`,
                                }}
                              />
                            ) : null}
                            {fadeOutPercent > 0 ? (
                              <span
                                className="audio-stage-fade out"
                                style={{
                                  width: `${fadeOutPercent}%`,
                                }}
                              />
                            ) : null}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="empty-state compact">
                <strong>No beds loaded</strong>
                <span>Import MP3, WAV, M4A, FLAC, OGG, or OPUS layers to build the sequence mix bus.</span>
              </div>
            )}

            {activeMusicBed ? (
              <>
                <div className="detail-block section-gap">
                  <span>Selected bed</span>
                  <strong>
                    {activeMusicBed.sourceName} | {formatDuration(activeMusicBed.durationSeconds)} source | {activeMusicBed.routingMode === 'duck' ? 'music bus' : 'bypass bus'}
                  </strong>
                </div>

                <WaveformBars
                  peaks={activeMusicBed.waveformPeaks}
                  className="music-bed-waveform"
                />

                <div className="field-grid">
                  <label className="field-block">
                    <span>Bed trim start (seconds)</span>
                    <input
                      value={musicBedTrimStartDraft}
                      onChange={(event) => setMusicBedTrimStartDraft(event.target.value)}
                      placeholder="0"
                    />
                  </label>

                  <label className="field-block">
                    <span>Bed trim end (seconds)</span>
                    <input
                      value={musicBedTrimEndDraft}
                      onChange={(event) => setMusicBedTrimEndDraft(event.target.value)}
                      placeholder="Full bed"
                      disabled={musicBedLoopDraft}
                    />
                    <small>
                      {musicBedLoopDraft
                        ? 'Loop mode keeps the trimmed slice running for the full sequence.'
                        : 'Leave empty to play the remainder of the file after the trim start.'}
                    </small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field-block">
                    <span>Lane start (seconds)</span>
                    <input
                      value={musicBedTimelineStartDraft}
                      onChange={(event) => setMusicBedTimelineStartDraft(event.target.value)}
                      placeholder="0"
                    />
                    <small>Shift where this bed enters the exported sequence.</small>
                  </label>

                  <label className="field-block">
                    <span>Lane end (seconds)</span>
                    <input
                      value={musicBedTimelineEndDraft}
                      onChange={(event) => setMusicBedTimelineEndDraft(event.target.value)}
                      placeholder={musicBedLoopDraft ? 'Sequence end' : 'Natural source end'}
                    />
                    <small>
                      Leave empty to {musicBedLoopDraft ? 'run until the sequence ends' : 'stop at the trimmed source boundary'}.
                    </small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field-block">
                    <span>Bed gain</span>
                    <input
                      type="range"
                      min="-24"
                      max="12"
                      step="0.5"
                      value={musicBedGainDraft}
                      onChange={(event) => setMusicBedGainDraft(Number(event.target.value))}
                    />
                    <small>Current bed gain: {formatGainDb(musicBedGainDraft)}</small>
                  </label>

                  <label className="field-block">
                    <span>Routing</span>
                    <select
                      value={musicBedRoutingModeDraft}
                      onChange={(event) => setMusicBedRoutingModeDraft(event.target.value as TimelineMusicBed['routingMode'])}
                    >
                      {bedRoutingOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <small>{bedRoutingOptions.find((option) => option.id === musicBedRoutingModeDraft)?.detail}</small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="toggle-row audio-toggle">
                    <span>Include selected bed in mix</span>
                    <input
                      type="checkbox"
                      checked={musicBedEnabledDraft}
                      onChange={(event) => setMusicBedEnabledDraft(event.target.checked)}
                    />
                  </label>

                  <label className="field-block">
                    <span>Fade in</span>
                    <input
                      type="range"
                      min="0"
                      max="6"
                      step="0.05"
                      value={musicBedFadeInDraft}
                      onChange={(event) => setMusicBedFadeInDraft(Number(event.target.value))}
                    />
                    <small>{formatEditableSeconds(musicBedFadeInDraft)}s of entry smoothing</small>
                  </label>

                  <label className="field-block">
                    <span>Fade out</span>
                    <input
                      type="range"
                      min="0"
                      max="6"
                      step="0.05"
                      value={musicBedFadeOutDraft}
                      onChange={(event) => setMusicBedFadeOutDraft(Number(event.target.value))}
                    />
                    <small>{formatEditableSeconds(musicBedFadeOutDraft)}s of exit smoothing</small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="toggle-row audio-toggle">
                    <span>Loop selected bed</span>
                    <input
                      type="checkbox"
                      checked={musicBedLoopDraft}
                      onChange={(event) => setMusicBedLoopDraft(event.target.checked)}
                    />
                  </label>

                  <div className="detail-block">
                    <span>Bed status</span>
                    <strong>{musicBedEnabledDraft ? 'Selected bed is routed to the mix bus.' : 'Selected bed stays in the project but is muted for export.'}</strong>
                  </div>
                </div>

                <div className="detail-block section-gap">
                  <span>Automation curve</span>
                  <strong>
                    {musicBedAutomationEnabledDraft
                      ? automationDraftSummary
                        ? `${automationDraftKeyframes.length} point${automationDraftKeyframes.length === 1 ? '' : 's'} from ${formatEditableSeconds(automationDraftSummary.startSeconds)}s to ${formatEditableSeconds(automationDraftSummary.endSeconds)}s | ${formatGainDb(automationDraftSummary.minGainDb)} to ${formatGainDb(automationDraftSummary.maxGainDb)}`
                        : 'Curve armed. Click the graph or use the quick builder to seed your first envelope.'
                      : 'Automation disabled for this lane.'}
                  </strong>
                </div>

                <div className="field-grid">
                  <label className="toggle-row audio-toggle">
                    <span>Enable automation curve</span>
                    <input
                      type="checkbox"
                      checked={musicBedAutomationEnabledDraft}
                      onChange={(event) => handleToggleAutomationCurve(event.target.checked)}
                    />
                  </label>

                  <div className="detail-block">
                    <span>Curve behavior</span>
                    <strong>
                      {musicBedAutomationEnabledDraft
                        ? 'Outside the first and last point the lane returns to its base gain.'
                        : 'The lane plays at its base gain with no per-lane automation.'}
                    </strong>
                  </div>
                </div>

                <div
                  className={`automation-editor ${musicBedAutomationEnabledDraft ? '' : 'disabled'}`.trim()}
                  onClick={handleAutomationEditorClick}
                  role="presentation"
                >
                  <div className="automation-editor-grid" />
                  <svg
                    className="automation-editor-svg"
                    viewBox="0 0 100 40"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path className="automation-editor-baseline" d="M 0 20 L 100 20" />
                    {automationDraftCurvePath ? (
                      <path className="automation-editor-curve" d={automationDraftCurvePath} />
                    ) : null}
                  </svg>

                  {activeMusicBedDraftPlacement && automationDraftKeyframes.map((keyframe) => {
                    const leftPercent =
                      activeMusicBedDraftPlacement.durationSeconds <= 0
                        ? 0
                        : ((keyframe.timeSeconds - activeMusicBedDraftPlacement.timelineStartSeconds) / activeMusicBedDraftPlacement.durationSeconds) * 100
                    const bottomPercent =
                      ((keyframe.gainDb - automationGainRange.min) / (automationGainRange.max - automationGainRange.min)) * 100

                    return (
                      <button
                        key={keyframe.id}
                        type="button"
                        className={`automation-editor-point ${keyframe.id === selectedAutomationKeyframe?.id ? 'active' : ''}`.trim()}
                        style={{
                          left: `${leftPercent}%`,
                          bottom: `${bottomPercent}%`,
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedAutomationKeyframeId(keyframe.id)
                        }}
                        aria-label={`Automation point at ${formatEditableSeconds(keyframe.timeSeconds)} seconds`}
                      />
                    )
                  })}

                  <div className="automation-editor-hud">
                    <span>+18 dB</span>
                    <span>Click anywhere to add a point. Playhead {formatEditableSeconds(timelinePlayheadSeconds)}s.</span>
                    <span>-18 dB</span>
                  </div>
                </div>

                <div className="panel-actions compact">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleAddAutomationKeyframe()}
                    disabled={!musicBedAutomationEnabledDraft || !activeMusicBedDraftPlacement}
                  >
                    Add point at playhead
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleResetAutomationCurve}
                    disabled={!activeMusicBedDraftPlacement}
                  >
                    Rebuild from quick builder
                  </button>
                  <button
                    type="button"
                    className="secondary ghost"
                    onClick={handleRemoveAutomationKeyframe}
                    disabled={!selectedAutomationKeyframe || automationDraftKeyframes.length <= 2}
                  >
                    Remove selected point
                  </button>
                </div>

                <div className="field-grid">
                  <label className="field-block">
                    <span>Selected point time (seconds)</span>
                    <input
                      value={selectedAutomationKeyframe ? formatEditableSeconds(selectedAutomationKeyframe.timeSeconds) : ''}
                      onChange={(event) => {
                        const parsedSeconds = parseSecondsInput(event.target.value)
                        if (parsedSeconds === undefined || !selectedAutomationKeyframe) {
                          return
                        }

                        handleUpdateAutomationKeyframe(
                          selectedAutomationKeyframe.id,
                          {
                            timeSeconds: parsedSeconds ?? activeMusicBedDraftPlacement?.timelineStartSeconds ?? 0,
                          },
                        )
                      }}
                      placeholder={musicBedTimelineStartDraft || '0'}
                      disabled={!musicBedAutomationEnabledDraft || !selectedAutomationKeyframe}
                    />
                  </label>

                  <label className="field-block">
                    <span>Selected point gain</span>
                    <input
                      type="range"
                      min={String(automationGainRange.min)}
                      max={String(automationGainRange.max)}
                      step="0.5"
                      value={selectedAutomationKeyframe?.gainDb ?? 0}
                      onChange={(event) => {
                        if (!selectedAutomationKeyframe) {
                          return
                        }

                        handleUpdateAutomationKeyframe(selectedAutomationKeyframe.id, {
                          gainDb: Number(event.target.value),
                        })
                      }}
                      disabled={!musicBedAutomationEnabledDraft || !selectedAutomationKeyframe}
                    />
                    <small>
                      {selectedAutomationKeyframe
                        ? `Current point gain: ${formatGainDb(selectedAutomationKeyframe.gainDb)}`
                        : 'Select a point from the curve to tune its gain.'}
                    </small>
                  </label>
                </div>

                <div className="detail-block section-gap">
                  <span>Quick curve builder</span>
                  <strong>Seed a reusable dip/boost shape, then refine it with freeform keyframes.</strong>
                </div>

                <div className="field-grid">
                  <label className="field-block">
                    <span>Builder start (seconds)</span>
                    <input
                      value={musicBedAutomationStartDraft}
                      onChange={(event) => setMusicBedAutomationStartDraft(event.target.value)}
                      placeholder={musicBedTimelineStartDraft || '0'}
                    />
                  </label>

                  <label className="field-block">
                    <span>Builder end (seconds)</span>
                    <input
                      value={musicBedAutomationEndDraft}
                      onChange={(event) => setMusicBedAutomationEndDraft(event.target.value)}
                      placeholder="Lane end"
                    />
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field-block">
                    <span>Builder gain</span>
                    <input
                      type="range"
                      min={String(automationGainRange.min)}
                      max={String(automationGainRange.max)}
                      step="0.5"
                      value={musicBedAutomationGainDraft}
                      onChange={(event) => setMusicBedAutomationGainDraft(Number(event.target.value))}
                    />
                    <small>{formatGainDb(musicBedAutomationGainDraft)} for the seeded curve body</small>
                  </label>

                  <label className="field-block">
                    <span>Builder ramp</span>
                    <input
                      type="range"
                      min="0"
                      max="6"
                      step="0.05"
                      value={musicBedAutomationRampDraft}
                      onChange={(event) => setMusicBedAutomationRampDraft(Number(event.target.value))}
                    />
                    <small>{formatEditableSeconds(musicBedAutomationRampDraft)}s of entry/exit taper for the seeded curve</small>
                  </label>
                </div>

                <div className="detail-block">
                  <span>Routing outcome</span>
                  <strong>
                    {musicBedRoutingModeDraft === 'duck'
                      ? 'This lane joins the music bus and will be sidechained under narration.'
                      : 'This lane bypasses ducking and stays full-presence in the final mix.'}
                  </strong>
                </div>
              </>
            ) : null}

            <div className="detail-block section-gap">
              <span>Voice clarity</span>
            </div>

            <div className="field-grid">
              <label className="toggle-row audio-toggle">
                <span>Enable voice clarity</span>
                <input
                  type="checkbox"
                  checked={voiceClarityEnabledDraft}
                  onChange={(event) => setVoiceClarityEnabledDraft(event.target.checked)}
                />
              </label>

              <label className="field-block">
                <span>Cleanup profile</span>
                <select
                  value={voiceClarityProfileDraft}
                  onChange={(event) => setVoiceClarityProfileDraft(event.target.value as VoiceClarityProfile)}
                  disabled={!voiceClarityEnabledDraft}
                >
                  {voiceClarityProfileOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>
                  {voiceClarityProfileOptions.find((option) => option.id === voiceClarityProfileDraft)?.detail ||
                    'Clean up the isolated microphone stem during stage preview and export.'}
                </small>
              </label>
            </div>

            <div className="detail-block">
              <span>Mic stem workflow</span>
              <strong>
                {voiceClarityEnabledDraft
                  ? 'New captures keep the microphone isolated, audition that stem live in the stage, then clean and level it during clip and timeline exports.'
                  : 'New captures still isolate the microphone stem, and the stage can audition it raw before export.'}
              </strong>
            </div>

            <div className="detail-block section-gap">
              <span>Ducking automation</span>
            </div>

            <div className="field-grid">
              <label className="toggle-row audio-toggle">
                <span>Enable ducking</span>
                <input
                  type="checkbox"
                  checked={duckingEnabledDraft}
                  onChange={(event) => setDuckingEnabledDraft(event.target.checked)}
                  disabled={!activeMusicBed}
                />
              </label>

              <label className="field-block">
                <span>Ducking amount</span>
                <input
                  type="range"
                  min="0"
                  max="18"
                  step="1"
                  value={duckingReductionDraft}
                  onChange={(event) => setDuckingReductionDraft(Number(event.target.value))}
                  disabled={!activeMusicBed || !duckingEnabledDraft}
                />
                <small>{duckingReductionDraft} dB of target reduction under voice activity</small>
              </label>
            </div>

            <div className="field-grid">
              <label className="field-block">
                <span>Attack</span>
                <input
                  type="range"
                  min="20"
                  max="600"
                  step="10"
                  value={duckingAttackDraft}
                  onChange={(event) => setDuckingAttackDraft(Number(event.target.value))}
                  disabled={!activeMusicBed || !duckingEnabledDraft}
                />
                <small>{duckingAttackDraft} ms</small>
              </label>

              <label className="field-block">
                <span>Release</span>
                <input
                  type="range"
                  min="80"
                  max="2000"
                  step="20"
                  value={duckingReleaseDraft}
                  onChange={(event) => setDuckingReleaseDraft(Number(event.target.value))}
                  disabled={!activeMusicBed || !duckingEnabledDraft}
                />
                <small>{duckingReleaseDraft} ms</small>
              </label>
            </div>

            <div className="detail-block">
              <span>Export behavior</span>
              <strong>
                {project.output.format === 'gif'
                  ? 'GIF exports stay silent. Sequence beds only apply to MP4 exports.'
                  : enabledMusicBedCount
                    ? `Sequence exports will place ${enabledMusicBedCount} enabled bed(s) on the audio stage, apply fades and automation windows, route ${duckedMusicBedCount} through ducking, keep ${bypassMusicBedCount} in bypass, and ${voiceClarityEnabledDraft ? `clean isolated mic stems in ${voiceClarityProfileDraft} mode` : 'leave isolated mic stems untouched'} when available.`
                    : `Sequence exports currently use clip audio, isolated mic stems when available, and silence fills${voiceClarityEnabledDraft ? ` with ${voiceClarityProfileDraft} voice cleanup on the mic path` : ''}.`}
              </strong>
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <p className="panel-kicker">Render Engine</p>
              <h2>FFmpeg and output defaults</h2>
            </div>

            <div className="engine-status" data-ready={boot.ffmpeg.available}>
              <strong>{boot.ffmpeg.available ? 'FFmpeg ready' : 'FFmpeg missing'}</strong>
              <span>
                {boot.ffmpeg.version || 'Waiting for ffmpeg.exe detection'}
                {activeOutputFormat ? ` | ${activeOutputFormat.label}` : ''}
              </span>
              {boot.ffmpeg.available ? (
                <small>
                  {boot.ffmpeg.managed ? 'Managed local toolchain' : 'Direct external binary'}
                  {boot.ffmpeg.preferredVideoEncoder ? ` | ${boot.ffmpeg.preferredVideoEncoder}` : ''}
                  {boot.ffmpeg.supportsAdvancedCompositing ? ' | advanced compositor' : ''}
                </small>
              ) : null}
            </div>

            <div className="field-grid">
              <label className="field-block">
                <span>Output format</span>
                <select
                  value={project.output.format}
                  onChange={(event) =>
                    void handleProjectOutputChange({
                      format: event.target.value as LocalProject['output']['format'],
                    })
                  }
                >
                  {outputFormatOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>{activeOutputFormat?.detail}</small>
              </label>

              <label className="field-block">
                <span>Delivery canvas</span>
                <select
                  value={project.output.aspectPreset}
                  onChange={(event) =>
                    void handleProjectOutputChange({
                      aspectPreset: event.target.value as LocalProject['output']['aspectPreset'],
                    })
                  }
                >
                  {outputAspectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-grid">
              <label className="field-block">
                <span>Encoder preset</span>
                <select
                  value={project.output.preset}
                  onChange={(event) =>
                    void handleProjectOutputChange({
                      preset: event.target.value,
                    })
                  }
                >
                  <option value="medium">medium</option>
                  <option value="slow">slow</option>
                  <option value="slower">slower</option>
                </select>
                <small>
                  {project.output.format === 'gif'
                    ? 'Used for intermediate renders before GIF conversion.'
                    : 'Higher presets trade speed for cleaner compression.'}
                </small>
              </label>

              <label className="field-block">
                <span>CRF quality</span>
                <input
                  type="range"
                  min="14"
                  max="28"
                  value={project.output.crf}
                  onChange={(event) =>
                    void handleProjectOutputChange({
                      crf: Number(event.target.value),
                    })
                  }
                />
                <small>Current CRF: {project.output.crf}</small>
              </label>
            </div>

            <div className="field-grid">
              <label className="field-block">
                <span>Video codec</span>
                <select
                  value={project.output.videoCodec}
                  onChange={(event) =>
                    void handleProjectOutputChange({
                      videoCodec: event.target.value,
                    })
                  }
                  disabled={project.output.format === 'gif'}
                >
                  <option value="libx264">H.264 / libx264</option>
                  <option value="libx265">H.265 / libx265</option>
                </select>
                <small>
                  {project.output.format === 'gif'
                    ? 'GIF ignores the final codec but still uses the encoder for timeline intermediates.'
                    : 'H.265 is smaller and slower; H.264 is the compatibility default.'}
                </small>
              </label>

              <label className="field-block">
                <span>Framing mode</span>
                <select
                  value={project.output.fitMode}
                  onChange={(event) =>
                    void handleProjectOutputChange({
                      fitMode: event.target.value as LocalProject['output']['fitMode'],
                    })
                  }
                >
                  {outputFitModeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {project.output.format === 'gif' ? (
              <label className="field-block">
                <span>GIF frame rate</span>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={project.output.gifFps}
                  onChange={(event) =>
                    void handleProjectOutputChange({
                      gifFps: Number(event.target.value),
                    })
                  }
                />
                <small>Current GIF fps: {project.output.gifFps}</small>
              </label>
            ) : null}

            <label className="field-block">
              <span>Sequence export name</span>
              <input
                value={timelineExportNameDraft}
                onChange={(event) => setTimelineExportNameDraft(event.target.value)}
                placeholder="timeline-export"
              />
            </label>

            <div className="panel-actions">
              <button
                type="button"
                className="primary"
                onClick={handleExportTimeline}
                disabled={isExportingTimeline || !boot.ffmpeg.available || !enabledTimelineItemCount}
              >
                {isExportingTimeline
                  ? `Rendering ${project.output.format.toUpperCase()} sequence...`
                  : `Export full timeline as ${project.output.format.toUpperCase()}`}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void window.forkApi.shell.showInFolder(
                    project.timeline.lastExportPath || boot.paths.exportsRoot,
                  )
                }
              >
                Open latest sequence
              </button>
            </div>

            {project.timeline.exports.length ? (
              <div className="export-log">
                {project.timeline.exports.slice(0, 4).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="export-log-row"
                    onClick={() => void window.forkApi.shell.showInFolder(item.filePath)}
                  >
                    <strong>{formatDateTime(item.createdAt)}</strong>
                    <span>
                      {item.format.toUpperCase()} | {formatBytes(item.size)} | {item.itemCount} items | {formatDuration(item.durationSeconds)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <strong>No sequence exports yet</strong>
                <span>Assemble enabled timeline items and render the complete walkthrough into the chosen delivery format.</span>
              </div>
            )}

            <div className="detail-block">
              <span>Projects</span>
              <strong>{boot.paths.projectsRoot}</strong>
            </div>
            <div className="detail-block">
              <span>Exports</span>
              <strong>{boot.paths.exportsRoot}</strong>
            </div>
            <div className="detail-block">
              <span>Imported legacy state</span>
              <strong>{boot.paths.importsRoot}</strong>
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
  }

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="studio-header-left">
          <button
            type="button"
            className={`menu-trigger ${isFileMenuOpen ? 'open' : ''}`.trim()}
            onClick={() => setIsFileMenuOpen((currentState) => !currentState)}
            aria-label="Open file menu"
          >
            <StudioIcon name="menu" />
          </button>

          <div className="studio-brand-lockup" aria-label="Movion studio">
            <span className="studio-logo-mark" aria-hidden="true" />
            <div className="studio-logo-copy">
              <strong>MOVION</strong>
              <small>Editorial capture studio</small>
            </div>
          </div>

          <div className="studio-file-meta">
            <strong>*{project.title}.movion</strong>
            <span>{projectMetaLabel}</span>
          </div>

          {isFileMenuOpen ? (
            <div className="studio-file-menu">
              <button
                type="button"
                className="file-menu-row"
                onClick={() => {
                  setIsFileMenuOpen(false)
                  void handleCreateProject()
                }}
                disabled={projectWorkspaceLocked}
              >
                <strong>New Project</strong>
                <span>Ctrl N</span>
              </button>
              <button
                type="button"
                className="file-menu-row"
                onClick={() => {
                  setIsFileMenuOpen(false)
                  void handleDuplicateProject(project.id)
                }}
                disabled={projectWorkspaceLocked}
              >
                <strong>Duplicate project</strong>
                <span>Create branch</span>
              </button>
              <button
                type="button"
                className="file-menu-row"
                onClick={() => {
                  setIsFileMenuOpen(false)
                  void window.forkApi.shell.showInFolder(lastSavedPath || boot.paths.capturesRoot)
                }}
              >
                <strong>Open captures</strong>
                <span>Latest recordings</span>
              </button>
              <button
                type="button"
                className="file-menu-row"
                onClick={() => {
                  setIsFileMenuOpen(false)
                  void window.forkApi.shell.showInFolder(lastExportPath || boot.paths.exportsRoot)
                }}
              >
                <strong>Open exports</strong>
                <span>{totalExportCount} file{totalExportCount === 1 ? '' : 's'}</span>
              </button>
              <button
                type="button"
                className="file-menu-row"
                onClick={() => {
                  setIsFileMenuOpen(false)
                  void window.forkApi.shell.showInFolder(boot.paths.runtimeLogFile)
                }}
              >
                <strong>Open Logs</strong>
                <span>Runtime diagnostics</span>
              </button>
              <button
                type="button"
                className="file-menu-row"
                onClick={() => {
                  setIsFileMenuOpen(false)
                  void scanImportState()
                }}
                disabled={isScanningImport}
              >
                <strong>Scan legacy data</strong>
                <span>{isScanningImport ? 'Scanning...' : 'Inspect previous install'}</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="studio-header-right">
          <div className="studio-header-statuses" aria-label="Studio status">
            <span className="studio-header-badge">
              <strong>Motion</strong>
              <small>{activeMotionPreset?.label ?? 'Ready'}</small>
            </span>
            <span className={`studio-header-badge runtime ${boot.ffmpeg.available ? 'ready' : 'warning'}`.trim()}>
              <strong>Engine</strong>
              <small>{boot.ffmpeg.available ? 'Ready' : 'Needs FFmpeg'}</small>
            </span>
          </div>
          <button
            type="button"
            className="secondary studio-header-action"
            onClick={() => void window.forkApi.shell.showInFolder(lastExportPath || boot.paths.exportsRoot)}
          >
            <StudioIcon name="folder" />
            <span>Exports</span>
          </button>
          <button
            type="button"
            className="chrome-button"
            onClick={() => void refreshSources()}
            aria-label="Refresh sources"
          >
            <StudioIcon name="spark" />
          </button>
        </div>
      </header>

      <section className="studio-command-deck">
        <aside className="studio-rail-panel">
          <div className="studio-rail-head">
            <span>Studio</span>
            <strong>Tools</strong>
          </div>

          <nav className="studio-rail" aria-label="Studio sections">
            {railItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rail-button ${activeStudioSection === item.id ? 'active' : ''}`.trim()}
                onClick={() => setActiveStudioSection(item.id)}
                aria-label={item.label}
                aria-current={activeStudioSection === item.id ? 'page' : undefined}
                title={item.label}
              >
                <span className="rail-button-icon">
                  <StudioIcon name={item.icon} />
                </span>
                <span className="rail-button-copy">
                  <strong>{item.label}</strong>
                </span>
              </button>
            ))}
          </nav>

          <div className="studio-rail-foot">
            <span>Active</span>
            <strong>{activeRailItem.label}</strong>
            <small>
              {projectClipCount} clip{projectClipCount === 1 ? '' : 's'} / {enabledTimelineItemCount} live
            </small>
          </div>
        </aside>

        <section className="studio-workspace">
          <div className="studio-hero-band">
            <article className="studio-hero-card emphasis">
              <span>Project</span>
              <strong>{project.title}</strong>
              <small>{projectMetaLabel}</small>
            </article>
            <article className="studio-hero-card primary">
              <span>Clip</span>
              <strong>{activeClipLabel}</strong>
              <small>{activeClipMeta}</small>
            </article>
            <article className="studio-hero-card meta">
              <span>Motion</span>
              <strong>{activeMotionPreset?.label ?? 'Motion ready'}</strong>
              <small>{motionSummaryLabel} / {motionSupportLabel}</small>
            </article>
            <article className="studio-hero-card meta">
              <span>Delivery</span>
              <strong>{activeOutputFormat?.label ?? project.output.format.toUpperCase()}</strong>
              <small>{deliveryStatusLabel} / {lastArtifactName}</small>
            </article>
          </div>

          <div className="studio-editor-grid">
            <aside className="studio-inspector">
          <div className="inspector-scroll">
            {activeStudioSection === 'background' ? (
              <>
                <div className="inspector-header">
                  <p>Background</p>
                  <h2>Canvas styling</h2>
                </div>

                <div className="segment-tabs">
                  {backgroundModes.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`segment-chip ${backgroundMode === mode.id ? 'active' : ''}`.trim()}
                      onClick={() => {
                        setBackgroundMode(mode.id)
                        void handleProjectBackgroundChange({
                          mode: mode.id,
                        })
                      }}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {backgroundMode === 'wallpaper' ? (
                  <section className="inspector-section">
                    <div className="section-title">
                      <span>Wallpaper</span>
                      <strong>Atmospheres</strong>
                    </div>
                    <div className="preset-swatch-grid">
                      {wallpaperPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`preset-swatch ${activeBackgroundSettings.wallpaperId === preset.id ? 'active' : ''}`.trim()}
                          style={{ backgroundImage: buildPresetBackgroundImage(preset) }}
                          onClick={() =>
                            void handleProjectBackgroundChange({
                              mode: 'wallpaper',
                              wallpaperId: preset.id,
                            })
                          }
                          aria-label={preset.label}
                          title={preset.label}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}

                {backgroundMode === 'image' ? (
                  <section className="inspector-section">
                    <div className="section-title">
                      <span>Image</span>
                      <strong>Backdrop</strong>
                    </div>
                    <div className="image-upload-card">
                      {activeBackgroundSettings.imagePath ? (
                        <>
                          <div className="image-upload-preview" style={buildBackgroundLayerStyle(activeBackgroundSettings)} />
                          <strong>{activeBackgroundSettings.imagePath.split('\\').pop()}</strong>
                          <span>Local image</span>
                        </>
                      ) : (
                        <>
                          <strong>Add background image</strong>
                          <span>PNG, JPG, or WEBP</span>
                        </>
                      )}
                      <div className="image-upload-actions">
                        <button type="button" className="primary" onClick={handleImportBackgroundImage}>
                          Choose image
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={handleClearBackgroundImage}
                          disabled={!activeBackgroundSettings.imagePath}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}

                {backgroundMode === 'gradient' ? (
                  <section className="inspector-section">
                    <div className="section-title">
                      <span>Gradient</span>
                      <strong>Gradients</strong>
                    </div>
                    <div className="preset-swatch-grid wide">
                      {gradientPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`preset-swatch wide ${activeBackgroundSettings.gradientId === preset.id ? 'active' : ''}`.trim()}
                          style={{ backgroundImage: buildPresetBackgroundImage(preset) }}
                          onClick={() =>
                            void handleProjectBackgroundChange({
                              mode: 'gradient',
                              gradientId: preset.id,
                            })
                          }
                        >
                          <span>{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {backgroundMode === 'color' ? (
                  <section className="inspector-section">
                    <div className="section-title">
                      <span>Color</span>
                      <strong>Solid fill</strong>
                    </div>
                    <div className="color-chip-row">
                      {backgroundColorChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className={`color-chip ${activeBackgroundSettings.colorValue.toLowerCase() === chip.toLowerCase() ? 'active' : ''}`.trim()}
                          style={{ backgroundColor: chip }}
                          onClick={() =>
                            void handleProjectBackgroundChange({
                              mode: 'color',
                              colorValue: chip,
                            })
                          }
                          aria-label={chip}
                        />
                      ))}
                    </div>
                    <label className="field-block">
                      <span>Custom color</span>
                      <input
                        type="color"
                        value={activeBackgroundSettings.colorValue}
                        onChange={(event) =>
                          void handleProjectBackgroundChange({
                            mode: 'color',
                            colorValue: event.target.value,
                          })
                        }
                      />
                    </label>
                  </section>
                ) : null}

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Blur</span>
                    <strong>Backdrop blur</strong>
                  </div>
                  <div className="slider-row">
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.01"
                      value={activeBackgroundSettings.blur}
                      onChange={(event) =>
                        void handleProjectBackgroundChange({
                          blur: Number(event.target.value),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="secondary ghost"
                      onClick={() =>
                        void handleProjectBackgroundChange({
                          blur: defaultBackgroundStudioSettings.blur,
                        })
                      }
                    >
                      Reset
                    </button>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Shape</span>
                    <strong>Surface</strong>
                  </div>
                  <label className="field-block">
                    <span>Padding</span>
                    <input
                      type="range"
                      min="0"
                      max="0.22"
                      step="0.01"
                      value={activeBackgroundSettings.padding}
                      onChange={(event) =>
                        void handleProjectBackgroundChange({
                          padding: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field-block">
                    <span>Rounded corners</span>
                    <input
                      type="range"
                      min="0"
                      max="0.18"
                      step="0.01"
                      value={activeBackgroundSettings.radius}
                      onChange={(event) =>
                        void handleProjectBackgroundChange({
                          radius: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field-block">
                    <span>Shadows</span>
                    <input
                      type="range"
                      min="0"
                      max="0.9"
                      step="0.01"
                      value={activeBackgroundSettings.shadow}
                      onChange={(event) =>
                        void handleProjectBackgroundChange({
                          shadow: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Canvas</span>
                    <strong>Aspect</strong>
                  </div>
                  <div className="option-pills">
                    {outputAspectOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`pill-button ${project.output.aspectPreset === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectOutputChange({
                            aspectPreset: option.id as LocalProject['output']['aspectPreset'],
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Fit</span>
                    <strong>Frame fit</strong>
                  </div>
                  <div className="option-pills">
                    {outputFitModeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`pill-button ${project.output.fitMode === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectOutputChange({
                            fitMode: option.id as LocalProject['output']['fitMode'],
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : null}

            {activeStudioSection === 'capture' ? (
              <>
                <div className="inspector-header">
                  <p>Capture</p>
                  <h2>Capture setup</h2>
                </div>

                <div className="inspector-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={handleStartRecording}
                    disabled={isRecording || isStartingRecording || !selectedSource}
                  >
                    {isStartingRecording ? 'Preparing...' : 'Start recording'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleStopRecording}
                    disabled={!isRecording}
                  >
                    Stop and save
                  </button>
                </div>

                <section className="inspector-section">
                  <div className="metric-grid">
                    <article>
                      <span>Status</span>
                      <strong>{isRecording ? 'Recording' : 'Idle'}</strong>
                    </article>
                    <article>
                      <span>Timer</span>
                      <strong>{formatTimer(recordingSeconds)}</strong>
                    </article>
                    <article>
                      <span>Clips</span>
                      <strong>{project.clips.length}</strong>
                    </article>
                    <article>
                      <span>Inputs</span>
                      <strong>
                        {settings.capture.includeSystemAudio ? 'System' : 'Silent'}
                        {settings.capture.includeMicrophone ? ' + Mic' : ''}
                      </strong>
                    </article>
                    <article>
                      <span>Auto zoom</span>
                      <strong>{autoZoomDetectionOptions.find((option) => option.id === settings.capture.autoZoomMode)?.label || 'Off'}</strong>
                    </article>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Sources</span>
                    <strong>{sources.length} detected</strong>
                  </div>
                  <div className="source-list">
                    {sources.map((source) => (
                      <button
                        key={source.id}
                        type="button"
                        className={`source-row ${source.id === settings.capture.selectedSourceId ? 'active' : ''}`.trim()}
                        aria-label={`${source.name}, ${source.kind}${source.displayId ? `, display ${source.displayId}` : ''}`}
                        onClick={() =>
                          void persistSettings({
                            capture: {
                              selectedSourceId: source.id,
                            },
                          })
                        }
                      >
                        <img src={source.thumbnailDataUrl} alt="" />
                        <div>
                          <strong>{source.name}</strong>
                          <span>
                            {source.kind}
                            {source.displayId ? ` / display ${source.displayId}` : ''}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Audio</span>
                    <strong>Input routing</strong>
                  </div>
                  <div className="setting-row">
                    <label>
                      <span>System audio</span>
                          <strong>Capture source audio.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={settings.capture.includeSystemAudio}
                      onChange={(event) =>
                        void persistSettings({
                          capture: {
                            includeSystemAudio: event.target.checked,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="setting-row">
                    <label>
                      <span>Microphone</span>
                      <strong>
                        {settings.capture.includeMicrophone
                          ? `Armed on ${activeMicrophoneDeviceLabel}.`
                          : 'Capture a separate voice stem.'}
                      </strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={settings.capture.includeMicrophone}
                      onChange={(event) =>
                        void persistSettings({
                          capture: {
                            includeMicrophone: event.target.checked,
                          },
                        })
                      }
                    />
                  </div>
                  <label className="field-block">
                    <span>Microphone source</span>
                    <select
                      value={settings.capture.microphoneDeviceId}
                      onChange={(event) =>
                        void persistSettings({
                          capture: {
                            microphoneDeviceId: event.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Default microphone</option>
                      {microphoneDevices.map((device, index) => (
                        <option key={device.deviceId || `${device.label}-${index}`} value={device.deviceId}>
                          {device.label || `Microphone ${index + 1}`}
                        </option>
                      ))}
                    </select>
                    <small>Saved as a separate voice stem.</small>
                  </label>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Auto zoom</span>
                    <strong>Create zoom blocks</strong>
                  </div>
                  <div className="option-pills">
                    {autoZoomDetectionOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`pill-button ${settings.capture.autoZoomMode === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void persistSettings({
                            capture: {
                              autoZoomMode: option.id,
                            },
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="support-note">
                    <strong>
                      {autoZoomDetectionOptions.find((option) => option.id === settings.capture.autoZoomMode)?.label || 'Off'}
                    </strong>
                    <span>
                      {autoZoomDetectionOptions.find((option) => option.id === settings.capture.autoZoomMode)?.detail ||
                        'Keep capture fully manual and add zoom blocks later.'}
                    </span>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Clips</span>
                    <strong>{projectClipCount} clip{projectClipCount === 1 ? '' : 's'}</strong>
                  </div>
                  {project.clips.length ? (
                    <div className="clip-list">
                      {project.clips.map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          className={`clip-row ${selectedClip?.id === clip.id ? 'active' : ''}`.trim()}
                          aria-label={`${clip.label}, ${formatDuration(clip.durationSeconds)}, ${clip.captureProfile.motionPresetLabel}`}
                          onClick={() => void selectClip(clip.id)}
                        >
                          {clip.thumbnailDataUrl ? (
                            <img src={clip.thumbnailDataUrl} alt="" />
                          ) : (
                            <div className="clip-row-fallback">{clip.source.kind.toUpperCase()}</div>
                          )}
                          <div>
                            <strong>{clip.label}</strong>
                          <span>{formatDuration(clip.durationSeconds)} / {clip.captureProfile.motionPresetLabel}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact">
                      <strong>No clips yet</strong>
                      <span>Record the first take to begin.</span>
                    </div>
                  )}
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Clip</span>
                    <strong>{selectedClip ? selectedClip.label : 'No clip selected'}</strong>
                  </div>

                  {selectedClip ? (
                    <>
                      <div className="metric-grid">
                        <article>
                          <span>Duration</span>
                          <strong>{formatDuration(selectedClip.durationSeconds)}</strong>
                        </article>
                        <article>
                          <span>Motion</span>
                          <strong>{selectedClip.captureProfile.motionPresetLabel}</strong>
                        </article>
                        <article>
                          <span>Zoom blocks</span>
                          <strong>{selectedClipFocusRegions.length}</strong>
                        </article>
                        <article>
                          <span>Cursor</span>
                          <strong>
                            {selectedClip.cursorTrack
                              ? `${selectedClip.cursorTrack.points.length} samples`
                              : 'Preset guided'}
                          </strong>
                        </article>
                      </div>

                      <div className="field-grid">
                        <label className="field-block">
                          <span>Trim in</span>
                          <input
                            value={trimStartDraft}
                            onChange={(event) => setTrimStartDraft(event.target.value)}
                            placeholder="0"
                          />
                        </label>

                        <label className="field-block">
                          <span>Trim out</span>
                          <input
                            value={trimEndDraft}
                            onChange={(event) => setTrimEndDraft(event.target.value)}
                            placeholder="Full clip"
                          />
                        </label>
                      </div>

                      <label className="field-block">
                        <span>Motion</span>
                        <select
                          value={selectedClip.captureProfile.motionPresetId}
                          onChange={(event) => void updateSelectedClipCaptureProfile(event.target.value)}
                        >
                          {motionPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                        <small>
                          {selectedClip.cursorTrack
                            ? 'Using live cursor guidance.'
                            : selectedClipMotionPreset?.description ??
                              'Drives clip and sequence framing.'}
                        </small>
                      </label>

                      <div className="inspector-actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={handlePreviewCrop}
                        >
                          Apply trim
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={handlePreviewAuto}
                        >
                          Reset trim
                        </button>
                        <button
                          type="button"
                          className="secondary ghost"
                          onClick={() => void handleRemoveSelectedClip()}
                        >
                          Remove clip
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state compact">
                      <strong>No clip selected</strong>
                      <span>Select a take to edit trim and motion.</span>
                    </div>
                  )}
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Zoom blocks</span>
                    <strong>
                      {selectedClip
                        ? selectedClipFocusRegions.length
                          ? `${selectedClipFocusRegions.length} manual block${selectedClipFocusRegions.length === 1 ? '' : 's'}`
                          : 'Add the first zoom'
                        : 'Select a clip first'}
                    </strong>
                  </div>

                  {selectedClip ? (
                    <>
                      <div className="inspector-actions">
                        <button
                          type="button"
                          className="primary"
                          onClick={handleAddFocusRegion}
                        >
                          Add zoom at playhead
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={handleRemoveSelectedFocusRegion}
                          disabled={!selectedFocusRegion}
                        >
                          Remove selected
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={handleApplySelectedZoomLevelToAll}
                          disabled={!selectedFocusRegion || selectedClipFocusRegions.length < 2}
                        >
                          Apply zoom to all
                        </button>
                        <button
                          type="button"
                          className="secondary ghost"
                          onClick={handleRemoveAllFocusRegions}
                          disabled={!selectedClipFocusRegions.length}
                        >
                          Remove all
                        </button>
                      </div>

                      {selectedClipFocusRegions.length ? (
                        <>
                          <label className="field-block">
                            <span>Active zoom</span>
                            <select
                              value={selectedFocusRegion?.id ?? ''}
                              onChange={(event) => setSelectedFocusRegionId(event.target.value)}
                            >
                              {selectedClipFocusRegions.map((region) => (
                                <option key={region.id} value={region.id}>
                                  {region.label} / {formatEditableSeconds(region.startSeconds)}s-{formatEditableSeconds(region.endSeconds)}s
                                </option>
                              ))}
                            </select>
                            <small>Overrides preset motion.</small>
                          </label>

                          {selectedFocusRegion ? (
                            <div className="field-grid focus-editor-grid">
                              <label className="field-block">
                                <span>Start</span>
                                <input
                                  type="number"
                                  min="0"
                                  max={selectedClip.durationSeconds}
                                  step="0.01"
                                  value={selectedFocusRegion.startSeconds}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value)
                                    if (Number.isFinite(nextValue)) {
                                      void handleUpdateSelectedFocusRegion({
                                        startSeconds: nextValue,
                                      })
                                    }
                                  }}
                                />
                              </label>
                              <label className="field-block">
                                <span>End</span>
                                <input
                                  type="number"
                                  min="0"
                                  max={selectedClip.durationSeconds}
                                  step="0.01"
                                  value={selectedFocusRegion.endSeconds}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value)
                                    if (Number.isFinite(nextValue)) {
                                      void handleUpdateSelectedFocusRegion({
                                        endSeconds: nextValue,
                                      })
                                    }
                                  }}
                                />
                              </label>
                              <label className="field-block">
                                <span>Zoom</span>
                                <input
                                  type="number"
                                  min="1.05"
                                  max="4"
                                  step="0.05"
                                  value={selectedFocusRegion.zoom}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value)
                                    if (Number.isFinite(nextValue)) {
                                      void handleUpdateSelectedFocusRegion({
                                        zoom: nextValue,
                                      })
                                    }
                                  }}
                                />
                              </label>
                              <label className="field-block">
                                <span>Focus X</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="1"
                                  step="0.01"
                                  value={selectedFocusRegion.focusX}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value)
                                    if (Number.isFinite(nextValue)) {
                                      void handleUpdateSelectedFocusRegion({
                                        focusX: nextValue,
                                      })
                                    }
                                  }}
                                />
                              </label>
                              <label className="field-block">
                                <span>Focus Y</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="1"
                                  step="0.01"
                                  value={selectedFocusRegion.focusY}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value)
                                    if (Number.isFinite(nextValue)) {
                                      void handleUpdateSelectedFocusRegion({
                                        focusY: nextValue,
                                      })
                                    }
                                  }}
                                />
                              </label>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="support-note">
                          <strong>No zoom blocks yet</strong>
                          <span>Add one at the playhead.</span>
                        </div>
                      )}
                    </>
                  ) : (
                <div className="empty-state compact">
                  <strong>No clip selected</strong>
                  <span>Select a clip to add zoom blocks.</span>
                </div>
              )}
                </section>
              </>
            ) : null}

            {activeStudioSection === 'camera' ? (
              <>
                <div className="inspector-header">
                  <p>Camera</p>
                  <h2>Camera overlay</h2>
                </div>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Enable camera</span>
                      <strong>
                        {activeCameraSettings.enabled
                          ? 'Presenter take armed.'
                          : 'Screen only.'}
                      </strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCameraSettings.enabled}
                      onChange={(event) =>
                        void handleProjectCameraChange({
                          enabled: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="metric-grid">
                    <article>
                      <span>Camera devices</span>
                      <strong>{cameraDevices.length || '0'}</strong>
                    </article>
                    <article>
                      <span>Selected camera</span>
                      <strong>{activeCameraDeviceLabel}</strong>
                    </article>
                    <article>
                      <span>Overlay</span>
                      <strong>{activeCameraSettings.shape === 'circle' ? 'Bubble' : 'Card'}</strong>
                    </article>
                    <article>
                      <span>Placement</span>
                      <strong>{cameraPositionOptions.find((option) => option.id === activeCameraSettings.position)?.label || 'Bottom right'}</strong>
                    </article>
                    <article>
                      <span>Latest clip</span>
                      <strong>{selectedClip?.cameraTake ? 'Camera attached' : 'No camera take'}</strong>
                    </article>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Device</span>
                    <strong>Presenter feed</strong>
                  </div>
                  <label className="field-block">
                    <span>Camera source</span>
                    <select
                      value={activeCameraSettings.deviceId}
                      onChange={(event) => {
                        const nextDevice = cameraDevices.find((device) => device.deviceId === event.target.value)
                        void handleProjectCameraChange({
                          deviceId: event.target.value,
                          deviceLabel: nextDevice?.label || '',
                        })
                      }}
                    >
                      <option value="">Default camera</option>
                      {cameraDevices.map((device, index) => (
                        <option key={device.deviceId || `${device.label}-${index}`} value={device.deviceId}>
                          {device.label || `Camera ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Layout</span>
                    <strong>Size and placement</strong>
                  </div>
                  <div className="slider-row">
                    <input
                      type="range"
                      min="0.14"
                      max="0.38"
                      step="0.01"
                      value={activeCameraSettings.size}
                      onChange={(event) =>
                        void handleProjectCameraChange({
                          size: Number(event.target.value),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="secondary ghost"
                      onClick={() =>
                        void handleProjectCameraChange({
                          size: defaultCameraStudioSettings.size,
                        })
                      }
                    >
                      Reset
                    </button>
                  </div>
                  <label className="field-block">
                    <span>Inset from edge</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={activeCameraSettings.offset}
                      onChange={(event) =>
                        void handleProjectCameraChange({
                          offset: Number(event.target.value),
                        })
                      }
                    />
                    <small>Move the overlay inward.</small>
                  </label>
                  <div className="option-pills">
                    {cameraPositionOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`pill-button ${activeCameraSettings.position === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectCameraChange({
                            position: option.id,
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="setting-row">
                    <label>
                      <span>Mirror camera</span>
                      <strong>Mirror the feed.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCameraSettings.mirror}
                      onChange={(event) =>
                        void handleProjectCameraChange({
                          mirror: event.target.checked,
                        })
                      }
                    />
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Shape</span>
                    <strong>Bubble or card</strong>
                  </div>
                  <div className="cursor-style-grid compact-choice-grid">
                    {cameraShapeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`cursor-style-card ${activeCameraSettings.shape === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectCameraChange({
                            shape: option.id,
                          })
                        }
                      >
                        <strong>{option.label}</strong>
                        <span>{option.detail}</span>
                      </button>
                    ))}
                  </div>
                  <label className="field-block">
                    <span>Roundness</span>
                    <input
                      type="range"
                      min="0.08"
                      max="0.48"
                      step="0.01"
                      value={activeCameraSettings.roundness}
                      onChange={(event) =>
                        void handleProjectCameraChange({
                          roundness: Number(event.target.value),
                        })
                      }
                      disabled={activeCameraSettings.shape === 'circle'}
                    />
                  </label>
                  <label className="field-block">
                    <span>Shadow</span>
                    <input
                      type="range"
                      min="0"
                      max="0.9"
                      step="0.01"
                      value={activeCameraSettings.shadow}
                      onChange={(event) =>
                        void handleProjectCameraChange({
                          shadow: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field-block">
                    <span>Border accent</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={activeCameraSettings.border}
                      onChange={(event) =>
                        void handleProjectCameraChange({
                          border: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </section>

                <section className="inspector-section">
                  <div className="support-note">
                    <strong>Separate presenter take</strong>
                    <span>Captured once, composited automatically.</span>
                  </div>
                </section>
              </>
            ) : null}

            {activeStudioSection === 'cursor' ? (
              <>
                <div className="inspector-header">
                  <p>Cursor</p>
                  <h2>Pointer behavior</h2>
                </div>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Show cursor</span>
                      <strong>
                        {activeCursorSettings.showCursor
                          ? 'Render styled pointer.'
                          : 'Hide overlay pointer.'}
                      </strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCursorSettings.showCursor}
                      onChange={(event) =>
                        void handleProjectCursorChange({
                          showCursor: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="metric-grid">
                    <article>
                      <span>Tracking</span>
                      <strong>{captureCursorTelemetryLabel}</strong>
                    </article>
                    <article>
                      <span>Mode</span>
                      <strong>{selectedSource?.kind === 'screen' ? 'Screen follow' : 'Window preset'}</strong>
                    </article>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Size</span>
                    <strong>Pointer scale</strong>
                  </div>
                  <div className="slider-row">
                    <input
                      type="range"
                      min="0.6"
                      max="2.4"
                      step="0.05"
                      value={activeCursorSettings.size}
                      onChange={(event) =>
                        void handleProjectCursorChange({
                          size: Number(event.target.value),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="secondary ghost"
                      onClick={() =>
                        void handleProjectCursorChange({
                          size: defaultCursorStudioSettings.size,
                        })
                      }
                    >
                      Reset
                    </button>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Style</span>
                    <strong>Pointer style</strong>
                  </div>
                  <div className="cursor-style-grid compact-choice-grid">
                    {cursorStyleOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`cursor-style-card ${activeCursorSettings.style === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectCursorChange({
                            style: option.id,
                          })
                        }
                      >
                        <strong>{option.label}</strong>
                        <span>{option.detail}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Force arrow</span>
                      <strong>Ignore text, hand, and resize states.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCursorSettings.alwaysPointer}
                      onChange={(event) =>
                        void handleProjectCursorChange({
                          alwaysPointer: event.target.checked,
                        })
                      }
                    />
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Click effect</span>
                    <strong>Click pulse</strong>
                  </div>
                  <div className="option-pills">
                    {cursorClickEffectOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`pill-button ${activeCursorSettings.clickEffect === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectCursorChange({
                            clickEffect: option.id,
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Smoothing</span>
                      <strong>Smooth pointer path.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCursorSettings.smoothingEnabled}
                      onChange={(event) =>
                        void handleProjectCursorChange({
                          smoothingEnabled: event.target.checked,
                        })
                      }
                    />
                  </div>
                  <div className="section-title compact-top">
                    <span>Motion curve</span>
                    <strong>Response feel</strong>
                  </div>
                  <div className="option-pills">
                    {cursorAnimationStyleOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`pill-button ${activeCursorSettings.animationStyle === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectCursorChange({
                            animationStyle: option.id,
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="support-note">
                    <strong>Shared motion engine</strong>
                    <span>Preview and export stay aligned.</span>
                  </div>
                </section>
              </>
            ) : null}

            {activeStudioSection === 'keyboard' ? (
              <>
                <div className="inspector-header">
                  <p>Keyboard</p>
                  <h2>Keyboard callouts</h2>
                </div>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Show keyboard shortcuts</span>
                      <strong>
                        {activeShortcutSettings.enabled
                          ? 'Render recorded shortcut callouts.'
                          : 'Keep shortcut telemetry hidden.'}
                      </strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeShortcutSettings.enabled}
                      onChange={(event) =>
                        void handleProjectShortcutsChange({
                          enabled: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="metric-grid">
                    <article>
                      <span>Capture telemetry</span>
                      <strong>{captureKeyboardTelemetryLabel}</strong>
                    </article>
                    <article>
                      <span>Selected clip</span>
                      <strong>
                        {selectedClipKeyboardShortcuts.length
                          ? `${selectedClipKeyboardShortcuts.length} timestamp${selectedClipKeyboardShortcuts.length === 1 ? '' : 's'}`
                          : 'No timestamps'}
                      </strong>
                    </article>
                    <article>
                      <span>Label mode</span>
                      <strong>{activeShortcutSettings.showSymbols ? 'Symbols' : 'Text labels'}</strong>
                    </article>
                    <article>
                      <span>Size</span>
                      <strong>{keyboardShortcutSizeOptions.find((option) => option.id === activeShortcutSettings.labelSize)?.label || 'Medium'}</strong>
                    </article>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Show symbols</span>
                      <strong>Prefer symbolic keycaps.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeShortcutSettings.showSymbols}
                      onChange={(event) =>
                        void handleProjectShortcutsChange({
                          showSymbols: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="cursor-style-grid compact-choice-grid">
                    {keyboardShortcutSizeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`cursor-style-card ${activeShortcutSettings.labelSize === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectShortcutsChange({
                            labelSize: option.id,
                          })
                        }
                      >
                        <strong>{option.label}</strong>
                        <span>{option.detail}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Recorded shortcuts</span>
                    <strong>
                      {selectedKeyboardShortcut
                        ? `${formatEditableSeconds(selectedKeyboardShortcut.timeSeconds)}s / ${formatKeyboardShortcutLabel(selectedKeyboardShortcut.keys, activeShortcutSettings.showSymbols)}`
                        : 'Captured shortcuts'}
                    </strong>
                  </div>

                  {selectedClipKeyboardShortcuts.length ? (
                    <>
                      <div className="panel-actions compact">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void handleSetAllKeyboardShortcutsVisibility(true)}
                        >
                          Show all
                        </button>
                        <button
                          type="button"
                          className="secondary ghost"
                          onClick={() => void handleSetAllKeyboardShortcutsVisibility(false)}
                        >
                          Hide all
                        </button>
                      </div>

                      <div className="shortcut-timestamp-list">
                        {selectedClipKeyboardShortcuts.map((shortcut) => {
                          const active = shortcut.id === selectedKeyboardShortcut?.id
                          const label = formatKeyboardShortcutLabel(shortcut.keys, activeShortcutSettings.showSymbols)

                          return (
                            <div
                              key={shortcut.id}
                              className={`shortcut-timestamp-row ${active ? 'active' : ''}`.trim()}
                            >
                              <button
                                type="button"
                                className="shortcut-timestamp-main"
                                onClick={() => setSelectedKeyboardShortcutId(shortcut.id)}
                              >
                                <span className="shortcut-timestamp-time">{formatEditableSeconds(shortcut.timeSeconds)}s</span>
                                <span className="shortcut-timestamp-label">{label}</span>
                                <span className={`shortcut-timestamp-state ${shortcut.visible !== false ? 'visible' : 'hidden'}`.trim()}>
                                  {shortcut.visible !== false ? 'Visible' : 'Hidden'}
                                </span>
                              </button>
                              <label className="shortcut-timestamp-toggle">
                                <input
                                  type="checkbox"
                                  checked={shortcut.visible !== false}
                                  onChange={(event) => {
                                    void handleToggleKeyboardShortcutVisibility(shortcut.id, event.target.checked)
                                  }}
                                  aria-label={`Toggle ${label}`}
                                />
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="support-note">
                      <strong>No shortcut data yet</strong>
                      <span>Record a take to seed shortcut timestamps.</span>
                    </div>
                  )}
                </section>
              </>
            ) : null}

            {activeStudioSection === 'captions' ? (
              <>
                <div className="inspector-header">
                  <p>Captions</p>
                  <h2>Captions</h2>
                </div>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Show captions</span>
                      <strong>
                        {activeCaptionSettings.enabled
                          ? 'Render timed captions.'
                          : 'Keep transcript only.'}
                      </strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCaptionSettings.enabled}
                      onChange={(event) =>
                        void handleProjectCaptionsChange({
                          enabled: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="metric-grid">
                    <article>
                      <span>Generator</span>
                      <strong>{boot.transcription.available ? 'OpenAI ready' : 'Unavailable'}</strong>
                    </article>
                    <article>
                      <span>Selected clip</span>
                      <strong>
                        {selectedClipTranscriptSegments.length
                          ? `${selectedClipTranscriptSegments.length} line${selectedClipTranscriptSegments.length === 1 ? '' : 's'}`
                          : 'No transcript'}
                      </strong>
                    </article>
                    <article>
                      <span>Word highlight</span>
                      <strong>{activeCaptionSettings.wordHighlighting ? 'On' : 'Off'}</strong>
                    </article>
                    <article>
                      <span>Stage</span>
                      <strong>{previewCaptionSummary.label}</strong>
                    </article>
                  </div>

                  {!boot.transcription.available ? (
                    <div className="support-note">
                      <strong>Transcript generation unavailable</strong>
                      <span>{boot.transcription.reason}</span>
                    </div>
                  ) : null}
                </section>

                <section className="inspector-section">
                  <div className="setting-row">
                    <label>
                      <span>Word highlighting</span>
                      <strong>Highlight the active word.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCaptionSettings.wordHighlighting}
                      onChange={(event) =>
                        void handleProjectCaptionsChange({
                          wordHighlighting: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="setting-row">
                    <label>
                      <span>Speaker labels</span>
                      <strong>Show speaker names when available.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={activeCaptionSettings.showSpeakerLabels}
                      onChange={(event) =>
                        void handleProjectCaptionsChange({
                          showSpeakerLabels: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <label className="field-block">
                    <span>Language hint</span>
                    <input
                      value={activeCaptionSettings.languageHint}
                      onChange={(event) =>
                        void handleProjectCaptionsChange({
                          languageHint: event.target.value,
                        })
                      }
                      placeholder="en"
                    />
                    <small>ISO code, for example `en` or `ru`.</small>
                  </label>

                  <div className="cursor-style-grid compact-choice-grid">
                    {captionSizeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`cursor-style-card ${activeCaptionSettings.labelSize === option.id ? 'active' : ''}`.trim()}
                        onClick={() =>
                          void handleProjectCaptionsChange({
                            labelSize: option.id,
                          })
                        }
                      >
                        <strong>{option.label}</strong>
                        <span>{option.detail}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Transcript tools</span>
                    <strong>
                      {selectedTranscriptSegment
                        ? `${formatEditableSeconds(selectedTranscriptSegment.startSeconds)}s-${formatEditableSeconds(selectedTranscriptSegment.endSeconds)}s`
                        : selectedClip
                          ? selectedClipTranscriptSourceLabel
                          : 'Choose a clip'}
                    </strong>
                  </div>

                  <div className="action-cluster">
                    <div className="panel-actions compact">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleGenerateSelectedClipTranscript()}
                        disabled={!selectedClip || isGeneratingTranscript || !boot.transcription.available}
                      >
                        {isGeneratingTranscript ? 'Generating...' : 'Generate'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleImportSelectedClipTranscript()}
                        disabled={!selectedClip || isImportingTranscript}
                      >
                        {isImportingTranscript ? 'Importing...' : 'Import'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleCopyTranscriptAsText()}
                        disabled={!selectedClipTranscriptSegments.length}
                      >
                        Copy TXT
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleCopyTranscriptAsSrt()}
                        disabled={!selectedClipTranscriptSegments.length}
                      >
                        Copy SRT
                      </button>
                    </div>

                    <div className="panel-actions compact">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleTrimSelectedClipToTranscriptSegment()}
                        disabled={!selectedTranscriptSegment}
                      >
                        Trim
                      </button>
                      <button
                        type="button"
                        className={isRecordingAudioRetake ? 'primary' : 'secondary'}
                        onClick={() =>
                          void (isRecordingAudioRetake
                            ? handleStopSelectedTranscriptAudioRetake()
                            : handleStartSelectedTranscriptAudioRetake())
                        }
                        disabled={
                          (!selectedTranscriptSegment && !isRecordingAudioRetake) ||
                          isRecording ||
                          isStartingRecording ||
                          selectedTranscriptRetakeLimitSeconds > 15
                        }
                      >
                        {isRecordingAudioRetake
                          ? `Stop retake ${formatTimer(audioRetakeSeconds)}`
                          : 'Retake'}
                      </button>
                      <button
                        type="button"
                        className="secondary ghost"
                        onClick={() => void handleRemoveSelectedTranscriptAudioRetake()}
                        disabled={!selectedTranscriptAudioRetake || isRecordingAudioRetake}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void (
                            selectedTranscriptTimelineAction.mode === 'restore'
                              ? handleRestoreSelectedTranscriptCut()
                              : handleCutSelectedTranscriptSegmentFromTimeline()
                          )
                        }
                        disabled={selectedTranscriptTimelineAction.mode === 'unavailable'}
                      >
                        {selectedTranscriptTimelineAction.mode === 'restore' ? 'Restore' : 'Cut'}
                      </button>
                      <button
                        type="button"
                        className="secondary ghost"
                        onClick={() => void handleClearSelectedTranscript()}
                        disabled={!selectedClipTranscriptSegments.length}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="support-note transcript-action-note">
                    <strong>Cut / restore</strong>
                    <span>{selectedTranscriptTimelineAction.message}</span>
                  </div>
                  <div className="support-note transcript-action-note">
                    <strong>Retake</strong>
                    <span>
                      {isRecordingAudioRetake
                          ? `Recording / limit ${formatEditableSeconds(selectedTranscriptRetakeLimitSeconds)}s.`
                        : selectedTranscriptAudioRetake
                          ? `Saved / ${formatEditableSeconds(selectedTranscriptAudioRetake.startSeconds)}s-${formatEditableSeconds(selectedTranscriptAudioRetake.endSeconds)}s.`
                          : selectedTranscriptSegment
                            ? selectedTranscriptRetakeLimitSeconds > 15
                              ? 'Line exceeds 15s limit.'
                              : 'Record a retake.'
                            : 'Select a line.'}
                    </span>
                  </div>
                  <div className="support-note transcript-action-note">
                    <strong>Source</strong>
                    <span>
                      {boot.transcription.available
                        ? 'Generate or import.'
                        : 'Import SRT/VTT.'}
                    </span>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Transcript lines</span>
                      <strong>
                        {selectedTranscriptSegment
                          ? formatTranscriptSegmentSummary(selectedTranscriptSegment, activeCaptionSettings.showSpeakerLabels)
                          : selectedClipTranscript.status === 'error'
                            ? selectedClipTranscript.error || 'Transcript generation failed'
                            : 'Search lines'}
                      </strong>
                    </div>

                  <label className="field-block">
                    <span>Search</span>
                    <input
                      value={transcriptSearchQuery}
                      onChange={(event) => setTranscriptSearchQuery(event.target.value)}
                      placeholder="Find a phrase"
                    />
                  </label>

                  {selectedTranscriptSegment ? (
                    <label className="field-block">
                      <span>Edit line</span>
                      <textarea
                        className="transcript-editor"
                        value={transcriptSegmentTextDraft}
                        onChange={(event) => setTranscriptSegmentTextDraft(event.target.value)}
                        rows={3}
                        placeholder="Edit line"
                      />
                    </label>
                  ) : null}

                  {selectedTranscriptSegment ? (
                    <div className="panel-actions compact">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleSaveSelectedTranscriptSegmentText()}
                        disabled={!transcriptSegmentTextDraft.trim() || transcriptSegmentTextDraft.trim() === selectedTranscriptSegment.text.trim()}
                      >
                        Save line
                      </button>
                    </div>
                  ) : null}

                  {selectedClipTranscriptSegments.length ? (
                    <>
                      <div className="panel-actions compact">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void handleSetAllTranscriptSegmentsVisibility(true)}
                        >
                          Show
                        </button>
                        <button
                          type="button"
                          className="secondary ghost"
                          onClick={() => void handleSetAllTranscriptSegmentsVisibility(false)}
                        >
                          Hide
                        </button>
                      </div>

                      <div className="transcript-segment-list">
                        {filteredSelectedTranscriptSegments.map((segment) => {
                          const active = segment.id === selectedTranscriptSegment?.id
                          const label = formatTranscriptSegmentSummary(segment, activeCaptionSettings.showSpeakerLabels)
                          const sequenceState = transcriptSequenceStateBySegmentId.get(segment.id) ?? 'outside'

                          return (
                            <div
                              key={segment.id}
                              className={`transcript-segment-row ${active ? 'active' : ''} ${sequenceState}`.trim()}
                            >
                              <button
                                type="button"
                                className="transcript-segment-main"
                                onClick={() => {
                                  setSelectedTranscriptSegmentId(segment.id)
                                  handleJumpToTranscriptSegment(segment)
                                }}
                              >
                                <span className="transcript-segment-time">
                                  {formatEditableSeconds(segment.startSeconds)}s-{formatEditableSeconds(segment.endSeconds)}s
                                </span>
                                <span className="transcript-segment-text">{label}</span>
                                <span
                                  className={`transcript-segment-state ${segment.visible !== false ? 'visible' : 'hidden'} ${sequenceState}`.trim()}
                                >
                                  {segment.visible !== false
                                    ? sequenceState === 'cut'
                                      ? 'Cut'
                                      : sequenceState === 'mixed'
                                        ? 'Live + cut'
                                        : sequenceState === 'live'
                                          ? 'Live'
                                          : 'Outside'
                                    : 'Hidden'}
                                </span>
                              </button>
                              <label className="shortcut-timestamp-toggle">
                                <input
                                  type="checkbox"
                                  checked={segment.visible !== false}
                                  onChange={(event) => {
                                    void handleToggleTranscriptSegmentVisibility(segment.id, event.target.checked)
                                  }}
                                  aria-label={`Toggle ${label}`}
                                />
                              </label>
                            </div>
                          )
                        })}
                      </div>

                      {!filteredSelectedTranscriptSegments.length ? (
                        <div className="support-note">
                          <strong>No matches</strong>
                          <span>Clear search.</span>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="support-note">
                      <strong>No transcript yet</strong>
                      <span>Generate one to edit lines.</span>
                    </div>
                  )}
                </section>
              </>
            ) : null}

            {activeStudioSection === 'audio' ? (
              <>
                <div className="inspector-header">
                  <p>Audio</p>
                  <h2>Mix and cleanup</h2>
                </div>

                <section className="inspector-section">
                  <div className="metric-grid">
                    <article>
                      <span>Armed beds</span>
                      <strong>{enabledMusicBedCount}</strong>
                    </article>
                    <article>
                      <span>Duck / bypass</span>
                      <strong>{duckedMusicBedCount} / {bypassMusicBedCount}</strong>
                    </article>
                    <article>
                      <span>Stage</span>
                      <strong>{formatDuration(audioStageDuration)}</strong>
                    </article>
                    <article>
                      <span>Ducking</span>
                      <strong>{duckingEnabledDraft ? `${duckingReductionDraft} dB` : 'Off'}</strong>
                    </article>
                    <article>
                      <span>Voice clarity</span>
                      <strong>
                        {voiceClarityEnabledDraft
                          ? voiceClarityProfileOptions.find((option) => option.id === voiceClarityProfileDraft)?.label || 'Armed'
                          : 'Off'}
                      </strong>
                    </article>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Music beds</span>
                    <strong>{musicBeds.length ? `${enabledMusicBedCount} live in sequence` : 'Import the first bed'}</strong>
                  </div>

                  <div className="inspector-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={handleImportMusicBed}
                      disabled={isImportingMusicBed}
                    >
                      {isImportingMusicBed ? 'Importing...' : musicBeds.length ? 'Add bed' : 'Import bed'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleRemoveMusicBed}
                      disabled={!activeMusicBed || isRemovingMusicBed}
                    >
                      {isRemovingMusicBed ? 'Removing...' : 'Remove bed'}
                    </button>
                    <button
                      type="button"
                      className="secondary ghost"
                      onClick={() => void window.forkApi.shell.showInFolder(activeMusicBed?.filePath || boot.paths.audioRoot)}
                    >
                      Open folder
                    </button>
                  </div>

                  {musicBeds.length ? (
                    <div className="audio-bed-list">
                      {musicBeds.map((bed) => (
                        <button
                          key={bed.id}
                          type="button"
                          className={`audio-bed-row ${bed.id === activeMusicBed?.id ? 'active' : ''} ${bed.enabled ? '' : 'muted'}`.trim()}
                          onClick={() => void handleSelectMusicBed(bed.id)}
                        >
                          <strong>{bed.label}</strong>
                          <span>{bed.enabled ? 'Live' : 'Muted'} / {bed.routingMode === 'duck' ? 'Ducked' : 'Bypass'} / {formatGainDb(bed.gainDb)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact">
                      <strong>No beds loaded</strong>
                      <span>Import a music layer to build the sequence mix.</span>
                    </div>
                  )}
                </section>

                {activeMusicBed ? (
                  <section className="inspector-section">
                    <div className="section-title">
                      <span>Selected bed</span>
                      <strong>{activeMusicBed.sourceName}</strong>
                    </div>

                    <div className="metric-grid">
                      <article>
                        <span>Source</span>
                        <strong>{formatDuration(activeMusicBed.durationSeconds)}</strong>
                      </article>
                      <article>
                        <span>Routing</span>
                        <strong>{activeMusicBed.routingMode === 'duck' ? 'Duck' : 'Bypass'}</strong>
                      </article>
                      <article>
                        <span>Status</span>
                        <strong>{musicBedEnabledDraft ? 'Live' : 'Muted'}</strong>
                      </article>
                      <article>
                        <span>Loop</span>
                        <strong>{musicBedLoopDraft ? 'On' : 'Off'}</strong>
                      </article>
                    </div>

                    <div className="field-grid">
                      <label className="field-block">
                        <span>Bed gain</span>
                        <input
                          type="range"
                          min="-24"
                          max="12"
                          step="0.5"
                          value={musicBedGainDraft}
                          onChange={(event) => setMusicBedGainDraft(Number(event.target.value))}
                        />
                        <small>{formatGainDb(musicBedGainDraft)}</small>
                      </label>

                      <label className="field-block">
                        <span>Routing</span>
                        <select
                          value={musicBedRoutingModeDraft}
                          onChange={(event) => setMusicBedRoutingModeDraft(event.target.value as TimelineMusicBed['routingMode'])}
                        >
                          {bedRoutingOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <small>{bedRoutingOptions.find((option) => option.id === musicBedRoutingModeDraft)?.detail}</small>
                      </label>
                    </div>

                    <div className="field-grid">
                      <label className="toggle-row audio-toggle">
                        <span>Include in mix</span>
                        <input
                          type="checkbox"
                          checked={musicBedEnabledDraft}
                          onChange={(event) => setMusicBedEnabledDraft(event.target.checked)}
                        />
                      </label>

                      <label className="toggle-row audio-toggle">
                        <span>Loop bed</span>
                        <input
                          type="checkbox"
                          checked={musicBedLoopDraft}
                          onChange={(event) => setMusicBedLoopDraft(event.target.checked)}
                        />
                      </label>
                    </div>

                    <div className="field-grid">
                      <label className="field-block">
                        <span>Fade in</span>
                        <input
                          type="range"
                          min="0"
                          max="6"
                          step="0.05"
                          value={musicBedFadeInDraft}
                          onChange={(event) => setMusicBedFadeInDraft(Number(event.target.value))}
                        />
                        <small>{formatEditableSeconds(musicBedFadeInDraft)}s</small>
                      </label>

                      <label className="field-block">
                        <span>Fade out</span>
                        <input
                          type="range"
                          min="0"
                          max="6"
                          step="0.05"
                          value={musicBedFadeOutDraft}
                          onChange={(event) => setMusicBedFadeOutDraft(Number(event.target.value))}
                        />
                        <small>{formatEditableSeconds(musicBedFadeOutDraft)}s</small>
                      </label>
                    </div>
                  </section>
                ) : null}

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Voice clarity</span>
                    <strong>{voiceClarityEnabledDraft ? 'Cleanup on' : 'Cleanup off'}</strong>
                  </div>

                  <div className="setting-row">
                    <label>
                      <span>Enable cleanup</span>
                      <strong>Clean the isolated mic path during preview and export.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={voiceClarityEnabledDraft}
                      onChange={(event) => setVoiceClarityEnabledDraft(event.target.checked)}
                    />
                  </div>

                  <label className="field-block">
                    <span>Profile</span>
                    <select
                      value={voiceClarityProfileDraft}
                      onChange={(event) => setVoiceClarityProfileDraft(event.target.value as VoiceClarityProfile)}
                      disabled={!voiceClarityEnabledDraft}
                    >
                      {voiceClarityProfileOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <small>
                      {voiceClarityProfileOptions.find((option) => option.id === voiceClarityProfileDraft)?.detail ||
                        'Clean up the isolated microphone stem during preview and export.'}
                    </small>
                  </label>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Ducking</span>
                    <strong>{duckingEnabledDraft ? 'Voice priority on' : 'Voice priority off'}</strong>
                  </div>

                  <div className="setting-row">
                    <label>
                      <span>Enable ducking</span>
                      <strong>Push beds under narration when the voice path is active.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={duckingEnabledDraft}
                      onChange={(event) => setDuckingEnabledDraft(event.target.checked)}
                      disabled={!activeMusicBed}
                    />
                  </div>

                  <div className="field-grid">
                    <label className="field-block">
                      <span>Amount</span>
                      <input
                        type="range"
                        min="0"
                        max="18"
                        step="1"
                        value={duckingReductionDraft}
                        onChange={(event) => setDuckingReductionDraft(Number(event.target.value))}
                        disabled={!activeMusicBed || !duckingEnabledDraft}
                      />
                      <small>{duckingReductionDraft} dB</small>
                    </label>

                    <label className="field-block">
                      <span>Attack</span>
                      <input
                        type="range"
                        min="20"
                        max="600"
                        step="10"
                        value={duckingAttackDraft}
                        onChange={(event) => setDuckingAttackDraft(Number(event.target.value))}
                        disabled={!activeMusicBed || !duckingEnabledDraft}
                      />
                      <small>{duckingAttackDraft} ms</small>
                    </label>

                    <label className="field-block">
                      <span>Release</span>
                      <input
                        type="range"
                        min="80"
                        max="2000"
                        step="20"
                        value={duckingReleaseDraft}
                        onChange={(event) => setDuckingReleaseDraft(Number(event.target.value))}
                        disabled={!activeMusicBed || !duckingEnabledDraft}
                      />
                      <small>{duckingReleaseDraft} ms</small>
                    </label>
                  </div>

                  <div className="support-note">
                    <strong>Sequence mix behavior</strong>
                    <span>
                      {project.output.format === 'gif'
                        ? 'GIF exports stay silent.'
                        : enabledMusicBedCount
                          ? `${enabledMusicBedCount} bed${enabledMusicBedCount === 1 ? '' : 's'} will render into the sequence mix.`
                          : 'Sequence export uses clip and mic audio only.'}
                    </span>
                  </div>
                </section>
              </>
            ) : null}

            {activeStudioSection === 'export' ? (
              <>
                <div className="inspector-header">
                  <p>Export</p>
                  <h2>Render output</h2>
                </div>

                <section className="inspector-section">
                  <div className="engine-status" data-ready={boot.ffmpeg.available}>
                    <strong>{boot.ffmpeg.available ? 'FFmpeg ready' : 'FFmpeg missing'}</strong>
                    <span>
                      {boot.ffmpeg.version || 'Waiting for FFmpeg'}
                      {activeOutputFormat ? ` / ${activeOutputFormat.label}` : ''}
                    </span>
                    {boot.ffmpeg.available ? (
                      <small>
                        {boot.ffmpeg.managed ? 'Managed runtime' : 'External binary'}
                        {boot.ffmpeg.preferredVideoEncoder ? ` / ${boot.ffmpeg.preferredVideoEncoder}` : ''}
                        {boot.ffmpeg.supportsAdvancedCompositing ? ' / compositor ready' : ''}
                      </small>
                    ) : null}
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Delivery profile</span>
                    <strong>{activeOutputFormat?.label ?? project.output.format.toUpperCase()}</strong>
                  </div>

                  <div className="metric-grid">
                    <article>
                      <span>Format</span>
                      <strong>{activeOutputFormat?.label ?? project.output.format.toUpperCase()}</strong>
                    </article>
                    <article>
                      <span>Aspect</span>
                      <strong>{outputAspectOptions.find((option) => option.id === project.output.aspectPreset)?.label ?? project.output.aspectPreset}</strong>
                    </article>
                    <article>
                      <span>Codec</span>
                      <strong>{project.output.format === 'gif' ? 'GIF' : project.output.videoCodec === 'libx265' ? 'H.265' : 'H.264'}</strong>
                    </article>
                    <article>
                      <span>Quality</span>
                      <strong>{project.output.format === 'gif' ? `${project.output.gifFps} fps` : `CRF ${project.output.crf}`}</strong>
                    </article>
                  </div>

                  <div className="field-grid">
                    <label className="field-block">
                      <span>Format</span>
                      <select
                        value={project.output.format}
                        onChange={(event) =>
                          void handleProjectOutputChange({
                            format: event.target.value as LocalProject['output']['format'],
                          })
                        }
                      >
                        {outputFormatOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <small>{activeOutputFormat?.detail}</small>
                    </label>

                    <label className="field-block">
                      <span>Aspect</span>
                      <select
                        value={project.output.aspectPreset}
                        onChange={(event) =>
                          void handleProjectOutputChange({
                            aspectPreset: event.target.value as LocalProject['output']['aspectPreset'],
                          })
                        }
                      >
                        {outputAspectOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="field-grid">
                    <label className="field-block">
                      <span>Fit</span>
                      <select
                        value={project.output.fitMode}
                        onChange={(event) =>
                          void handleProjectOutputChange({
                            fitMode: event.target.value as LocalProject['output']['fitMode'],
                          })
                        }
                      >
                        {outputFitModeOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-block">
                      <span>Speed</span>
                      <select
                        value={project.output.preset}
                        onChange={(event) =>
                          void handleProjectOutputChange({
                            preset: event.target.value,
                          })
                        }
                      >
                        <option value="medium">Medium</option>
                        <option value="slow">Slow</option>
                        <option value="slower">Slower</option>
                      </select>
                      <small>Slower means better compression.</small>
                    </label>
                  </div>

                  <div className="field-grid">
                    <label className="field-block">
                      <span>Codec</span>
                      <select
                        value={project.output.videoCodec}
                        onChange={(event) =>
                          void handleProjectOutputChange({
                            videoCodec: event.target.value,
                          })
                        }
                        disabled={project.output.format === 'gif'}
                      >
                        <option value="libx264">H.264 / libx264</option>
                        <option value="libx265">H.265 / libx265</option>
                      </select>
                      <small>{project.output.format === 'gif' ? 'GIF ignores the final codec.' : 'H.264 is safest. H.265 is smaller.'}</small>
                    </label>

                    <label className="field-block">
                      <span>Quality</span>
                      <input
                        type="range"
                        min={project.output.format === 'gif' ? '10' : '14'}
                        max={project.output.format === 'gif' ? '24' : '28'}
                        step="1"
                        value={project.output.format === 'gif' ? project.output.gifFps : project.output.crf}
                        onChange={(event) =>
                          void handleProjectOutputChange(
                            project.output.format === 'gif'
                              ? { gifFps: Number(event.target.value) }
                              : { crf: Number(event.target.value) },
                          )
                        }
                      />
                      <small>{project.output.format === 'gif' ? `${project.output.gifFps} fps` : `CRF ${project.output.crf}`}</small>
                    </label>
                  </div>
                </section>

                {selectedClip ? (
                  <section className="inspector-section">
                    <div className="section-title">
                      <span>Clip export</span>
                      <strong>{selectedClip.label}</strong>
                    </div>

                    <div className="inspector-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={analyzeSelectedClipAudio}
                        disabled={isAnalyzingSelectedClipAudio}
                      >
                        {isAnalyzingSelectedClipAudio ? 'Analyzing...' : 'Analyze audio'}
                      </button>
                      <button
                        type="button"
                        className="secondary ghost"
                        onClick={() => void window.forkApi.shell.showInFolder(selectedClip.lastExportPath || boot.paths.exportsRoot)}
                      >
                        Open latest clip
                      </button>
                    </div>

                    <label className="field-block">
                      <span>Clip filename</span>
                      <input
                        value={exportNameDraft}
                        onChange={(event) => setExportNameDraft(event.target.value)}
                        placeholder="clip-export"
                      />
                    </label>
                    <div className="inspector-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={handleExportSelectedClip}
                        disabled={isExportingClip || !boot.ffmpeg.available}
                      >
                        {isExportingClip ? 'Rendering clip...' : 'Export clip'}
                      </button>
                    </div>
                  </section>
                ) : null}

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Sequence export</span>
                    <strong>{activeOutputFormat?.label ?? project.output.format.toUpperCase()}</strong>
                  </div>

                  <label className="field-block">
                    <span>Sequence filename</span>
                    <input
                      value={timelineExportNameDraft}
                      onChange={(event) => setTimelineExportNameDraft(event.target.value)}
                      placeholder="sequence-export"
                    />
                  </label>

                  <div className="inspector-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void window.forkApi.shell.showInFolder(project.timeline.lastExportPath || boot.paths.exportsRoot)}
                    >
                      Open latest sequence
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={handleExportTimeline}
                      disabled={isExportingTimeline || !boot.ffmpeg.available || !enabledTimelineItemCount}
                    >
                      {isExportingTimeline ? 'Rendering sequence...' : 'Export sequence'}
                    </button>
                  </div>
                </section>
              </>
            ) : null}

            {activeStudioSection === 'projects' ? (
              <>
                <div className="inspector-header">
                  <p>Workspaces</p>
                  <h2>Library</h2>
                </div>

                <section className="inspector-section">
                  <div className="metric-grid">
                    <article>
                      <span>Library</span>
                      <strong>{projectLibrary.length} saved</strong>
                    </article>
                    <article>
                      <span>Autosave</span>
                      <strong>{project.recovery.autosaveEnabled ? 'On' : 'Off'}</strong>
                    </article>
                    <article>
                      <span>Last saved</span>
                      <strong>{isSavingProject ? 'Saving...' : formatDateTime(project.recovery.lastSavedAt)}</strong>
                    </article>
                    <article>
                      <span>Active clip</span>
                      <strong>{selectedClip?.label ?? 'None'}</strong>
                    </article>
                  </div>

                  <div className="setting-row">
                    <label>
                      <span>Autosave</span>
                      <strong>Save while editing.</strong>
                    </label>
                    <input
                      type="checkbox"
                      checked={project.recovery.autosaveEnabled}
                      onChange={(event) => {
                        void handleRecoveryToggle(event.target.checked)
                      }}
                    />
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Workspace</span>
                    <strong>New or branch</strong>
                  </div>
                  <label className="field-block">
                    <span>Workspace name</span>
                    <input
                      value={projectSeedTitleDraft}
                      onChange={(event) => setProjectSeedTitleDraft(event.target.value)}
                      placeholder="Optional title"
                    />
                  </label>
                  <div className="inspector-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={handleCreateProject}
                      disabled={projectWorkspaceLocked}
                    >
                      {projectWorkspaceLocked ? 'Workspace locked...' : 'Create workspace'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void handleDuplicateProject(project.id)}
                      disabled={projectWorkspaceLocked}
                    >
                      Branch current
                    </button>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Library</span>
                    <strong>{activeProjectSummary?.title ?? 'Saved workspaces'}</strong>
                  </div>

                  {projectLibrary.length ? (
                    <div className="project-stack">
                      {projectLibrary.map((projectSummary) => (
                        <article
                          key={projectSummary.id}
                          className={`project-card ${projectSummary.isActive ? 'active' : ''}`.trim()}
                        >
                          <button
                            type="button"
                            className="project-card-main"
                            aria-label={`${projectSummary.title}, ${projectSummary.isActive ? 'active workspace' : 'saved workspace'}, ${projectSummary.clipCount} clip${projectSummary.clipCount === 1 ? '' : 's'}, ${formatDuration(projectSummary.totalTimelineDuration)}`}
                            onClick={() => void handleOpenProject(projectSummary.id)}
                            disabled={projectWorkspaceLocked || projectSummary.isActive}
                          >
                            <div className="project-card-media">
                              {projectSummary.coverThumbnailDataUrl ? (
                                <img
                                  src={projectSummary.coverThumbnailDataUrl}
                                  alt=""
                                />
                              ) : (
                                <div className="project-card-fallback">
                                  <span>{projectSummary.isActive ? 'Active workspace' : 'Ready to open'}</span>
                                </div>
                              )}
                            </div>

                            <div className="project-card-body">
                              <div className="project-card-heading">
                                <div className="project-card-title">
                                  <strong>{projectSummary.title}</strong>
                                  <small>{projectSummary.isActive ? 'Current workspace' : 'Ready to open'}</small>
                                </div>
                                <span>{projectSummary.isActive ? 'Active' : 'Standby'}</span>
                              </div>
                              {projectSummary.brief ? <p>{projectSummary.brief}</p> : null}
                              <div className="project-card-meta">
                                <span>{projectSummary.clipCount} clip{projectSummary.clipCount === 1 ? '' : 's'}</span>
                                <span>{projectSummary.enabledTimelineItemCount} live</span>
                                <span>{projectSummary.timelineItemCount} item{projectSummary.timelineItemCount === 1 ? '' : 's'}</span>
                                <span>{formatDuration(projectSummary.totalTimelineDuration)}</span>
                              </div>
                            </div>
                          </button>

                          <div className="project-card-actions">
                            <button
                              type="button"
                              className="secondary ghost"
                              onClick={() => void handleDuplicateProject(projectSummary.id)}
                              disabled={projectWorkspaceLocked}
                            >
                              Branch
                            </button>
                            <button
                              type="button"
                              className="secondary ghost"
                              onClick={() => void handleDeleteProject(projectSummary)}
                              disabled={projectWorkspaceLocked || projectLibrary.length === 1}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact">
                      <strong>No workspaces yet</strong>
                      <span>Create one to branch edits.</span>
                    </div>
                  )}
                </section>

                <section className="inspector-section">
                  <div className="section-title">
                    <span>Legacy import</span>
                    <strong>{importSummary?.detected ? 'Migration available' : 'Legacy scan'}</strong>
                  </div>

                  <div className="inspector-actions">
                    <button type="button" className="secondary" onClick={scanImportState} disabled={isScanningImport}>
                      {isScanningImport ? 'Scanning...' : 'Scan setup'}
                    </button>
                    <button type="button" className="secondary ghost" onClick={importLegacyState} disabled={isImporting}>
                      {isImporting ? 'Importing...' : 'Import data'}
                    </button>
                  </div>

                  <div className="metric-grid">
                    <article>
                      <span>Detected</span>
                      <strong>{importSummary?.detected ? 'Yes' : 'No'}</strong>
                    </article>
                    <article>
                      <span>Version</span>
                      <strong>{importSummary?.sourceVersion || 'Unknown'}</strong>
                    </article>
                    <article>
                      <span>Projects</span>
                      <strong>{importSummary?.projectCount ?? 0}</strong>
                    </article>
                    <article>
                      <span>Presets</span>
                      <strong>{importSummary?.presetCount ?? 0}</strong>
                    </article>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </aside>

          <section className="studio-stage">
            <div className="studio-preview-desk">
              <div className="studio-desk-heading">
                <div>
                  <span>Preview</span>
                  <h2>Canvas</h2>
                </div>
                <div className="studio-desk-badges">
                  <span>{previewDeskPrimaryBadge}</span>
                  <span>{previewDeskSecondaryBadge}</span>
                </div>
              </div>

          <div className="stage-toolbar">
            <div className="toolbar-left">
              <div className="preset-pill">
                <StudioIcon name="spark" />
                <label>
                  <span>Presets</span>
                  <select
                    value={settings.capture.motionPresetId}
                    onChange={(event) =>
                      void persistSettings({
                        capture: {
                          motionPresetId: event.target.value,
                        },
                      })
                    }
                  >
                    {motionPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="toolbar-center">
              <div className="toolbar-sequence-pill">
                <span>Sequence</span>
                <strong>{selectedTimelineOrderLabel}</strong>
              </div>
              <button
                type="button"
                className="chrome-button chrome-button-labeled"
                onClick={() => selectedTimelineItem && void moveTimelineItem(selectedTimelineItem.id, -1)}
                disabled={!selectedTimelineItem}
                aria-label="Move selected clip earlier"
                title="Move selected clip earlier"
              >
                <StudioIcon name="undo" />
                <span>Earlier</span>
              </button>
              <button
                type="button"
                className="chrome-button chrome-button-labeled"
                onClick={() => selectedTimelineItem && void moveTimelineItem(selectedTimelineItem.id, 1)}
                disabled={!selectedTimelineItem}
                aria-label="Move selected clip later"
                title="Move selected clip later"
              >
                <StudioIcon name="redo" />
                <span>Later</span>
              </button>
            </div>

            <div className="toolbar-right">
              <button
                type="button"
                className="secondary toolbar-share"
                onClick={() => void window.forkApi.shell.showInFolder(lastExportPath || boot.paths.exportsRoot)}
              >
                <StudioIcon name="folder" />
                <span>Open exports</span>
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (enabledTimelineItemCount) {
                    void handleExportTimeline()
                    return
                  }

                  void handleExportSelectedClip()
                }}
                disabled={
                  !boot.ffmpeg.available ||
                  (enabledTimelineItemCount
                    ? isExportingTimeline
                    : isExportingClip || !selectedClip)
                }
              >
                {enabledTimelineItemCount
                  ? isExportingTimeline
                    ? 'Exporting sequence...'
                    : 'Export sequence'
                  : isExportingClip
                    ? 'Exporting clip...'
                    : 'Export clip'}
              </button>
            </div>
          </div>

          <div className="stage-status">
            <article className="stage-status-card emphasis">
              <span>State</span>
              <strong>{stageStateLabel}</strong>
              <small>{stageStateDetail}</small>
            </article>
            <article className="stage-status-card">
              <span>{stageArtifactCaption}</span>
              <strong>{stageArtifactDetail}</strong>
              <small>{deliveryStatusLabel}</small>
            </article>
            <article className={`stage-status-card ${boot.ffmpeg.available ? 'ready' : 'warning'}`.trim()}>
              <span>Engine</span>
              <strong>{stageEngineLabel}</strong>
              <small>{stageEngineDetail}</small>
            </article>
          </div>

          {errorMessage ? <p className="error-banner stage-banner">{errorMessage}</p> : null}

          <div className="stage-frame">
            <div className="stage-canvas">
              <div className="stage-background-layer" style={stageBackgroundLayerStyle} />
              <div className="stage-background-layer blur-pass" style={{ ...stageBackgroundLayerStyle, ...stageBackgroundBlurStyle }} />
              <div
                ref={stageSurfaceRef}
                className={stageSurfaceClassName}
                style={stageSurfaceStyle}
                onClick={(event) => {
                  void handleStageSurfaceFocusPick(event)
                }}
              >
                <div className="stage-media-motion" style={stagePreviewMotionStyle}>
                  {!isRecording && stagePosterThumbnail ? (
                    <img
                      src={stagePosterThumbnail}
                      alt={stagePosterLabel}
                      className="stage-poster"
                      style={stageMediaFitStyle}
                    />
                  ) : (
                    <div className="stage-empty">
                      <strong>{selectedSource ? 'Ready to record' : 'Choose a source'}</strong>
                      <span>{selectedSource ? 'Arm the source and press Start recording.' : 'Open the Capture tab and select a screen or window.'}</span>
                    </div>
                  )}

                  <video
                    ref={stagePlaybackRef}
                    className={`stage-playback-feed ${!isRecording && previewClipContext?.fileUrl ? 'visible' : ''}`.trim()}
                    autoPlay={false}
                    preload="auto"
                    style={stageMediaFitStyle}
                    playsInline
                  />

                  <video
                    ref={stageLivePreviewRef}
                    className={`studio-live-feed ${isRecording ? 'visible' : ''}`.trim()}
                    autoPlay
                    style={stageMediaFitStyle}
                    playsInline
                  />

                  <div
                    ref={stageLiveCursorLayerRef}
                    className={`stage-live-cursor-layer ${stageLiveCursorTelemetryVisible ? 'visible' : ''}`.trim()}
                    aria-hidden="true"
                  >
                    <div ref={stageLiveCursorRef} className="stage-live-cursor">
                      <img ref={stageLiveCursorImageRef} alt="" draggable={false} />
                    </div>
                    <div ref={stageLiveCursorPulseRef} className="stage-live-cursor-pulse" />
                    <div
                      ref={stageLiveCursorIndicatorRef}
                      className="preview-cursor-indicator stage-live-cursor-indicator"
                    >
                      <span />
                    </div>
                  </div>

                  <canvas
                    ref={stageCursorCanvasRef}
                    className={`stage-cursor-overlay ${stagePlaybackCursorOverlayVisible ? 'visible' : ''}`.trim()}
                  />
                </div>

                {stageFocusEditingEnabled && selectedFocusRegion ? (
                  <button
                    type="button"
                    className="stage-focus-target"
                    style={{
                      left: `${selectedFocusRegion.focusX * 100}%`,
                      top: `${selectedFocusRegion.focusY * 100}%`,
                    }}
                    onMouseDown={beginStageFocusTargetDrag}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span />
                  </button>
                ) : null}

                <div
                  className={`stage-camera-shell ${
                    isRecording || previewCameraVisible ? 'visible' : ''
                  }`.trim()}
                  style={stageCameraStyle}
                >
                  <video
                    ref={stagePlaybackCameraRef}
                    className={`stage-camera-feed ${previewCameraVisible ? 'visible' : ''}`.trim()}
                    autoPlay={false}
                    preload="auto"
                    style={stageCameraFeedStyle}
                    playsInline
                  />
                  <video
                    ref={liveCameraPreviewRef}
                    className={`stage-camera-feed ${isRecording && activeCameraSettings.enabled ? 'visible' : ''}`.trim()}
                    autoPlay
                    muted
                    style={stageCameraFeedStyle}
                    playsInline
                  />
                </div>

                {!isRecording && activeShortcutSettings.enabled && previewActiveKeyboardShortcuts.length ? (
                  <div
                    className={`stage-shortcut-overlay size-${activeShortcutSettings.labelSize} ${previewActiveTranscriptSegment ? 'stacked' : ''}`.trim()}
                    aria-live="polite"
                  >
                    {previewActiveKeyboardShortcuts.map((shortcut) => (
                      <div key={shortcut.id} className="stage-shortcut-chip">
                        {shortcut.label}
                      </div>
                    ))}
                  </div>
                ) : null}

                {!isRecording && activeCaptionSettings.enabled && previewActiveTranscriptSegment ? (
                  <div
                    className={`stage-captions-overlay size-${activeCaptionSettings.labelSize}`.trim()}
                    aria-live="polite"
                  >
                    {activeCaptionSettings.showSpeakerLabels && previewActiveTranscriptSegment.speaker ? (
                      <span className="stage-captions-speaker">{previewActiveTranscriptSegment.speaker}</span>
                    ) : null}
                    <div className="stage-captions-line">
                      {previewCanHighlightTranscriptWords ? (
                        previewActiveTranscriptWords.map((word) => (
                          <span
                            key={word.id}
                            className={`stage-captions-word ${word.id === previewActiveTranscriptWordId ? 'active' : ''}`.trim()}
                          >
                            {word.text}
                          </span>
                        ))
                      ) : (
                        <span className="stage-captions-word active">
                          {previewActiveTranscriptSegment.text}
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="stage-chip top-left">
                <span>{isRecording ? 'Live' : 'Preview'}</span>
                <strong>{previewMediaLabel}</strong>
                <small>{previewSequenceSummary ? `${previewSequenceSummary} / ${previewStageSummaryDetail}` : previewStageSummaryDetail}</small>
              </div>

              <div className="stage-chip top-right">
                <span>Cursor</span>
                <strong>{captureCursorTelemetryLabel}</strong>
                <small>
                  {isRecording
                    ? captureKeyboardTelemetryLabel
                    : boot.ffmpeg.available
                      ? 'Engine ready'
                      : 'Export offline'}
                </small>
              </div>

              {!isRecording ? (
                <div className="stage-chip bottom-left audio-route">
                  <span>Audio</span>
                  <strong>{previewAudioStageSummary.label}</strong>
                  <small>{previewAudioStageSummary.detail}</small>
                </div>
              ) : null}

              {!isRecording ? (
                <div className="stage-chip bottom-right shortcut-route">
                  <span>Keys</span>
                  <strong>{previewKeyboardShortcutSummary.label}</strong>
                  <small>{previewKeyboardShortcutSummary.detail}</small>
                </div>
              ) : null}
            </div>
          </div>

          <div className="stage-transport">
            <div className="transport-meta">
              <div className="transport-meta-copy">
                <span>Playhead</span>
                <strong>{previewSequenceSummary || previewMediaLabel}</strong>
              </div>
              <input
                type="range"
                min="0"
                max={String(previewTimelineDuration)}
                step="0.01"
                value={timelinePlayheadSeconds}
                aria-label="Stage playhead"
                onChange={(event) => {
                  setIsStagePlaying(false)
                  setTimelinePlayheadSeconds(Number(event.target.value))
                }}
              />
            </div>

            <div className="transport-center">
              <span className="transport-timecode current">{formatTimer(Math.round(timelinePlayheadSeconds))}</span>
              <button
                type="button"
                className="chrome-button chrome-button-labeled transport-step"
                onClick={() => nudgePlayhead(-5)}
                aria-label="Jump back 5 seconds"
                title="Jump back 5 seconds"
              >
                <StudioIcon name="back" />
                <span>-5s</span>
              </button>
              <button type="button" className="play-button play-button-labeled" onClick={handleToggleStagePlayback}>
                <StudioIcon name={isStagePlaying ? 'pause' : 'play'} />
                <span>{stagePlayActionLabel}</span>
              </button>
              <button
                type="button"
                className="chrome-button chrome-button-labeled transport-step"
                onClick={() => nudgePlayhead(5)}
                aria-label="Jump forward 5 seconds"
                title="Jump forward 5 seconds"
              >
                <StudioIcon name="forward" />
                <span>+5s</span>
              </button>
              <span className="transport-timecode total">{formatTimer(Math.round(previewTimelineDuration))}</span>
            </div>

            <div className="transport-actions">
              <div className="transport-actions-copy">
                <span>{selectedTimelineItem ? 'Trim' : 'Framing'}</span>
                <strong>{selectedTimelineItem ? 'Commit or reset the selected shot' : 'Tune framing before export'}</strong>
              </div>
              <button type="button" className="secondary" onClick={() => void handlePreviewCrop()}>
                {stagePrimaryActionLabel}
              </button>
              <button type="button" className="secondary" onClick={() => void handlePreviewAuto()}>
                {stageSecondaryActionLabel}
              </button>
            </div>
          </div>

            </div>

            <section className="studio-timeline-desk">
              <div className="studio-desk-heading">
                <div>
                  <span>Timeline</span>
                  <h2>Sequence</h2>
                </div>
                <div className="studio-desk-badges">
                  <span>{timelineLiveItemsLabel}</span>
                  <span>{timelineDurationBadge}</span>
                  <span>{previewDeskSecondaryBadge}</span>
                </div>
              </div>

          <section className="studio-timeline">
            <div className="timeline-ruler-shell">
              <div className="timeline-lane-header ruler">
                <span>Time</span>
                <strong>{timelineDurationBadge}</strong>
              </div>
              <div className="timeline-ruler modern">
                {previewRulerMarks.map((mark) => (
                  <span
                    key={`${mark.label}-${mark.leftPercent}`}
                    style={{ left: `${mark.leftPercent}%` }}
                  >
                    {mark.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="timeline-lane">
              <div className="timeline-lane-header">
                <span>Clips</span>
                <strong>{clipLaneLabel}</strong>
              </div>
              <div className="timeline-band clip-band">
                <div
                  className="timeline-playhead-marker"
                  style={{
                    left: `${previewPlayheadRatio * 100}%`,
                  }}
                />
                {timelineSequence.length ? (
                  timelineSequence.map((segment) => {
                    const leftPercent = previewTimelineDuration
                      ? (segment.startSeconds / previewTimelineDuration) * 100
                      : 0
                    const widthPercent = previewTimelineDuration
                      ? Math.max((segment.bounds.durationSeconds / previewTimelineDuration) * 100, 7)
                      : 7

                    return (
                      <button
                        key={segment.item.id}
                        type="button"
                        className={`timeline-block clip ${segment.item.id === selectedTimelineItem?.id ? 'active' : ''} ${segment.item.enabled ? '' : 'muted'}`.trim()}
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                        }}
                        onClick={() => void selectTimelineItem(segment.item.id)}
                      >
                        <span>{segment.item.label}</span>
                        <strong>{formatDuration(segment.bounds.durationSeconds)}</strong>
                      </button>
                    )
                  })
                ) : selectedClip ? (
                  <button
                    type="button"
                    className="timeline-block clip active fallback"
                    style={{ left: '0%', width: '100%' }}
                    onClick={() => void addClipToTimeline(selectedClip)}
                  >
                    <span>{selectedClip.label}</span>
                    <strong>{formatDuration(selectedClip.durationSeconds)}</strong>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="timeline-lane">
              <div className="timeline-lane-header">
                <span>Motion</span>
                <strong>{motionLaneLabel}</strong>
              </div>
              <div className="timeline-band motion-band" onClick={(event) => void handleMotionBandCreate(event)}>
                <div
                  className="timeline-playhead-marker"
                  style={{
                    left: `${previewPlayheadRatio * 100}%`,
                  }}
                />
                {timelineSequence.length ? (
                  timelineSequence.map((segment) => {
                    const leftPercent = previewTimelineDuration
                      ? (segment.startSeconds / previewTimelineDuration) * 100
                      : 0
                    const widthPercent = previewTimelineDuration
                      ? Math.max((segment.bounds.durationSeconds / previewTimelineDuration) * 100, 7)
                      : 7
                    const presetLabel =
                      segment.clip?.captureProfile.motionPresetLabel ||
                      activeMotionPreset?.label ||
                      'Motion'

                    return (
                      <button
                        key={`${segment.item.id}-motion`}
                        type="button"
                        className={`timeline-block motion ${segment.item.id === selectedTimelineItem?.id ? 'active' : ''}`.trim()}
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                        }}
                        onClick={() => void selectTimelineItem(segment.item.id)}
                      >
                        <span>{presetLabel}</span>
                        <strong>
                          {segment.clip?.cursorTrack
                            ? `${segment.clip.cursorTrack.points.length} samples`
                            : 'Preset guided'}
                        </strong>
                      </button>
                    )
                  })
                ) : selectedClip ? (
                  <button
                    type="button"
                    className="timeline-block motion active fallback"
                    style={{ left: '22%', width: '42%' }}
                    onClick={() => void addClipToTimeline(selectedClip)}
                  >
                    <span>{selectedClip.captureProfile.motionPresetLabel}</span>
                    <strong>
                      {selectedClip.cursorTrack
                        ? `${selectedClip.cursorTrack.points.length} samples`
                        : 'Preset guided'}
                    </strong>
                  </button>
                ) : null}
                {timelineFocusBlocks.map((block) => (
                  <div
                    key={block.key}
                    className={`timeline-focus-block ${block.region.id === selectedFocusRegion?.id ? 'active' : ''}`.trim()}
                    style={{
                      left: `${block.leftPercent}%`,
                      width: `${block.widthPercent}%`,
                    }}
                    onClick={() => {
                      setSelectedFocusRegionId(block.region.id)
                      if (block.itemId && block.itemId !== selectedTimelineItem?.id) {
                        void selectTimelineItem(block.itemId)
                      }
                    }}
                    onMouseDown={(event) => beginTimelineFocusRegionDrag(event, block, 'move')}
                  >
                    <button
                      type="button"
                      className="timeline-focus-handle start"
                      onMouseDown={(event) => beginTimelineFocusRegionDrag(event, block, 'resize-start')}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Resize start for ${block.region.label}`}
                    />
                    <span>{block.region.label}</span>
                    <strong>Q {block.region.zoom.toFixed(1)}x</strong>
                    <button
                      type="button"
                      className="timeline-focus-handle end"
                      onMouseDown={(event) => beginTimelineFocusRegionDrag(event, block, 'resize-end')}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Resize end for ${block.region.label}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
            </section>
          </section>
        </div>
      </section>
    </section>
    </main>
  )
}

export default App
