import { Vehicle } from './vehicle.js?v=1';
import { ReplayPlayer, ReplayUI } from './replays.js?v=1';

export class MainScene extends Scene3D {
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
  cameraController = null
  controlsManager = null
  starSystem = null
  replayPlayer = null
  replayUI = null

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

    // Add audio listener to camera
    this.listener = new THREE.AudioListener()

    // Initialize checkpoint manager
    this.checkpointManager = new CheckpointManager(this)

    // Preload car model once
    console.log("Preloading car model...");
    const carGltf = await this.load.gltf('assets/glb/red-mustang-bigwheel2.glb');
    const carModel = carGltf.scenes[0];

    carModel.children.forEach(child => {
      console.log(3333, child.name, child.position)})
    console.log("Car model preloaded successfully");

    // Initialize remote object manager with preloaded model
    this.remoteManager = new RemoteObjectManager(this)
    this.remoteManager.carModel = carModel.clone();

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
    this.physics.add.existing(track, { collisionFlags: 1, mass: 0, shape: 'concave' })
    this.track = track
    this.startTransform = new THREE.Object3D()
    this.track.traverse(child => {
      if (child.name === 'StartPos1') {
        const worldPosition = child.position.clone()
        console.log('Found StartPos1 (world pos):', worldPosition)
        this.startTransform.position.copy(worldPosition)
        this.startTransform.quaternion.copy(child.quaternion)
        console.log('startTransform (world pos):', this.startTransform.position)
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

    this.car = await Vehicle.setupCarMustang(this, this.startTransform, carModel.clone())
    
    // Initialize camera controller using setupCamera helper
    this.cameraController = setupCamera(this.camera, this.car.chassis);
    
    // Initialize checkpoint manager with the car
    this.checkpointManager.init(this.car)
    
    // Initialize replay system
    console.log('Initializing replay system...')
    this.replayPlayer = new ReplayPlayer()
    this.replayUI = new ReplayUI()
    console.log('Replay system initialized')
    
    // Start recording automatically on page load
    console.log('Starting auto-recording...')
    if (this.car.recorder) {
      this.car.recorder.start()
      console.log('Auto-recording started on page load')
    } else {
      console.log('Auto-recording skipped - recorder not available')
    }
    
    if (!this.car) return

    // Initialize controls manager instead of setupKeyboardControls
    this.controlsManager = new ControlsManager(this);
    
    await this.setupNetwork()
    
    if (!params.offlinePlay && this.networkManager) {
      this.carsender = new NetworkSender('car', () => {
        return this.car.serialize()
      })
      this.networkManager.addSender(this.carsender)
    }

    // Setup replay buttons
    const recordBtn = document.getElementById('record-replay-btn');
    const playBtn = document.getElementById('play-replay-btn');
    
    recordBtn.addEventListener('click', () => {
      if (!this.car.recorder) {
        console.log('Recorder not available');
        return;
      }
      if (this.car.recorder.isRecording) {
        const frames = this.car.recorder.stop();
        recordBtn.textContent = 'Record';
        console.log('Recording stopped, captured', frames.length, 'frames');
      } else {
        this.car.recorder.start();
        recordBtn.textContent = 'Stop';
        console.log('Recording started');
      }
    });
    
    // Update button text to show recording state
    recordBtn.textContent = 'Stop';
    
    playBtn.addEventListener('click', () => {
      if (this.replayPlayer.isPlaying) {
        this.replayPlayer.pause();
        playBtn.textContent = 'Play';
        this.replayUI.hide();
      } else {
        const frames = this.car.recorder.frames;
        if (frames.length > 0) {
          this.replayPlayer.load(frames);
          this.replayPlayer.play();
          playBtn.textContent = 'Pause';
          this.replayUI.show();
        } else {
          console.log('No replay data to play');
        }
      }
    });

    // Setup create server button
    const createServerBtn = document.getElementById('create-server-btn');
    createServerBtn.addEventListener('click', async () => {
      if (this.networkManager) {
        this.networkManager.cleanup();
      }
      // Clear remote cars when creating new server
      if (this.remoteManager) {
        this.remoteManager.clearAll();
      }
      this.updateConnectionStatus("Creating new server...", "connecting");
      
      // Create new network manager
      this.networkManager = new NetworkManager(
        (message, state) => {
          this.updateConnectionStatus(message, state);
          this.log(message);
        },
        this.log,
        this.log
      );

      try {
        await this.networkManager.signalingManager.becomeServer();
        const peerId = this.networkManager.signalingManager.peerId;
        this.updateConnectionStatus(`Server: ${peerId}`, "connected");
        
        // Add car sender after becoming server
        this.carsender = new NetworkSender('car', () => {
          return this.car.serialize()
        });
        this.networkManager.addSender(this.carsender);
        
        // Setup state update handler
        this.networkManager.on('state-update', (states) => {
          const myPeerId = this.networkManager.signalingManager.peerId;
          this.remoteManager.handleStateUpdate(states, myPeerId);
        });
      } catch (error) {
        this.updateConnectionStatus(`Error: ${error.message}`, "disconnected");
      }
    });
  }

  log(a, b) {
    console.log(a, b)
  }

  async setupNetwork() {
    if (params.offlinePlay) {
      console.log("Offline play enabled - skipping network setup");
      this.updateConnectionStatus("Offline Mode", "offline");
      return;
    }

    // Check for gameId in URL
    const url = new URL(window.location);
    const gameId = url.searchParams.get('gameId');

    // Create network manager
    this.networkManager = new NetworkManager(
      (message, state) => {
        this.updateConnectionStatus(message, state);
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
        this.updateConnectionStatus(`Connecting to ${gameId}...`, "connecting");
        const serverRef = await this.networkManager.signalingManager.db.collection('servers').doc(gameId).get();
        if (serverRef.exists) {
          await this.networkManager.signalingManager.joinServer(gameId, serverRef.data());
        } else {
          throw new Error('Server not found');
        }
      } catch (error) {
        console.error('Failed to connect to server:', error);
        this.updateConnectionStatus(`Failed to connect to ${gameId}`, "disconnected");
        // If connection fails, try to find or become a server
        await this.networkManager.signalingManager.findOrBecomeServer();
      }
    } else {
      // If no gameId, try to find or become server as before
      await this.networkManager.signalingManager.findOrBecomeServer();
    }
  }

  updateConnectionStatus(message, state = 'connected') {
    const statusDiv = document.getElementById('connection-status');
    const createServerBtn = document.getElementById('create-server-btn');
    
    statusDiv.textContent = message;
    statusDiv.className = `status-${state}`;

    // Clear remote cars when disconnected or offline
    if (state === 'disconnected' || state === 'offline') {
      if (this.remoteManager) {
        this.remoteManager.clearAll();
      }
    }

    // Update URL with server's gameId when we have a valid server ID
    if (this.networkManager?.signalingManager) {
      const gameId = this.networkManager.signalingManager.getServerId();
      const url = new URL(window.location);
      
      if (gameId?.startsWith('game_')) {
        url.searchParams.set('gameId', gameId);
        window.history.replaceState({}, '', url);
      } else if (state === 'disconnected' || state === 'offline') {
        // Remove gameId from URL when disconnected or offline
        url.searchParams.delete('gameId');
        window.history.replaceState({}, '', url);
      }
    }
    
    // Log the state and IDs for debugging
    console.log('Connection State:', state, 
      'PeerId:', this.networkManager?.signalingManager?.peerId,
      'ServerId:', this.networkManager?.signalingManager?.getServerId());
  }

  update(time, deltaTime) {
    this.car.update(inputControls);
    this.car.updateTireMarks();
    
    // Record replay data
    if (this.car.recorder) {
      this.car.recorder.recordFrame(this.car);
    }
    
    // Update replay player if playing
    if (this.replayPlayer && this.replayPlayer.isPlaying) {
      this.replayPlayer.update(this.car);
    } else {
      this.updateCamera(deltaTime);
    }
    
    // Update star system
    if (this.starSystem) {
      this.starSystem.update(deltaTime);
    }

    // Update controls manager
    if (this.controlsManager) {
      this.controlsManager.update();
    }

    if (!params.offlinePlay && this.remoteManager) {
      this.remoteManager.update();
    }
  }

  preRender() {

  }

  updateCamera(deltaTime) {
    // Use the CameraSmoothFollow update method
    this.cameraController.update(this.camera, this.car.chassis, deltaTime);
  }

  cleanup() {
    // Clean up checkpoint manager
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
