/**
 * ExplosionManager - Handles vehicle explosions and respawning
 */
class ExplosionManager {
  /**
   * Create a new ExplosionManager
   * @param {Scene3D} scene - The game scene
   */
  constructor(scene) {
    this.scene = scene;
    this.car = null;
    this.isExploding = false;
    this.explosionParticles = [];
    this.startTransform = null;
  }

  /**
   * Initialize the explosion manager with the player's car and start transform
   * @param {Vehicle} car - The player's car
   * @param {THREE.Object3D} startTransform - The starting position transform
   */
  init(car, startTransform) {
    this.car = car;
    this.startTransform = startTransform;
    console.log("ExplosionManager initialized");
    
    // Set up collision monitoring for explosions
    this.setupCollisionMonitoring();
  }

  /**
   * Set up collision monitoring to detect high-impact collisions
   */
  setupCollisionMonitoring() {
    if (!this.car || !this.car.chassis || !this.car.chassis.body) {
      console.error("Cannot setup collision monitoring, car not properly initialized");
      return;
    }
    
    const self = this;
    
    // Monitor collisions on the car's chassis
    this.car.chassis.body.on.collision((otherObject, event) => {
      // Skip if explosions are disabled in settings
      if (!params.explosionEnabled) return;
      
      if (event === 'start' && !self.isExploding) {
        // Get collision velocity (approximated from car's velocity)
        const velocity = self.car.chassis.body.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
        
        // Use threshold from GUI settings
        const threshold = params.explosionForceThreshold;
        
        // Check if impact is strong enough to trigger explosion
        if (speed > threshold) {
          console.log(`Impact detected! Speed: ${speed.toFixed(2)} (threshold: ${threshold})`);
          self.explodeCar();
        }
      }
    });
    
    console.log("Collision monitoring set up for explosions");
  }
  
  /**
   * Create an explosion effect at the car's position and respawn
   */
  explodeCar() {
    if (this.isExploding) return;
    
    this.isExploding = true;
    console.log("BOOM! Car exploded!");
    
    // Get car position
    const carPosition = this.car.chassis.position.clone();
    
    // Play explosion sound
    this.playExplosionSound();
    
    // Create explosion message
    this.showExplosionMessage();
    
    // Create particle explosion
    this.createExplosionEffect(carPosition);
    
    // Hide the car
    this.car.chassis.visible = false;
    
    // Stop the car's motion
    const body = this.car.chassis.body;
    if (body) {
      body.setVelocity(0, 0, 0);
      body.setAngularVelocity(0, 0, 0);
    }
    
    // Respawn after delay (use delay from GUI settings)
    setTimeout(() => {
      this.respawnCar();
    }, params.respawnDelay);
  }
  
  /**
   * Play explosion sound effect
   */
  playExplosionSound() {
    // Check if audio listener exists
    if (!this.scene.listener) {
      console.warn("Audio listener not found, can't play explosion sound");
      return;
    }
    
    // Create audio source
    const explosionSound = new THREE.Audio(this.scene.listener);
    
    // Load sound file
    const audioLoader = new THREE.AudioLoader();
    
    // Try to load explosion sound
    try {
      audioLoader.load(
        // Use a free explosion sound effect
        'https://freesound.org/data/previews/587/587183_7707433-lq.mp3',
        (buffer) => {
          explosionSound.setBuffer(buffer);
          explosionSound.setVolume(0.8);
          explosionSound.play();
          console.log("Playing explosion sound");
        },
        (xhr) => {
          // Loading progress
        },
        (err) => {
          console.error("Error loading explosion sound:", err);
          // Fallback to oscillator explosion sound
          this.playFallbackExplosionSound();
        }
      );
    } catch (e) {
      console.error("Error setting up explosion sound:", e);
      // Fallback to oscillator explosion sound
      this.playFallbackExplosionSound();
    }
  }
  
