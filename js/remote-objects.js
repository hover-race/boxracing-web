class RemoteObjectManager {
  constructor(scene) {
    this.scene = scene;
    this.remoteCars = new Map();
    this.carModel = null;
  }

  async preloadCarModel() {
    console.log("Preloading car model...");
    const gltf = await this.scene.load.gltf('assets/glb/red-mustang-bigwheel.glb');
    this.carModel = gltf.scenes[0];
    console.log("Car model preloaded successfully");
  }

  handleStateUpdate(states, myPeerId) {
    // Print state structure occasionally for debugging
    if (Math.random() < 0.01) {
      console.log('Received state update:', states);
    }
    
    // Process all peer states
    for (const [peerId, peerState] of states.entries()) {
      if (peerId === myPeerId) continue; // Skip our own state
      
      // Look for objects in the peer's state
      for (const [objectId, objectState] of Object.entries(peerState)) {
        // Skip metadata fields
        if (objectId === 'active' || objectId === 'lastUpdate') {
          continue;
        }
        
        // Create a compound key: peerId_objectId
        const compoundKey = `${peerId}_${objectId}`;
        
        // If this object has position data, it's likely a car
        if (objectState && objectState.position) {
          // Create a new RemoteCar if we don't have one for this object
          if (!this.remoteCars.has(compoundKey)) {
            console.log(`Creating a RemoteCar for peer ${peerId}, object ${objectId}`);
            if (!this.carModel) {
              console.error('No preloaded car model available');
              continue;
            }
            this.remoteCars.set(compoundKey, new RemoteCar(this.scene, this.carModel));
          }
          
          // Update the car with the latest state
          const remoteCar = this.remoteCars.get(compoundKey);
          remoteCar.deserialize(objectState);
        }
      }
    }
  }

  update() {
    // Update all remote objects
    if (this.remoteCars.size > 0) {
      // Update remote cars at low frequency to avoid console spam
      if (Math.random() < 0.001) {
        console.log(`Active remote cars: ${this.remoteCars.size}`);
        
        // Show a sample of active remote cars
        let count = 0;
        for (const [key, remoteCar] of this.remoteCars.entries()) {
          if (remoteCar.chassis && count < 3) {
            const [peerId, objectId] = key.split('_');
            console.log(`  Car ${count+1}: peer=${peerId}, object=${objectId}`);
            count++;
          }
        }
      }
    }
  }
}
