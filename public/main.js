const roomId = window.location.pathname.split('/').pop();
const ws = new WebSocket(`ws://${location.host}`);
let peer;
let dataChannel;
let isReady = false;
let localMove = null;
let opponentEncryptedMove = null;
let localKey = null;

document.querySelectorAll('#moves button').forEach(btn => {
    btn.onclick = async () => {
        if (!isReady || localMove) return;
        localMove = btn.dataset.move;
        btn.disabled = true;
        localKey = await generateKey();
        const encrypted = await encryptMove(localMove, localKey);
        dataChannel.send(JSON.stringify({ type: 'move', data: encrypted }));
        document.getElementById('status').innerText = `You chose ${localMove}`;
    };
});

ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', roomId }));
};

ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'joined') {
        console.log('Joined room');
    }

    if (msg.type === 'ready') {
        startWebRTC();
    }

    if (msg.type === 'signal') {
        await peer.signal(msg.data);
    }

    if (msg.type === 'error') {
        alert(msg.message);
    }

    if (msg.type === 'left') {
        alert("Opponent left the game.");
        location.href = "/";
    }
};

function startWebRTC() {
    const SimplePeer = window.SimplePeer;
    peer = new SimplePeer({ initiator: location.hash !== '#2', trickle: false });

    peer.on('signal', data => {
        ws.send(JSON.stringify({ type: 'signal', roomId, data }));
    });

    peer.on('connect', () => {
        dataChannel = peer;
        isReady = true;
        document.getElementById('status').innerText = "Connected! Make your move.";
    });

    peer.on('data', async raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'move') {
            opponentEncryptedMove = msg.data;
            document.getElementById('opponent-state').innerText = "Opponent chose!";
        }
    });
}

// 🔐 Crypto
async function generateKey() {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function encryptMove(move, key) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        enc.encode(move)
    );
    return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
}
