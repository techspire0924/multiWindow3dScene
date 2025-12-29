class NetworkManager {
    constructor(options = {}) {
        this.socket = null;
        this.clientId = null;
        this.windowId = null;
        this.serverTimeOffset = 0;
        this.pingInterval = null;
        this.messageHandlers = new Map();
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.lastPingTime = 0;
        this.latency = 0;
        
        // Client-side prediction
        this.predictedState = new Map();
        this.authoritativeState = new Map();
        this.interpolationBuffer = new Map();
        this.reconciliationQueue = [];
        
        // Performance optimization
        this.lastNetworkUpdate = 0;
        this.networkUpdateInterval = options.updateInterval || 50; // 50ms = 20Hz updates (in ms)
        this.pendingDeltas = [];
        this.deltaThreshold = options.deltaThreshold || 0.01; // Minimum movement to send delta (in world units)
    }

    connect(serverUrl = `ws://${window.location.hostname}:8080`) {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket(serverUrl);
            
            this.socket.onopen = () => {
                console.log('Connected to server');
                this.connected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                
                // Start ping/pong for latency measurement
                this.pingInterval = setInterval(() => this.sendPing(), 5000);
                
                resolve();
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            this.socket.onclose = () => {
                console.log('Disconnected from server');
                this.connected = false;
                clearInterval(this.pingInterval);
                this.attemptReconnect();
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.socket.close();
                reject(error);
            };
        });
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            if (!this.connected) {
                this.connect().catch(console.error);
            }
        }, delay);
    }
    
    sendPing() {
        if (this.connected) {
            this.lastPingTime = Date.now();
            this.send({
                type: 'PING',
                timestamp: this.lastPingTime
            });
        }
    }
    
    send(message) {
        if (this.connected && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        } else {
            console.warn('Cannot send message, not connected');
        }
    }
    
    handleMessage(message) {
        // Update server time offset for client-side prediction
        if (message.type === 'PONG') {
            const roundTripTime = Date.now() - message.timestamp;
            this.latency = roundTripTime / 2;
            this.serverTimeOffset = (message.serverTime + this.latency) - Date.now();
            return;
        }
        
        // Handle initialization
        if (message.type === 'INIT') {
            this.clientId = message.clientId;
            console.log('Initialized with client ID:', this.clientId);
            return;
        }
        
        // Handle other message types
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
            handler(message);
        }
    }
    
    on(messageType, handler) {
        this.messageHandlers.set(messageType, handler);
    }
    
    off(messageType) {
        this.messageHandlers.delete(messageType);
    }
    
    updateWindow(windowData) {
        if (!this.connected) return;
        
        this.send({
            type: 'WINDOW_UPDATE',
            windowId: this.windowId,
            ...windowData
        });
    }
    
    updateOrbiters(orbiters) {
        if (!this.connected) return;
        
        const now = Date.now();
        if (now - this.lastNetworkUpdate < this.networkUpdateInterval) {
            return; // Throttle updates
        }
        
        this.lastNetworkUpdate = now;
        
        // Collect deltas for efficient transmission
        const deltas = [];
        const fullUpdates = [];
        
        orbiters.forEach(orbiter => {
            const lastKnown = this.predictedState.get(orbiter.id);
            const currentPos = orbiter.mesh.position;
            
            if (!lastKnown) {
                // First time seeing this orbiter, send full update
                fullUpdates.push({
                    id: orbiter.id,
                    position: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
                    velocity: orbiter.velocity || { x: 0, y: 0, z: 0 }
                });
                this.predictedState.set(orbiter.id, {
                    position: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
                    velocity: { ...orbiter.velocity }
                });
            } else {
                // Calculate delta
                const dx = currentPos.x - lastKnown.position.x;
                const dy = currentPos.y - lastKnown.position.y;
                const dz = currentPos.z - lastKnown.position.z;
                
                if (Math.abs(dx) > this.deltaThreshold || 
                    Math.abs(dy) > this.deltaThreshold || 
                    Math.abs(dz) > this.deltaThreshold) {
                    
                    deltas.push({
                        id: orbiter.id,
                        dx: dx,
                        dy: dy,
                        dz: dz,
                        dvx: (orbiter.velocity?.x || 0) - lastKnown.velocity.x,
                        dvy: (orbiter.velocity?.y || 0) - lastKnown.velocity.y,
                        dvz: (orbiter.velocity?.z || 0) - lastKnown.velocity.z
                    });
                    
                    // Update predicted state
                    this.predictedState.set(orbiter.id, {
                        position: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
                        velocity: { ...orbiter.velocity }
                    });
                }
            }
        });
        
        // Send deltas if we have any
        if (deltas.length > 0) {
            this.send({
                type: 'ORBITER_DELTA',
                deltas: deltas,
                timestamp: this.getServerTime()
            });
        }
        
        // Send full updates for new orbiters
        if (fullUpdates.length > 0) {
            this.send({
                type: 'ORBITER_UPDATE',
                orbiters: fullUpdates,
                timestamp: this.getServerTime()
            });
        }
    }
    
    // Client-side prediction
    predictOrbiterPosition(orbiter, deltaTime) {
        const predicted = this.predictedState.get(orbiter.id);
        if (!predicted) return null;
        
        // Simple physics prediction
        const predictedPos = {
            x: predicted.position.x + predicted.velocity.x * deltaTime,
            y: predicted.position.y + predicted.velocity.y * deltaTime,
            z: predicted.position.z + predicted.velocity.z * deltaTime
        };
        
        return predictedPos;
    }
    
    // State reconciliation
    reconcileWithServer(serverState) {
        serverState.orbiters.forEach(orbiterData => {
            const predicted = this.predictedState.get(orbiterData.id);
            if (predicted) {
                // Calculate error between predicted and authoritative
                const error = {
                    x: orbiterData.position.x - predicted.position.x,
                    y: orbiterData.position.y - predicted.position.y,
                    z: orbiterData.position.z - predicted.position.z
                };
                
                const errorMagnitude = Math.sqrt(error.x * error.x + error.y * error.y + error.z * error.z);
                
                // If error is significant, add to reconciliation queue
                if (errorMagnitude > 0.1) {
                    this.reconciliationQueue.push({
                        id: orbiterData.id,
                        authoritativePosition: orbiterData.position,
                        authoritativeVelocity: orbiterData.velocity,
                        error: error,
                        timestamp: Date.now()
                    });
                }
                
                // Update authoritative state
                this.authoritativeState.set(orbiterData.id, {
                    position: orbiterData.position,
                    velocity: orbiterData.velocity
                });
            }
        });
    }
    
    // Smooth interpolation for rendering
    interpolateOrbiterPosition(orbiter, renderTime) {
        const buffer = this.interpolationBuffer.get(orbiter.id);
        if (!buffer || buffer.length < 2) return null;
        
        // Find the two states to interpolate between
        let fromState = null;
        let toState = null;
        
        for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i].timestamp <= renderTime && buffer[i + 1].timestamp > renderTime) {
                fromState = buffer[i];
                toState = buffer[i + 1];
                break;
            }
        }
        
        if (!fromState || !toState) return null;
        
        // Calculate interpolation factor
        const totalDuration = toState.timestamp - fromState.timestamp;
        const elapsed = renderTime - fromState.timestamp;
        const factor = elapsed / totalDuration;
        
        // Interpolate position
        return {
            x: fromState.position.x + (toState.position.x - fromState.position.x) * factor,
            y: fromState.position.y + (toState.position.y - fromState.position.y) * factor,
            z: fromState.position.z + (toState.position.z - fromState.position.z) * factor
        };
    }
    
    getServerTime() {
        return Date.now() + this.serverTimeOffset;
    }
    
    disconnect() {
        if (this.socket) {
            clearInterval(this.pingInterval);
            this.socket.close();
            this.connected = false;
        }
    }
    
    // Performance metrics
    getMetrics() {
        return {
            connected: this.connected,
            latency: this.latency,
            reconnectAttempts: this.reconnectAttempts,
            predictedOrbiters: this.predictedState.size,
            reconciliationQueueSize: this.reconciliationQueue.length,
            serverTimeOffset: this.serverTimeOffset
        };
    }
}

export default new NetworkManager();
