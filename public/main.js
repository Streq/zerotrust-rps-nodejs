const roomId = window.location.pathname.split('/').pop();
const ws = new WebSocket(`ws://${location.host}`);

let peer;
let dataChannel;
let isReady = false;

let localMove = null;
let opponentEncryptedMove = null;
let hasOpponentEncryptedMove = false;
let localKey = null;
let opponentKey = null;
let hasOpponentKey = false;
let scores = { self: 0, opponent: 0 };
let sentKey = false;
let wantRematch = false;
let opponentWantsRematch = false;

goto('init');

function goto(state) {
    switch (state) {
        case 'init':
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = true);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = true);
            document.getElementById('status').innerText = "Waiting for a connection...";
            break;
        case 'gameover':
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = true);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = false);
            const winner = scores.self > scores.opponent ? 'You win!' : 'Opponent wins!';
            document.getElementById('status').innerText = winner;
            break;
        case 'new_round':
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = false);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = true);
            break;
        case 'new_game':
            wantRematch = false;
            opponentWantsRematch = false;
            scores = { self: 0, opponent: 0 };
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = false);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = true);
            document.getElementById('status').innerText = "New Game Started! Make your move.";
            document.getElementById('opponent-state').innerText = "Opponent has not chosen";
            isReady = true;
            break;
    }
    localMove = null;
    opponentEncryptedMove = null;
    hasOpponentEncryptedMove = false;
    localKey = null;
    opponentKey = null;
    hasOpponentKey = false;
    sentKey = false;
    document.getElementById('score').innerText = `You: ${scores.self} | Opponent: ${scores.opponent}`;

}

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

document.querySelectorAll('#play_again button').forEach(btn => {
    btn.onclick = async () => {
        btn.disabled = true;
        dataChannel.send(JSON.stringify({ type: 'rematch' }))
        document.getElementById('status'.innerText = 'Requesting rematch...')
        wantRematch = true;
        tryRematch();
    }
})

ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', roomId }));
};

ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    console.log(event);
    document.querySelectorAll('#moves button').forEach(btn => btn.disabled = true);

    if (msg.type === 'joined') {
        console.log('joined');
    }

    if (msg.type === 'ready') {
        startWebRTC(msg.initiator);
    }

    if (msg.type === 'signal') {
        await peer.signal(msg.data);
    }

    if (msg.type === 'error') {
        alert(msg.message);
    }

    if (msg.type === 'left') {
        document.getElementById('opponent-state').innerText = "Opponent left the game."
        document.getElementById('status').innerText = "Waiting for a connection...";
    }
};

function startWebRTC(isInitiator) {
    const SimplePeer = window.SimplePeer;

    peer = new SimplePeer({
        initiator: isInitiator,
        trickle: false
    });

    console.log(isInitiator ? 'I am the initiator' : 'I am the responder');
    peer.on('signal', data => {
        ws.send(JSON.stringify({ type: 'signal', roomId, data }));
    });

    peer.on('connect', () => {
        dataChannel = peer;
        goto("new_game");

    });

    peer.on('data', async raw => {
        const msg = JSON.parse(raw);

        if (msg.type === 'move' && !hasOpponentEncryptedMove) {
            hasOpponentEncryptedMove = true;
            opponentEncryptedMove = msg.data;
            document.getElementById('opponent-state').innerText = "Opponent chose!";
            tryResolve();
        }

        if (msg.type === 'key' && !hasOpponentKey) {
            hasOpponentKey = true;
            opponentKey = await importKey(msg.data);
            tryResolve();
        }

        if (msg.type === 'rematch') {
            opponentWantsRematch = true;
            tryRematch();
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


function tryResolve() {
    if (localMove && opponentEncryptedMove) {
        // if we haven't sent our key yet, send it now
        if (!sentKey) {
            sentKey = true;
            exportKey(localKey).then(exported => {
                dataChannel.send(JSON.stringify({ type: 'key', data: exported }));
            });
        }


        if (opponentKey) {
            resolveRound();
        }
    }
}

function tryRematch() {
    if (wantRematch && opponentWantsRematch) {
        goto("new_game");
    }
}

async function resolveRound() {
    const opponentMove = await decryptMove(opponentEncryptedMove, opponentKey);
    console.log(`Opponent played: ${opponentMove}`);

    document.getElementById('opponent-state').innerText = `Opponent played ${opponentMove}`;
    let myMove = localMove;
    let opMove = opponentMove;
    goto("new_round");
    updateScore(myMove, opMove);
}

function updateScore(selfMove, otherMove) {
    const rules = {
        rock: 'scissors',
        paper: 'rock',
        scissors: 'paper'
    };

    if (selfMove === otherMove) {
        scores.self += 1;
        scores.opponent += 1;
    } else if (rules[selfMove] === otherMove) {
        scores.self += 2;
    } else {
        scores.opponent += 2;
    }

    if (scores.self >= 5 || scores.opponent >= 5) {
        if (scores.self !== scores.opponent) {
            goto("gameover")
        }
    }
}

// --- Key serialization helpers ---

async function exportKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return Array.from(new Uint8Array(raw));
}

async function importKey(arr) {
    const buffer = new Uint8Array(arr).buffer;
    return crypto.subtle.importKey('raw', buffer, 'AES-GCM', true, ['decrypt']);
}

async function decryptMove({ iv, data }, key) {
    const ivArr = new Uint8Array(iv);
    const encData = new Uint8Array(data);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivArr }, key, encData);
    return new TextDecoder().decode(decrypted);
}