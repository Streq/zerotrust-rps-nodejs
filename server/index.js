// server/index.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map(); // roomId -> [ws1, ws2]

app.use(express.static('public'));

app.get('/rock-paper-scissors/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

wss.on('connection', function connection(ws) {
    let roomId;

    ws.on('message', function incoming(message) {
        const data = JSON.parse(message);

        if (data.type === 'join') {
            roomId = data.roomId;
            if (!rooms.has(roomId)) rooms.set(roomId, []);
            const clients = rooms.get(roomId);
            if (clients.length >= 2) {
                ws.send(JSON.stringify({ type: 'error', message: 'Room full' }));
                return;
            }

            clients.push(ws);
            ws.send(JSON.stringify({ type: 'joined', id: clients.length }));

            if (clients.length === 2) {
                // Notify both peers
                clients[0].send(JSON.stringify({ type: 'ready' }));
                clients[1].send(JSON.stringify({ type: 'ready' }));
            }
        }

        if (data.type === 'signal') {
            const clients = rooms.get(roomId);
            if (clients) {
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'signal', data: data.data }));
                    }
                });
            }
        }
    });

    ws.on('close', function () {
        if (!roomId) return;
        const clients = rooms.get(roomId);
        if (!clients) return;
        const idx = clients.indexOf(ws);
        if (idx !== -1) clients.splice(idx, 1);
        if (clients.length === 0) rooms.delete(roomId);
        else clients.forEach(c => c.send(JSON.stringify({ type: 'left' })));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
