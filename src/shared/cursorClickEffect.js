export const CURSOR_CLICK_EFFECT_DURATION_SECONDS = 0.68
export const CURSOR_CLICK_EFFECT_FADE_IN_SECONDS = 0.08
export const CURSOR_CLICK_EFFECT_REFERENCE_SIZE = 240
export const CURSOR_CLICK_EFFECT_FADE_OUT_START_RATIO = 0.24
export const CURSOR_CLICK_EFFECT_STRENGTH_MIN = 0.8
export const CURSOR_CLICK_EFFECT_STRENGTH_MAX = 1.3
export const CURSOR_CLICK_EFFECT_BASE_SIZE = 50
export const CURSOR_CLICK_EFFECT_GROWTH_SIZE = 102

const clampNumber = (value, minimum, maximum) => {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, Number(value)))
}

const clampUnit = (value) => clampNumber(value, 0, 1)
const easeOutCubic = (progress) => 1 - (1 - progress) ** 3

export function buildLiquidGlassCursorClickEffectDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" fill="none">
      <defs>
        <radialGradient id="halo" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(120 120) rotate(90) scale(86)">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.72" />
          <stop offset="0.24" stop-color="#d7e7ff" stop-opacity="0.52" />
          <stop offset="0.52" stop-color="#8bb7ff" stop-opacity="0.36" />
          <stop offset="1" stop-color="#8bb7ff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="glassCore" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(118 116) rotate(90) scale(42)">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.98" />
          <stop offset="0.38" stop-color="#f5fbff" stop-opacity="0.78" />
          <stop offset="0.78" stop-color="#cfe4ff" stop-opacity="0.32" />
          <stop offset="1" stop-color="#cfe4ff" stop-opacity="0.08" />
        </radialGradient>
        <radialGradient id="innerGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(124 124) rotate(90) scale(58)">
          <stop offset="0" stop-color="#9ec5ff" stop-opacity="0.26" />
          <stop offset="0.65" stop-color="#9ec5ff" stop-opacity="0.08" />
          <stop offset="1" stop-color="#9ec5ff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="ringStroke" x1="82" y1="78" x2="164" y2="170" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.96" />
          <stop offset="0.46" stop-color="#d5e7ff" stop-opacity="0.84" />
          <stop offset="1" stop-color="#84b3ff" stop-opacity="0.62" />
        </linearGradient>
        <linearGradient id="outerStroke" x1="64" y1="62" x2="182" y2="186" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.72" />
          <stop offset="0.54" stop-color="#bfd8ff" stop-opacity="0.5" />
          <stop offset="1" stop-color="#78aaff" stop-opacity="0.2" />
        </linearGradient>
        <radialGradient id="specular" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(98 92) rotate(43) scale(28 18)">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.96" />
          <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>
        <filter id="softBloom" x="18" y="18" width="204" height="204" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="innerBloom" x="44" y="44" width="152" height="152" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <g filter="url(#softBloom)" opacity="0.8">
        <circle cx="120" cy="120" r="66" fill="url(#halo)" />
      </g>
      <g filter="url(#innerBloom)" opacity="0.82">
        <circle cx="120" cy="120" r="48" fill="url(#innerGlow)" />
      </g>
      <circle cx="120" cy="120" r="37" fill="url(#glassCore)" stroke="url(#ringStroke)" stroke-width="2.4" />
      <circle cx="120" cy="120" r="58" stroke="url(#outerStroke)" stroke-width="2.2" />
      <ellipse cx="98" cy="92" rx="24" ry="14" fill="url(#specular)" />
      <path d="M86 118C98 98 124 90 153 92" stroke="rgba(255,255,255,0.54)" stroke-width="5" stroke-linecap="round" />
      <circle cx="142" cy="144" r="14" fill="rgba(157, 196, 255, 0.24)" />
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export const LIQUID_GLASS_CURSOR_CLICK_EFFECT_DATA_URL = buildLiquidGlassCursorClickEffectDataUrl()

export function clampCursorClickEffectStrength(strength) {
  return clampNumber(Number(strength) || 1, CURSOR_CLICK_EFFECT_STRENGTH_MIN, CURSOR_CLICK_EFFECT_STRENGTH_MAX)
}

export function getCursorClickEffectProgress(elapsedSeconds) {
  return clampUnit((Number(elapsedSeconds) || 0) / CURSOR_CLICK_EFFECT_DURATION_SECONDS)
}

export function getCursorClickEffectFadeOutStartSeconds(startSeconds) {
  return Number((Number(startSeconds) + CURSOR_CLICK_EFFECT_DURATION_SECONDS * CURSOR_CLICK_EFFECT_FADE_OUT_START_RATIO).toFixed(3))
}

export function getCursorClickEffectFadeOutDurationSeconds() {
  return Number(
    Math.max(0.12, CURSOR_CLICK_EFFECT_DURATION_SECONDS - CURSOR_CLICK_EFFECT_DURATION_SECONDS * CURSOR_CLICK_EFFECT_FADE_OUT_START_RATIO).toFixed(3),
  )
}

export function getCursorClickEffectOpacity(progress) {
  const normalizedProgress = clampUnit(progress)
  const fadeInProgress = clampUnit(
    normalizedProgress / Math.max(0.001, CURSOR_CLICK_EFFECT_FADE_IN_SECONDS / CURSOR_CLICK_EFFECT_DURATION_SECONDS),
  )
  const fadeOutProgress = clampUnit(
    (normalizedProgress - CURSOR_CLICK_EFFECT_FADE_OUT_START_RATIO) /
      Math.max(0.001, 1 - CURSOR_CLICK_EFFECT_FADE_OUT_START_RATIO),
  )

  return clampUnit(fadeInProgress * (1 - fadeOutProgress))
}

export function getCursorClickEffectSize(pointerScale, strength, progress) {
  const normalizedScale = Math.max(0, Number(pointerScale) || 0)
  const normalizedStrength = clampCursorClickEffectStrength(strength)
  const easedProgress = easeOutCubic(clampUnit(progress))
  return (CURSOR_CLICK_EFFECT_BASE_SIZE + easedProgress * CURSOR_CLICK_EFFECT_GROWTH_SIZE) * normalizedScale * normalizedStrength
}
