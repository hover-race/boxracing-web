// Cartoon cel-shaded explosion: banded fireball (custom shader with noise dissolve),
// toon-shaded dark smoke puffs, and ballistic debris chunks. Standalone from the old
// ExplosionManager — drive it with spawn(position) + update(dt) from any scene.

const fxParams = {
  // fireball
  fireballRadius: 3.2,
  fireballDuration: 0.9,
  fireballWobble: 0.35,
  fireballBands: 3,
  // smoke
  smokeCount: 10,
  smokeSize: 1.6,
  smokeDuration: 2.2,
  smokeRiseSpeed: 2.2,
  smokeSpread: 2.4,
  // debris
  debrisCount: 16,
  debrisSize: 0.28,
  debrisSpeed: 11,
  debrisGravity: 18,
  debrisDuration: 1.6,
  // flash
  flashRadius: 5,
  flashDuration: 0.18,
}

const FIRE_COLORS = [0xfff7c0, 0xffb020, 0xe23c10]
const SMOKE_COLORS = [0x2b2b30, 0x3a3a40, 0x1e1e22]
const DEBRIS_COLORS = [0x2a2a2e, 0x3d3229, 0xe25822]

function makeToonGradient() {
  const data = new Uint8Array([70, 70, 70, 255, 140, 140, 140, 255, 255, 255, 255, 255])
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

const fireballVertex = /* glsl */ `
  uniform float uTime;
  uniform float uWobble;
  varying float vNoise;
  varying vec3 vNormalV;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vNormalV = normalize(normalMatrix * normal);
    float n = noise(position * 2.0 + uTime * 3.0);
    vNoise = n;
    vec3 displaced = position + normal * n * uWobble;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const fireballFragment = /* glsl */ `
  uniform float uTime;
  uniform float uBands;
  uniform vec3 uColorCore;
  uniform vec3 uColorMid;
  uniform vec3 uColorEdge;
  varying float vNoise;
  varying vec3 vNormalV;

  void main() {
    // Dissolve: noise gets eaten away as life progresses
    float erode = uTime * 1.15;
    if (vNoise < erode) discard;

    // Band by fresnel + noise, quantized for the cel look
    float fresnel = 1.0 - abs(dot(vNormalV, vec3(0.0, 0.0, 1.0)));
    float v = clamp(fresnel * 0.7 + vNoise * 0.5 + uTime * 0.4, 0.0, 0.999);
    float band = floor(v * uBands) / max(uBands - 1.0, 1.0);

    vec3 color = uColorCore;
    if (band > 0.66) color = uColorEdge;
    else if (band > 0.33) color = uColorMid;

    gl_FragColor = vec4(color, 1.0);
  }
`

class ExplosionFX {
  constructor(scene, params = fxParams) {
    this.scene = scene
    this.params = params
    this.active = []
    this.toonGradient = makeToonGradient()

    this.smokeGeo = new THREE.IcosahedronGeometry(1, 1)
    this.debrisGeos = [
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.TetrahedronGeometry(0.9),
      new THREE.BoxGeometry(1.4, 0.5, 0.7),
    ]
    this.flashGeo = new THREE.CircleGeometry(1, 24)
  }

  spawn(position) {
    const p = this.params
    const group = new THREE.Group()
    group.position.copy(position)
    this.scene.add(group)

    const fx = { group, t: 0, fireball: null, smoke: [], debris: [], flash: null }

    fx.fireball = this._makeFireball(p)
    group.add(fx.fireball.mesh)

    for (let i = 0; i < p.smokeCount; i++) {
      const puff = this._makeSmokePuff(p, i / p.smokeCount)
      fx.smoke.push(puff)
      group.add(puff.mesh)
    }

    for (let i = 0; i < p.debrisCount; i++) {
      const chunk = this._makeDebris(p)
      fx.debris.push(chunk)
      group.add(chunk.mesh)
    }

    fx.flash = this._makeFlash(p)
    group.add(fx.flash.mesh)

    this.active.push(fx)
    return fx
  }

  _makeFireball(p) {
    const material = new THREE.ShaderMaterial({
      vertexShader: fireballVertex,
      fragmentShader: fireballFragment,
      uniforms: {
        uTime: { value: 0 },
        uWobble: { value: p.fireballWobble },
        uBands: { value: p.fireballBands },
        uColorCore: { value: new THREE.Color(FIRE_COLORS[0]) },
        uColorMid: { value: new THREE.Color(FIRE_COLORS[1]) },
        uColorEdge: { value: new THREE.Color(FIRE_COLORS[2]) },
      },
    })
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), material)
    mesh.scale.setScalar(0.01)
    return { mesh, material }
  }

  _makeSmokePuff(p, frac) {
    const material = new THREE.MeshToonMaterial({
      color: SMOKE_COLORS[Math.floor(Math.random() * SMOKE_COLORS.length)],
      gradientMap: this.toonGradient,
    })
    const mesh = new THREE.Mesh(this.smokeGeo, material)
    const theta = frac * Math.PI * 2 + Math.random() * 0.8
    const r = 0.4 + Math.random() * 0.6
    mesh.position.set(Math.cos(theta) * r, 0.2 + Math.random() * 0.5, Math.sin(theta) * r)
    mesh.scale.setScalar(0.01)
    return {
      mesh,
      material,
      dir: new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)),
      size: p.smokeSize * (0.6 + Math.random() * 0.8),
      // Let the fireball pop first, then smoke takes over as it dissolves
      delay: 0.25 + Math.random() * 0.35,
      spin: (Math.random() - 0.5) * 2,
    }
  }

  _makeDebris(p) {
    const material = new THREE.MeshToonMaterial({
      color: DEBRIS_COLORS[Math.floor(Math.random() * DEBRIS_COLORS.length)],
      gradientMap: this.toonGradient,
    })
    const geo = this.debrisGeos[Math.floor(Math.random() * this.debrisGeos.length)]
    const mesh = new THREE.Mesh(geo, material)
    const size = p.debrisSize * (0.5 + Math.random())
    mesh.scale.setScalar(size)

    const theta = Math.random() * Math.PI * 2
    const up = 0.35 + Math.random() * 0.65
    const speed = p.debrisSpeed * (0.5 + Math.random() * 0.8)
    return {
      mesh,
      material,
      vel: new THREE.Vector3(
        Math.cos(theta) * speed * (1 - up),
        speed * up,
        Math.sin(theta) * speed * (1 - up)
      ),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(12),
      size,
    }
  }

  _makeFlash(p) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffee,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(this.flashGeo, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 0.05
    mesh.scale.setScalar(0.01)
    return { mesh, material }
  }

  update(dt) {
    const p = this.params
    const totalLife = Math.max(p.fireballDuration, p.smokeDuration, p.debrisDuration)

    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i]
      fx.t += dt

      this._updateFireball(fx, p)
      this._updateSmoke(fx, p, dt)
      this._updateDebris(fx, p, dt)
      this._updateFlash(fx, p)

      if (fx.t >= totalLife) {
        this._dispose(fx)
        this.active.splice(i, 1)
      }
    }
  }

  _updateFireball(fx, p) {
    const life = fx.t / p.fireballDuration
    const { mesh, material } = fx.fireball
    if (life >= 1) {
      mesh.visible = false
      return
    }
    // Fast pop out, slow tail: ease-out growth
    const grow = 1 - Math.pow(1 - Math.min(life * 1.6, 1), 3)
    mesh.scale.setScalar(p.fireballRadius * grow)
    material.uniforms.uTime.value = life
    material.uniforms.uWobble.value = p.fireballWobble
    material.uniforms.uBands.value = p.fireballBands
  }

  _updateSmoke(fx, p, dt) {
    for (const puff of fx.smoke) {
      const t = fx.t - puff.delay
      if (t < 0) continue
      const life = t / p.smokeDuration
      if (life >= 1) {
        puff.mesh.visible = false
        continue
      }
      // Grow to full size by 30% of life, then cartoon-shrink to zero at the end
      const scale = life < 0.3
        ? puff.size * (life / 0.3)
        : puff.size * (1 - Math.pow((life - 0.3) / 0.7, 2))
      puff.mesh.scale.setScalar(Math.max(scale, 0.001))
      puff.mesh.position.addScaledVector(puff.dir, p.smokeSpread * dt * (1 - life))
      puff.mesh.position.y += p.smokeRiseSpeed * dt
      puff.mesh.rotation.y += puff.spin * dt
    }
  }

  _updateDebris(fx, p, dt) {
    for (const chunk of fx.debris) {
      const life = fx.t / p.debrisDuration
      if (life >= 1) {
        chunk.mesh.visible = false
        continue
      }
      chunk.vel.y -= p.debrisGravity * dt
      chunk.mesh.position.addScaledVector(chunk.vel, dt)
      chunk.mesh.rotation.x += chunk.spin.x * dt
      chunk.mesh.rotation.y += chunk.spin.y * dt
      chunk.mesh.rotation.z += chunk.spin.z * dt
      // Bounce off ground plane
      if (chunk.mesh.position.y < chunk.size * 0.5 && chunk.vel.y < 0) {
        chunk.mesh.position.y = chunk.size * 0.5
        chunk.vel.y *= -0.35
        chunk.vel.x *= 0.7
        chunk.vel.z *= 0.7
      }
      // Shrink out in the last quarter
      if (life > 0.75) chunk.mesh.scale.setScalar(chunk.size * (1 - (life - 0.75) / 0.25))
    }
  }

  _updateFlash(fx, p) {
    const life = fx.t / p.flashDuration
    const { mesh, material } = fx.flash
    if (life >= 1) {
      mesh.visible = false
      return
    }
    mesh.scale.setScalar(p.flashRadius * life)
    material.opacity = 0.95 * (1 - life)
  }

  _dispose(fx) {
    fx.fireball.material.dispose()
    fx.fireball.mesh.geometry.dispose()
    for (const puff of fx.smoke) puff.material.dispose()
    for (const chunk of fx.debris) chunk.material.dispose()
    fx.flash.material.dispose()
    this.scene.remove(fx.group)
  }

  disposeAll() {
    for (const fx of this.active) this._dispose(fx)
    this.active = []
  }
}

export { ExplosionFX, fxParams }
