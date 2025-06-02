const [path, roomId] = window.location.pathname.split('/room/');
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProtocol}://${window.location.host}${path}/`);

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
let scores_before = { self: 0, opponent: 0 };
let sentKey = false;
let wantRematch = false;
let opponentWantsRematch = false;

goto('init');

function splitLast(str, separator) {
    const i = str.lastIndexOf(separator);
    if (i === -1) return [str];
    return [str.slice(0, i), str.slice(i + separator.length)];
}

function goto(state) {
    switch (state) {
        case 'init':
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = true);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = true);
            document.querySelector('#me .state').innerText = "Connecting...";
            break;
        case 'gameover':
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = true);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = false);
            const [me, op] = scores.self > scores.opponent ? ['<span style="color:green">WIN</span>', 'LOSES'] : ['<span style="color:red">LOSE</span>', 'WINS'];
            document.querySelector('#me .state').innerHTML = me;
            document.querySelector('#op .state').innerHTML = op;
            break;
        case 'new_round':
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = false);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = true);
            document.querySelector('#me .state').innerHTML = "<span style='color:gray'>Choose!</span>";
            document.querySelector('#op .state').innerHTML = "<span style='color:gray'>Not Chosen</span>";
            break;
        case 'new_game':
            wantRematch = false;
            opponentWantsRematch = false;
            scores = { self: 0, opponent: 0 };
            scores_before = { self: 0, opponent: 0 };
            document.querySelectorAll('#moves button').forEach(btn => btn.disabled = false);
            document.querySelectorAll('#play_again button').forEach(btn => btn.disabled = true);
            document.querySelector('#me .state').innerHTML = "<span style='color:gray'>Choose!</span>";
            document.querySelector('#op .state').innerHTML = "<span style='color:gray'>Not Chosen</span>";
            isReady = true;
            break;
    }
    document.querySelectorAll('#moves button').forEach(btn => btn.style.display = 'initial');
    localMove = null;
    opponentEncryptedMove = null;
    hasOpponentEncryptedMove = false;
    localKey = null;
    opponentKey = null;
    hasOpponentKey = false;
    sentKey = false;
    let selfDelta = scores.self - scores_before.self
    document.querySelector('#me .score').innerHTML = `${scores.self}${selfDelta > 0 ? ` <span style="color:green">(+${selfDelta})</span>` : ""}`;
    let oppDelta = scores.opponent - scores_before.opponent
    document.querySelector('#op .score').innerHTML = `${scores.opponent}${oppDelta > 0 ? ` <span style="color:red">(+${oppDelta})</span>` : ""}`;
}
function capitalizeFirstLetter(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

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
        document.querySelector('#op .state').innerText = "Left."
        document.querySelector('#me .state').innerText = "Connecting...";
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
            document.querySelector('#op .state').innerText = "Move Submitted";
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
    console.log(`Opponent chose: ${opponentMove}`);

    document.querySelector('#op .move').innerText = `${MOVES[opponentMove].fullName}`;
    document.querySelector('#me .move').innerText = `${MOVES[localMove].fullName}`;
    let state = updateScore(localMove, opponentMove);
    goto(state);
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

const MOVES = {
    'rock': {
        icon: '🪨',
        beats: 'scissors',
    },
    'paper': {
        icon: '📄',
        beats: 'rock',
    },
    'scissors': {
        icon: '✂️',
        beats: 'paper',
    }
}
function updateScore(selfMove, otherMove) {
    scores_before.self = scores.self;
    scores_before.opponent = scores.opponent;
    if (selfMove === otherMove) {
        scores.self += 1;
        scores.opponent += 1;
    } else if (MOVES[selfMove].beats === otherMove) {
        scores.self += 2;
    } else {
        scores.opponent += 2;
    }

    if (scores.self >= 5 || scores.opponent >= 5) {
        if (scores.self !== scores.opponent) {
            return "gameover"
        }
    }
    return "new_round"
}
function init() {
    let container = document.querySelector('#moves');

    for (const [move, value] of Object.entries(MOVES)) {
        let btn = document.createElement('button');
        let icon = value.icon;
        let capitalized = capitalizeFirstLetter(move);
        value.capitalized = capitalized;
        let fullName = `${icon} ${capitalized}`;
        value.fullName = fullName;
        btn.textContent = fullName;

        btn.onclick = async () => {
            if (!isReady || localMove) return;
            localMove = move;
            btn.disabled = true;

            document.querySelectorAll('#moves button').forEach(btn => { btn.disabled = true; btn.style.display = 'none'; });
            btn.style.display = 'initial';
            localKey = await generateKey();
            const encrypted = await encryptMove(localMove, localKey);
            dataChannel.send(JSON.stringify({ type: 'move', data: encrypted }));
            document.querySelector('#me .state').innerText = "Move Submitted";

        };

        container.appendChild(btn);
    }



    const rematch = document.querySelector('#play_again button')
    rematch.onclick = async () => {
        rematch.disabled = true;
        dataChannel.send(JSON.stringify({ type: 'rematch' }))
        document.querySelector('#me .state').innerText = 'Requesting rematch...'
        wantRematch = true;
        tryRematch();
    }
}
init();