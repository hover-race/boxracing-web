/**
 * Portal - Creates a special teleportation portal to LevelsIO VibeJam
 */
class Portal {
  /**
   * Create a new portal
   * @param {Scene3D} scene - The game scene
   * @param {THREE.Object3D} [transform] - Optional transform to position the portal
   */
  constructor(scene, transform) {
    this.scene = scene;
    this.portalMesh = null;
    this.innerPortalMesh = null;
    this.portalLight = null;
    this.particles = [];
    this.isActive = true;
    this.transform = transform;
    
    // Portal animation values
    this.rotationSpeed = 0.01;
    this.floatAmplitude = 0.2;
    this.floatSpeed = 0.01;
    this.floatOffset = 0;
    
    // Create the portal object
    this.createPortal();
    
    // Apply transform if provided
    if (this.transform) {
      // Set position
      this.setPosition(
        this.transform.position.x,
        this.transform.position.y,
        this.transform.position.z
      );
      
      // Set rotation from quaternion
      const euler = new THREE.Euler().setFromQuaternion(this.transform.quaternion);
      this.setRotation(euler.x, euler.y, euler.z);
      
      // Set scale if available
      if (this.transform.scale) {
        this.setScale(
          this.transform.scale.x,
          this.transform.scale.y,
          this.transform.scale.z
        );
      }
      
      console.log('Portal positioned using provided transform');
    }
  }
  
