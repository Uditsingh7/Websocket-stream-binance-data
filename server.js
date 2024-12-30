const WebSocket = require('ws');
const { Pool } = require('pg');
const FastPriorityQueue = require('fastpriorityqueue');

const BINANCE_WS_BASE = 'wss://fstream.binance.com/stream';
const wsConnections = {}; // Stores Binance WebSocket connections per pair
const frontendClients = {}; // Tracks frontend clients per pair
const orderQueues = {}; // Order queues per pair

const pool = new Pool({
    user: 'postgres',
    host: 'database-2.ce6qhznpf2i4.us-east-1.rds.amazonaws.com',
    database: 'how3-exchange',
    password: 'ba8DUPGV5cIufXIef6np',
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

const PRICE_DEVIATION_THRESHOLD = 0.01; // 1% deviation allowed

function isPriceAcceptable(targetPrice, actualPrice) {
    const deviation = Math.abs((actualPrice - targetPrice) / targetPrice);
    return deviation <= PRICE_DEVIATION_THRESHOLD;
}

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
            wsConnections[pair].orderBookUpdate = streamData; 
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

    wsConnections[pair] = { socket: binanceWs, orderBookUpdate: null };
}

// Handle order execution for all pairs
async function processAllOrders() {
    const pairsWithActiveOrders = Object.keys(orderQueues); // Get pairs with active orders

    for (const pair of pairsWithActiveOrders) {
        const connection = wsConnections[pair];
        if (!connection || !connection.orderBookUpdate) continue;

        const orderBookUpdate = connection.orderBookUpdate;
        const bids = orderBookUpdate.b || [];
        const asks = orderBookUpdate.a || [];
        const bestBid = parseFloat(bids[bids.length - 1]?.[0] || 0);
        const bestAsk = parseFloat(asks[0]?.[0] || Infinity);

        console.log(`Processing orders for ${pair}: Best Bid: ${bestBid}, Best Ask: ${bestAsk}`);

        while (true) {
            const topOrder = getTopOrder(pair);
            if (!topOrder) break;

            console.log(`Checking top order for ${pair}:`, topOrder);

            if (topOrder.order_action === 'buy' && bestAsk <= topOrder.target_price && isPriceAcceptable(topOrder.target_price, bestAsk)) {
                console.log(`Executing buy order ${topOrder.id} at ${bestAsk}`);
                await executeOrder(topOrder, bestAsk);
            } else if (topOrder.order_action === 'sell' && bestBid >= topOrder.target_price && isPriceAcceptable(topOrder.target_price, bestBid)) {
                console.log(`Executing sell order ${topOrder.id} at ${bestBid}`);
                await executeOrder(topOrder, bestBid);
            } else {
                console.log(`Order ${topOrder.id} not executable or price deviation too high. Re-queuing.`);
                addOrder(pair, topOrder);
                break;
            }
        }
    }
}


// Execute an order and update the database
async function executeOrder(order, executionPrice) {
    try {
        await pool.query(
            'UPDATE orders SET status = $1, executed_price = $2 WHERE id = $3',
            ['completed', executionPrice, order.id]
        );
        console.log(`Order ${order.id} executed successfully at ${executionPrice}`);
    } catch (err) {
        console.error(`Error executing order ${order.id}:`, err);
    }
}

// Initialize or retrieve a queue for a specific pair
function getOrCreateQueue(pair) {
    if (!orderQueues[pair]) {
        orderQueues[pair] = new FastPriorityQueue((a, b) => a.target_price < b.target_price);
        console.log(`Initialized queue for pair: ${pair}`);
    }
    return orderQueues[pair];
}

// Add an order to the appropriate queue
function addOrder(pair, order) {
    const queue = getOrCreateQueue(pair);
    queue.add(order);
    console.log(`Added order to ${pair}:`, order);
}

// Get the top order from the queue
function getTopOrder(pair) {
    const queue = orderQueues[pair];
    if (queue && !queue.isEmpty()) {
        return queue.poll();
    }
    return null;
}

// Sync pending orders from the database
async function syncPendingOrders() {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE status = $1', ['pending']);
        console.log('Pending orders fetched:', result.rows);

        result.rows.forEach(order => {
            const { coin_symbol, limit_price, id, order_action, quantity } = order;
            const pair = `${coin_symbol.toLowerCase()}usdt`; // Format pair for order processing

            if (!wsConnections[pair]) {
                subscribeToBinance(pair); // Ensure WebSocket subscription for the pair
            }

            addOrder(pair, {
                target_price: limit_price,
                id,
                order_action,
                quantity,
                coin_symbol
            });
        });

        console.log('Order queues synced successfully.');
    } catch (error) {
        console.error('Error syncing pending orders:', error);
    }
}

// Periodically process all pairs
setInterval(async () => {
    await processAllOrders();
}, 1000); // Adjust interval as needed

// Periodically sync pending orders from the database
setInterval(async () => {
    console.log('Syncing pending orders from database...');
    await syncPendingOrders();
}, 60000); // Every 1 minute

(async function initialize() {
    console.log('Initializing order system...');

    try {
        await syncPendingOrders();
        console.log('Order queues synced.');
    } catch (error) {
        console.error('Error during initialization:', error);
    }
})();
