import { RemoteCar } from './vehicle.js';

class RemoteObjectManager {
  constructor(scene, carModels) {
    this.scene = scene;
    this.carModels = carModels;
    this.remoteCars = new Map();
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
          const car_id = this.carModels.has(objectState.car_id) ? objectState.car_id : 'mustang';
          const existingCar = this.remoteCars.get(compoundKey);
          if (existingCar && existingCar.car_id !== car_id) {
            existingCar.destroy();
            this.remoteCars.delete(compoundKey);
          }

          if (!this.remoteCars.has(compoundKey)) {
            console.log(`Creating a RemoteCar for peer ${peerId}, object ${objectId}`);
            const { definition, prefab } = this.carModels.get(car_id);
            this.remoteCars.set(
              compoundKey,
              new RemoteCar(this.scene, prefab.clone(true), definition)
            );
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

  clearAll() {
    // Remove all remote cars from the scene and clear the map
    for (const [key, remoteCar] of this.remoteCars.entries()) {
      remoteCar.destroy()
    }
    this.remoteCars.clear();
    console.log('Cleared all remote cars');
  }
}

export { RemoteObjectManager };
