export type CaptureSource = {
  id: string
  name: string
  displayId: string
  kind: 'screen' | 'window'
  thumbnailDataUrl: string
}

export type QualityProfile = {
  id: string
  label: string
  width: number
  height: number
  fps: number
  videoBitsPerSecond: number
  detail: string
}

export type MotionPreset = {
  id: string
  label: string
  description: string
}

export type ImportStateSummary = {
  detected: boolean
  canvidVersion: string
  presetCount: number
  projectCount: number
  hasWindowState: boolean
  hasPartitionState: boolean
  scannedAt: string
}

export type LocalSettings = {
  capture: {
    selectedSourceId: string
    includeSystemAudio: boolean
    includeMicrophone: boolean
    microphoneDeviceId: string
    autoZoomMode: AutoZoomMode
    qualityProfileId: string
    motionPresetId: string
  }
  importState: {
    lastScannedAt: string
    lastImportedAt: string
    canvidVersion: string
    presetCount: number
    projectCount: number
    hasWindowState: boolean
    hasPartitionState: boolean
  }
  output: {
    capturesRootName: string
  }
}

export type LocalSettingsPatch = {
  capture?: Partial<LocalSettings['capture']>
  importState?: Partial<LocalSettings['importState']>
  output?: Partial<LocalSettings['output']>
}

export type ExportFormat = 'mp4' | 'gif'

export type OutputAspectPreset = 'source' | 'widescreen' | 'square' | 'portrait' | 'feed'

export type OutputFitMode = 'contain' | 'cover'

export type AutoZoomMode = 'off' | 'all-clicks' | 'long-clicks' | 'ctrl-click'

export type ProjectBackgroundMode = 'wallpaper' | 'image' | 'gradient' | 'color'

export type CursorStylePreset = 'windows' | 'mac' | 'touch'

export type CursorVisualKind =
  | 'arrow'
  | 'hand'
  | 'ibeam'
  | 'crosshair'
  | 'move'
  | 'resize-ew'
  | 'resize-ns'
  | 'resize-nesw'
  | 'resize-nwse'
  | 'not-allowed'
  | 'help'
  | 'wait'

export type CursorClickEffect = 'none' | 'ripple'

export type CursorAnimationStyle = 'molasses' | 'default' | 'gentle' | 'stiff'

export type VoiceClarityProfile = 'balanced' | 'strong'

export type KeyboardShortcutLabelSize = 'small' | 'medium' | 'large'

export type ProjectCameraPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type ProjectCameraShape = 'circle' | 'rounded'

export type CursorTrackPoint = {
  timeSeconds: number
  x: number
  y: number
  cursorKind?: CursorVisualKind
  cursorAppearanceId?: string
  cursorHotspotRatioX?: number
  cursorHotspotRatioY?: number
}

export type CursorAppearanceAsset = {
  id: string
  cursorKind: CursorVisualKind
  imageDataUrl: string
  hotspotRatioX: number
  hotspotRatioY: number
  referenceWidth?: number
  referenceHeight?: number
}

export type CursorClickButton = 'left' | 'right'

export type CursorClickEvent = {
  timeSeconds: number
  x: number
  y: number
  button: CursorClickButton
  ctrlKey: boolean
  durationMs: number
}

export type CursorCoordinateSpace = {
  width: number
  height: number
}

export type CursorTrack = {
  sourceKind: 'screen' | 'window'
  sampleIntervalMs: number
  points: CursorTrackPoint[]
  clicks: CursorClickEvent[]
  appearances?: CursorAppearanceAsset[]
  coordinateSpace?: CursorCoordinateSpace
}

export type CursorRenderMode = 'baked' | 'overlay'

export type KeyboardShortcutEvent = {
  id: string
  timeSeconds: number
  durationMs: number
  keys: string[]
  visible: boolean
}

export type CaptionLabelSize = 'small' | 'medium' | 'large'

export type ClipTranscriptStatus = 'idle' | 'ready' | 'error'

export type ClipTranscriptWord = {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
}

export type ClipTranscriptSegment = {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
  speaker: string
  visible: boolean
  wordIds: string[]
}

export type ClipTranscript = {
  status: ClipTranscriptStatus
  provider: 'openai' | 'imported' | 'none'
  model: string
  language: string
  generatedAt: string
  error: string
  text: string
  segments: ClipTranscriptSegment[]
  words: ClipTranscriptWord[]
}

export type ClipAudio = {
  hasAudio: boolean
  muted: boolean
  gainDb: number
  waveformPeaks: number[]
}

export type ProjectCameraSettings = {
  enabled: boolean
  deviceId: string
  deviceLabel: string
  size: number
  position: ProjectCameraPosition
  offset: number
  mirror: boolean
  shape: ProjectCameraShape
  roundness: number
  shadow: number
  border: number
}

