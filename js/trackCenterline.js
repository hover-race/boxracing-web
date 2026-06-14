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

function polarCenterline(points, bins = 720, minPerBin = 6) {
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

function splitActiveSegments(active, bins = 720, maxGap = 10, minSegLen = 5) {
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
  return big.slice(start).concat(big.slice(0, start));
}

function smoothSegment(points, passes = 5, alpha = 0.45) {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  let pts = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  for (let pass = 0; pass < passes; pass++) {
    const next = pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)];
      const succ = pts[Math.min(pts.length - 1, i + 1)];
      const w = i === 0 || i === pts.length - 1 ? alpha * 0.5 : alpha;
      return {
        x: p.x * (1 - w) + (prev.x + succ.x) * 0.5 * w,
        y: p.y * (1 - w) + (prev.y + succ.y) * 0.5 * w,
        z: p.z * (1 - w) + (prev.z + succ.z) * 0.5 * w,
      };
    });
    pts = next;
  }
  return pts;
}

function dropSpuriousSegments(segments, minLen = 20) {
  return segments.filter((seg) => seg.length >= minLen);
}

function segmentsToPoints(segments) {
  return segments
    .map((seg) => smoothSegment(seg.map((p) => ({ x: p.x, y: p.y, z: p.z }))))
    .flat();
}

function splitAtGaps(points, maxGap = 25) {
  if (points.length === 0) return [];
  const chunks = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const d = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    if (d > maxGap) chunks.push([]);
    chunks[chunks.length - 1].push(cur);
  }
  return chunks.filter((c) => c.length >= 2);
}

function trimTailPastLastMark(chunk, spacing) {
  if (chunk.length < 2) return chunk;
  let dist = 0;
  let nextMark = 0;
  const marks = [];
  for (let i = 0; i < chunk.length; i++) {
    if (i > 0) dist += Math.hypot(chunk[i].x - chunk[i - 1].x, chunk[i].z - chunk[i - 1].z);
    while (dist >= nextMark) {
      marks.push({ i, nextMark });
      nextMark += spacing;
    }
  }
  if (marks.length < 2) return chunk;
  const last = marks[marks.length - 1];
  const remainder = dist - last.nextMark;
  if (remainder > 0 && remainder < spacing) {
    return chunk.slice(0, marks[marks.length - 2].i + 1);
  }
  return chunk;
}

function trimHeadFromMark(chunk, skipMarks, spacing) {
  let dist = 0;
  let nextMark = 0;
  let markIdx = 0;
  for (let i = 0; i < chunk.length; i++) {
    if (i > 0) dist += Math.hypot(chunk[i].x - chunk[i - 1].x, chunk[i].z - chunk[i - 1].z);
    while (dist >= nextMark) {
      if (markIdx === skipMarks) return chunk.slice(i);
      markIdx++;
      nextMark += spacing;
    }
  }
  return chunk;
}

function trimTailExtraMarks(chunk, spacing, dropCount = 1) {
  if (chunk.length < 2) return chunk;
  let dist = 0;
  let nextMark = 0;
  const marks = [];
  for (let i = 0; i < chunk.length; i++) {
    if (i > 0) dist += Math.hypot(chunk[i].x - chunk[i - 1].x, chunk[i].z - chunk[i - 1].z);
    while (dist >= nextMark) {
      marks.push({ i, nextMark });
      nextMark += spacing;
    }
  }
  if (marks.length <= dropCount + 1) return chunk;
  const last = marks[marks.length - 1];
  const remainder = dist - last.nextMark;
  if (remainder > 0 && remainder < spacing) {
    return chunk.slice(0, marks[marks.length - dropCount - 1].i + 1);
  }
  return chunk;
}

function trimLoopEnds(points, spacing = 12, maxGap = 25) {
  const chunks = splitAtGaps(trimGapTails(points, spacing, maxGap), maxGap);
  if (chunks.length === 0) return points;
  chunks[0] = trimHeadFromMark(chunks[0], 1, spacing);
  chunks[chunks.length - 1] = trimTailExtraMarks(chunks[chunks.length - 1], spacing, 2);
  return chunks.flat();
}

function trimGapTails(points, spacing = 12, maxGap = 25) {
  const chunks = splitAtGaps(points, maxGap);
  if (chunks.length <= 1) return points;
  const out = [];
  for (let c = 0; c < chunks.length; c++) {
    const chunk = c < chunks.length - 1
      ? trimTailPastLastMark(chunks[c], spacing)
      : chunks[c];
    out.push(...chunk);
  }
  return out;
}

function normalizeLoop(points, closeMaxGap = 25) {
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
  const total = cumulative[cumulative.length - 1] + (close <= closeMaxGap ? close : 0);
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

  const segments = dropSpuriousSegments(
    splitActiveSegments(polarCenterline(meshWorldPoints(mesh))),
  );
  const loop = segmentsToPoints(segments);
  if (loop.length < 8) return null;
  return normalizeLoop(trimLoopEnds(loop.slice().reverse()));
}