  /**
   * Create the portal visual elements
   */
  createPortal() {
    // Check if portal is enabled in settings
    this.isActive = params.portalEnabled;
    
    // Create the outer portal ring
    const torusGeometry = new THREE.TorusGeometry(3, 0.5, 16, 32);
    const torusMaterial = new THREE.MeshPhongMaterial({
      color: 0x00ddff,
      emissive: 0x0066aa,
      shininess: 100,
      transparent: true,
      opacity: 0.9
    });
    
    this.portalMesh = new THREE.Mesh(torusGeometry, torusMaterial);
    this.portalMesh.rotation.x = Math.PI / 2; // Make it horizontal
    this.scene.scene.add(this.portalMesh);
    
    // Create inner swirling portal disk
    const diskGeometry = new THREE.CircleGeometry(2.8, 32);
    const diskMaterial = new THREE.MeshBasicMaterial({
      color: 0x66ffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    
    // Create procedural swirl texture
    const textureSize = 512;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d');
    
    // Create radial gradient
    const gradient = ctx.createRadialGradient(
      textureSize/2, textureSize/2, 0, 
      textureSize/2, textureSize/2, textureSize/2
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.7, 'rgba(0, 221, 255, 0.6)');
    gradient.addColorStop(1, 'rgba(0, 102, 170, 0.4)');
    
    // Fill background
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, textureSize, textureSize);
    
    // Draw spiral pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    
    // Draw inner spiral
    ctx.beginPath();
    const drawSpiral = (clockwise) => {
      const centerX = textureSize/2;
      const centerY = textureSize/2;
      const maxRadius = textureSize * 0.45;
      const totalTurns = 3;
      const points = 100;
      
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2 * totalTurns;
        const radius = (i / points) * maxRadius;
        const direction = clockwise ? 1 : -1;
        
        const x = centerX + Math.cos(angle * direction) * radius;
        const y = centerY + Math.sin(angle * direction) * radius;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    };
    
    // Draw two spirals in opposite directions
    drawSpiral(true);
    ctx.stroke();
    
    ctx.beginPath();
    drawSpiral(false);
    ctx.stroke();
    
    // Draw cross lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(textureSize * 0.25, textureSize * 0.25);
    ctx.lineTo(textureSize * 0.75, textureSize * 0.75);
    ctx.moveTo(textureSize * 0.25, textureSize * 0.75);
    ctx.lineTo(textureSize * 0.75, textureSize * 0.25);
    ctx.moveTo(textureSize * 0.2, textureSize * 0.5);
    ctx.lineTo(textureSize * 0.8, textureSize * 0.5);
    ctx.moveTo(textureSize * 0.5, textureSize * 0.2);
    ctx.lineTo(textureSize * 0.5, textureSize * 0.8);
    ctx.stroke();
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    diskMaterial.map = texture;
    diskMaterial.needsUpdate = true;
    
    this.innerPortalMesh = new THREE.Mesh(diskGeometry, diskMaterial);
    this.innerPortalMesh.rotation.x = Math.PI / 2; // Align with the torus
    this.scene.scene.add(this.innerPortalMesh);
    
    // Add a point light inside the portal
    this.portalLight = new THREE.PointLight(0x00ddff, 2, 10);
    this.portalLight.position.set(0, 0, 0);
    this.scene.scene.add(this.portalLight);
    
    // Create floating particles around the portal
    this.createPortalParticles();
    
    // Add physics trigger for portal
    this.addPortalTrigger();
    
    // Start portal animation
    this.animate();
    
    // Create portal label
    this.createPortalLabel();
  }
  
  /**
   * Create a text label above the portal
   */
  createPortalLabel() {
    // Create div for portal label
    const labelElement = document.createElement('div');
    labelElement.id = 'portal-label';
    labelElement.textContent = 'VIBE JAM PORTAL';
    labelElement.style.position = 'fixed';
    labelElement.style.fontFamily = 'monospace';
    labelElement.style.fontSize = '16px';
    labelElement.style.fontWeight = 'bold';
    labelElement.style.color = '#00ddff';
    labelElement.style.textShadow = '0 0 5px #00ddff, 0 0 10px #00ddff';
    labelElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    labelElement.style.padding = '5px 10px';
    labelElement.style.borderRadius = '5px';
    labelElement.style.pointerEvents = 'none'; // Don't interrupt mouse events
    labelElement.style.zIndex = '100';
    labelElement.style.display = 'none'; // Initially hidden
    
    document.body.appendChild(labelElement);
    this.labelElement = labelElement;
  }
  
  /**
   * Update the portal label position to follow the portal in 3D space
   */
  updateLabelPosition() {
    if (!this.labelElement || !this.portalMesh) return;
    
    // Get portal position in world space
    const portalPos = this.portalMesh.position.clone();
    
    // Project the 3D position to 2D screen space
    const vector = portalPos.clone();
    vector.y += 4; // Position label above portal
    
    vector.project(this.scene.camera);
    
    // Convert to screen coordinates
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
    
    // Update label position
    this.labelElement.style.left = x + 'px';
    this.labelElement.style.top = y + 'px';
    this.labelElement.style.transform = 'translate(-50%, -50%)';
    
    // Only show label if portal is in front of camera
    if (vector.z < 1) {
      this.labelElement.style.display = 'block';
    } else {
      this.labelElement.style.display = 'none';
    }
  }
  
  /**
   * Create floating particles around the portal
   */
  createPortalParticles() {
    // Create particles floating around the portal
    const particleCount = 30;
    
    for (let i = 0; i < particleCount; i++) {
      // Random position around the torus
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 1.5 - 0.75; // Slightly inside and outside the torus
      
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = (Math.random() - 0.5) * 2;
      
      // Create a small glowing particle
      const geometry = new THREE.SphereGeometry(0.05 + Math.random() * 0.1);
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.6 + Math.random() * 0.4
      });
      
      const particle = new THREE.Mesh(geometry, material);
      particle.position.set(x, y, z);
      
      // Store original position and other animation parameters
      particle.userData.originalPos = new THREE.Vector3(x, y, z);
      particle.userData.floatSpeed = 0.01 + Math.random() * 0.02;
      particle.userData.floatOffset = Math.random() * Math.PI * 2;
      
      this.scene.scene.add(particle);
      this.particles.push(particle);
    }
  }
  
  /**
   * Create physics trigger for the portal
   */
  addPortalTrigger() {
    // Create an invisible trigger volume for the portal
    const triggerObject = new THREE.Object3D();
    triggerObject.position.copy(this.portalMesh.position);
    this.scene.scene.add(triggerObject);
    
    // Add physics to the trigger object
    this.scene.physics.add.existing(triggerObject, {
      shape: 'cylinder',
      radius: 2.5,
      height: 2,
      mass: 0,  // Static object
      collisionFlags: 4  // CF_NO_CONTACT_RESPONSE - ghost object
    });
    
    // Set up collision detection
    const self = this;
    const portalBody = triggerObject.body;
    
    portalBody.on.collision((otherObject, event) => {
      if (otherObject === self.scene.car.chassis) {
        if (event === 'start' && self.isActive) {
          console.log('PORTAL: Car entered the VibeJam portal!');
          self.activatePortal();
        }
      }
    });
    
    this.triggerObject = triggerObject;
  }
  
  /**
   * Position the portal at the specified coordinates
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} z - Z position
   */
  setPosition(x, y, z) {
    this.portalMesh.position.set(x, y, z);
    this.innerPortalMesh.position.set(x, y, z);
    this.portalLight.position.set(x, y + 0.5, z);
    this.triggerObject.position.set(x, y, z);
    
    // Update particles positions relative to new portal position
    this.particles.forEach(particle => {
      const originalPos = particle.userData.originalPos;
      particle.position.set(
        originalPos.x + x,
        originalPos.y + y,
        originalPos.z + z
      );
      
      // Update the original position to be relative to the new center
      particle.userData.originalPos = new THREE.Vector3(
        originalPos.x,
        originalPos.y,
        originalPos.z
      );
    });
  }
  
  /**
   * Set the rotation of the portal
   * @param {number} x - X rotation in radians
   * @param {number} y - Y rotation in radians
   * @param {number} z - Z rotation in radians
   */
  setRotation(x, y, z) {
    // Save the original x rotation (we want to keep the portal horizontal)
    const originalXRotation = this.portalMesh.rotation.x;
    const originalInnerXRotation = this.innerPortalMesh.rotation.x;
    
    // Apply new rotation
    this.portalMesh.rotation.set(x, y, z);
    this.innerPortalMesh.rotation.set(x, y, z);
    
    // Restore horizontal orientation (x rotation)
    this.portalMesh.rotation.x = originalXRotation;
    this.innerPortalMesh.rotation.x = originalInnerXRotation;
    
    // Update the trigger object rotation as well
    if (this.triggerObject && this.triggerObject.body) {
      // For physics objects, we need to update the Ammo.js transform
      const transform = this.triggerObject.body.ammo.getWorldTransform();
      
      // Create Ammo quaternion from Euler angles
      const quat = new Ammo.btQuaternion(0, 0, 0, 1);
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
      quat.setValue(rotation.x, rotation.y, rotation.z, rotation.w);
      
      // Set the rotation
      transform.setRotation(quat);
      
      // Activate the body to ensure the change takes effect
      this.triggerObject.body.ammo.activate();
    }
    
    console.log('Portal rotation set to:', { x, y, z });
  }
  
  /**
   * Set the scale of the portal
   * @param {number} x - X scale
   * @param {number} y - Y scale
   * @param {number} z - Z scale
   */
  setScale(x, y, z) {
    this.portalMesh.scale.set(x, y, z);
    this.innerPortalMesh.scale.set(x, y, z);
  }
  
  /**
   * Set the visibility of the portal
   * @param {boolean} visible - Whether the portal should be visible
   */
  setVisible(visible) {
    this.isActive = visible;
    
    // Update visibility of all portal elements
    if (this.portalMesh) {
      this.portalMesh.visible = visible;
    }
    
    if (this.innerPortalMesh) {
      this.innerPortalMesh.visible = visible;
    }
    
    if (this.portalLight) {
      this.portalLight.visible = visible;
    }
    
    // Update particles visibility
    this.particles.forEach(particle => {
      if (particle) {
        particle.visible = visible;
      }
    });
    
    // Update label visibility
    if (this.labelElement) {
      this.labelElement.style.display = visible ? '' : 'none';
    }
    
    // If being made visible again, restart animation
    if (visible && !this.animationRunning) {
      this.animationRunning = true;
      this.animate();
    }
  }
  
  /**
   * Animate the portal and its particles
   */
  animate() {
    if (!this.isActive) {
      this.animationRunning = false;
      return;
    }
    
    this.animationRunning = true;
    
    // Update floating animation
    this.floatOffset += this.floatSpeed;
    const floatY = Math.sin(this.floatOffset) * this.floatAmplitude;
    
    // Move portal up and down
    const baseY = this.portalMesh.position.y - floatY;
    this.portalMesh.position.y = baseY + floatY;
    this.innerPortalMesh.position.y = baseY + floatY;
    this.portalLight.position.y = baseY + floatY + 0.5;
    
    // Rotate portal elements
    this.portalMesh.rotation.z += this.rotationSpeed;
    this.innerPortalMesh.rotation.z -= this.rotationSpeed * 1.5;
    
    // Animate particles
    this.particles.forEach(particle => {
      // Get the original position relative to portal center
      const originalPos = particle.userData.originalPos;
      const floatSpeed = particle.userData.floatSpeed;
      const particleOffset = particle.userData.floatOffset + this.floatOffset * floatSpeed;
      
      // Calculate new particle position with floating motion
      const x = originalPos.x + Math.sin(particleOffset * 2) * 0.2;
      const y = originalPos.y + Math.cos(particleOffset) * 0.3 + floatY;
      const z = originalPos.z + Math.sin(particleOffset * 1.5) * 0.2;
      
      // Update particle position relative to portal center
      particle.position.set(
        x + this.portalMesh.position.x,
        y + baseY,
        z + this.portalMesh.position.z
      );
      
      // Pulse the particle opacity
      particle.material.opacity = 0.6 + Math.sin(this.floatOffset * 2 + particleOffset) * 0.4;
    });
    
    // Pulse portal light intensity
    this.portalLight.intensity = 2 + Math.sin(this.floatOffset * 3) * 0.5;
    
    // Update the label position
    this.updateLabelPosition();
    
    // Continue animation on next frame
    requestAnimationFrame(() => this.animate());
  }
  
  /**
   * Activate the portal and teleport to VibeJam
   */
  activatePortal() {
    if (!this.isActive) return;
    
    // Temporarily deactivate to prevent multiple activations
    this.isActive = false;
    
    // Play portal sound
    this.playPortalSound();
    
    // Create teleport effect
    this.createTeleportEffect();
    
    // Show message
    this.showPortalMessage();
    
    // After a delay, open VibeJam in a new tab
    setTimeout(() => {
      window.open('https://vibejam.io', '_blank');
      
      // Reactivate portal after a cooldown
      setTimeout(() => {
        this.isActive = true;
      }, 5000);
    }, 2000);
  }
  
  /**
   * Play portal activation sound
   */
  playPortalSound() {
    // Check if audio listener exists
    if (!this.scene.listener) {
      console.warn("Audio listener not found, can't play portal sound");
      return;
    }
    
    // Create audio source
    const portalSound = new THREE.Audio(this.scene.listener);
    
    // Try to create a synth sound since we don't have an actual file
    try {
      // Create audio context
      let audioContext = THREE.AudioContext.getContext();
      
      // Create buffer for synth sound
      const duration = 2;
      const sampleRate = audioContext.sampleRate;
      const buffer = audioContext.createBuffer(1, duration * sampleRate, sampleRate);
      const data = buffer.getChannelData(0);
      
      // Generate portal whoosh sound
      for (let i = 0; i < buffer.length; i++) {
        const t = i / sampleRate;
        const phase = 20 * t;
        const fadeIn = Math.min(t * 10, 1);
        const fadeOut = Math.min((duration - t) * 2, 1);
        const fade = fadeIn * fadeOut;
        
        // Generate a rising tone with some modulation
        const freq = 300 + 1000 * t;
        const modulation = Math.sin(phase * 10) * 0.2;
        
        data[i] = Math.sin(phase * Math.pow(t+0.5, 2) * 2) * fade * 0.5;
        data[i] += Math.sin(phase * freq * 0.01) * fade * 0.5;
        data[i] += modulation * fade;
      }
      
      portalSound.setBuffer(buffer);
      portalSound.setVolume(0.8);
      portalSound.play();
      
    } catch (e) {
      console.error("Error creating portal sound:", e);
    }
  }
  
  /**
   * Create visual effect for teleportation
   */
  createTeleportEffect() {
    // Create expanding ring effect
    const ringCount = 5;
    const rings = [];
    
    for (let i = 0; i < ringCount; i++) {
      const ringGeometry = new THREE.TorusGeometry(0.1, 0.1, 8, 24);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 1
      });
      
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(this.portalMesh.position);
      ring.scale.set(1, 1, 1);
      
      // Add to scene
      this.scene.scene.add(ring);
      rings.push({
        mesh: ring,
        delay: i * 200, // Stagger the start of each ring
        startTime: performance.now() + i * 200
      });
    }
    
    // Animate the rings
    const animateRings = () => {
      const currentTime = performance.now();
      let allComplete = true;
      
      rings.forEach(ring => {
        if (currentTime < ring.startTime) {
          allComplete = false;
          return;
        }
        
        const elapsed = currentTime - ring.startTime;
        const duration = 1000; // 1 second animation
        
        if (elapsed < duration) {
          allComplete = false;
          const progress = elapsed / duration;
          
          // Expand the ring
          const scale = 1 + progress * 10;
          ring.mesh.scale.set(scale, scale, scale);
          
          // Fade out
          ring.mesh.material.opacity = 1 - progress;
        } else if (ring.mesh.parent) {
          // Remove the ring when animation is complete
          this.scene.scene.remove(ring.mesh);
          ring.mesh.geometry.dispose();
          ring.mesh.material.dispose();
        }
      });
      
      if (!allComplete) {
        requestAnimationFrame(animateRings);
      }
    };
    
    // Start animation
    animateRings();
  }
  
  /**
   * Show portal activation message
   */
  showPortalMessage() {
    // Create message element
    let messageElement = document.getElementById('portal-activation-message');
    
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'portal-activation-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '50%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = '#00ddff';
      messageElement.style.fontFamily = 'monospace';
      messageElement.style.fontSize = '32px';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.7)';
      messageElement.style.padding = '20px 30px';
      messageElement.style.borderRadius = '10px';
      messageElement.style.zIndex = '3000';
      messageElement.style.opacity = '0';
      messageElement.style.transition = 'opacity 0.5s ease';
      messageElement.style.textShadow = '0 0 10px #00ddff';
      document.body.appendChild(messageElement);
    }
    
    // Set message text
    messageElement.innerHTML = '🌀 PORTAL ACTIVATED! 🌀<br>Teleporting to VibeJam...';
    
    // Show message with fade in/out animation
    messageElement.style.opacity = '1';
    
    // Hide message after delay
    setTimeout(() => {
      messageElement.style.opacity = '0';
      
      // Remove from DOM after fade out
      setTimeout(() => {
        if (messageElement.parentNode) {
          messageElement.parentNode.removeChild(messageElement);
        }
      }, 500);
    }, 3000);
  }
  
  /**
   * Clean up resources when no longer needed
   */
  cleanup() {
    // Remove meshes
    if (this.portalMesh && this.portalMesh.parent) {
      this.portalMesh.parent.remove(this.portalMesh);
      this.portalMesh.geometry.dispose();
      this.portalMesh.material.dispose();
    }
    
    if (this.innerPortalMesh && this.innerPortalMesh.parent) {
      this.innerPortalMesh.parent.remove(this.innerPortalMesh);
      this.innerPortalMesh.geometry.dispose();
      this.innerPortalMesh.material.dispose();
    }
    
    // Remove light
    if (this.portalLight && this.portalLight.parent) {
      this.portalLight.parent.remove(this.portalLight);
    }
    
    // Remove trigger
    if (this.triggerObject && this.triggerObject.parent) {
      this.triggerObject.parent.remove(this.triggerObject);
    }
    
    // Remove particles
    this.particles.forEach(particle => {
      if (particle && particle.parent) {
        particle.parent.remove(particle);
        particle.geometry.dispose();
        particle.material.dispose();
      }
    });
    
    // Remove UI elements
    if (this.labelElement && this.labelElement.parentNode) {
      this.labelElement.parentNode.removeChild(this.labelElement);
    }
    
    const portalMessage = document.getElementById('portal-activation-message');
    if (portalMessage && portalMessage.parentNode) {
      portalMessage.parentNode.removeChild(portalMessage);
    }
    
    // Stop animation
    this.isActive = false;
  }
}

// Export the Portal class
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Portal;
} else {
  // Browser environment
  window.Portal = Portal;
} 