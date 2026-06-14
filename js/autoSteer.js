// Player autosteer: project onto the smoothed centerline, then steer to hold
// zero lateral offset. Tuning lives here — GUI only exposes on/off and strength.
const HOLD_SEC = 0.5;
const BLEND_SEC = 0.5;
const LOOKAHEAD = 4;
const LOOKAHEAD_TIME = 0.12;
const LAT_GAIN = 0.045;
const VEL_GAIN = 1.0;
const HEADING_GAIN = 0.12;
const STEER_RATE = 0.04;
const STEER_SMOOTH = 0.35;
const LAT_FILTER = 0.12;
const LAT_DEADBAND = 0.15;

class AutoSteer {
  constructor(lines) {
    this.laps = lines.map((line) => ({ line, u: 0 }));
    this.steering = 0;
    this.filtLat = 0;
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

  signedLateral(line, u, x, z, tangentDist = 3) {
    const here = line.sample(u);
    const ahead = line.sample(u + tangentDist / line.length);
    const tx = ahead.x - here.x;
    const tz = ahead.z - here.z;
    const tLen = Math.hypot(tx, tz) || 1;
    const nx = -tz / tLen;
    const nz = tx / tLen;
    return (x - here.x) * nx + (z - here.z) * nz;
  }

  measureLateral(car) {
    const pos = car.chassis.position;
    let best = null;
    for (const lap of this.laps) {
      lap.u = lap.line.project(pos.x, pos.z, lap.u);
      let here = lap.line.sample(lap.u);
      lap.err = Math.hypot(pos.x - here.x, pos.z - here.z);
      if (lap.err > 20) {
        lap.u = lap.line.project(pos.x, pos.z, null);
        here = lap.line.sample(lap.u);
        lap.err = Math.hypot(pos.x - here.x, pos.z - here.z);
      }
      lap.lateral = this.signedLateral(lap.line, lap.u, pos.x, pos.z);
      if (!best || lap.err < best.err) best = lap;
    }
    vehicleParams.autoSteerLateral = best.lateral;
    return best;
  }

  steeringFor(car, manualSteering = 0, deltaTime = 0) {
    const dt = deltaTime > 0 ? deltaTime / 1000 : 1 / 60;
    const pos = car.chassis.position;
    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(car.chassis.quaternion);
    const best = this.measureLateral(car);

    const inputMag = Math.abs(manualSteering);
    const strength = params.autoSteerStrength;

    if (best.err > params.botMaxOffset) {
      this.holdRemaining = 0;
      this.blendElapsed = 0;
      this.needsBlendIn = false;
      this._setAssist(0);
      this.prevInputMag = inputMag;
      if (inputMag > 0) return Math.max(-1, Math.min(1, manualSteering));
      return 0;
    }

    const latSmooth = 1 - Math.exp(-dt / LAT_FILTER);
    this.filtLat += latSmooth * (best.lateral - this.filtLat);
    let lateralErr = this.filtLat;
    if (Math.abs(lateralErr) < LAT_DEADBAND) lateralErr = 0;
    else lateralErr -= Math.sign(lateralErr) * LAT_DEADBAND;

    const speedMps = Math.abs(car.vehicle.getCurrentSpeedKmHour()) / 3.6;
    const speedScale = 0.5 + 0.5 * Math.min(1, speedMps / 8);
    const lookahead = LOOKAHEAD + speedMps * LOOKAHEAD_TIME;
    const here = best.line.sample(best.u);
    const ahead = best.line.sample(best.u + lookahead / best.line.length);
    const tangentX = ahead.x - here.x;
    const tangentZ = ahead.z - here.z;
    const headingErr = Math.atan2(
      fwd.z * tangentX - fwd.x * tangentZ,
      fwd.x * tangentX + fwd.z * tangentZ
    );

    const tLen = Math.hypot(tangentX, tangentZ) || 1;
    const nx = -tangentZ / tLen;
    const nz = tangentX / tLen;
    const vel = car.chassis.body.ammo.getLinearVelocity();
    const crossVel = vel.x() * nx + vel.z() * nz;

    let target = strength * (
      -LAT_GAIN * speedScale * lateralErr
      - HEADING_GAIN * headingErr
    ) - VEL_GAIN * crossVel;
    target = Math.max(-params.botMaxSteer, Math.min(params.botMaxSteer, target));

    const delta = target - this.steering;
    if (Math.abs(delta) > STEER_RATE) {
      target = this.steering + Math.sign(delta) * STEER_RATE;
    }
    const outSmooth = 1 - Math.exp(-dt / STEER_SMOOTH);
    this.steering += outSmooth * (target - this.steering);

    if (inputMag > 0) {
      this.holdRemaining = 0;
      this.blendElapsed = 0;
      this.needsBlendIn = false;
      this._setAssist(1 - inputMag);
      this.prevInputMag = inputMag;
      return Math.max(-1, Math.min(1, this.steering * this.assist + manualSteering * inputMag));
    }

    if (this.prevInputMag > 0) {
      this.holdRemaining = HOLD_SEC;
      this.blendElapsed = 0;
      this.needsBlendIn = true;
    }
    this.prevInputMag = 0;

    if (this.holdRemaining > 0) {
      this.holdRemaining = Math.max(0, this.holdRemaining - dt);
      this._setAssist(0);
      return 0;
    }

    if (this.needsBlendIn && BLEND_SEC > 0) {
      this.blendElapsed = Math.min(BLEND_SEC, this.blendElapsed + dt);
      this._setAssist(this.blendElapsed / BLEND_SEC);
      if (this.blendElapsed >= BLEND_SEC) this.needsBlendIn = false;
      return Math.max(-1, Math.min(1, this.steering * this.assist));
    }

    this.needsBlendIn = false;
    this._setAssist(1);
    return Math.max(-1, Math.min(1, this.steering));
  }
}

export { AutoSteer };
