// A racing-line-following bot (pure-pursuit) that can follow several recorded
// laps at once. Each frame it projects the car onto every lap, then follows the
// lap whose lookahead target points most straight ahead. This lets it switch
// laps mid-corner and route around any single lap's start/finish discontinuity
// without reprocessing the recorded data. Steering is clamped and rate-limited
// so a sudden target jump can never jerk the car off the road.
class Bot {
  constructor(lines) {
    this.laps = lines.map((line) => ({ line, u: 0, err: 0, headingErr: 0, target: null }));
    this.active = 0;
    this.steering = 0;
    this.target = { x: 0, y: 0, z: 0 };
    this._fwd = new THREE.Vector3();
  }

  // Signed angle (radians) from the car's nose to a point, in the XZ plane.
  headingErrorTo(pos, fwd, point) {
    const dx = point.x - pos.x;
    const dz = point.z - pos.z;
    return Math.atan2(fwd.z * dx - fwd.x * dz, fwd.x * dx + fwd.z * dz);
  }

  // Lower is better: prefer laps whose lookahead points straight ahead, and
  // rule out laps the car is too far from (their seam, or a different line).
  score(lap) {
    return Math.abs(lap.headingErr) + (lap.err > params.botMaxOffset ? 10 : 0);
  }

  // Path curvature (1/m) of the line near u, via the Menger curvature of three
  // points spaced `spacing` metres apart along the line.
  curvatureAt(line, u, spacing) {
    const du = spacing / line.length;
    const a = line.sample(u - du);
    const b = line.sample(u);
    const c = line.sample(u + du);
    const dAB = Math.hypot(b.x - a.x, b.z - a.z);
    const dBC = Math.hypot(c.x - b.x, c.z - b.z);
    const dAC = Math.hypot(c.x - a.x, c.z - a.z);
    if (dAB * dBC * dAC < 1e-6) return 0;
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    return (2 * area2) / (dAB * dBC * dAC);
  }

  drive(car) {
    const pos = car.chassis.position;
    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(car.chassis.quaternion);

    // Look farther ahead the faster we go, so the controller stays stable at
    // speed instead of chasing a too-near target and oscillating into a spin.
    const speedMps = Math.abs(car.vehicle.getCurrentSpeedKmHour()) / 3.6;
    const lookahead = params.botLookahead + speedMps * params.botLookaheadTime;

    for (const lap of this.laps) {
      lap.u = lap.line.project(pos.x, pos.z, lap.u);
      const here = lap.line.sample(lap.u);
      lap.err = Math.hypot(pos.x - here.x, pos.z - here.z);
      const targetU = lap.u + lookahead / lap.line.length;
      lap.target = lap.line.sample(targetU);
      lap.headingErr = this.headingErrorTo(pos, fwd, lap.target);
    }

    let best = this.active;
    for (let i = 0; i < this.laps.length; i++) {
      if (this.score(this.laps[i]) < this.score(this.laps[best])) best = i;
    }
    // Hysteresis: only switch if the candidate is clearly better.
    if (best !== this.active && this.score(this.laps[best]) < this.score(this.laps[this.active]) - 0.05) {
      this.active = best;
    }

    const lap = this.laps[this.active];
    this.target = lap.target;

    let steer = -params.botSteerGain * lap.headingErr;
    steer = Math.max(-params.botMaxSteer, Math.min(params.botMaxSteer, steer));
    const delta = steer - this.steering;
    if (Math.abs(delta) > params.botSteerRate) {
      steer = this.steering + Math.sign(delta) * params.botSteerRate;
    }
    this.steering = steer;

    // Longitudinal control: slow down for the upcoming bend. The fastest speed
    // a corner of curvature k can be taken at is v = sqrt(aLat / k); look ahead
    // (scaled with speed) so braking happens before the corner, not in it.
    const aheadU = lap.u + (lookahead / lap.line.length);
    const curvature = this.curvatureAt(lap.line, aheadU, params.botCurvatureSpacing);
    const vMax = params.botMaxSpeed / 3.6;
    const vTarget = Math.min(vMax, Math.sqrt(params.botMaxLatAccel / Math.max(curvature, 1e-4)));
    this.targetSpeed = vTarget;

    const dv = vTarget - speedMps;
    let throttle = Math.max(0, Math.min(1, dv * 0.2 + 0.15));
    let brake = dv < 0 ? Math.min(1, -dv * 0.15) : 0;
    if (brake > 0) throttle = 0;

    return { steering: steer, throttle, brake, handbrake: 0 };
  }
}

export { Bot };
