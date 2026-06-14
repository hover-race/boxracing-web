import { centerlineFromTrack, showCenterlinePath, showCenterlineMarkers } from './trackCenterline.js';

export class CenterlineScene extends Scene3D {
  async loadGltf(path) {
    const obj = await this.load.gltf(path);
    const scene = obj.scenes[0];
    scene.traverse((child) => {
      if (child.material) child.material.metalness = 0;
    });
    this.add.existing(scene);
    return scene;
  }

  async create() {
    const { orbitControls } = await this.warpSpeed('-ground', '-sky', '-light');
    this.orbitControls = orbitControls;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();

    const skyGeometry = new THREE.SphereGeometry(1000, 32, 32);
    skyGeometry.scale(-1, 1, 1);
    const skyTexture = new THREE.TextureLoader().load('assets/img/sky.png');
    const sky = new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ map: skyTexture }));
    this.scene.add(sky);

    this.scene.add(new THREE.AmbientLight(0xffffff, 2.0));

    const track = await this.loadGltf('assets/glb/rcc-oval.glb');
    this.track = track;

    const line = centerlineFromTrack(track);
    if (line) {
      showCenterlinePath(this.scene, line);
      showCenterlineMarkers(this.scene, line, 12);
      console.log('Centerline:', line.count, 'points,', line.length.toFixed(0), 'm');
      window.__trackCenterline = line;
    }

    this.camera.position.set(0, 120, -160);
    this.orbitControls.target.set(0, 0, -160);
    this.orbitControls.update();
  }

  update() {
    this.orbitControls?.update();
  }
}
