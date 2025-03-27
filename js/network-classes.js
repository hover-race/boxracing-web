class NetworkSender {
    constructor(type, serializeFn) {
        this.type = type;
        this.serializeFn = serializeFn;
        this.lastUpdate = Date.now();
    }

    serialize() {
        this.lastUpdate = Date.now();
        return {
            type: this.type,
            ...this.serializeFn(),
            lastUpdate: this.lastUpdate
        };
    }
}

class RemoteObject {
    // Persistent view of the remote object.
    // Stores incoming state, eg position, rotation, etc
    // This is then sent to remote peers.
    // Also calculates inactive status
    static INACTIVE_THRESHOLD_SECONDS = 5.0;

    constructor(peerId, objectId, initialState) {
        this.peerId = peerId;
        this.objectId = objectId;
        this.state = {};
        this.lastUpdate = Date.now();
        this.updateState(initialState);
    }

    updateState(state) {
        if (!state) return;
        
        this.state = { ...state };
        if (state.lastUpdate) {
            this.lastUpdate = state.lastUpdate;
        }
    }

    isActive() {
        return (Date.now() - this.lastUpdate) / 1000 < RemoteObject.INACTIVE_THRESHOLD_SECONDS;
    }

    getState() {
        return {
            ...this.state,
            lastUpdate: this.lastUpdate,
            active: this.isActive()
        };
    }
}

class NetworkManager {
    static UPDATE_RATE_HZ = 20;
    static UPDATE_INTERVAL_SECONDS = 1 / NetworkManager.UPDATE_RATE_HZ;
    static INACTIVE_CHECK_INTERVAL_SECONDS = 1;

    constructor(onStatusUpdate, onLogEvent, onPeersChanged) {
        this.onStatusUpdate = onStatusUpdate;
        this.onLogEvent = onLogEvent;
        this.onPeersChanged = onPeersChanged;

        // Simple event listeners
        this.eventListeners = new Map();

        // Create signaling manager
        this.signalingManager = new SignalingManager(
            (peerId, signalData) => {
                if (signalData) {
                    this.handlePeerSignal(peerId, signalData);
                } else {
                    this.initiateConnection(peerId);
                }
            },
            () => {
                this.cleanup();
                this.onPeersChanged();
            },
            this.onStatusUpdate,
            this.onLogEvent
        );

        // WebRTC configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ]
        };

        // Connection management
        this.rtcPeerConnections = new Map();
        this.dataChannels = new Map();

        // Object management
        this.localSenders = new Map();
        this.remoteObjects = new Map();
        
        // Single counter for all object IDs
        this.nextObjectId = 0;

