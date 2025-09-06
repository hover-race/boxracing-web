export class UIController {
  constructor(mainScene) {
    this.mainScene = mainScene;
  }

  setup() {
    this.setupCreateServerButton();
    this.setupReplayControls();
  }

  setupCreateServerButton() {
    const createServerBtn = document.getElementById('create-server-btn');
    
    if (createServerBtn) {
      createServerBtn.addEventListener('click', async () => {
        if (this.mainScene.networkManager) {
          this.mainScene.networkManager.cleanup();
        }
        // Clear remote cars when creating new server
        if (this.mainScene.remoteManager) {
          this.mainScene.remoteManager.clearAll();
        }
        this.updateConnectionStatus("Creating new server...", "connecting");
        
        // Create new network manager
        this.mainScene.networkManager = new NetworkManager(
          (message, state) => {
            this.updateConnectionStatus(message, state);
            this.mainScene.log(message);
          },
          this.mainScene.log,
          this.mainScene.log
        );

        try {
          await this.mainScene.networkManager.signalingManager.becomeServer();
          const peerId = this.mainScene.networkManager.signalingManager.peerId;
          this.updateConnectionStatus(`Server: ${peerId}`, "connected");
          
          // Add car sender after becoming server
          this.mainScene.carsender = new NetworkSender('car', () => {
            return this.mainScene.car.serialize()
          });
          this.mainScene.networkManager.addSender(this.mainScene.carsender);
          
          // Setup state update handler
          this.mainScene.networkManager.on('state-update', (states) => {
            const myPeerId = this.mainScene.networkManager.signalingManager.peerId;
            this.mainScene.remoteManager.handleStateUpdate(states, myPeerId);
          });
        } catch (error) {
          this.updateConnectionStatus(`Error: ${error.message}`, "disconnected");
        }
      });
    }
  }

  setupReplayControls() {
    // Setup replay buttons
    const playBtn = document.getElementById('play-replay-btn');
    const pauseBtn = document.getElementById('pause-replay-btn');
    const rewindBackBtn = document.getElementById('rewind-back-btn');
    const rewindForwardBtn = document.getElementById('rewind-forward-btn');
    
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const frames = this.mainScene.car.recorder.frames;
        if (frames.length > 0) {
          this.mainScene.replayPlayer.load(frames);
          this.mainScene.replayPlayer.play();
          playBtn.style.display = 'none';
          pauseBtn.style.display = 'block';
          this.mainScene.replayUI.show();
          console.log('Replay started');
        } else {
          console.log('No replay data to play');
        }
      });
    }
    
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        this.mainScene.replayPlayer.pause();
        playBtn.style.display = 'block';
        pauseBtn.style.display = 'none';
        this.mainScene.replayUI.hide();
        console.log('Replay paused');
      });
    }
    
    if (rewindBackBtn) {
      rewindBackBtn.addEventListener('click', () => {
        this.mainScene.replayPlayer.seek(0);
        console.log('Rewound to start');
      });
    }
    
    if (rewindForwardBtn) {
      rewindForwardBtn.addEventListener('click', () => {
        // Seek to end of replay
        if (this.mainScene.replayPlayer.frames.length > 0) {
          const lastFrame = this.mainScene.replayPlayer.frames[this.mainScene.replayPlayer.frames.length - 1];
          this.mainScene.replayPlayer.seek(lastFrame.timestamp);
        }
        console.log('Fast forwarded to end');
      });
    }
  }

  updateConnectionStatus(message, state = 'connected') {
    const statusDiv = document.getElementById('connection-status');
    const createServerBtn = document.getElementById('create-server-btn');
    
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = `status-${state}`;
    }

    // Clear remote cars when disconnected or offline
    if (state === 'disconnected' || state === 'offline') {
      if (this.mainScene.remoteManager) {
        this.mainScene.remoteManager.clearAll();
      }
    }

    // Update URL with server's gameId when we have a valid server ID
    if (this.mainScene.networkManager?.signalingManager) {
      const gameId = this.mainScene.networkManager.signalingManager.getServerId();
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
      'PeerId:', this.mainScene.networkManager?.signalingManager?.peerId,
      'ServerId:', this.mainScene.networkManager?.signalingManager?.getServerId());
  }
}
