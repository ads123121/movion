export type FocusMotionBaseCurve = 'linear' | 'smootherStep' | 'easeOutCubic' | 'easeInOutCubic'
export type FocusMotionEasingId =
  | 'linear'
  | 'cinematicZoom'
  | 'cinematicFocus'
  | 'cinematicReframe'
  | 'cinematicExit'

export type FocusMotionProfile = {
  baseSeconds: number
  minSeconds: number
  maxSeconds: number
  positionWeight: number
  zoomWeight: number
}

export type FocusMotionStateLike = {
  zoom: number
  focusX: number
  focusY: number
}

export type FocusMotionPointLike = FocusMotionStateLike & {
  timeSeconds: number
}

export type FocusMotionSegmentLike = {
  startSeconds: number
  endSeconds: number
  from: FocusMotionPointLike
  to: FocusMotionPointLike
  zoomEasing: FocusMotionEasingId
  focusEasing: FocusMotionEasingId
}

export type ClipFocusRegionLike = {
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

export type CursorClickLike = {
  timeSeconds: number
  x: number
  y: number
  button: 'left' | 'right'
  ctrlKey?: boolean
  durationMs?: number
}

export type CursorTrackLike = {
  points?: Array<{ timeSeconds: number; x: number; y: number }>
  clicks?: CursorClickLike[] | null
}

export const FOCUS_MOTION_PROFILES: {
  connectedGapThresholdSeconds: number
  enter: FocusMotionProfile
  reframe: FocusMotionProfile
  exit: FocusMotionProfile
}

export const FOCUS_MOTION_EASINGS: Record<
  FocusMotionEasingId,
  {
    baseCurve: FocusMotionBaseCurve
    springResponse: number | null
    springWeight: number
    leadFactor: number
  }
>

export const AUTO_FOCUS_REPEAT_CLICK_WINDOW_SECONDS: number
export const AUTO_FOCUS_REPEAT_DISTANCE: number
export const AUTO_FOCUS_CLUSTER_CLICK_WINDOW_SECONDS: number
export const AUTO_FOCUS_CLUSTER_VISIBLE_GAP_SECONDS: number
export const AUTO_FOCUS_CLUSTER_DISTANCE: number
export const AUTO_FOCUS_SETTLE_LEAD_SECONDS: number
export const AUTO_FOCUS_LONG_CLICK_SETTLE_LEAD_SECONDS: number
export const AUTO_FOCUS_CLICK_MATCH_WINDOW_SECONDS: number
export const AUTO_FOCUS_CLICK_MATCH_DISTANCE: number
export const AUTO_FOCUS_POST_CLICK_HOLD_RATIO: number
export const AUTO_FOCUS_MIN_POST_CLICK_HOLD_SECONDS: number
export const AUTO_FOCUS_MAX_POST_CLICK_HOLD_SECONDS: number

export function shouldSettleFocusRegionAtStart(region: Partial<ClipFocusRegionLike> | null | undefined): boolean

export function isAutomaticFocusRegion(region: Partial<ClipFocusRegionLike> | null | undefined): boolean

export function shouldClusterAutomaticFocusRegions(
  previousRegion: ClipFocusRegionLike | null | undefined,
  nextRegion: ClipFocusRegionLike | null | undefined,
): boolean

export function coalesceAutomaticFocusRegions(regions: ClipFocusRegionLike[]): ClipFocusRegionLike[]

export function normalizeFocusRegions(
  focusRegions: Array<Partial<ClipFocusRegionLike> | null | undefined>,
  durationSeconds: number,
): ClipFocusRegionLike[]

export function buildAutomaticFocusRegions(
  cursorTrack: CursorTrackLike | null | undefined,
  autoZoomMode: 'off' | 'all-clicks' | 'long-clicks' | 'ctrl-click',
  durationSeconds: number,
): ClipFocusRegionLike[]

export function createFocusMotionPoint(
  timeSeconds: number,
  state: Pick<FocusMotionStateLike, 'zoom' | 'focusX' | 'focusY'>,
): FocusMotionPointLike

export function buildFocusTransitionSeconds(
  from: Pick<FocusMotionStateLike, 'zoom' | 'focusX' | 'focusY'>,
  to: Pick<FocusMotionStateLike, 'zoom' | 'focusX' | 'focusY'>,
  options: FocusMotionProfile,
): number

export function getFocusEnterMotionProfile(from: Pick<FocusMotionStateLike, 'zoom'>): {
  profile: FocusMotionProfile
  focusEasing: Extract<FocusMotionEasingId, 'cinematicFocus' | 'cinematicReframe'>
}

export function getFocusRegionTargetState(region: ClipFocusRegionLike): FocusMotionPointLike

export function getFocusRegionSettleLeadSeconds(
  region: Partial<ClipFocusRegionLike> | null | undefined,
  enterDurationSeconds: number,
  options?: {
    cursorTrack?: CursorTrackLike | null
    getCursorApproachMetrics?: (
      points: Array<{ timeSeconds: number; x: number; y: number }>,
      targetTimeSeconds: number,
    ) => { effectiveDistance: number; approachSpeed: number } | null
  },
): number

export function findMatchingAutoFocusClick(
  region: Partial<ClipFocusRegionLike> | null | undefined,
  cursorTrack: CursorTrackLike | null | undefined,
): CursorClickLike | null

export function getAutoFocusRegionClickAnchorSeconds(
  region: ClipFocusRegionLike,
  cursorTrack: CursorTrackLike | null | undefined,
  durationSeconds: number,
): number

export function getAutoFocusPostClickHoldSeconds(region: ClipFocusRegionLike, clickAnchorSeconds: number): number

export function getFocusRegionCueStartSeconds(
  from: FocusMotionStateLike | FocusMotionPointLike,
  region: ClipFocusRegionLike,
  durationSeconds: number,
  options?: {
    cursorTrack?: CursorTrackLike | null
    getCursorApproachMetrics?: (
      points: Array<{ timeSeconds: number; x: number; y: number }>,
      targetTimeSeconds: number,
    ) => { effectiveDistance: number; approachSpeed: number } | null
  },
): number

export function evaluateFocusMotionEasing(easingId: FocusMotionEasingId, progress: number): number

export function buildFocusMotionSegments(
  focusRegions: ClipFocusRegionLike[],
  durationSeconds: number,
  options?: {
    idleFocusX?: number
    idleFocusY?: number
    cursorTrack?: CursorTrackLike | null
    getCursorApproachMetrics?: (
      points: Array<{ timeSeconds: number; x: number; y: number }>,
      targetTimeSeconds: number,
    ) => { effectiveDistance: number; approachSpeed: number } | null
  },
): FocusMotionSegmentLike[]
