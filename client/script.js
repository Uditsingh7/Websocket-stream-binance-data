const ws = new WebSocket('ws://3.87.89.155:8080');
let currentPair = '';

// WebSocket Connection Open
ws.onopen = () => {
    console.log('Connected to backend WebSocket.');
};

// WebSocket Connection Closed
ws.onclose = () => {
    console.log('Disconnected from backend WebSocket.');
};

// Subscribe to Pair
function subscribeToPair() {
    const pair = document.getElementById('pair').value.toLowerCase().trim();
    if (!pair) return alert('Please enter a valid pair!');

    if (ws.readyState === WebSocket.OPEN) {
        if (currentPair && currentPair === pair) {
            return alert(`Already subscribed to ${pair}.`);
        }
        currentPair = pair;
        ws.send(JSON.stringify({ action: 'subscribe', pair }));
        // alert(`Subscribed to ${pair} for depth and price updates.`);
    } else {
        alert('WebSocket is not connected!');
    }
}

// Handle WebSocket Messages
ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    console.log('Received Data:', data);

    if (data.type === 'price') {
        document.getElementById('price').innerHTML = `Price for ${data.pair}: ${data.price}`;
    } else if (data.type === 'depth') {
        document.getElementById('output').innerHTML = `Order book update for ${data.pair}: ${JSON.stringify(data.update)}`;
    } else if (data.type === 'allPrices') {
        const header = document.getElementById('price-header');
        header.innerHTML = ''; // Clear existing prices

        data.updates.forEach((update) => {
            const priceDiv = document.createElement('div');
            const changeColor = parseFloat(update.change) >= 0 ? 'green' : 'red';

            priceDiv.innerHTML = `
                <span>${update.symbol}: </span>
                <span>$${update.price}</span>
                <span style="color: ${changeColor};"> (${update.change}%)</span>
            `;
            header.appendChild(priceDiv);
        });
    }
};


// Unsubscribe from Pair
function unsubscribe() {
    if (!currentPair) return alert('No pair subscribed!');
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'unsubscribe', pair: currentPair }));
        currentPair = '';
    } else {
        alert('WebSocket is not connected!');
    }
}
