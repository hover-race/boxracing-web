// Visibility shaders for bot cars, selectable via the GUI dropdown (params.botShader).
//
// The goal is making opponents readable at a distance. Lit paint shrinks to a few
// dark pixels far away, so each option trades realism for contrast/silhouette:
//
//   none    – normal lit material (baseline).
//   outline – inverted-hull silhouette with SCREEN-SPACE constant width: the hull is
//             offset along the view-space normal in clip space and scaled by clip.w,
//             so after perspective divide the line stays a fixed fraction of the
//             screen. The car shrinks with distance but the outline does not, i.e.
//             the line gets relatively thicker the farther away the car is.
//   fresnel – rim/Fresnel emissive injected into the standard material; lights up the
//             silhouette edge regardless of scene lighting.
//   solid   – flat unlit bright color (max contrast, ignores lighting).
//   xray    – crossfade: normal lit car (depth-tested) + flat shell that draws through walls.
//   digital – screen-space pixelation + scrolling noise / scanline shimmer.
//   glitch  – VHS/video static: RGB tear, snow, slice offsets.
//   waves   – red tint bands traveling from the rear toward the nose.
//
// THREE and params are globals (see index2.html / gui.js).

const BOT_SHADERS = ['none', 'outline', 'fresnel', 'solid', 'xray', 'digital', 'glitch', 'waves']
const ANIMATED_BOT_SHADERS = new Set(['digital', 'glitch', 'waves'])

function botColorForIndex(i, n) {
  return new THREE.Color().setHSL((i / Math.max(1, n)) % 1, 0.9, 0.55)
}

const BOT_EXTRA_NAMES = ['__bot_outline', '__bot_inside', '__contact_overlay']

function botBodyMeshes(chassis) {
  const meshes = []
  chassis.traverse(c => {
    if (c.isMesh && !c.userData.isCollisionMesh && !BOT_EXTRA_NAMES.includes(c.name)) meshes.push(c)
  })
  return meshes
}

function removeBotExtras(mesh) {
  for (const extra of mesh.children.filter(c => BOT_EXTRA_NAMES.includes(c.name))) {
    mesh.remove(extra)
    extra.material.dispose()
  }
}

function makeOutlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      outlineColor: { value: new THREE.Color(0xffffff) },
      thickness: { value: params.botOutlineThickness },
      aspect: { value: window.innerWidth / window.innerHeight },
    },
    vertexShader: `
      uniform float thickness;
      uniform float aspect;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normal);
        vec2 dir = normalize((projectionMatrix * vec4(viewNormal, 0.0)).xy);
        dir.x /= aspect; // equalize pixel width on x and y
        clip.xy += dir * thickness * clip.w;
        gl_Position = clip;
      }
    `,
    fragmentShader: `
      uniform vec3 outlineColor;
      void main() { gl_FragColor = vec4(outlineColor, 1.0); }
    `,
    side: THREE.BackSide,
  })
}

