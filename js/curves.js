// Slip ratio to force


function getForwardForce(slipRatio) {
  const forwardForceCurve = [
    [0, 0],
    [0.2, 1],
    [0.4, 0.8],
    [1, 0.6],
  ]
  return linearInterpolation(forwardForceCurve, slipRatio)
}

function linearInterpolation(curve, slipRatio) {
  const index = curve.findIndex(p => p[0] >= slipRatio)
  if (index === -1) return curve[curve.length - 1][1]
  if (index === 0) return curve[0][1]
  const [x1, y1] = curve[index - 1]
  const [x2, y2] = curve[index]
  const t = (slipRatio - x1) / (x2 - x1)
  return y1 + t * (y2 - y1)
}

for (let i = -0.1; i < 1.4; i += 0.05) {
  console.log(i, getForwardForce(i))
}