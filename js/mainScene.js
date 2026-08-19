import { Vehicle } from './vehicle.js';
import { refreshAllBotShaders, botColorForIndex, updateBotFade } from './botShaders.js';
import { RemoteObjectManager } from './remote-objects.js';
import { NetworkSender, NetworkManager } from './network-classes.js';
import { SignalingManager } from './firestore-signaling.js';
import { CameraSwitcher } from './camera.js';
import { ControlsManager } from './controls.js';
import { CheckpointManager } from './checkpointManager.js';
import { UIController } from './ui.js';
import { Replay } from './replays.js';
import { LapPathRecorder } from './lapPath.js';
import { RacingLine } from './racingLine.js';
import { Bot } from './bot.js';
import { AutoSteer } from './autoSteer.js';
import { centerlineFromTrack } from './trackCenterline.js';
import { ExplosionFX } from './explosionFx.js';
import { CAR_MODELS, getCarModel, selectScene } from './carModels.js';
import { CarCollisionManager, GROUP_TRACK, GROUP_CAR } from './carCollisions.js';
import { emit as emitRaceEvent, isRaceStarted } from './raceEvents.js';
import './countdownHud.js';

export class MainScene extends Scene3D {
  constructor() {
    super({ key: 'main' })
  }

  car
  keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false
  }
  vehicleSteering = 0
  light
  joystick = null
  checkpointManager = null
  portal = null
  controlsManager = null
  starSystem = null
  replay = null
  cameraSwitcher = null

  async loadGltf(path) {
    const obj = await this.load.gltf(path)
    const scene = obj.scenes[0]
    scene.traverse(child => {
      if (child.material) {
        child.material.metalness = 0;
      }
    })
    this.add.existing(scene)
    return scene
  }

  async create() {
    const { lights, orbitControls } = await this.warpSpeed('-ground', '-sky', '-light')
    this.orbitControls = orbitControls
    this.camera.fov = 70
    this.camera.updateProjectionMatrix()

    this.listener = new THREE.AudioListener()
    this.camera.add(this.listener)

    // Initialize checkpoint manager
    this.checkpointManager = new CheckpointManager(this)

    this.lapPathRecorder = new LapPathRecorder()
    this.checkpointManager.lapPathRecorder = this.lapPathRecorder

    this.carModels = new Map()
    for (const definition of CAR_MODELS) {
      const gltf = await this.load.gltf(definition.file)
      this.carModels.set(definition.car_id, {
        definition,
        prefab: selectScene(definition, gltf),
      })
    }
    this.remoteManager = new RemoteObjectManager(this, this.carModels)

    // Add skybox
    const skyGeometry = new THREE.SphereGeometry(1000, 32, 32)
    // Flip the geometry inside out
    skyGeometry.scale(-1, 1, 1)
    
    const skyTexture = new THREE.TextureLoader().load('assets/img/sky.png')
    const skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture
    })
    
    const sky = new THREE.Mesh(skyGeometry, skyMaterial)
    this.scene.add(sky)

    // Add bright ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.0)
    this.scene.add(ambientLight)

    this.camera.position.set(3, 10, -20)
    this.camera.lookAt(0, 0, 0)

    // Load track
    var track = await this.loadGltf('assets/glb/rcc-oval.glb')
    this.physics.add.existing(track, {
      collisionFlags: 1,
      mass: 0,
      shape: 'concave',
      collisionGroup: GROUP_TRACK,
      collisionMask: GROUP_TRACK | GROUP_CAR,
    })
    this.track = track
    this.startTransform = new THREE.Object3D()
    this.botStartTransform = new THREE.Object3D()
    let hasBotStart = false
    this.track.traverse(child => {
      if (child.name === 'StartPos1') {
        const worldPosition = child.position.clone()
        console.log('Found StartPos1 (world pos):', worldPosition)
        this.startTransform.position.copy(worldPosition)
        this.startTransform.quaternion.copy(child.quaternion)
        console.log('startTransform (world pos):', this.startTransform.position)
      }
      if (child.name === 'StartPos2') {
        console.log('Found StartPos2 (world pos):', child.position)
        this.botStartTransform.position.copy(child.position)
        this.botStartTransform.quaternion.copy(child.quaternion)
        hasBotStart = true
      }
      if (child.name === 'FinishLineVolume') {
        this.checkpointManager.setupFinishLine(child)
      }
      if (child.name === 'Checkpoint1') {
        this.checkpointManager.setupCheckpoint(child)
      }
      // Look for a node named Portal to use for positioning the portal
      if (child.name === 'Portal' || child.name.toLowerCase().includes('portal')) {
        console.log('Found Portal node in track:', child.name, child.position);
        this.portalTransform = new THREE.Object3D();
        this.portalTransform.position.copy(child.position);
        this.portalTransform.quaternion.copy(child.quaternion);
        this.portalTransform.scale.copy(child.scale);
      }
    })

    if (!hasBotStart) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.startTransform.quaternion)
      this.botStartTransform.position.copy(this.startTransform.position).addScaledVector(right, 4)
      this.botStartTransform.quaternion.copy(this.startTransform.quaternion)
      console.log('StartPos2 not found in track; bot spawned 4m right of StartPos1')
    }

    this.carCollisionManager = new CarCollisionManager(this.physics.physicsWorld)
    this.physics.carCollisionManager = this.carCollisionManager

    this.racingLines = await Promise.all([
      RacingLine.load('laps/lap-2.json'),
      RacingLine.load('laps/lap-3.json'),
    ])
    this.trackCenterline = centerlineFromTrack(track)
    if (!this.trackCenterline) throw new Error('Failed to extract track centerline')
    console.log('Track centerline:', this.trackCenterline.count, 'points,', this.trackCenterline.length.toFixed(0), 'm')

    const botCount = params.numBots
    const useRaceGrid = params.numLaps > 0 && params.debugSpawnU < 0
    const raceGrid = useRaceGrid ? this.buildRaceGrid(botCount) : null
    const playerTransform = raceGrid?.playerTransform ?? this.startTransform

    const selectedCarModel = getCarModel(params.car_id)
    const selectedPrefab = this.carModels.get(selectedCarModel.car_id).prefab
    this.car = await Vehicle.setup(
      this,
      playerTransform,
      selectedPrefab.clone(true),
      selectedCarModel
    )
    this.carCollisionManager.localVehicle = this.car

    this.explosionFx = new ExplosionFX(this.scene)
    
    // Initialize camera switcher
    this.cameraSwitcher = new CameraSwitcher(this)
    this.cameraSwitcher.initFollow(this.camera, this.car.visualRoot);
    window.bindCameraSwitcherToGui?.(this.cameraSwitcher)
    
    this.checkpointManager.init(this.car, {
      totalLaps: params.numLaps,
      trackLine: this.trackCenterline,
    })
    this.autoSteer = new AutoSteer([this.trackCenterline])
    if (params.debugSpawnU >= 0) {
      const backU = params.debugSpawnBackM / this.trackCenterline.length;
      let u = params.debugSpawnU - backU;
      if (u < 0) u += 1;
      this.teleportCar(MainScene.transformOnLine(this.trackCenterline, u, params.spawnAngle));
      this.autoSteer.seedAtCar(this.car);
      this.autoSteer.resetLatLog();
      console.log('Debug spawn on centerline u=', this.autoSteer.laps[0].u, `(target ${params.debugSpawnU}, back ${params.debugSpawnBackM}m, angle ${params.spawnAngle}°)`);
    } else {
      this.autoSteer.seedAtCar(this.car);
      if (params.spawnAngle !== 0) {
        this.teleportCar(MainScene.yawOffsetTransform(this.car.chassis, params.spawnAngle));
      }
    }

    this.bots = []
    if (botCount > 0) {
      const usedNames = new Set([params.playerName])
      for (let i = 0; i < botCount; i++) {
        const botSpawn = raceGrid?.botSpawns[i]
        const transform = botSpawn?.transform ?? this.botStartTransform
        const bot = new Bot(this.racingLines)
        const botCarModel = CAR_MODELS[Math.floor(Math.random() * CAR_MODELS.length)]
        if (botSpawn) {
          for (const lap of bot.laps) {
            lap.u = lap.line.project(transform.position.x, transform.position.z)
          }
        }
        const botCar = await Vehicle.setup(
          this,
          transform,
          this.carModels.get(botCarModel.car_id).prefab.clone(true),
          botCarModel,
          { isBot: true, botColor: botColorForIndex(i, botCount) }
        )
        let name
        do {
          name = generateDefaultPlayerName() + '[bot]'
        } while (usedNames.has(name))
        usedNames.add(name)
        this.checkpointManager.registerRacer(botCar, { name })
        this.bots.push({ car: botCar, bot })
      }
    }

    this.replay = new Replay(this)


    // Initialize controls manager instead of setupKeyboardControls
    this.controlsManager = new ControlsManager(this);
    
    // Setup UI controller first
    this.uiController = new UIController(this);
    this.uiController.setup();
    
    this.setupDebugStepper()

    await this.setupNetwork()
    
    if (!params.offlinePlay && this.networkManager) {
      this.carsender = new NetworkSender('car', () => {
        return this.car.serialize()
      })
      this.networkManager.addSender(this.carsender)
    }

    this.startRaceCountdown()
  }

  setupDebugStepper() {
    window.__mainScene = this
    window.refreshBotShader = () => refreshAllBotShaders(this)
    params.runPhysics = true
    this._physicsElapsed = 0
    this._fpsFrames = 0
    this._fpsAccum = 0
    this._physicsTimer = document.getElementById('physics-timer')
    this._fpsCounter = document.getElementById('fps-counter')

    if (params.recordLaps) this.lapPathRecorder.startSession()
    window.downloadTrackTrace = () => this.lapPathRecorder.downloadTrace()
    window.downloadLap = (n) => this.lapPathRecorder.downloadLap(n)

    if (params.autoStopPhysicsAfterSec > 0) {
      this._autoStopAt = null;
    }

    window.setPhysicsDebug = (enabled) => {
      const drawer = this.physics?.debugDrawer
      if (!drawer) return
      if (enabled) drawer.enable()
      else drawer.disable()
    }
    window.setPhysicsDebug(params.physicsDebug)
  }

  startRaceCountdown() {
    if (params.skipIntro) {
      emitRaceEvent('raceStart')
      return
    }
    const steps = [3, 2, 1, 0]
    emitRaceEvent('countdownStart')
    let i = 0
    const tick = () => {
      emitRaceEvent('countdown', steps[i])
      if (steps[i] === 0) {
        emitRaceEvent('raceStart')
        return
      }
      i++
      setTimeout(tick, 1000)
    }
    tick()
  }

  _scheduleAutoStop() {
    if (this._autoStopScheduled || params.autoStopPhysicsAfterSec <= 0) return;
    this._autoStopScheduled = true;
    this._autoStopAt = performance.now() + params.autoStopPhysicsAfterSec * 1000;
  }

  _checkAutoStop() {
    if (!this._autoStopAt || performance.now() < this._autoStopAt) return;
    this._autoStopAt = null;
    params.runPhysics = false;
    this.autoSteer?.dumpLog();
  }

  teleportCar(transform) {
    const pos = transform.position;
    const rot = transform.quaternion;
    this.car.syncBodyTransform(pos, rot);
    const body = this.car.collisionMesh.body;
    const tf = body.ammo.getWorldTransform();
    tf.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
    tf.setRotation(new Ammo.btQuaternion(rot.x, rot.y, rot.z, rot.w));
    body.ammo.setWorldTransform(tf);
    this.car.resetMotion();
  }

  log(a, b) {
    console.log(a, b)
  }

  async setupNetwork() {
    if (params.offlinePlay) {
      console.log("Offline play enabled - skipping network setup");
      this.uiController.updateConnectionStatus("Offline Mode", "offline");
      return;
    }

    // Check for gameId in URL
    const url = new URL(window.location);
    const gameId = url.searchParams.get('gameId');

    // Create network manager
    this.networkManager = new NetworkManager(
      (message, state) => {
        this.uiController.updateConnectionStatus(message, state);
        this.log(message);
      },
      this.log,
      this.log
    );

    // Using arrow function to preserve 'this' context
    this.networkManager.on('state-update', (states) => {
      const myPeerId = this.networkManager.signalingManager.peerId;
      this.remoteManager.handleStateUpdate(states, myPeerId);
    });

    // If gameId exists in URL, try to connect to that server
    if (gameId) {
      try {
        this.uiController.updateConnectionStatus(`Connecting to ${gameId}...`, "connecting");
        const serverRef = await this.networkManager.signalingManager.db.collection('servers').doc(gameId).get();
        if (serverRef.exists) {
          await this.networkManager.signalingManager.joinServer(gameId, serverRef.data());
        } else {
          throw new Error('Server not found');
        }
      } catch (error) {
        console.error('Failed to connect to server:', error);
        this.uiController.updateConnectionStatus(`Failed to connect to ${gameId}`, "disconnected");
        // If connection fails, try to find or become a server
        await this.networkManager.signalingManager.findOrBecomeServer();
      }
    } else {
      // If no gameId, try to find or become server as before
      await this.networkManager.signalingManager.findOrBecomeServer();
    }
  }


  update(time, deltaTime) {
    this._deltaTime = deltaTime
    if (deltaTime > 0) {
      this._fpsFrames++
      this._fpsAccum += deltaTime
      if (this._fpsAccum >= 1000) {
        const fps = Math.round(this._fpsFrames * 1000 / this._fpsAccum)
        if (this._fpsCounter) this._fpsCounter.textContent = `${fps} fps`
        this._fpsFrames = 0
        this._fpsAccum = 0
      }
    }
    if (this.replay?.active) {
      this.replay.tick(deltaTime)
      return
    }
    if (!params.runPhysics) return
    this._physicsElapsed += deltaTime / 1000
    if (this._physicsTimer) this._physicsTimer.textContent = this._physicsElapsed.toFixed(1)
    this._scheduleAutoStop();

    const idle = { steering: 0, throttle: 0, brake: 0, handbrake: 0 }
    const raceLive = isRaceStarted()

    if (params.botDrive && this.bots.length && raceLive) {
      for (const { car, bot } of this.bots) {
        car.update(bot.drive(car))
        car.updateTireMarks()
      }
    } else {
      for (const { car } of this.bots ?? []) {
        car.update(idle)
      }
    }

    let vehicleInputs = idle
    const throttle = Math.max(-1, Math.min(1, inputControls.throttle + params.throttleInput + params.autoThrottle))
    if (raceLive) {
      let steering = inputControls.steering;
      if (this.autoSteer) {
        steering = this.autoSteer.drive(this.car, steering, deltaTime);
      } else {
        vehicleParams.autoSteerLateral = 0;
      }

      vehicleInputs = {
        ...inputControls,
        throttle,
        steering,
      }
    } else {
      vehicleInputs = { ...idle, throttle, holdOnGrid: true }
      if (this.autoSteer) vehicleParams.autoSteerLateral = 0;
    }
    this.car.update(vehicleInputs);
    this.autoSteer?.patchWheelLog(vehicleParams.wheelSteerAngle);
    this.car.updateTireMarks();

    this.explosionFx.update(deltaTime / 1000);
    if (params.explosionEnabled && !this.car.exploding && this.car.updateDamage(deltaTime / 1000, this.explosionFx)) {
      this.car.explode(this.explosionFx, this.startTransform, (t) => {
        this.teleportCar(t)
        this.checkpointManager.resetLapProgress(this.car)
      });
    }

    if (this.lapPathRecorder) {
      this.lapPathRecorder.recordFrame(this.car.visualRoot.position);
    }

    if (this.starSystem) {
      this.starSystem.update(deltaTime);
    }

    if (this.controlsManager) {
      this.controlsManager.update();
    }

    if (!params.offlinePlay && this.remoteManager) {
      this.remoteManager.update();
    }

    updateBotFade(this);
    this._checkAutoStop();
  }

  preRender() {
    if (this.replay?.active) {
      this.updateCamera(this._deltaTime || 0)
      return
    }
    if (this.car) this.car.syncVisualTransforms()
    for (const { car } of this.bots ?? []) car.syncVisualTransforms()
    this.carCollisionManager?.postPhysicsUpdate((this._deltaTime || 0) / 1000)
    this.replay?.recordFrame()
    this.updateCamera(this._deltaTime || 0)
  }

  updateCamera(deltaTime) {
    if (this.cameraSwitcher) {
      this.cameraSwitcher.update(this.camera, this.car.visualRoot, deltaTime);
    }
  }

  buildRaceGrid(botCount, spacingM = 8) {
    const startU = this.trackCenterline.project(
      this.startTransform.position.x,
      this.startTransform.position.z
    )
    const playerTransform = MainScene.transformOnLine(
      this.trackCenterline,
      startU,
      params.spawnAngle
    )

    const spawnLine = this.racingLines[0]
    const botStartU = spawnLine.project(
      this.startTransform.position.x,
      this.startTransform.position.z
    )
    const botSpawns = []
    for (let i = 0; i < botCount; i++) {
      let u = botStartU - ((i + 1) * spacingM / spawnLine.length)
      if (u < 0) u += 1
      botSpawns.push({
        transform: MainScene.transformOnLine(spawnLine, u, params.spawnAngle),
        u,
      })
    }
    return { playerTransform, botSpawns }
  }

  static transformOnLine(line, u, angleDeg = 0) {
    const pos = line.sample(u)
    const ahead = line.sample(u + 5 / line.length)
    const transform = new THREE.Object3D()
    transform.position.set(pos.x, pos.y, pos.z)
    const yaw = Math.atan2(ahead.x - pos.x, ahead.z - pos.z) + angleDeg * Math.PI / 180
    transform.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    return transform
  }

  static yawOffsetTransform(object, angleDeg) {
    const transform = new THREE.Object3D()
    transform.position.copy(object.position)
    const offset = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angleDeg * Math.PI / 180
    )
    transform.quaternion.copy(object.quaternion).multiply(offset)
    return transform
  }

  cleanup() {
    this.replay?.dispose();
    if (this.checkpointManager) {
      this.checkpointManager.cleanup();
    }
    
    // Clean up portal
    if (this.portal) {
      this.portal.cleanup();
    }
    
    // Clean up controls
    if (this.controlsManager) {
      this.controlsManager.cleanup();
    }
    
    // Clean up star system
    if (this.starSystem) {
      this.starSystem.cleanup();
    }
  }

}