function makeFresnelMaterial(base, color) {
  const mat = base.clone()
  mat.metalness = 0
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: new THREE.Color(color) }
    shader.uniforms.rimPower = { value: 2.0 }
    shader.fragmentShader = 'uniform vec3 rimColor;\nuniform float rimPower;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       float rimDot = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
       totalEmissiveRadiance += rimColor * pow(rimDot, rimPower);`
    )
  }
  mat.needsUpdate = true
  return mat
}

function makeSolidMaterial(base, color) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color ?? base.color) })
}

// Distance crossfade xray: up close the normal lit car shows; as it moves away it
// fades to a flat bot-colored FrontSide shell (BackSide on a convex body is only
// visible at silhouette edges from outside, so it reads as disappearing).
const XRAY_NEAR = 20.0
const XRAY_FAR = 140.0
const XRAY_SHELL_MIN = 0.25  // flat shell stays slightly visible up close

function botCarMeshes(car) {
  const meshes = botBodyMeshes(car.visualRoot)
  for (const wheel of car.wheelMeshes ?? []) {
    wheel.traverse(child => {
      if (child.isMesh && !BOT_EXTRA_NAMES.includes(child.name)) meshes.push(child)
    })
  }
  return meshes
}

function makeXrayNormalMaterial(base) {
  const mat = base.clone()
  mat.metalness = 0
  mat.transparent = true
  mat.depthWrite = true
  return mat
}

function makeDistanceShellMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: XRAY_SHELL_MIN,
    depthTest: false,
    depthWrite: false,
  })
}

// Screen-space pixelation + scrolling digital noise / shimmer bands.
function makeDigitalMaterial(base, color) {
  const map = base.map ?? null
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      pixelSize: { value: 5.0 },
      noiseAmount: { value: 0.45 },
      shimmerSpeed: { value: 6.0 },
      baseColor: { value: new THREE.Color(color ?? base.color ?? 0xffffff) },
      map: { value: map },
      useMap: { value: map ? 1.0 : 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float pixelSize;
      uniform float noiseAmount;
      uniform float shimmerSpeed;
      uniform vec3 baseColor;
      uniform sampler2D map;
      uniform float useMap;
      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        vec2 pix = floor(gl_FragCoord.xy / max(pixelSize, 1.0));

        vec3 albedo = baseColor;
        if (useMap > 0.5) {
          albedo *= texture2D(map, vUv).rgb;
        }

        float n = hash21(pix + floor(time * shimmerSpeed));
        float scan = step(0.92, fract(gl_FragCoord.y * 0.08 + time * shimmerSpeed * 0.15));
        float band = step(0.97, fract(gl_FragCoord.y * 0.02 - time * 0.7));
        float shimmer = mix(1.0 - noiseAmount * 0.5, 1.0 + noiseAmount, n);
        shimmer = mix(shimmer, 1.4, scan * 0.5);
        shimmer = mix(shimmer, 0.2, band);

        // Soft lambert so the pixel blocks still read as a 3D car
        vec3 N = normalize(vViewNormal);
        vec3 L = normalize(vec3(0.4, 0.8, 0.5));
        float ndl = clamp(dot(N, L), 0.25, 1.0);

        // Quantize final color into chunky digital levels
        vec3 lit = albedo * ndl * shimmer;
        lit = floor(lit * 6.0 + n * 0.35) / 6.0;

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  })
  if (map) mat.uniforms.map.value = map
  return mat
}

// VHS / broadcast glitch: RGB tear, snow static, horizontal slice jumps.
function makeGlitchMaterial(base, color) {
  const map = base.map ?? null
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseColor: { value: new THREE.Color(color ?? base.color ?? 0xffffff) },
      map: { value: map },
      useMap: { value: map ? 1.0 : 0.0 },
      snowAmount: { value: 0.55 },
      tearAmount: { value: 0.012 },
      rgbSplit: { value: 0.008 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vViewNormal;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 baseColor;
      uniform sampler2D map;
      uniform float useMap;
      uniform float snowAmount;
      uniform float tearAmount;
      uniform float rgbSplit;
      varying vec2 vUv;
      varying vec3 vViewNormal;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float hash11(float n) {
        return fract(sin(n) * 43758.5453);
      }

      void main() {
        vec2 uv = vUv;
        float t = time;

        // Occasional hard tear bursts
        float burst = step(0.92, hash11(floor(t * 8.0)));
        float slice = floor(uv.y * 28.0);
        float sliceJitter = (hash21(vec2(slice, floor(t * 12.0))) - 0.5);
        uv.x += sliceJitter * tearAmount * (1.0 + burst * 4.0);

        // Rolling bar
        float roll = fract(uv.y + t * 0.35);
        float bar = smoothstep(0.0, 0.04, roll) * smoothstep(0.12, 0.04, roll);

        vec2 split = vec2(rgbSplit * (0.6 + burst * 2.5), 0.0);
        vec3 albedo = baseColor;
        if (useMap > 0.5) {
          float r = texture2D(map, uv + split).r;
          float g = texture2D(map, uv).g;
          float b = texture2D(map, uv - split).b;
          albedo *= vec3(r, g, b);
        } else {
          albedo = vec3(
            albedo.r + burst * 0.15,
            albedo.g,
            albedo.b - burst * 0.1
          );
        }

        // Soft lambert so form still reads
        vec3 N = normalize(vViewNormal);
        vec3 L = normalize(vec3(0.35, 0.85, 0.4));
        float ndl = clamp(dot(N, L), 0.2, 1.0);
        vec3 lit = albedo * ndl;

        // Video snow / static
        float snow = hash21(gl_FragCoord.xy + floor(t * 60.0));
        lit = mix(lit, vec3(snow), snowAmount * (0.25 + 0.75 * burst));

        // Interlace + tracking lines
        float interlace = step(0.5, fract(gl_FragCoord.y * 0.5));
        lit *= mix(0.75, 1.0, interlace);
        lit = mix(lit, lit * vec3(0.7, 1.1, 0.85), bar);

        // Blocky dropout patches
        vec2 block = floor(gl_FragCoord.xy / 12.0);
        float drop = step(0.97, hash21(block + floor(t * 5.0)));
        lit = mix(lit, vec3(0.05), drop);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  })
  if (map) mat.uniforms.map.value = map
  return mat
}

// Red tint bands traveling nose → tail in car-local space (forward = +Z).
function makeWavesMaterial(base, color) {
  const map = base.map ?? null
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      carWorldInverse: { value: new THREE.Matrix4() },
      baseColor: { value: new THREE.Color(color ?? base.color ?? 0xffffff) },
      waveColor: { value: new THREE.Color(1.0, 0.05, 0.08) },
      map: { value: map },
      useMap: { value: map ? 1.0 : 0.0 },
      waveSpeed: { value: 4.0 },
      waveFreq: { value: 2.4 },
      waveStrength: { value: 0.4 },
    },
    vertexShader: `
      uniform mat4 carWorldInverse;
      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vCarLocal;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vCarLocal = (carWorldInverse * world).xyz;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 baseColor;
      uniform vec3 waveColor;
      uniform sampler2D map;
      uniform float useMap;
      uniform float waveSpeed;
      uniform float waveFreq;
      uniform float waveStrength;
      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vCarLocal;

      void main() {
        vec3 albedo = baseColor;
        if (useMap > 0.5) albedo *= texture2D(map, vUv).rgb;

        // Travel from rear (−Z) toward front (+Z)
        float phase = vCarLocal.z * waveFreq + time * waveSpeed;
        float band = pow(0.5 + 0.5 * sin(phase), 3.0);
        float frontGlow = smoothstep(-0.5, 2.0, vCarLocal.z) * 0.08;
        float tint = clamp(band * waveStrength + frontGlow, 0.0, 1.0);

        vec3 N = normalize(vViewNormal);
        vec3 L = normalize(vec3(0.4, 0.85, 0.45));
        float ndl = clamp(dot(N, L), 0.22, 1.0);
        vec3 lit = mix(albedo * ndl, waveColor, tint);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  })
  if (map) mat.uniforms.map.value = map
  return mat
}

