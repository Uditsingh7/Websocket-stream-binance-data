const WebSocket = require('ws');
// const express = require('express');

const BINANCE_WS_BASE = 'wss://fstream.binance.com/stream';
// const PORT = 3000;

// const app = express();
const wsConnections = {}; // Stores Binance WebSocket connections per pair
const frontendClients = {}; // Tracks frontend clients per pair

// Start a WebSocket server for frontend communication
const frontendWsServer = new WebSocket.Server({ port: 8080 });

// Handle frontend WebSocket connections
frontendWsServer.on('connection', (client) => { 
    console.log('Frontend client connected.');

    client.on('message', (message) => {
        const { action, pair } = JSON.parse(message);

        if (action === 'subscribe') {
            if (!pair) return;
            if (!wsConnections[pair]) {
                subscribeToBinance(pair); // Unified subscription for both price and depth
            }
            if (!frontendClients[pair]) frontendClients[pair] = [];
            frontendClients[pair].push(client);
            console.log(`Frontend subscribed to ${pair}`);
        } else if (action === 'unsubscribe') {
            if (pair && frontendClients[pair]) {
                frontendClients[pair] = frontendClients[pair].filter((c) => c !== client);
                console.log(`Frontend unsubscribed from ${pair}`);
            }
        } 
    });

    client.on('close', () => {
        console.log('Frontend client disconnected.');
        Object.keys(frontendClients).forEach((key) => {
            frontendClients[key] = frontendClients[key].filter((c) => c !== client);
        });
    });
});

// Subscribe to Binance WebSocket for Depth and Price Updates
function subscribeToBinance(pair) {
    const wsUrl = `${BINANCE_WS_BASE}?streams=${pair}@depth/${pair}@ticker`;
    const binanceWs = new WebSocket(wsUrl);

    binanceWs.on('message', (data) => {
        const parsedData = JSON.parse(data);
        const stream = parsedData.stream;
        const streamData = parsedData.data;

        if (stream.includes('@depth')) {
            if (frontendClients[pair]) {
                frontendClients[pair].forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            pair,
                            type: 'depth',
                            update: streamData,
                        }));
                    }
                });
            }
        } else if (stream.includes('@ticker')) {
            if (frontendClients[pair]) {
                frontendClients[pair].forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            pair,
                            type: 'price',
                            price: streamData.c,
                        }));
                    }
                });
            }
        }
    });

    binanceWs.on('close', () => {
        console.log(`Binance WebSocket for ${pair} closed.`);
        delete wsConnections[pair];
    });

    wsConnections[pair] = binanceWs;
}


// app.listen(PORT, () => {
//     console.log(`Backend server running on port ${PORT}`);
// });
