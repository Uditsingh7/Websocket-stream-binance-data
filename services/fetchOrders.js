const { Pool } = require('pg');
const FastPriorityQueue = require('fastpriorityqueue');

const pool = new Pool({
    user: 'postgres',
    host: 'database-2.ce6qhznpf2i4.us-east-1.rds.amazonaws.com',
    database: 'how3-exchange',
    password: 'ba8DUPGV5cIufXIef6np',
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

const orderQueues = {};

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
        const topOrder = queue.poll();
        console.log(`Fetched top order for ${pair}:`, topOrder);
        return topOrder;
    }
    console.log(`No orders available for ${pair}`);
    return null;
}

// Sync pending orders from the database
async function syncPendingOrders() {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE status = $1', ['pending']);
        console.log('Pending orders fetched:', result.rows);

        // Repopulate all queues
        result.rows.forEach(order => {
            const { coin_symbol, limit_price, id, order_action, quantity } = order;
            addOrder(coin_symbol.toLowerCase(), {
                target_price: limit_price,
                id,
                order_action,
                quantity,
            });
        });

        console.log('Order queues synced successfully.');
    } catch (error) {
        console.error('Error syncing pending orders:', error);
    }
}

module.exports = { orderQueues, addOrder, getTopOrder, syncPendingOrders };
