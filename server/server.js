const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;

// Create HTTP server
const server = http.createServer((req, res) => {
    // Serve static files
    if (req.url === '/') {
        const filePath = path.join(__dirname, '../index.html');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content, 'utf-8');
            }
        });
    } else if (req.url === '/main.js') {
        const filePath = path.join(__dirname, '../main.js');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end();
            } else {
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(content, 'utf-8');
            }
        });
    } else if (req.url === '/WindowManager.js') {
        const filePath = path.join(__dirname, '../WindowManager.js');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end();
            } else {
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(content, 'utf-8');
            }
        });
    } else if (req.url === '/src/networking.js') {
        const filePath = path.join(__dirname, '../src/networking.js');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end();
            } else {
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(content, 'utf-8');
            }
        });
    } else if (req.url === '/three.r124.min.js') {
        const filePath = path.join(__dirname, '../three.r124.min.js');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end();
            } else {
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(content, 'utf-8');
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients and game state
const clients = new Map();
const gameState = {
    windows: {},
    orbiters: {},
    lastUpdate: Date.now()
};

// Message types
const MSG_TYPES = {
    WINDOW_JOIN: 0x01,
    WINDOW_LEAVE: 0x02,
    WINDOW_STATE: 0x03,
    ORBITER_SNAPSHOT: 0x04,
    ORBITER_DELTA: 0x05,
    PING: 0x06,
    PONG: 0x07
};

// Handle new WebSocket connections
wss.on('connection', (ws) => {
    const clientId = uuidv4();
    console.log(`Client connected: ${clientId}`);
    
    // Add client to the map
    clients.set(clientId, { 
        ws, 
        windowId: null,
        lastPing: Date.now(),
        latency: 0
    });
    
    // Send initial game state
    ws.send(JSON.stringify({
        type: 'INIT',
        clientId,
        gameState,
        timestamp: Date.now()
    }));
    
    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'WINDOW_UPDATE':
                    handleWindowUpdate(clientId, data);
                    break;
                case 'ORBITER_UPDATE':
                    handleOrbiterUpdate(clientId, data);
                    break;
                case 'ORBITER_DELTA':
                    handleOrbiterDelta(clientId, data);
                    break;
                case 'PING':
                    handlePing(clientId, data);
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        const clientData = clients.get(clientId);
        if (clientData && clientData.windowId) {
            // Remove window from game state
            delete gameState.windows[clientData.windowId];
            // Broadcast window removal to all clients
            broadcast({
                type: 'WINDOW_REMOVED',
                windowId: clientData.windowId,
                timestamp: Date.now()
            });
        }
        clients.delete(clientId);
    });
});

function handleWindowUpdate(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;
    
    // Update window data
    const windowId = data.windowId || client.windowId || uuidv4();
    client.windowId = windowId;
    
    gameState.windows[windowId] = {
        position: data.position,
        size: data.size,
        timestamp: Date.now()
    };
    
    // Broadcast update to all clients
    broadcast({
        type: 'WINDOW_UPDATED',
        windowId,
        position: data.position,
        size: data.size,
        timestamp: Date.now()
    });
}

function handleOrbiterUpdate(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;
    
    // Update orbiter data
    if (data.orbiters) {
        data.orbiters.forEach(orbiterData => {
            if (!gameState.orbiters[orbiterData.id]) {
                gameState.orbiters[orbiterData.id] = {
                    position: { x: 0, y: 0, z: 0 },
                    velocity: { x: 0, y: 0, z: 0 },
                    timestamp: Date.now()
                };
            }
            
            const orbiter = gameState.orbiters[orbiterData.id];
            if (orbiterData.position) {
                orbiter.position = orbiterData.position;
            }
            if (orbiterData.velocity) {
                orbiter.velocity = orbiterData.velocity;
            }
            orbiter.timestamp = Date.now();
        });
        
        // Broadcast updates to all clients
        broadcast({
            type: 'ORBITERS_UPDATED',
            orbiters: data.orbiters,
            timestamp: Date.now()
        });
    }
}

function handleOrbiterDelta(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;
    
    // Handle delta updates for efficiency
    if (data.deltas) {
        const updates = [];
        
        data.deltas.forEach(delta => {
            if (!gameState.orbiters[delta.id]) {
                gameState.orbiters[delta.id] = {
                    position: { x: 0, y: 0, z: 0 },
                    velocity: { x: 0, y: 0, z: 0 },
                    timestamp: Date.now()
                };
            }
            
            const orbiter = gameState.orbiters[delta.id];
            
            // Apply delta to position
            orbiter.position.x += delta.dx || 0;
            orbiter.position.y += delta.dy || 0;
            orbiter.position.z += delta.dz || 0;
            
            if (delta.dvx !== undefined) orbiter.velocity.x += delta.dvx;
            if (delta.dvy !== undefined) orbiter.velocity.y += delta.dvy;
            if (delta.dvz !== undefined) orbiter.velocity.z += delta.dvz;
            
            orbiter.timestamp = Date.now();
            
            updates.push({
                id: delta.id,
                position: { ...orbiter.position },
                velocity: { ...orbiter.velocity }
            });
        });
        
        // Broadcast updates to all clients
        broadcast({
            type: 'ORBITERS_UPDATED',
            orbiters: updates,
            timestamp: Date.now()
        });
    }
}

function handlePing(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;
    
    client.lastPing = Date.now();
    client.latency = Date.now() - data.timestamp;
    
    // Send pong response echoing client's timestamp and including server time
    if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
            type: 'PONG',
            timestamp: data.timestamp, // Echo client's original timestamp
            serverTime: Date.now() // Include server time
        }));
    }
}

function broadcast(message) {
    const messageString = JSON.stringify(message);
    for (const client of clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(messageString);
        }
    }
}

// Clean up old state periodically
setInterval(() => {
    const now = Date.now();
    // Remove orbiters that haven't been updated in 10 seconds
    Object.keys(gameState.orbiters).forEach(id => {
        if (now - gameState.orbiters[id].timestamp > 10000) {
            delete gameState.orbiters[id];
        }
    });
    
    // Remove inactive clients
    for (const [clientId, client] of clients.entries()) {
        if (now - client.lastPing > 30000) {
            console.log(`Removing inactive client: ${clientId}`);
            client.ws.terminate();
            clients.delete(clientId);
        }
    }
}, 30000);

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log(`WebSocket server ready for connections`);
});
