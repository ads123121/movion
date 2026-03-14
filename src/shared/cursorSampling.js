export function sampleCursorTrackRange(points, startSeconds, endSeconds, options = {}) {
  const {
    getPointAtTime,
    rebaseTimeToStart = false,
    projectPoint = (point, sampledTime) => ({
      ...point,
      timeSeconds: sampledTime,
    }),
  } = options

  if (!Array.isArray(points) || !points.length || endSeconds <= startSeconds || typeof getPointAtTime !== 'function') {
    return []
  }

  const startPoint = getPointAtTime(points, startSeconds)
  const endPoint = getPointAtTime(points, endSeconds)

  if (!startPoint || !endPoint) {
    return []
  }

  const toSampleTime = (timeSeconds) =>
    Number((rebaseTimeToStart ? timeSeconds - startSeconds : timeSeconds).toFixed(3))

  const samples = [
    projectPoint(startPoint, toSampleTime(startSeconds), startSeconds),
    ...points
      .filter((point) => point.timeSeconds > startSeconds && point.timeSeconds < endSeconds)
      .map((point) => projectPoint(point, toSampleTime(point.timeSeconds), point.timeSeconds)),
    projectPoint(endPoint, toSampleTime(endSeconds), endSeconds),
  ]

  return samples.reduce((collection, point) => {
    const previousPoint = collection[collection.length - 1]

    if (previousPoint && Math.abs(previousPoint.timeSeconds - point.timeSeconds) < 0.001) {
      collection[collection.length - 1] = point
      return collection
    }

    collection.push(point)
    return collection
  }, [])
}
