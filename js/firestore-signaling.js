// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyADQsR9T1t31XEg7gvyBj-k-WViVsqhfKs",
    authDomain: "boxracing-17cbf.firebaseapp.com",
    projectId: "boxracing-17cbf",
    storageBucket: "boxracing-17cbf.appspot.com",
    messagingSenderId: "914670482439",
    appId: "1:914670482439:web:ca3871c498844a594aa6a2"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get Firestore instance
const db = firebase.firestore();

/*
Firestore Data Structure:

servers (collection)
└── {game_xxx} (document) - Host information
    ├── id: string
    ├── updated_at: timestamp
    ├── can_join: boolean
    └── signaling_messages (collection) - Messages for this server/host
        └── {auto_id} (document) - WebRTC signaling messages
            ├── type: "offer" | "answer" | "ice-candidate"
            ├── from: string (peer_id)
            ├── to: string (peer_id)
            ├── timestamp: timestamp
            └── [offer/answer/candidate]: object
*/

/*
Connection Flow:
1. Host Discovery:
   - New client checks 'servers' collection for active hosts
   - If no host found, becomes a host
   - If host found, becomes a client

2. Host Setup:
   - Generates game_xxx ID
   - Creates document in servers/{hostId}
   - Starts periodic updates to keep host active

3. Client Setup:
   - Generates client_xxx ID
   - Initiates WebRTC connection to host

4. WebRTC Signaling (through Firestore):
   - Client -> Host: Sends offer via servers/{hostId}/signaling_messages
   - Host -> Client: Sends answer via servers/{hostId}/signaling_messages
   - Both: Exchange ICE candidates via their respective signaling paths

5. After Connection:
   - All further communication happens through WebRTC data channels
   - Host relays position updates between all connected clients
   - Firestore is only used for discovery and initial WebRTC setup
*/

// Firestore signaling and server management
class SignalingManager {
    constructor(onPeerConnect, onPeerDisconnect, onStatusUpdate, onLogEvent) {
        this.db = db;  // Use the internal db instance
        this.onPeerConnect = onPeerConnect;
        this.onPeerDisconnect = onPeerDisconnect;
        this.onStatusUpdate = onStatusUpdate;
        this.onLogEvent = onLogEvent;
        
        this.myPeerId = this.generateId('game_');
        this.isHost = false;
        this.hostId = null;
        this.hostListener = null;
        this.reconnecting = false;
    }

    // Generate game ID avoiding O, I, L, 0, 1 
    generateId(prefix) {
        const validNums = '23456789';
        const validChars = 'abcdefghjkmnpqrstuvwxyz';
        return prefix + 
            validChars[Math.floor(Math.random() * validChars.length)] +
            validChars[Math.floor(Math.random() * validChars.length)] +
            validNums[Math.floor(Math.random() * validNums.length)] +
            validNums[Math.floor(Math.random() * validNums.length)] +
            validNums[Math.floor(Math.random() * validNums.length)];
    }

    async findOrBecomeServer() {
        if (this.reconnecting) return;
        this.reconnecting = true;
        this.onStatusUpdate('Searching for available servers...', 'connecting');

        try {
            const serversQuery = await this.db.collection('servers')
                .orderBy('updated_at', 'desc')
                .limit(1)
                .get();
            
            const serverData = serversQuery.docs[0]?.data();
            const lastUpdate = serverData?.updated_at?.toDate() || new Date(0);
            const MAX_SERVER_AGE_SEC = 60;
            const isServerActive = (new Date() - lastUpdate) < MAX_SERVER_AGE_SEC * 1000;
            
            if (!serversQuery.empty && isServerActive) {
                const serverDoc = serversQuery.docs[0];
                this.onLogEvent('Found active server ' + serverDoc.id + ', joining as client');
                this.onStatusUpdate('Connecting to server...', 'connecting');
                await this.joinServer(serverDoc.id, serverDoc.data());
            } else {
                this.onStatusUpdate('No active servers found, becoming a server...', 'connecting');
                await this.becomeServer();
            }
        } catch (error) {
            console.error('Error checking servers:', error);
            this.onStatusUpdate('Connection error, becoming server...', 'connecting');
            await this.becomeServer();
        } finally {
            this.reconnecting = false;
        }
    }

