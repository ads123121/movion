export const CURSOR_CLICK_EFFECT_DURATION_SECONDS: number
export const CURSOR_CLICK_EFFECT_FADE_IN_SECONDS: number
export const CURSOR_CLICK_EFFECT_REFERENCE_SIZE: number
export const CURSOR_CLICK_EFFECT_FADE_OUT_START_RATIO: number
export const CURSOR_CLICK_EFFECT_STRENGTH_MIN: number
export const CURSOR_CLICK_EFFECT_STRENGTH_MAX: number
export const CURSOR_CLICK_EFFECT_BASE_SIZE: number
export const CURSOR_CLICK_EFFECT_GROWTH_SIZE: number

export function buildLiquidGlassCursorClickEffectDataUrl(): string

export const LIQUID_GLASS_CURSOR_CLICK_EFFECT_DATA_URL: string

export function clampCursorClickEffectStrength(strength: number | null | undefined): number

export function getCursorClickEffectProgress(elapsedSeconds: number | null | undefined): number

export function getCursorClickEffectFadeOutStartSeconds(startSeconds: number): number

export function getCursorClickEffectFadeOutDurationSeconds(): number

export function getCursorClickEffectOpacity(progress: number): number

export function getCursorClickEffectSize(
  pointerScale: number | null | undefined,
  strength: number | null | undefined,
  progress: number,
): number
