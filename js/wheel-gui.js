wheelGui.useLocalStorage = true
wheelGui.remember(params)

wheelGui.add(params, 'throttleInput', -1, 1).step(0.01)
wheelGui.add(params, 'runPhysics')
wheelGui.add(params, 'autoStopPhysicsAfterSec')
wheelGui.add(params, 'smokeEnabled')

wheelGui.add(vehicleParams, 'wheelSpeed', -50, 50).step(0.1).listen()
wheelGui.add(vehicleParams, 'slipRatio', -1, 1).step(0.01).listen()
wheelGui.add(vehicleParams, 'slipAngle', -90, 90).step(0.1).listen()
wheelGui.add(vehicleParams, 'forwardForceScalar', -8000, 8000).step(1).listen()
wheelGui.add(vehicleParams, 'sideForceScalar', -8000, 8000).step(1).listen()
wheelGui.add(vehicleParams, 'wheelSteerAngle', -35, 35).step(0.1).listen()

function applyUrlParamOverrides() {
  const query = new URLSearchParams(window.location.search)
  for (const [key, raw] of query) {
    if (!(key in params)) continue
    const current = params[key]
    if (typeof current === 'boolean') params[key] = raw === 'true' || raw === '1'
    else if (typeof current === 'number') params[key] = Number(raw)
    else params[key] = raw
  }
  wheelGui.__controllers.forEach((c) => c.updateDisplay())
  userGui.__controllers.forEach((c) => c.updateDisplay())
}
applyUrlParamOverrides()

wheelGui.close()

window.bindCameraSwitcherToGui = () => {}
