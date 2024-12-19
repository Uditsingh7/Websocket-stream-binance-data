const ws = new WebSocket('ws://localhost:8080');
let currentPair = '';

ws.onopen = () => {
    console.log('Connected to backend WebSocket.');
};

ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    const output = document.getElementById('output');
    output.innerHTML = `<p>Update for ${data.pair}: ${JSON.stringify(data.update)}</p>`;
};

ws.onclose = () => {
    console.log('Disconnected from backend WebSocket.');
};

function subscribe() {
    const pair = document.getElementById('pair').value.toLowerCase();
    if (!pair) return alert('Please enter a pair!');
    currentPair = pair;
    ws.send(JSON.stringify({ action: 'subscribe', pair }));
}

function unsubscribe() {
    if (!currentPair) return alert('No pair subscribed!');
    ws.send(JSON.stringify({ action: 'unsubscribe', pair: currentPair }));
    currentPair = '';
}