function applyBotShader(car, shader, color) {
  car.visualRoot.userData.botColor = color
  for (const mesh of botCarMeshes(car)) {
    if (!mesh.userData.botBaseMaterial) mesh.userData.botBaseMaterial = mesh.material
    const base = mesh.userData.botBaseMaterial

    removeBotExtras(mesh)
    mesh.renderOrder = 0
    if (mesh.userData.botMaterial) {
      mesh.userData.botMaterial.dispose()
      mesh.userData.botMaterial = null
    }

    if (shader === 'none' || shader === 'outline') {
      mesh.material = base
      if (shader === 'outline') {
        const outline = new THREE.Mesh(mesh.geometry, makeOutlineMaterial())
        outline.name = '__bot_outline'
        mesh.add(outline)
      }
    } else if (shader === 'fresnel') {
      mesh.material = mesh.userData.botMaterial = makeFresnelMaterial(base, color)
    } else if (shader === 'solid') {
      mesh.material = mesh.userData.botMaterial = makeSolidMaterial(base, color)
    } else if (shader === 'xray') {
      mesh.material = mesh.userData.botMaterial = makeXrayNormalMaterial(base)
      const shell = new THREE.Mesh(mesh.geometry, makeDistanceShellMaterial(color))
      shell.name = '__bot_inside'
      shell.renderOrder = 999
      mesh.add(shell)
    } else if (shader === 'digital') {
      mesh.material = mesh.userData.botMaterial = makeDigitalMaterial(base, color)
    } else if (shader === 'glitch') {
      mesh.material = mesh.userData.botMaterial = makeGlitchMaterial(base, color)
    } else if (shader === 'waves') {
      mesh.material = mesh.userData.botMaterial = makeWavesMaterial(base, color)
    }
  }
}

function refreshAllBotShaders(mainScene) {
  for (const { car } of mainScene.bots ?? []) {
    if (car?.visualRoot) applyBotShader(car, params.botShader, car.visualRoot.userData.botColor)
  }
}

// Per-frame distance crossfade for the xray shader: fade the normal car out and the
// inside-out shell in as the bot moves away. Distance is measured per car (chassis
// vs camera), so the whole car shares one fade factor.
const _xrayTmp = { current: null }
function xrayTmp() {
  if (!_xrayTmp.current) _xrayTmp.current = new THREE.Vector3()
  return _xrayTmp.current
}

function updateBotFade(mainScene) {
  if (ANIMATED_BOT_SHADERS.has(params.botShader)) {
    const t = performance.now() * 0.001
    const inv = new THREE.Matrix4()
    for (const { car } of mainScene.bots ?? []) {
      if (!car?.visualRoot) continue
      if (params.botShader === 'waves') {
        car.visualRoot.updateMatrixWorld(true)
        inv.copy(car.visualRoot.matrixWorld).invert()
      }
      for (const mesh of botCarMeshes(car)) {
        const uniforms = mesh.userData.botMaterial?.uniforms
        if (!uniforms?.time) continue
        uniforms.time.value = t
        if (uniforms.carWorldInverse) uniforms.carWorldInverse.value.copy(inv)
      }
    }
    return
  }
  if (params.botShader !== 'xray') return
  const cam = mainScene.camera
  for (const { car } of mainScene.bots ?? []) {
    if (!car?.visualRoot) continue
    const dist = cam.position.distanceTo(car.visualRoot.getWorldPosition(xrayTmp()))
    const t = Math.min(1, Math.max(0, (dist - XRAY_NEAR) / (XRAY_FAR - XRAY_NEAR)))
    const shellOp = XRAY_SHELL_MIN + t * (1 - XRAY_SHELL_MIN)
    const normalOp = 1 - t
    const fade = (root) => root.traverse(c => {
      if (c.name === '__bot_inside') {
        c.material.opacity = shellOp
      } else if (c.isMesh && c.userData.botMaterial === c.material) {
        c.material.opacity = normalOp
        c.material.depthWrite = normalOp > 0.5
      }
    })
    fade(car.visualRoot)
    for (const wheel of car.wheelMeshes ?? []) fade(wheel)
  }
}

export { BOT_SHADERS, botColorForIndex, applyBotShader, refreshAllBotShaders, updateBotFade }
