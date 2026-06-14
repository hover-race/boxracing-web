import { RacingLine } from './racingLine.js';

function meshWorldPoints(mesh) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  const out = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.applyMatrix4(mesh.matrixWorld);
    out.push({ x: v.x, y: v.y, z: v.z });
  }
  return out;
}

function polarCenterline(points, bins = 360, minPerBin = 8) {
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cz += p.z;
  }
  cx /= points.length;
  cz /= points.length;

  const buckets = Array.from({ length: bins }, () => ({ rs: [], ys: [] }));
  for (const p of points) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    const r = Math.hypot(dx, dz);
    if (r < 5) continue;
    let a = Math.atan2(dz, dx);
    if (a < 0) a += Math.PI * 2;
    const bin = Math.min(bins - 1, Math.floor((a / (Math.PI * 2)) * bins));
    buckets[bin].rs.push(r);
    buckets[bin].ys.push(p.y);
  }

  const active = [];
  for (let i = 0; i < bins; i++) {
    const rs = buckets[i].rs.sort((a, b) => a - b);
    if (rs.length < minPerBin) continue;
    const rMid = (rs[Math.floor(rs.length * 0.1)] + rs[Math.floor(rs.length * 0.9)]) * 0.5;
    const ang = (i + 0.5) / bins * Math.PI * 2;
    const ys = buckets[i].ys;
    const y = ys.reduce((a, b) => a + b, 0) / ys.length;
    active.push({
      bin: i,
      x: cx + Math.cos(ang) * rMid,
      y,
      z: cz + Math.sin(ang) * rMid,
    });
  }
  return active;
}

function mainSegment(active, bins = 360, maxGap = 10, minSegLen = 10) {
  if (active.length === 0) return [];
  active.sort((a, b) => a.bin - b.bin);

  const segments = [];
  let seg = [active[0]];
  for (let i = 1; i < active.length; i++) {
    if (active[i].bin - active[i - 1].bin > maxGap) {
      segments.push(seg);
      seg = [active[i]];
    } else {
      seg.push(active[i]);
    }
  }
  segments.push(seg);

  const big = segments.filter((s) => s.length >= minSegLen);
  if (big.length === 0) return [];

  big.sort((a, b) => a[0].bin - b[0].bin);
  const pivot = big.reduce((best, s) => (s[0].bin > best[0].bin ? s : best), big[0]);
  const start = big.indexOf(pivot);
  const ordered = big.slice(start).concat(big.slice(0, start));

  return ordered.flat().map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

function normalizeLoop(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1] + Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
      points[i].z - points[i - 1].z,
    );
  }
  const last = points[points.length - 1];
  const close = Math.hypot(last.x - points[0].x, last.y - points[0].y, last.z - points[0].z);
  const total = cumulative[cumulative.length - 1] + close;
  return points.map((p, i) => ({
    u: Number((total > 0 ? cumulative[i] / total : 0).toFixed(5)),
    x: Number(p.x.toFixed(3)),
    y: Number(p.y.toFixed(3)),
    z: Number(p.z.toFixed(3)),
  }));
}

function extractCenterline(track, meshName = '1TARMAC_oval') {
  let mesh = null;
  track.traverse((child) => {
    if (child.name === meshName && child.isMesh) mesh = child;
  });
  if (!mesh) return null;

  const active = polarCenterline(meshWorldPoints(mesh));
  const loop = mainSegment(active);
  if (loop.length < 8) return null;
  return normalizeLoop(loop);
}

function centerlineFromTrack(track, meshName = '1TARMAC_oval') {
  const points = extractCenterline(track, meshName);
  if (!points) return null;
  return new RacingLine(points);
}

function showCenterlinePath(scene, line, yOffset = 0.5) {
  const pts = line.points;
  const positions = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    positions[i * 3] = pts[i].x;
    positions[i * 3 + 1] = pts[i].y + yOffset;
    positions[i * 3 + 2] = pts[i].z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const path = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xff00ff }));
  path.name = 'centerline-path';
  scene.add(path);
  return path;
}

function showCenterlineMarkers(scene, line, spacing = 8) {
  const group = new THREE.Group();
  group.name = 'centerline-debug';
  const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
  const geo = new THREE.BoxGeometry(1.5, 3, 1.5);
  const n = Math.max(1, Math.ceil(line.length / spacing));
  for (let i = 0; i < n; i++) {
    const p = line.sample(i / n);
    const cube = new THREE.Mesh(geo, mat);
    cube.position.set(p.x, p.y + 1.5, p.z);
    group.add(cube);
  }
  scene.add(group);
  return group;
}

export { extractCenterline, centerlineFromTrack, showCenterlinePath, showCenterlineMarkers };
