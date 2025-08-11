/**
 * Stars system that creates animated stars floating above the track
 */
class StarSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = Object.assign({
      count: 100,           // Number of stars
      height: 10,           // Height above track surface
      speed: 0.2,           // Movement speed (reduced from 0.5)
      size: 1.0,            // Star size (increased from 0.5)
      color: 0xFFFFFF,      // Star color
      twinkle: true,        // Whether stars should twinkle
      twinkleSpeed: 0.02,   // How fast stars twinkle (reduced slightly)
      fallSpeed: 0.3,       // How fast stars fall from sky (reduced from 0.5)
      bounds: {             // Area bounds for stars
        minX: -200,
        maxX: 200,
        minZ: -200,
        maxZ: 200
      }
    }, options);
    
    this.stars = [];
    this.raycaster = new THREE.Raycaster();
    this.downVector = new THREE.Vector3(0, -1, 0);
    this.init();
  }
  
  init() {
    // Create star geometry and material
    const geometry = new THREE.SphereGeometry(this.options.size, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: this.options.color,
      transparent: true,
      opacity: 0.8
    });
    
    // Create star instances
    for (let i = 0; i < this.options.count; i++) {
      const star = new THREE.Mesh(geometry, material.clone());
      
      // Start stars high in the sky
      star.position.set(
        this.randomInRange(this.options.bounds.minX, this.options.bounds.maxX),
        this.randomInRange(100, 200), // Start high up
        this.randomInRange(this.options.bounds.minZ, this.options.bounds.maxZ)
      );
      
      // Add custom properties for animation
      star.userData = {
        speed: this.options.speed * (0.5 + Math.random()),
        direction: new THREE.Vector3(
          this.randomInRange(-0.2, 0.2),
          0,
          this.randomInRange(-0.2, 0.2)
        ).normalize(),
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: this.options.twinkleSpeed * (0.5 + Math.random()),
        baseOpacity: 0.5 + Math.random() * 0.5,
        falling: true,  // Start in falling state
        fallSpeed: this.options.fallSpeed * (0.8 + Math.random() * 0.4),
        targetHeight: this.options.height * (0.8 + Math.random() * 0.4)
      };
      
      this.scene.scene.add(star);
      this.stars.push(star);
    }
  }
  
  update(deltaTime) {
    // Ensure deltaTime is valid
    const dt = deltaTime || 1/60;
    
    this.stars.forEach(star => {
      if (star.userData.falling) {
        // Star is falling from sky
        star.position.y -= star.userData.fallSpeed * dt * 10;
        
        // Cast ray to find ground
        this.raycaster.set(star.position, this.downVector);
        const intersects = this.raycaster.intersectObjects(this.scene.scene.children, true);
        
        // Check if we hit something and it's close enough
        if (intersects.length > 0 && intersects[0].distance < 20) {
          // Position star above the ground
          star.position.y = intersects[0].point.y + star.userData.targetHeight;
          star.userData.falling = false;
        }
        
        // If star fell below bounds, reset it
        if (star.position.y < -50) {
          this.resetStar(star);
        }
      } else {
        // Star is floating above track
        
        // Move star horizontally
        const movement = star.userData.direction.clone()
          .multiplyScalar(star.userData.speed * dt);
        star.position.add(movement);
        
        // Cast ray to find ground
        this.raycaster.set(
          new THREE.Vector3(star.position.x, star.position.y + 10, star.position.z), 
          this.downVector
        );
        const intersects = this.raycaster.intersectObjects(this.scene.scene.children, true);
        
        // Adjust height based on ground
        if (intersects.length > 0) {
          const targetY = intersects[0].point.y + star.userData.targetHeight;
          // Smoothly adjust height
          star.position.y += (targetY - star.position.y) * 0.1;
        } else {
          // If no ground found, start falling again
          star.userData.falling = true;
        }
        
        // Twinkle effect
        if (this.options.twinkle) {
          star.userData.twinklePhase += star.userData.twinkleSpeed;
          const opacity = star.userData.baseOpacity * 
            (0.5 + 0.5 * Math.sin(star.userData.twinklePhase));
          star.material.opacity = opacity;
        }
        
        // Wrap around if out of bounds
        if (star.position.x < this.options.bounds.minX) {
          star.position.x = this.options.bounds.maxX;
        } else if (star.position.x > this.options.bounds.maxX) {
          star.position.x = this.options.bounds.minX;
        }
        
        if (star.position.z < this.options.bounds.minZ) {
          star.position.z = this.options.bounds.maxZ;
        } else if (star.position.z > this.options.bounds.maxZ) {
          star.position.z = this.options.bounds.minZ;
        }
      }
    });
    
    // Occasionally spawn new falling stars
    if (Math.random() < 0.02) {
      const randomStar = this.stars[Math.floor(Math.random() * this.stars.length)];
      this.resetStar(randomStar);
    }
  }
  
  // Reset a star to fall from the sky again
  resetStar(star) {
    star.position.set(
      this.randomInRange(this.options.bounds.minX, this.options.bounds.maxX),
      this.randomInRange(100, 200), // Start high up
      this.randomInRange(this.options.bounds.minZ, this.options.bounds.maxZ)
    );
    star.userData.falling = true;
    star.userData.direction = new THREE.Vector3(
      this.randomInRange(-0.2, 0.2),
      0,
      this.randomInRange(-0.2, 0.2)
    ).normalize();
  }
  
  // Helper method for random range
  randomInRange(min, max) {
    return min + Math.random() * (max - min);
  }
  
  // Clean up resources
  cleanup() {
    this.stars.forEach(star => {
      this.scene.scene.remove(star);
      star.geometry.dispose();
      star.material.dispose();
    });
    this.stars = [];
  }
} 