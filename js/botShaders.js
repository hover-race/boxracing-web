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
//
// THREE and params are globals (see index2.html / gui.js).

const BOT_SHADERS = ['none', 'outline', 'fresnel', 'solid', 'xray']

function botColorForIndex(i, n) {
  return new THREE.Color().setHSL((i / Math.max(1, n)) % 1, 0.9, 0.55)
}

const BOT_EXTRA_NAMES = ['__bot_outline', '__bot_inside']

function botBodyMeshes(chassis) {
  const meshes = []
  chassis.traverse(c => {
    if (c.isMesh && !BOT_EXTRA_NAMES.includes(c.name)) meshes.push(c)
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
  const meshes = botBodyMeshes(car.chassis)
  for (const wheel of car.wheelMeshes ?? []) meshes.push(wheel)
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

function applyBotShader(car, shader, color) {
  car.chassis.userData.botColor = color
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
    }
  }
}

function refreshAllBotShaders(mainScene) {
  for (const { car } of mainScene.bots ?? []) {
    if (car?.chassis) applyBotShader(car, params.botShader, car.chassis.userData.botColor)
  }
}

// Per-frame distance crossfade for the xray shader: fade the normal car out and the
// inside-out shell in as the bot moves away. Distance is measured per car (chassis
// vs camera), so the whole car shares one fade factor.
const _xrayTmp = new THREE.Vector3()

function updateBotFade(mainScene) {
  if (params.botShader !== 'xray') return
  const cam = mainScene.camera
  for (const { car } of mainScene.bots ?? []) {
    if (!car?.chassis) continue
    const dist = cam.position.distanceTo(car.chassis.getWorldPosition(_xrayTmp))
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
    fade(car.chassis)
    for (const wheel of car.wheelMeshes ?? []) fade(wheel)
  }
}

export { BOT_SHADERS, botColorForIndex, applyBotShader, refreshAllBotShaders, updateBotFade }