export type ProjectClipCameraTake = {
  filePath: string
  mimeType: string
  size: number
  durationSeconds: number
  deviceId: string
  deviceLabel: string
}

export type ProjectClipMicrophoneTake = {
  filePath: string
  mimeType: string
  size: number
  durationSeconds: number
  deviceId: string
  deviceLabel: string
}

export type ProjectClipAudioRetake = {
  id: string
  filePath: string
  mimeType: string
  size: number
  durationSeconds: number
  deviceId: string
  deviceLabel: string
  segmentId: string
  segmentText: string
  startSeconds: number
  endSeconds: number
  createdAt: string
  updatedAt: string
}

export type BedRoutingMode = 'duck' | 'bypass'

export type TimelineMusicBedAutomationKeyframe = {
  id: string
  timeSeconds: number
  gainDb: number
}

export type TimelineMusicBedAutomation = {
  enabled: boolean
  startSeconds: number
  endSeconds: number | null
  gainDb: number
  rampSeconds: number
  keyframes: TimelineMusicBedAutomationKeyframe[]
}

export type TimelineMusicBed = {
  id: string
  label: string
  sourceName: string
  filePath: string
  size: number
  durationSeconds: number
  trimStartSeconds: number
  trimEndSeconds: number | null
  timelineStartSeconds: number
  timelineEndSeconds: number | null
  fadeInSeconds: number
  fadeOutSeconds: number
  gainDb: number
  routingMode: BedRoutingMode
  automation: TimelineMusicBedAutomation
  loop: boolean
  enabled: boolean
  waveformPeaks: number[]
  updatedAt: string
}

export type ProjectAudio = {
  beds: TimelineMusicBed[]
  activeBedId: string
  voiceClarity: {
    enabled: boolean
    profile: VoiceClarityProfile
  }
  ducking: {
    enabled: boolean
    reductionDb: number
    attackMs: number
    releaseMs: number
  }
}

export type ProjectClipExport = {
  id: string
  filePath: string
  format: ExportFormat
  createdAt: string
  size: number
  trimStartSeconds: number
  trimEndSeconds: number | null
}

export type ClipFocusRegion = {
  id: string
  label: string
  startSeconds: number
  endSeconds: number
  zoom: number
  focusX: number
  focusY: number
  settleAtStart?: boolean
  settleLeadSeconds?: number
}

export type ProjectClip = {
  id: string
  label: string
  filePath: string
  thumbnailDataUrl: string
  mimeType: string
  size: number
  durationSeconds: number
  createdAt: string
  updatedAt: string
  source: {
    id: string
    name: string
    kind: 'screen' | 'window'
  }
  captureProfile: {
    qualityProfileId: string
    qualityProfileLabel: string
    motionPresetId: string
    motionPresetLabel: string
    includeSystemAudio: boolean
  }
  trim: {
    startSeconds: number
    endSeconds: number | null
  }
  cursorRenderMode: CursorRenderMode
  cursorTrack: CursorTrack | null
  keyboardShortcuts: KeyboardShortcutEvent[]
  transcript: ClipTranscript
  focusRegions: ClipFocusRegion[]
  cameraTake: ProjectClipCameraTake | null
  microphoneTake: ProjectClipMicrophoneTake | null
  audioRetakes: ProjectClipAudioRetake[]
  audio: ClipAudio
  notes: string
  exports: ProjectClipExport[]
  lastExportPath: string
}

export type ProjectTimelineItem = {
  id: string
  clipId: string
  label: string
  enabled: boolean
  trimStartSeconds: number
  trimEndSeconds: number | null
  transcriptCut: ProjectTimelineTranscriptCut | null
  createdAt: string
  updatedAt: string
}

export type ProjectTimelineTranscriptCut = {
  sourceItemId: string
  sourceLabel: string
  segmentId: string
  segmentText: string
  segmentStartSeconds: number
  segmentEndSeconds: number
  createdAt: string
}

export type ProjectTimelineExport = {
  id: string
  filePath: string
  format: ExportFormat
  createdAt: string
  size: number
  itemCount: number
  durationSeconds: number
}

export type ProjectSummary = {
  id: string
  title: string
  brief: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  clipCount: number
  totalClipDuration: number
  timelineItemCount: number
  enabledTimelineItemCount: number
  totalTimelineDuration: number
  exportCount: number
  lastExportPath: string
  coverThumbnailDataUrl: string
  isActive: boolean
}