function interpolateCenterline(points, sampleSpacing = 2, maxGap = 25) {
  const chunks = splitAtGaps(points, maxGap);
  const out = [];

  function appendStraight(a, b) {
    const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (span < 0.1) return;
    let d = sampleSpacing;
    while (d < span) {
      const f = d / span;
      out.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
      });
      d += sampleSpacing;
    }
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    if (chunk.length < 2) continue;
    if (out.length) appendStraight(out[out.length - 1], chunk[0]);
    const curve = new THREE.CatmullRomCurve3(
      chunk.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      false,
      'catmullrom',
      0.15,
    );
    const steps = Math.max(1, Math.ceil(curve.getLength() / sampleSpacing));
    for (let i = 0; i <= steps; i++) {
      const p = curve.getPointAt(i / steps);
      const pt = { x: p.x, y: p.y, z: p.z };
      if (out.length) {
        const prev = out[out.length - 1];
        if (Math.hypot(pt.x - prev.x, pt.z - prev.z) < 0.05) continue;
      }
      out.push(pt);
    }
  }

  if (out.length >= 2) appendStraight(out[out.length - 1], out[0]);
  return out;
}

function centerlineFromTrack(track, meshName = '1TARMAC_oval') {
  const points = extractCenterline(track, meshName);
  if (!points) return null;
  const smooth = interpolateCenterline(points);
  return new RacingLine(normalizeLoop(smooth));
}

function resampleChunk(chunk, spacing = 2) {
  if (chunk.length < 2) return chunk;
  const out = [{ x: chunk[0].x, y: chunk[0].y, z: chunk[0].z }];
  let carry = 0;
  for (let i = 1; i < chunk.length; i++) {
    const a = chunk[i - 1];
    const b = chunk[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    let t = spacing - carry;
    while (t < segLen) {
      const f = t / segLen;
      out.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
      });
      t += spacing;
    }
    carry = (carry + segLen) % spacing;
  }
  const last = chunk[chunk.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > 0.1) out.push({ x: last.x, y: last.y, z: last.z });
  return out;
}

function addStraightBridge(group, a, b, mat, yOffset) {
  const bridge = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(a.x, a.y + yOffset, a.z),
      new THREE.Vector3(b.x, b.y + yOffset, b.z),
    ],
    false,
  );
  const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  group.add(new THREE.Mesh(
    new THREE.TubeGeometry(bridge, Math.max(4, Math.ceil(span / 2)), 0.35, 6, false),
    mat,
  ));
}

function showCenterlinePath(scene, line, yOffset = 2, maxGap = 25) {
  const group = new THREE.Group();
  group.name = 'centerline-path';
  const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false });
  const chunks = splitAtGaps(line.points, maxGap);
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const resampled = resampleChunk(chunk, 2);
    if (resampled.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(
        resampled.map((p) => new THREE.Vector3(p.x, p.y + yOffset, p.z)),
        false,
        'catmullrom',
        0.15,
      );
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, resampled.length * 4, 0.35, 6, false),
        mat,
      );
      group.add(tube);
    }
    if (ci < chunks.length - 1) {
      addStraightBridge(group, chunk[chunk.length - 1], chunks[ci + 1][0], mat, yOffset);
    }
  }
  const pts = line.points;
  if (pts.length >= 2) {
    addStraightBridge(group, pts[pts.length - 1], pts[0], mat, yOffset);
  }
  scene.add(group);
  return group;
}

function labelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 16);
  const map = new THREE.CanvasTexture(
    canvas,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.NearestFilter,
  );
  map.generateMipmaps = false;
  map.anisotropy = 1;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map, depthTest: false }),
  );
  sprite.scale.set(5, 2.5, 1);
  return sprite;
}

function showCenterlineMarkers(scene, line, spacing = 8, maxGap = 25, labelYOffset = 5) {
  const group = new THREE.Group();
  group.name = 'centerline-debug';
  const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
  const geo = new THREE.BoxGeometry(1.5, 3, 1.5);
  let index = 0;
  for (const chunk of splitAtGaps(line.points, maxGap)) {
    let dist = 0;
    let nextMark = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (i > 0) dist += Math.hypot(chunk[i].x - chunk[i - 1].x, chunk[i].z - chunk[i - 1].z);
      while (dist >= nextMark) {
        const cube = new THREE.Mesh(geo, mat);
        cube.position.set(chunk[i].x, chunk[i].y + 3, chunk[i].z);
        group.add(cube);
        const sprite = labelSprite(String(index));
        sprite.position.set(chunk[i].x, chunk[i].y + labelYOffset, chunk[i].z);
        group.add(sprite);
        index++;
        nextMark += spacing;
      }
    }
  }
  scene.add(group);
  return group;
}

export {
  extractCenterline,
  centerlineFromTrack,
  showCenterlinePath,
  showCenterlineMarkers,
  splitAtGaps,
  smoothSegment,
};
