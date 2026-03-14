export function sampleCursorTrackRange<
  TPoint extends { timeSeconds: number },
  TResolvedPoint extends { timeSeconds: number },
  TResult extends { timeSeconds: number },
>(
  points: TPoint[],
  startSeconds: number,
  endSeconds: number,
  options: {
    getPointAtTime: (points: TPoint[], targetTimeSeconds: number) => TResolvedPoint | null
    rebaseTimeToStart?: boolean
    projectPoint?: (point: TPoint | TResolvedPoint, sampledTimeSeconds: number, sourceTimeSeconds: number) => TResult
  },
): TResult[]
