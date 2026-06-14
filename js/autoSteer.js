// Player autosteer: project onto the track centerline. In bends, feedforward
// from path curvature holds steer roughly constant; heading trim + smoothing
// keep it stable on straights and noisy centerline segments.
class AutoSteer {
  constructor(lines) {
    this.laps = lines.map((line) => ({ line, u: 0 }));
    this.steering = 0;
    this.assist = 0;
    this.prevInputMag = 0;
    this.holdRemaining = 0;
    this.blendElapsed = 0;
    this.needsBlendIn = false;
    this._fwd = new THREE.Vector3();
  }

  _setAssist(amount) {
    this.assist = amount;
    vehicleParams.autoSteerAssist = amount;
  }

  curvatureAt(line, u, spacing) {
    const du = spacing / line.length;
    const a = line.sample(u - du);
    const b = line.sample(u);
    const c = line.sample(u + du);
    const dAB = Math.hypot(b.x - a.x, b.z - a.z);
    const dBC = Math.hypot(c.x - b.x, c.z - b.z);
    const dAC = Math.hypot(c.x - a.x, c.z - a.z);
    if (dAB * dBC * dAC < 1e-6) return 0;
    const area2 = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    return (2 * area2) / (dAB * dBC * dAC);
  }

  steeringFor(car, manualSteering = 0, deltaTime = 0) {
    const dt = deltaTime > 0 ? deltaTime / 1000 : 1 / 60;
    const pos = car.chassis.position;
    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(car.chassis.quaternion);

    let best = null;
    for (const lap of this.laps) {
      lap.u = lap.line.project(pos.x, pos.z, lap.u);
      const here = lap.line.sample(lap.u);
      lap.err = Math.hypot(pos.x - here.x, pos.z - here.z);
      if (!best || lap.err < best.err) best = lap;
    }

    const inputMag = Math.abs(manualSteering);
    const holdSec = params.autoSteerHoldSec;
    const blendSec = params.autoSteerBlendSec;

    if (best.err > params.botMaxOffset) {
      this.holdRemaining = 0;
      this.blendElapsed = 0;
      this.needsBlendIn = false;
      this._setAssist(0);
      this.prevInputMag = inputMag;
      if (inputMag > 0) return Math.max(-1, Math.min(1, manualSteering));
      return 0;
    }

    const speedMps = Math.abs(car.vehicle.getCurrentSpeedKmHour()) / 3.6;
    const lookahead = params.autoSteerLookahead + speedMps * params.autoSteerLookaheadTime;
    const aheadU = best.u + lookahead / best.line.length;
    const here = best.line.sample(best.u);
    const ahead = best.line.sample(aheadU);
    const tangentX = ahead.x - here.x;
    const tangentZ = ahead.z - here.z;
    const headingErr = Math.atan2(
      fwd.z * tangentX - fwd.x * tangentZ,
      fwd.x * tangentX + fwd.z * tangentZ
    );

    const kappa = this.curvatureAt(best.line, best.u, params.autoSteerCurvatureSpacing);
    const kappaSteer = params.botSteerGain * kappa * 4.5;
    const headingSteer = -params.botSteerGain * headingErr;
    const turnBlend = Math.min(1, Math.abs(kappa) / 0.015);
    let target = turnBlend * kappaSteer + (1 - turnBlend) * headingSteer;
    target = Math.max(-params.botMaxSteer, Math.min(params.botMaxSteer, target));

    const smooth = 1 - Math.exp(-dt / 0.3);
    this.steering += smooth * (target - this.steering);

    if (inputMag > 0) {
      this.holdRemaining = 0;
      this.blendElapsed = 0;
      this.needsBlendIn = false;
      this._setAssist(1 - inputMag);
      this.prevInputMag = inputMag;
      return Math.max(-1, Math.min(1, this.steering * this.assist + manualSteering * inputMag));
    }

    if (this.prevInputMag > 0) {
      this.holdRemaining = holdSec;
      this.blendElapsed = 0;
      this.needsBlendIn = true;
    }
    this.prevInputMag = 0;

    if (this.holdRemaining > 0) {
      this.holdRemaining = Math.max(0, this.holdRemaining - dt);
      this._setAssist(0);
      return 0;
    }

    if (this.needsBlendIn && blendSec > 0) {
      this.blendElapsed = Math.min(blendSec, this.blendElapsed + dt);
      this._setAssist(this.blendElapsed / blendSec);
      if (this.blendElapsed >= blendSec) this.needsBlendIn = false;
      return Math.max(-1, Math.min(1, this.steering * this.assist));
    }

    this.needsBlendIn = false;
    this._setAssist(1);
    return Math.max(-1, Math.min(1, this.steering));
  }
}

export { AutoSteer };