        // Set up update timer
        this.updateInterval = null;
        this.inactiveCheckInterval = null;
        this.startUpdateTimer();
        this.startInactiveCheckTimer();
    }

    startUpdateTimer() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        const intervalMs = NetworkManager.UPDATE_INTERVAL_SECONDS * 1000;

        this.updateInterval = setInterval(() => {
            if (this.signalingManager.isHosting) {
                this.broadcastStates();
            } else {
                this.sendStateToHost();
            }
        }, intervalMs);
    }

    stopUpdateTimer() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    startInactiveCheckTimer() {
        if (this.inactiveCheckInterval) {
            clearInterval(this.inactiveCheckInterval);
        }

        const intervalMs = NetworkManager.INACTIVE_CHECK_INTERVAL_SECONDS * 1000;

        this.inactiveCheckInterval = setInterval(() => {
            if (this.signalingManager.isHosting) {
                this.checkInactivePeers();
            }
        }, intervalMs);
    }

    stopInactiveCheckTimer() {
        if (this.inactiveCheckInterval) {
            clearInterval(this.inactiveCheckInterval);
            this.inactiveCheckInterval = null;
        }
    }

    checkInactivePeers() {
        if (!this.signalingManager.isHosting) return;

        let hasInactivePeers = false;
        this.remoteObjects.forEach((remoteObj, peerId) => {
            const wasActive = remoteObj.isActive();
            const isActive = remoteObj.isActive();
            
            if (wasActive && !isActive) {
                hasInactivePeers = true;
            }
        });

        if (hasInactivePeers) {
            this.broadcastStates();
        }
    }

    sendStateToHost() {
        const hostChannel = Array.from(this.dataChannels.values())[0];
        if (hostChannel?.readyState === 'open') {
            // Prepare local states from all senders
            const localStates = {};
            
            // If we have no senders, don't send anything
            if (this.localSenders.size === 0) return;
            
            // Get states from all local senders
            this.localSenders.forEach((sender, id) => {
                localStates[id] = sender.serialize();
            });
            
            // Send states
            hostChannel.send(JSON.stringify({
                type: 'state-update',
                states: {
                    [this.signalingManager.peerId]: localStates
                }
            }));
            
            // Emit state update event
            //this.emit('state-update', this.getStates());
        }
    }

    broadcastStates() {
        if (!this.signalingManager.isHosting) return;

        const states = {};
        
        // Add local sender states
        const localStates = {};
        this.localSenders.forEach((sender, id) => {
            localStates[id] = sender.serialize();
        });
        
        states[this.signalingManager.peerId] = localStates;

        // Add remote states
        this.remoteObjects.forEach((remoteObj, peerId) => {
            states[peerId] = remoteObj.getState();
        });

        this.dataChannels.forEach((channel) => {
            if (channel.readyState === 'open') {
                channel.send(JSON.stringify({
                    type: 'state-update',
                    states: states
                }));
            }
        });
        
        // Emit state update event
        this.emit('state-update', this.getStates());
    }

    async initiateConnection(peerId) {
        const peerConnection = new RTCPeerConnection(this.rtcConfig);
        this.rtcPeerConnections.set(peerId, peerConnection);

        peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === 'disconnected' || 
                peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'closed') {
                this.onLogEvent(`WebRTC connection ${peerConnection.connectionState} for peer ${peerId}`);
                this.handleDisconnect(peerId);
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            if (peerConnection.iceConnectionState === 'disconnected' ||
                peerConnection.iceConnectionState === 'failed' ||
                peerConnection.iceConnectionState === 'closed') {
                this.onLogEvent(`ICE connection ${peerConnection.iceConnectionState} for peer ${peerId}`);
                this.handleDisconnect(peerId);
            }
        };

        const dataChannel = peerConnection.createDataChannel('gameData');
        this.setupDataChannel(dataChannel, peerId);

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.signalingManager.sendSignaling(peerId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        this.signalingManager.sendSignaling(peerId, {
            type: 'offer',
            offer: offer
        });
    }

    async handlePeerSignal(peerId, signalData) {
        if (signalData.type === 'offer') {
            const peerConnection = new RTCPeerConnection(this.rtcConfig);
            this.rtcPeerConnections.set(peerId, peerConnection);

            peerConnection.onconnectionstatechange = () => {
                if (peerConnection.connectionState === 'connected') {
                    // Only update connection status for clients, not for the server
                    if (!this.signalingManager.isHosting) {
                        this.onStatusUpdate(`Connected to ${this.signalingManager.getServerId()}`, 'connected');
                    }
                } else if (peerConnection.connectionState === 'disconnected' || 
                    peerConnection.connectionState === 'failed' ||
                    peerConnection.connectionState === 'closed') {
                    this.onLogEvent(`WebRTC connection ${peerConnection.connectionState} for peer ${peerId}`);
                    this.handleDisconnect(peerId);
                }
            };

            peerConnection.oniceconnectionstatechange = () => {
                if (peerConnection.iceConnectionState === 'disconnected' ||
                    peerConnection.iceConnectionState === 'failed' ||
                    peerConnection.iceConnectionState === 'closed') {
                    this.onLogEvent(`ICE connection ${peerConnection.iceConnectionState} for peer ${peerId}`);
                    this.handleDisconnect(peerId);
                }
            };

            peerConnection.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, peerId);
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.signalingManager.sendSignaling(peerId, {
                        type: 'ice-candidate',
                        candidate: event.candidate
                    });
                }
            };

            await peerConnection.setRemoteDescription(signalData.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.signalingManager.sendSignaling(peerId, {
                type: 'answer',
                answer: answer
            });
        } else if (signalData.type === 'answer') {
            const peerConnection = this.rtcPeerConnections.get(peerId);
            if (peerConnection) {
                await peerConnection.setRemoteDescription(signalData.answer);
            }
        } else if (signalData.type === 'ice-candidate') {
            const peerConnection = this.rtcPeerConnections.get(peerId);
            if (peerConnection) {
                await peerConnection.addIceCandidate(signalData.candidate);
            }
        }
    }

    setupDataChannel(dataChannel, peerId) {
        this.dataChannels.set(peerId, dataChannel);

        dataChannel.onopen = () => {
            this.onLogEvent(`Data channel opened with peer ${peerId}`);
            // Only update connection status for clients, not for the server
            if (!this.signalingManager.isHosting) {
                this.onStatusUpdate(`Connected to ${this.signalingManager.getServerId()}`, 'connected');
            }
            this.onPeersChanged();
        };

        dataChannel.onclose = () => {
            this.onLogEvent(`Data channel closed with peer ${peerId}`);
            this.handleDisconnect(peerId);
        };

        dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'state-update') {
                    Object.entries(data.states).forEach(([id, state]) => {
                        if (id !== this.signalingManager.peerId) {
                            if (this.signalingManager.isHosting) {
                                if (this.dataChannels.has(id) && 
                                    this.dataChannels.get(id).readyState === 'open') {
                                    this.updateRemoteObject(id, state);
                                }
                            } else {
                                this.updateRemoteObject(id, state);
                            }
                        }
                    });
                    
                    // Emit a state-update event with the current states
                    this.emit('state-update', this.getStates());
                }
            } catch (error) {
                console.error("Error processing message:", error);
            }
        };
    }

    updateRemoteObject(peerId, state) {
        let remoteObj = this.remoteObjects.get(peerId);
        if (!remoteObj) {
            remoteObj = new RemoteObject(peerId, state);
            this.remoteObjects.set(peerId, remoteObj);
        } else {
            remoteObj.updateState(state);
        }
    }

    handleDisconnect(peerId) {
        this.remoteObjects.delete(peerId);
        this.dataChannels.delete(peerId);
        this.rtcPeerConnections.delete(peerId);
        
        if (this.signalingManager.isHosting) {
            this.broadcastStates();
        } else {
            // Emit state update directly if not hosting
            this.emit('state-update', this.getStates());
        }
        
        this.onPeersChanged();
    }

    getStates() {
        const states = new Map();
        
        // Add local states
        if (this.localSenders.size > 0) {
            const localStates = {};
            this.localSenders.forEach((sender, id) => {
                localStates[id] = sender.serialize();
            });
            
            states.set(this.signalingManager.peerId, {
                ...localStates,
                active: true
            });
        }
        
        // Add remote states
        this.remoteObjects.forEach((remoteObj, peerId) => {
            states.set(peerId, remoteObj.getState());
        });
        
        return states;
    }

    getConnectedPeers() {
        return Array.from(this.dataChannels.keys());
    }

    cleanup() {
        this.stopUpdateTimer();
        this.stopInactiveCheckTimer();
        this.dataChannels.forEach(channel => channel.close());
        this.rtcPeerConnections.forEach(conn => conn.close());
        this.dataChannels.clear();
        this.rtcPeerConnections.clear();
        this.remoteObjects.clear();
        this.eventListeners.clear();
        this.localSenders.clear();
        this.nextObjectId = 0;
    }

    addSender(sender) {
        // Generate a simple sequential object ID
        const objectId = this.nextObjectId++;
        
        // Add to the collection of senders
        this.localSenders.set(objectId, sender);
        
        // Return the generated object ID so the caller can reference it later
        return objectId;
    }

    // Subscribe to events
    on(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
    }
    
    emit(eventName, ...args) {
        if (!this.eventListeners.has(eventName)) return;
        
        const listeners = this.eventListeners.get(eventName);
        listeners.forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                console.error(`Error in ${eventName} event handler:`, error);
            }
        });
    }
} 