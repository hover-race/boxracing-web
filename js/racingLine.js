// A racing line loaded from a lap-N.json file (array of {u, x, y, z}, u in [0,1],
// sorted ascending, forming a closed loop). Provides:
//   sample(u)        -> {x, y, z}   position at normalized distance u (wraps)
//   project(x, z)    -> u           nearest u on the line for a ground position
class RacingLine {
  constructor(points) {
    this.points = points;
    this.count = points.length;
    this.length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      this.length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
  }

  static async load(url) {
    const res = await fetch(url);
    const points = await res.json();
    return new RacingLine(points);
  }

  // Largest index i with points[i].u <= u (binary search).
  indexOfU(u) {
    const pts = this.points;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].u <= u) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Position at normalized distance u. u wraps into [0, 1).
  sample(u) {
    const pts = this.points;
    const n = this.count;
    u -= Math.floor(u);

    const i0 = this.indexOfU(u);
    const i1 = (i0 + 1) % n;
    const a = pts[i0];
    const b = pts[i1];
    // Closing segment wraps u back to 0; treat b's u as 1 there.
    const bu = i1 === 0 ? 1 : b.u;
    const du = bu - a.u;
    const t = du > 1e-9 ? (u - a.u) / du : 0;

    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t
    };
  }

  // Nearest u on the line to ground position (x, z). Pass hintU (the previous
  // result) to search only a local window — O(1) for incrementally moving cars.
  project(x, z, hintU = null, window = 80) {
    const pts = this.points;
    const n = this.count;

    let from = 0;
    let countSeg = n; // number of segments to test (closed loop has n segments)
    if (hintU !== null) {
      from = this.indexOfU(hintU - Math.floor(hintU)) - window;
      countSeg = window * 2;
    }

    let bestD2 = Infinity;
    let bestU = 0;
    for (let s = 0; s < countSeg; s++) {
      const i0 = ((from + s) % n + n) % n;
      const i1 = (i0 + 1) % n;
      const a = pts[i0];
      const b = pts[i1];

      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const apx = x - a.x;
      const apz = z - a.z;
      const abLen2 = abx * abx + abz * abz;
      let t = abLen2 > 1e-9 ? (apx * abx + apz * abz) / abLen2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const cx = a.x + abx * t;
      const cz = a.z + abz * t;
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;

      if (d2 < bestD2) {
        bestD2 = d2;
        const bu = i1 === 0 ? 1 : b.u;
        bestU = a.u + (bu - a.u) * t;
      }
    }

    return bestU;
  }
}

export { RacingLine };