export type LocalProject = {
  id: string
  title: string
  brief: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  recovery: {
    autosaveEnabled: boolean
    lastSavedAt: string
  }
  output: {
    format: ExportFormat
    videoCodec: string
    audioCodec: string
    crf: number
    preset: string
    aspectPreset: OutputAspectPreset
    fitMode: OutputFitMode
    gifFps: number
  }
  background: {
    mode: ProjectBackgroundMode
    wallpaperId: string
    gradientId: string
    colorValue: string
    imagePath: string
    blur: number
    padding: number
    radius: number
    shadow: number
  }
  shortcuts: {
    enabled: boolean
    showSymbols: boolean
    labelSize: KeyboardShortcutLabelSize
  }
  captions: {
    enabled: boolean
    wordHighlighting: boolean
    showSpeakerLabels: boolean
    labelSize: CaptionLabelSize
    languageHint: string
  }
  cursor: {
    showCursor: boolean
    size: number
    style: CursorStylePreset
    alwaysPointer: boolean
    clickEffect: CursorClickEffect
    smoothingEnabled: boolean
    animationStyle: CursorAnimationStyle
  }
  camera: ProjectCameraSettings
  timeline: {
    activeClipId: string
    activeItemId: string
    items: ProjectTimelineItem[]
    exports: ProjectTimelineExport[]
    lastExportPath: string
  }
  audio: ProjectAudio
  clips: ProjectClip[]
}

export type ProjectPatch = {
  title?: string
  brief?: string
  recovery?: Partial<LocalProject['recovery']>
  output?: Partial<LocalProject['output']>
  background?: Partial<LocalProject['background']>
  shortcuts?: Partial<LocalProject['shortcuts']>
  captions?: Partial<LocalProject['captions']>
  cursor?: Partial<LocalProject['cursor']>
  camera?: Partial<LocalProject['camera']>
  timeline?: Partial<LocalProject['timeline']>
  audio?: Partial<LocalProject['audio']>
  clips?: ProjectClip[]
}

export type SaveRecordingPayload = {
  buffer?: ArrayBuffer
  existingFilePath?: string
  mimeType: string
  fileName: string
  systemAudio?: {
    buffer: ArrayBuffer
    mimeType: string
    fileName: string
  } | null
  camera?: {
    buffer: ArrayBuffer
    mimeType: string
    fileName: string
    deviceId: string
    deviceLabel: string
  } | null
  microphone?: {
    buffer: ArrayBuffer
    mimeType: string
    fileName: string
    deviceId: string
    deviceLabel: string
  } | null
  clip: {
    label: string
    thumbnailDataUrl: string
    durationSeconds: number
    source: {
      id: string
      name: string
      kind: 'screen' | 'window'
    }
    captureProfile: {
      qualityProfileId: string
      qualityProfileLabel: string
      motionPresetId: string
      motionPresetLabel: string
      includeSystemAudio: boolean
    }
    cursorRenderMode?: CursorRenderMode
    cursorTrack: CursorTrack | null
    keyboardShortcuts?: KeyboardShortcutEvent[]
    focusRegions?: ClipFocusRegion[]
    audio?: Partial<ClipAudio>
    notes: string
  }
}

export type SaveAudioRetakePayload = {
  clipId: string
  segmentId: string
  segmentText: string
  startSeconds: number
  endSeconds: number
  buffer: ArrayBuffer
  mimeType: string
  fileName: string
  deviceId: string
  deviceLabel: string
}

export type SavedRecordingResult = {
  filePath: string
  size: number
  clip: ProjectClip
  project: LocalProject
}

export type ClipExportPayload = {
  clipId: string
  trimStartSeconds?: number
  trimEndSeconds?: number | null
  outputName?: string
}

export type ClipExportResult = {
  clipId: string
  filePath: string
  size: number
  exportRecord: ProjectClipExport
  project: LocalProject
}

export type TimelineExportPayload = {
  outputName?: string
}

export type TimelineExportResult = {
  filePath: string
  size: number
  exportRecord: ProjectTimelineExport
  project: LocalProject
}

export type MusicBedImportResult = {
  cancelled: boolean
  project: LocalProject | null
}

export type BackgroundImageImportResult = {
  cancelled: boolean
  project: LocalProject | null
}

export type ProjectWorkspacePayload = {
  activeProject: LocalProject
  projects: ProjectSummary[]
}

export type CreateProjectPayload = {
  title?: string
  brief?: string
}

export type BootstrapPayload = {
  settings: LocalSettings
  importState: ImportStateSummary
  activeProject: LocalProject
  projects: ProjectSummary[]
  ffmpeg: {
    available: boolean
    path: string
    version: string
    managed: boolean
    sourcePath: string
    preferredVideoEncoder: string
    supportsAdvancedCompositing: boolean
  }
  transcription: {
    available: boolean
    provider: string
    model: string
    apiKeyConfigured: boolean
    reason: string
    maxUploadBytes: number
  }
  paths: {
    capturesRoot: string
    projectsRoot: string
    exportsRoot: string
    importsRoot: string
    audioRoot: string
    runtimeLogFile: string
  }
  qualityProfiles: QualityProfile[]
  motionPresets: MotionPreset[]
}

