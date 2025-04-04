/**
 * Stars system that creates animated stars flying above the track
 */
class StarSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = Object.assign({
      count: 100,           // Number of stars
      height: 50,           // Height above track
      speed: 0.5,           // Movement speed
      size: 0.5,            // Star size
      color: 0xFFFFFF,      // Star color
      twinkle: true,        // Whether stars should twinkle
      twinkleSpeed: 0.03,   // How fast stars twinkle
      bounds: {             // Area bounds for stars
        minX: -200,
        maxX: 200,
        minZ: -200,
        maxZ: 200
      }
    }, options);
    
    this.stars = [];
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
      
      // Random position within bounds
      star.position.set(
        this.randomInRange(this.options.bounds.minX, this.options.bounds.maxX),
        this.options.height + this.randomInRange(-10, 10),
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
        baseOpacity: 0.5 + Math.random() * 0.5
      };
      
      this.scene.scene.add(star);
      this.stars.push(star);
    }
  }
  
  update(deltaTime) {
    // Ensure deltaTime is valid
    const dt = deltaTime || 1/60;
    
    this.stars.forEach(star => {
      // Move star
      const movement = star.userData.direction.clone()
        .multiplyScalar(star.userData.speed * dt);
      star.position.add(movement);
      
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
    });
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