    async becomeServer() {
        this.onStatusUpdate('Setting up server...', 'connecting');
        
        // Change ID to game_ format when becoming server
        this.myPeerId = this.generateId('game_');
        
        // Create host document in servers collection
        const hostRef = this.db.collection('servers').doc(this.myPeerId);
        await hostRef.set({
            id: this.myPeerId,
            updated_at: firebase.firestore.FieldValue.serverTimestamp(),
            can_join: true
        });

        const SERVER_FIRESTORE_UPDATE_INTERVAL_SEC = 30;
        // Set up periodic server updates
        setInterval(async () => {
            if (this.isHost) {
                await hostRef.update({
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }, SERVER_FIRESTORE_UPDATE_INTERVAL_SEC * 1000);

        this.isHost = true;
        this.onLogEvent('Became server ' + this.myPeerId);
        
        this.setupFirestoreListeners();
    }

    getServerId() {
        if (this.isHost) {
            return this.myPeerId;
        } else {
            return this.hostId;
        }
    }

    async joinServer(serverHostId, hostData) {
        // Change ID to client_ format when joining
        this.myPeerId = this.generateId('client_');
        this.hostId = serverHostId;
        
        // Monitor host document for deletion/updates
        if (this.hostListener) this.hostListener();
        this.hostListener = this.db.collection('servers').doc(this.hostId)
            .onSnapshot((doc) => {
                if (!doc.exists && !this.isHost) {
                    this.onLogEvent('Host disconnected (document deleted)');
                    this.handleDisconnect();
                }
            }, (error) => {
                console.error('Error monitoring host:', error);
                if (!this.isHost) this.handleDisconnect();
            });
        
        this.onPeerConnect(hostData.id);
        this.onStatusUpdate('Connected as client to ' + hostData.id, 'connected');
        
        this.setupFirestoreListeners();
    }

    setupFirestoreListeners() {
        // Listen for WebRTC signaling in the server's signaling_messages collection
        this.db.collection(`servers/${this.isHost ? this.myPeerId : this.hostId}/signaling_messages`)
            .where('to', '==', this.myPeerId)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        const signalData = change.doc.data();
                        await this.handleSignaling(signalData);
                        // Delete the signaling document after processing
                        await change.doc.ref.delete();
                    }
                });
            });

        // Clean up when window closes
        window.addEventListener('beforeunload', async () => {
            if (this.isHost) {
                await this.db.collection('servers').doc(this.myPeerId).delete();
            }
        });
    }

    async handleDisconnect() {
        // Remove old listeners
        if (this.hostListener) {
            this.hostListener();
            this.hostListener = null;
        }

        // Reset state
        this.isHost = false;
        this.hostId = null;
        this.onStatusUpdate('Disconnected from server', 'disconnected');
        this.onPeerDisconnect();

        // Wait a moment to show the disconnected state
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Try to find a new server or become one
        await this.findOrBecomeServer();
    }

    async sendSignaling(targetPeerId, data) {
        // Serialize the data before sending to Firestore
        const serializedData = {
            ...data,
            from: this.myPeerId,
            to: targetPeerId,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Serialize RTCSessionDescription (offer/answer)
        if (data.offer) {
            serializedData.offer = {
                type: data.offer.type,
                sdp: data.offer.sdp
            };
        }
        if (data.answer) {
            serializedData.answer = {
                type: data.answer.type,
                sdp: data.answer.sdp
            };
        }
        // Serialize RTCIceCandidate
        if (data.candidate) {
            serializedData.candidate = {
                candidate: data.candidate.candidate,
                sdpMLineIndex: data.candidate.sdpMLineIndex,
                sdpMid: data.candidate.sdpMid,
                usernameFragment: data.candidate.usernameFragment
            };
        }

        // Send to the server's signaling_messages collection
        await this.db.collection(`servers/${this.isHost ? this.myPeerId : this.hostId}/signaling_messages`).add(serializedData);
    }

    async handleSignaling(signalData) {
        if (signalData.type === 'offer') {
            this.onPeerConnect(signalData.from, {
                type: 'offer',
                offer: new RTCSessionDescription({
                    type: signalData.offer.type,
                    sdp: signalData.offer.sdp
                })
            });
        } else if (signalData.type === 'answer') {
            this.onPeerConnect(signalData.from, {
                type: 'answer',
                answer: new RTCSessionDescription({
                    type: signalData.answer.type,
                    sdp: signalData.answer.sdp
                })
            });
        } else if (signalData.type === 'ice-candidate') {
            this.onPeerConnect(signalData.from, {
                type: 'ice-candidate',
                candidate: new RTCIceCandidate({
                    candidate: signalData.candidate.candidate,
                    sdpMLineIndex: signalData.candidate.sdpMLineIndex,
                    sdpMid: signalData.candidate.sdpMid,
                    usernameFragment: signalData.candidate.usernameFragment
                })
            });
        }
    }

    get peerId() {
        return this.myPeerId;
    }

    get isHosting() {
        return this.isHost;
    }
} 