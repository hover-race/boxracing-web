// Player autosteer: project onto recorded laps (same as bot) and steer so the
// car's heading matches the line tangent at the closest point.
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

    const du = 5 / best.line.length;
    const here = best.line.sample(best.u);
    const ahead = best.line.sample(best.u + du);
    const tangentX = ahead.x - here.x;
    const tangentZ = ahead.z - here.z;
    const headingErr = Math.atan2(
      fwd.z * tangentX - fwd.x * tangentZ,
      fwd.x * tangentX + fwd.z * tangentZ
    );

    let steer = -params.botSteerGain * headingErr;
    steer = Math.max(-params.botMaxSteer, Math.min(params.botMaxSteer, steer));
    const delta = steer - this.steering;
    if (Math.abs(delta) > params.botSteerRate) {
      steer = this.steering + Math.sign(delta) * params.botSteerRate;
    }
    this.steering = steer;

    if (inputMag > 0) {
      this.holdRemaining = 0;
      this.blendElapsed = 0;
      this.needsBlendIn = false;
      this._setAssist(1 - inputMag);
      this.prevInputMag = inputMag;
      return Math.max(-1, Math.min(1, steer * this.assist + manualSteering * inputMag));
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
      return Math.max(-1, Math.min(1, steer * this.assist));
    }

    this.needsBlendIn = false;
    this._setAssist(1);
    return Math.max(-1, Math.min(1, steer));
  }
}

export { AutoSteer };