export type CapturePrepareResult = {
  ok: boolean
  sourceId: string
  sourceKind: 'screen' | 'window'
  cursorTrackingAvailable: boolean
  keyboardTrackingAvailable: boolean
  cursorCoordinateSpace: CursorCoordinateSpace | null
}

export type CapturePrimeResult = {
  ok: boolean
  sourceId: string
  sourceKind: 'screen' | 'window'
}

export type NativeScreenCaptureStartResult = {
  ok: boolean
  sessionId: string
  filePath: string
  mimeType: string
  engine: 'ddagrab' | 'gdigrab'
  encoder: string
  startedAtMs: number
}

export type NativeScreenCaptureStopResult = {
  ok: boolean
  sessionId: string
  filePath: string
  mimeType: string
  size: number
  engine: 'ddagrab' | 'gdigrab'
  encoder: string
  startedAtMs: number
  durationSeconds: number
}

export type CursorSnapshot = {
  trackingAvailable: boolean
  x: number
  y: number
  cursorKind?: CursorVisualKind
  cursorAppearanceId?: string
  cursorImageDataUrl?: string
  cursorHotspotRatioX?: number
  cursorHotspotRatioY?: number
  cursorReferenceWidth?: number
  cursorReferenceHeight?: number
  clicks: Array<{
    x: number
    y: number
    button: CursorClickButton
    occurredAtMs: number
    ctrlKey: boolean
    durationMs: number
  }>
  shortcuts: Array<{
    keys: string[]
    occurredAtMs: number
    durationMs: number
  }>
}

export type CursorAppearanceCatalog = CursorAppearanceAsset[]

export type ForkApi = {
  app: {
    bootstrap: () => Promise<BootstrapPayload>
  }
  sources: {
    list: () => Promise<CaptureSource[]>
  }
  capture: {
    primeSync: (payload: { sourceId: string; includeSystemAudio: boolean }) => CapturePrimeResult
    prepare: (payload: { sourceId: string; includeSystemAudio: boolean }) => Promise<CapturePrepareResult>
    startNativeScreenRecording: (payload: {
      sourceId: string
      width: number
      height: number
      fps: number
      videoBitsPerSecond: number
      fileName: string
    }) => Promise<NativeScreenCaptureStartResult>
    stopNativeScreenRecording: (payload: { sessionId: string }) => Promise<NativeScreenCaptureStopResult>
    getCursorAppearanceCatalog: () => Promise<CursorAppearanceCatalog>
    getCursorSnapshot: () => Promise<CursorSnapshot>
    saveRecording: (payload: SaveRecordingPayload) => Promise<SavedRecordingResult>
  }
  settings: {
    load: () => Promise<LocalSettings>
    save: (patch: LocalSettingsPatch) => Promise<LocalSettings>
  }
  importState: {
    scan: () => Promise<ImportStateSummary>
    run: () => Promise<{ summary: ImportStateSummary; settings: LocalSettings }>
  }
  project: {
    load: () => Promise<LocalProject>
    list: () => Promise<ProjectSummary[]>
    save: (patch: ProjectPatch) => Promise<LocalProject>
    create: (payload: CreateProjectPayload) => Promise<ProjectWorkspacePayload>
    open: (projectId: string) => Promise<ProjectWorkspacePayload>
    duplicate: (projectId: string) => Promise<ProjectWorkspacePayload>
    remove: (projectId: string) => Promise<ProjectWorkspacePayload>
    importBackgroundImage: () => Promise<BackgroundImageImportResult>
    importMusicBed: () => Promise<MusicBedImportResult>
    removeMusicBed: (bedId: string) => Promise<LocalProject>
    analyzeClipAudio: (clipId: string) => Promise<LocalProject>
    generateTranscript: (clipId: string) => Promise<LocalProject>
    importTranscript: (clipId: string) => Promise<LocalProject>
    saveAudioRetake: (payload: SaveAudioRetakePayload) => Promise<LocalProject>
    exportClip: (payload: ClipExportPayload) => Promise<ClipExportResult>
    exportTimeline: (payload: TimelineExportPayload) => Promise<TimelineExportResult>
  }
  shell: {
    showInFolder: (targetPath?: string) => Promise<{ ok: boolean }>
    copyText: (value: string) => Promise<{ ok: boolean }>
  }
}