  /**
   * Play a fallback explosion sound using oscillator
   */
  playFallbackExplosionSound() {
    // Check if audio context exists
    let audioContext;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error("Web Audio API not supported");
      return;
    }
    
    // Create oscillator
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Set properties
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(40, audioContext.currentTime + 0.5);
    
    // Fade out
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    // Start and stop
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);
  }
  
  /**
   * Create visual particles for explosion effect
   * @param {THREE.Vector3} position - Position of the explosion
   */
  createExplosionEffect(position) {
    // Clean up any existing explosion particles
    this.cleanupExplosionParticles();
    
    // Parameters (use particle count from GUI settings)
    const particleCount = params.particleCount;
    const particleSize = 0.5;
    const explosionRadius = 5;
    const colors = [0xff0000, 0xff5500, 0xff9900, 0xffff00]; // Fire colors
    
    // Create explosion particles
    for (let i = 0; i < particleCount; i++) {
      // Random position within sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = Math.random() * explosionRadius;
      
      const x = position.x + r * Math.sin(phi) * Math.cos(theta);
      const y = position.y + r * Math.sin(phi) * Math.sin(theta);
      const z = position.z + r * Math.cos(phi);
      
      // Create particle
      const geometry = new THREE.SphereGeometry(particleSize * (0.5 + Math.random()));
      const material = new THREE.MeshBasicMaterial({ 
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true,
        opacity: 0.8
      });
      
      const particle = new THREE.Mesh(geometry, material);
      particle.position.set(x, y, z);
      
      // Random velocity for particle
      particle.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10 + 5, // Bias upward
        (Math.random() - 0.5) * 10
      );
      
      // Add particle to scene and track it
      this.scene.scene.add(particle);
      this.explosionParticles.push(particle);
    }
    
    // Start explosion animation
    this.animateExplosion();
  }
  
  /**
   * Animate the explosion particles
   */
  animateExplosion() {
    const self = this;
    const animationDuration = params.respawnDelay * 0.8; // End before respawn
    const startTime = performance.now();
    
    // Animation function
    function animate() {
      const currentTime = performance.now();
      const elapsed = currentTime - startTime;
      
      // Stop when animation is complete
      if (elapsed >= animationDuration) {
        self.cleanupExplosionParticles();
        return;
      }
      
      // Animation progress from 0 to 1
      const progress = elapsed / animationDuration;
      
      // Update each particle
      self.explosionParticles.forEach(particle => {
        // Update position based on velocity
        particle.position.x += particle.velocity.x * 0.05;
        particle.position.y += particle.velocity.y * 0.05;
        particle.position.z += particle.velocity.z * 0.05;
        
        // Add gravity effect
        particle.velocity.y -= 0.1;
        
        // Fade out particles
        if (particle.material) {
          particle.material.opacity = Math.max(0, 0.8 * (1 - progress * 1.2));
        }
      });
      
      // Continue animation
      requestAnimationFrame(animate);
    }
    
    // Start animation
    animate();
  }
  
  /**
   * Clean up explosion particles
   */
  cleanupExplosionParticles() {
    // Remove all explosion particles
    this.explosionParticles.forEach(particle => {
      if (particle && particle.parent) {
        particle.parent.remove(particle);
        if (particle.geometry) particle.geometry.dispose();
        if (particle.material) particle.material.dispose();
      }
    });
    
    // Clear array
    this.explosionParticles = [];
  }
  
  /**
   * Respawn the car at the start position
   */
  respawnCar() {
    if (!this.car) return;
    
    console.log("Respawning car at start position");
    
    // Play respawn sound
    this.playRespawnSound();
    
    // Show the car again
    this.car.chassis.visible = true;
    
    // Reset position to start transform
    if (this.startTransform) {
      const startPos = this.startTransform.position;
      const startRot = this.startTransform.quaternion;
      
      // Teleport the chassis back to start position
      this.car.chassis.position.copy(startPos);
      this.car.chassis.quaternion.copy(startRot);
      
      // Reset physics body
      const body = this.car.chassis.body;
      if (body) {
        body.setVelocity(0, 0, 0);
        body.setAngularVelocity(0, 0, 0);
        
        // Update Ammo.js transform to match
        const transform = body.ammo.getWorldTransform();
        transform.setOrigin(new Ammo.btVector3(startPos.x, startPos.y, startPos.z));
        
        const q = new Ammo.btQuaternion(
          startRot.x,
          startRot.y,
          startRot.z,
          startRot.w
        );
        transform.setRotation(q);
        
        // Activate the body
        body.ammo.activate();
      }
    }
    
    // No longer exploding
    this.isExploding = false;
    
    // Show respawn message
    this.showRespawnMessage();
  }
  
  /**
   * Play respawn sound effect
   */
  playRespawnSound() {
    // Check if audio context exists
    let audioContext;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error("Web Audio API not supported");
      return;
    }
    
    // Create oscillator
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Set properties for a "power up" sound
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.5);
    
    // Fade in and out
    gainNode.gain.setValueAtTime(0.01, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.2, audioContext.currentTime + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    // Start and stop
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);
  }
  
  /**
   * Show explosion message
   */
  showExplosionMessage() {
    // Create or get the message element
    let messageElement = document.getElementById('explosion-message');
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'explosion-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '50%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = '#ff3300';
      messageElement.style.fontFamily = 'monospace';
      messageElement.style.fontSize = '32px';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.7)';
      messageElement.style.padding = '20px 30px';
      messageElement.style.borderRadius = '10px';
      messageElement.style.zIndex = '2000';
      messageElement.style.opacity = '0';
      messageElement.style.transition = 'opacity 0.5s ease';
      document.body.appendChild(messageElement);
    }
    
    // Set message text
    messageElement.innerHTML = '💥 BOOM! 💥<br>Car Exploded!';
    
    // Show message with fade in/out animation
    messageElement.style.opacity = '1';
    
    // Clear any existing timeout
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
    }
    
    // Hide message after delay
    this.messageTimeout = setTimeout(() => {
      messageElement.style.opacity = '0';
    }, 2000);
  }
  
  /**
   * Show respawn message
   */
  showRespawnMessage() {
    // Create or get the message element
    let messageElement = document.getElementById('respawn-message');
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'respawn-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '50%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = '#00dd00';
      messageElement.style.fontFamily = 'monospace';
      messageElement.style.fontSize = '28px';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.7)';
      messageElement.style.padding = '20px 30px';
      messageElement.style.borderRadius = '10px';
      messageElement.style.zIndex = '2000';
      messageElement.style.opacity = '0';
      messageElement.style.transition = 'opacity 0.5s ease';
      document.body.appendChild(messageElement);
    }
    
    // Set message text
    messageElement.innerHTML = '🔄 RESPAWNED 🔄<br>Back at start position';
    
    // Show message with fade in/out animation
    messageElement.style.opacity = '1';
    
    // Clear any existing timeout
    if (this.respawnMessageTimeout) {
      clearTimeout(this.respawnMessageTimeout);
    }
    
    // Hide message after delay
    this.respawnMessageTimeout = setTimeout(() => {
      messageElement.style.opacity = '0';
    }, 2000);
  }
  
  /**
   * Clean up resources when no longer needed
   */
  cleanup() {
    // Clear message timeouts
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
    }
    if (this.respawnMessageTimeout) {
      clearTimeout(this.respawnMessageTimeout);
    }
    
    // Clean up explosion particles
    this.cleanupExplosionParticles();
    
    // Remove UI elements
    const uiElements = [
      'explosion-message',
      'respawn-message'
    ];
    
    uiElements.forEach(id => {
      const element = document.getElementById(id);
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });
  }
}

// Export the ExplosionManager class
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExplosionManager;
} else {
  // Browser environment
  window.ExplosionManager = ExplosionManager;
} 