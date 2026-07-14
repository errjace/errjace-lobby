const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'amici.html'));
});

app.get('/amici.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'amici.html'));
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.get('/icon-192.svg', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'icon-192.svg'));
});

const ytSearch = require('yt-search');

app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json({ results: [] });
  try {
    const r = await ytSearch(q);
    const results = r.videos.slice(0, 10).map(v => ({
      videoId: v.videoId,
      title: v.title,
      artist: v.author.name,
      cover: v.image || v.thumbnail,
      duration: v.duration.timestamp,
      url: v.url,
    }));
    res.json({ results });
  } catch (err) {
    console.error('Errore ricerca YouTube:', err);
    res.status(500).json({ error: 'Errore ricerca' });
  }
});

const users = {};
const queue = [];
const messageReactions = {};
let msgCounter = 0;

// DAMA Game
const games = {};
let gameIdCounter = 0;

function createBoard() {
  const board = Array(8).fill().map(() => Array(8).fill(0));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 !== 0) continue;
      if (r < 3) board[r][c] = 2;
      else if (r > 4) board[r][c] = 1;
    }
  }
  return board;
}

function isValidGameMove(board, from, to, playerPiece) {
  const [fr, fc] = from;
  const [tr, tc] = to;
  if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
  if (fr < 0 || fr > 7 || fc < 0 || fc > 7) return false;
  const piece = board[fr][fc];
  if (piece === 0) return false;
  if (board[tr][tc] !== 0) return false;
  if ((playerPiece === 1 || playerPiece === 3) && (piece !== 1 && piece !== 3)) return false;
  if ((playerPiece === 2 || playerPiece === 4) && (piece !== 2 && piece !== 4)) return false;
  const dr = tr - fr;
  const dc = tc - fc;
  if (Math.abs(dr) !== Math.abs(dc)) return false;
  if (Math.abs(dr) > 2) return false;
  const isKing = piece >= 3;
  if (!isKing) {
    if (playerPiece === 1 && dr >= 0) return false;
    if (playerPiece === 2 && dr <= 0) return false;
  }
  if (Math.abs(dr) === 2) {
    const mr = fr + dr / 2;
    const mc = fc + dc / 2;
    const mid = board[mr][mc];
    if (mid === 0) return false;
    const opponent = (playerPiece === 1 || playerPiece === 3) ? [2, 4] : [1, 3];
    if (!opponent.includes(mid)) return false;
  }
  return true;
}

function getPlayerPieces(board, player) {
  const pieces = [];
  const p = (player === 1 || player === 3) ? [1, 3] : [2, 4];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (p.includes(board[r][c])) pieces.push([r, c, board[r][c]]);
    }
  }
  return pieces;
}

function hasValidMoves(board, player) {
  const pieces = getPlayerPieces(board, player);
  for (const [r, c, p] of pieces) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dr === 0 || dc === 0) continue;
        if (Math.abs(dr) !== Math.abs(dc)) continue;
        if (isValidGameMove(board, [r, c], [r + dr, c + dc], p)) return true;
      }
    }
  }
  return false;
}

function applyMove(board, from, to) {
  const [fr, fc] = from;
  const [tr, tc] = to;
  const piece = board[fr][fc];
  board[fr][fc] = 0;
  let captured = null;
  if (Math.abs(tr - fr) === 2) {
    const mr = fr + (tr - fr) / 2;
    const mc = fc + (tc - fc) / 2;
    captured = board[mr][mc];
    board[mr][mc] = 0;
  }
  let newPiece = piece;
  if (piece === 1 && tr === 0) newPiece = 3;
  if (piece === 2 && tr === 7) newPiece = 4;
  board[tr][tc] = newPiece;
  return captured;
}

// UNO Game
const unoGames = {};

function createUnoDeck() {
  const d = [];
  const cl = ['red','yellow','green','blue'];
  const nums = ['0','1','1','2','2','3','3','4','4','5','5','6','6','7','7','8','8','9','9'];
  const acts = ['skip','skip','reverse','reverse','draw2','draw2'];
  cl.forEach(c => { nums.forEach(n => d.push({c,v:n})); acts.forEach(a => d.push({c,v:a})); });
  for (let i = 0; i < 4; i++) { d.push({c:'wild',v:'wild'}); d.push({c:'wild',v:'wild4'}); }
  return d;
}
function shuffle(a) { for (let i = a.length-1;i>0;i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function canPlayUno(card, top, curColor) { if (card.c === 'wild') return true; if (card.c === curColor) return true; if (card.v === top.v) return true; return false; }

function getUnoState(game, pid) {
  const players = game.players.map(p => ({ id: p.id, nick: p.nick, avatar: p.avatar, cardCount: p.cards.length }));
  const me = game.players.find(p => p.id === pid);
  return {
    id: game.id, status: game.status, host: game.host, maxPlayers: game.maxPlayers,
    players, hand: me ? me.cards : [],
    topCard: game.discardPile[game.discardPile.length-1] || null,
    deckCount: game.deck.length,
    currentColor: game.currentColor,
    currentPlayerId: game.players[game.currentPlayerIndex]?.id || null,
    direction: game.direction, winner: game.winner,
    lastAction: game.lastAction,
  };
}
function advanceTurn(g) { g.currentPlayerIndex = (g.currentPlayerIndex + g.direction + g.players.length) % g.players.length; }

// MAPPA 2D
const mapPlayers = {};
const MAP_W = 50;
const MAP_H = 38;
const MAP_CHARS = [
  { id: 'hero', name: 'Eroe', color: '#7c3aed' },
  { id: 'mage', name: 'Mago', color: '#3b82f6' },
  { id: 'ninja', name: 'Ninja', color: '#ef4444' },
  { id: 'robot', name: 'Robot', color: '#22c55e' },
  { id: 'ghost', name: 'Fantasma', color: '#a78bfa' },
  { id: 'king', name: 'Re', color: '#ffd700' },
];
const mapWildPokes = [];
function generateWildPokes() {
  mapWildPokes.length = 0;
  const pool = [
    { id: 17, name: 'Pidgeotto' }, { id: 20, name: 'Raticate' },
    { id: 22, name: 'Fearow' }, { id: 24, name: 'Arbok' },
    { id: 28, name: 'Sandslash' }, { id: 42, name: 'Golbat' },
    { id: 44, name: 'Gloom' }, { id: 61, name: 'Poliwhirl' },
    { id: 75, name: 'Graveler' }, { id: 93, name: 'Haunter' },
    { id: 45, name: 'Vileplume' }, { id: 65, name: 'Alakazam' },
    { id: 68, name: 'Machamp' }, { id: 76, name: 'Golem' },
    { id: 94, name: 'Gengar' }, { id: 82, name: 'Magneton' },
    { id: 80, name: 'Slowbro' }, { id: 78, name: 'Rapidash' },
    { id: 119, name: 'Seaking' }, { id: 87, name: 'Dewgong' },
  ];
  for (let i = 0; i < 20; i++) {
    const pk = pool[Math.floor(Math.random() * pool.length)];
    mapWildPokes.push({
      id: pk.id, name: pk.name,
      x: Math.floor(Math.random() * MAP_W),
      y: Math.floor(Math.random() * MAP_H),
      spawnTime: Date.now()
    });
  }
}
generateWildPokes();
setInterval(() => { generateWildPokes(); io.emit('map:wildPokes', mapWildPokes); }, 180000);

// CASINO & QUIZ
const casinoBals = {};
const casinoEarnings = {}; // net earnings per socket
const CASINO_START = 10000;
const QUIZ_PRIZE = 30000;
const QUIZ_INTERVAL = 600000;
const QUIZ_TIME = 10000;
let quizTimer = null;
let quizActive = false;
let currentQuiz = null;
let quizAnswered = new Set();

function broadcastCasinoLeaderboard() {
  const entries = Object.keys(casinoEarnings).map(id => ({ id, nick: users[id]?.nick||'Sconosciuto', earn: casinoEarnings[id] }));
  entries.sort((a,b) => b.earn - a.earn);
  io.emit('casino:leaderboard', entries.slice(0, 10));
}

const QUIZ_QUESTIONS = [
  {q:"In città il limite di velocità è:",o:["30 km/h","50 km/h","70 km/h","90 km/h"],a:1},
  {q:"Il semaforo giallo indica:",o:["Accelerare","Fermarsi se possibile","Passare sempre","Suonare"],a:1},
  {q:"Si può parcheggiare in doppia fila?",o:["Sì","No","Solo di notte","Solo domenica"],a:1},
  {q:"Cosa significa lo zig-zag sulla strada?",o:["Divieto sosta","Fermata bus","Passaggio pedonale","Carico/scarico"],a:1},
  {q:"Si può guidare dopo aver bevuto alcol?",o:["Sì","No","Un bicchiere","Dipende"],a:1},
  {q:"L'assicurazione auto è obbligatoria?",o:["Sì","No","Solo auto nuove","Solo autostrada"],a:0},
  {q:"Limite alcol neopatentati:",o:["0,5 g/L","0,3 g/L","0,0 g/L","0,8 g/L"],a:2},
  {q:"Documento NON serve per guidare?",o:["Patente","Libretto","Carta identità","Assicurazione"],a:2},
  {q:"Distanza sicurezza dipende da:",o:["Velocità","Freni","Tempo reazione","Tutti"],a:3},
  {q:"In autostrada il limite è:",o:["110","120","130","150 km/h"],a:2},
  {q:"Triangolo bianco bordo rosso significa:",o:["Divieto","Pericolo","Obbligo","Indicazione"],a:1},
  {q:"Telefono mentre si guida:",o:["Sì","No","Solo vivavoce","Solo urgente"],a:2},
  {q:"Cinture sicurezza obbligatorie:",o:["Solo autostrada","Sempre","Solo notte","Solo guidatore"],a:1},
  {q:"Señale STOP obbliga a:",o:["Rallentare","Fermarsi e dare prec.","Solo se traffico","Suonare"],a:1},
  {q:"Sorpasso a destra:",o:["Sì","No","Solo autostrada","Solo se impossibile a sx"],a:3},
  {q:"Casco obbligatorio per:",o:["Bici","Moto","Auto","Tutti"],a:1},
  {q:"Con pioggia distanza sicurezza:",o:["Diminuisce","Aumenta","Uguale","Non serve"],a:1},
  {q:"Patente AM abilita:",o:["Auto","Ciclomotori","Camion","Moto"],a:1},
  {q:"Parcheggio su strisce pedonali:",o:["Sì","No","Solo notte","5 minuti"],a:1},
  {q:"Precedenza in rotatoria:",o:["Chi entra","Chi è dentro","Chi viene da destra","Chi da sinistra"],a:1},
  {q:"Limite neopatentati in città:",o:["50","70","90","100 km/h"],a:0},
  {q:"Segnale 'dare precedenza' ha forma:",o:["Cerchio","Triangolo","Quadrato","Rettangolo"],a:1},
  {q:"Si può sorpassare in curva?",o:["Sì","No","Solo se visibilità","Solo di giorno"],a:1},
  {q:"La revisione auto è obbligatoria ogni:",o:["1 anno","2 anni","3 anni","4 anni"],a:1},
  {q:"Il libretto di circolazione contiene:",o:["Dati auto","Dati proprietario","Bollo","Multa"],a:0},
];
const SLOT_SYMS = [
  {e:'🍒',w:25,p2:2,p3:5},{e:'🍋',w:20,p2:2,p3:8},{e:'🍊',w:18,p2:2,p3:12},
  {e:'🍇',w:15,p2:2,p3:20},{e:'💎',w:12,p2:2,p3:30},{e:'⭐',w:6,p2:0,p3:50},
  {e:'7️⃣',w:3,p2:0,p3:100},{e:'👑',w:1,p2:0,p3:200},
];
function spinSlots() {
  const r = [];
  for (let i = 0; i < 3; i++) {
    let t = Math.random() * 100, cum = 0;
    for (const s of SLOT_SYMS) { cum += s.w; if (t <= cum) { r.push(s); break; } }
    if (!r[i]) r[i] = SLOT_SYMS[0];
  }
  return r;
}
function calcSlot(r, bet) {
  const [a,b,c] = r;
  if (a.e === b.e && b.e === c.e) return bet * a.p3;
  if (a.e === b.e) return bet * a.p2;
  if (a.e === c.e) return bet * a.p2;
  if (b.e === c.e) return bet * b.p2;
  return 0;
}
function getBal(id) { if (casinoBals[id] === undefined) casinoBals[id] = CASINO_START; saveNickData(id); return casinoBals[id]; }
function resetQuiz() { quizActive = false; currentQuiz = null; quizAnswered = new Set(); }
function sendQuiz() {
  if (Object.keys(users).length < 1) return;
  const q = QUIZ_QUESTIONS[Math.floor(Math.random() * QUIZ_QUESTIONS.length)];
  currentQuiz = q; quizActive = true; quizAnswered = new Set();
  io.emit('quiz:question', { question: q.q, options: q.o, prize: QUIZ_PRIZE, timeLeft: 10 });
  setTimeout(() => { if (quizActive) { io.emit('quiz:timeout'); resetQuiz(); } }, QUIZ_TIME);
}
function startQuiz() { if (quizTimer) clearInterval(quizTimer); quizTimer = setInterval(sendQuiz, QUIZ_INTERVAL); }

// POKEMON System
const pokemonData = {};
// Migrate old clawPoke to team array
function migratePokemonData(d) {
  if (!d) return;
  if (d.clawPoke && !d.team) {
    d.team = [d.clawPoke];
    delete d.clawPoke;
  }
  if (!d.team) d.team = [];
  d.team.forEach(function(p) { if (!p.lv) p.lv = 1; });
}
const clawCounters = {};
const tradeSessions = {};

// === PERSISTENZA DATI ===
const DATA_FILE = path.join(__dirname, 'data.json');
const dataByToken = {};
const tokenForSocket = {};
const nickAuth = {}; // nickname → { pin, token }
const nickData = {}; // nickname backup (per PIN fallback)
const NICKAUTH_FILE = path.join(__dirname, 'nickauth.json');
const NICKDATA_FILE = path.join(__dirname, 'nickdata.json');
let useMongo = false;

const UserDataSchema = new mongoose.Schema({
  token: { type: String, unique: true },
  nick: String, avatar: String,
  casinoBal: Number, casinoEarnings: Number,
  pokemon: mongoose.Schema.Types.Mixed,
  clawCounter: Number,
});
const UserData = mongoose.model('UserData', UserDataSchema);

async function loadData() {
  if (useMongo) {
    try {
      const docs = await UserData.find({}).lean();
      docs.forEach(d => { dataByToken[d.token] = d; delete dataByToken[d.token]._id; delete dataByToken[d.token].__v; });
      console.log(`[DB] Caricati dati di ${Object.keys(dataByToken).length} utenti`);
    } catch(e) { console.error('[DB] Errore caricamento:', e); }
  }
  // Fallback file (sincrono)
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const fileData = JSON.parse(raw);
      Object.keys(fileData).forEach(k => { if (!dataByToken[k]) dataByToken[k] = fileData[k]; });
    }
  } catch(e) { console.error('Errore caricamento file:', e); }
  // Carica nickAuth
  try {
    if (fs.existsSync(NICKAUTH_FILE)) {
      const raw = fs.readFileSync(NICKAUTH_FILE, 'utf-8');
      const loaded = JSON.parse(raw);
      Object.keys(loaded).forEach(k => { nickAuth[k] = loaded[k]; });
    }
  } catch(e) { console.error('Errore caricamento nickauth:', e); }
  // Carica nickData
  try {
    if (fs.existsSync(NICKDATA_FILE)) {
      const raw = fs.readFileSync(NICKDATA_FILE, 'utf-8');
      const loaded = JSON.parse(raw);
      Object.keys(loaded).forEach(k => { if (!nickData[k]) nickData[k] = loaded[k]; });
    }
  } catch(e) { console.error('Errore caricamento nickdata:', e); }
}

async function saveData() {
  if (useMongo) {
    try {
      const ops = Object.entries(dataByToken).map(([token, d]) => ({
        updateOne: { filter: { token }, update: { $set: { ...d, token } }, upsert: true }
      }));
      if (ops.length > 0) await UserData.bulkWrite(ops);
    } catch(e) { console.error('[DB] Errore salvataggio:', e); }
  } else {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(dataByToken, null, 2));
    } catch(e) { console.error('Errore salvataggio file:', e); }
    try {
      fs.writeFileSync(NICKDATA_FILE, JSON.stringify(nickData, null, 2));
    } catch(e) { console.error('Errore salvataggio nickdata:', e); }
  }
}

function saveNickData(socketId) {
  const u = users[socketId];
  if (!u || !u.nick) return;
  const nick = u.nick;
  nickData[nick] = {
    nick: u.nick,
    avatar: u.avatar,
    token: tokenForSocket[socketId] || '',
    casinoBal: casinoBals[socketId] !== undefined ? casinoBals[socketId] : CASINO_START,
    casinoEarnings: casinoEarnings[socketId] || 0,
    pokemon: pokemonData[socketId] || null,
    clawCounter: clawCounters[socketId] || 0,
  };
  try { fs.writeFileSync(NICKDATA_FILE, JSON.stringify(nickData, null, 2)); }
  catch(e) { console.error('Errore salvataggio nickdata:', e); }
  // Sync anche su dataByToken per MongoDB
  const token = tokenForSocket[socketId];
  if (token) { dataByToken[token] = { ...dataByToken[token] || {}, ...nickData[nick], token }; }
}

function syncTokenData(socketId) {
  const token = tokenForSocket[socketId];
  if (!token || !dataByToken[token]) return;
  const d = dataByToken[token];
  d.nick = users[socketId]?.nick || d.nick;
  d.avatar = users[socketId]?.avatar || d.avatar;
  if (casinoBals[socketId] !== undefined) d.casinoBal = casinoBals[socketId];
  if (casinoEarnings[socketId] !== undefined) d.casinoEarnings = casinoEarnings[socketId];
  d.pokemon = pokemonData[socketId] || null;
  d.clawCounter = clawCounters[socketId] || 0;
  if (d.nick) nickData[d.nick] = { ...d, token };
  try { fs.writeFileSync(NICKDATA_FILE, JSON.stringify(nickData, null, 2)); }
  catch(e) { console.error('Errore salvataggio nickdata:', e); }
}

setInterval(() => saveData(), 30000);
setInterval(() => {
  try { fs.writeFileSync(NICKAUTH_FILE, JSON.stringify(nickAuth, null, 2)); }
  catch(e) { console.error('Errore salvataggio nickauth:', e); }
}, 30000);
// =========================

const EVO_THRESH = [0,30,80,150,250,400,600,900,1300,2000,2800,3800,5000,6500,8500,11000];
const POKE_IMG = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/';
const CLAW_COST = 5000;
const CANDY_COST = 50000;
const CANDY_MAX_COST = 500000;
const CLAW_POOL = [
  {n:'Pidgeotto',i:17,t:0},{n:'Raticate',i:20,t:0},{n:'Fearow',i:22,t:0},{n:'Arbok',i:24,t:0},
  {n:'Sandslash',i:28,t:0},{n:'Golbat',i:42,t:0},{n:'Gloom',i:44,t:0},{n:'Poliwhirl',i:61,t:0},
  {n:'Weepinbell',i:70,t:0},{n:'Graveler',i:75,t:0},{n:'Doduo',i:84,t:0},{n:'Dewgong',i:87,t:0},
  {n:'Haunter',i:93,t:0},{n:'Hypno',i:97,t:0},{n:'Seadra',i:117,t:0},{n:'Seaking',i:119,t:0},
  {n:'Pikachu',i:25,t:1},{n:'Raichu',i:26,t:1},{n:'Ninetales',i:38,t:1},{n:'Wigglytuff',i:40,t:1},
  {n:'Vileplume',i:45,t:1},{n:'Politoed',i:186,t:1},{n:'Machoke',i:67,t:1},{n:'Kadabra',i:64,t:1},
  {n:'Rapidash',i:78,t:1},{n:'Slowbro',i:80,t:1},{n:'Magneton',i:82,t:1},{n:'Dragonair',i:148,t:1},
  {n:'Alakazam',i:65,t:1},{n:'Gengar',i:94,t:1},{n:'Machamp',i:68,t:1},{n:'Golem',i:76,t:1},
  {n:'Mewtwo',i:150,t:2},{n:'Rayquaza',i:384,t:2},{n:'Dialga',i:483,t:2},{n:'Palkia',i:484,t:2},
  {n:'Giratina',i:487,t:2},{n:'Arceus',i:493,t:2},{n:'Zekrom',i:644,t:2},{n:'Reshiram',i:643,t:2},
  {n:'Kyogre',i:382,t:2},{n:'Groudon',i:383,t:2},{n:'Lugia',i:249,t:2},{n:'Ho-Oh',i:250,t:2},
];
const STARTERS = {
  charmander:{name:'Charmander',evos:['Charmander','Charmeleon','Charizard'],imgs:[4,5,6]},
  mimikyu:{name:'Mimikyu',evos:['Mimikyu','Mimikyu','Mimikyu💀'],imgs:[778,778,778]},
  riolu:{name:'Riolu',evos:['Riolu','Lucario','Lucario⭐'],imgs:[447,448,448]},
  swinub:{name:'Swinub',evos:['Swinub','Piloswine','Mamoswine'],imgs:[220,221,473]},
};
function getPokemonLv(xp) { for(let i=EVO_THRESH.length-1;i>=0;i--) if(xp>=EVO_THRESH[i]) return i+1; return 1; }
function getPokeStage(lv) { return lv>=10?2:lv>=5?1:0; }
function addPokeXP(id, amt, reason) {
  const d=pokemonData[id]; if(!d)return;
  migratePokemonData(d);
  const ol=getPokemonLv(d.xp), os=getPokeStage(ol);
  d.xp+=amt;
  const nl=getPokemonLv(d.xp), ns=getPokeStage(nl);
  if(users[id]) io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
  if(ns>os) {
    const s=STARTERS[d.starter], oldE=s.evos[os], newE=s.evos[ns];
    d.currentForm=newE;
    io.emit('chat message',{id:++msgCounter,nick:'Pokémon',avatar:'<img src="'+POKE_IMG+STARTERS[d.starter].imgs[ns]+'.png" style="width:22px;height:22px;vertical-align:middle;">',msg:`✨ ${users[id]?.nick||'Qualcuno'} ha fatto evolvere ${oldE} → ${newE}! Liv.${nl}`,time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),system:true,reactions:{}});
    io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
  }
  saveNickData(id);
}
setInterval(()=>{Object.keys(pokemonData).forEach(id=>{if(users[id])addPokeXP(id,1,'online');});},60000);

// === NEGOZIO LEGGENDARI ===
const LEGENDARY_SHOP = [
  // 50k€
  {id:144,name:'Articuno',price:50000},{id:145,name:'Zapdos',price:50000},{id:146,name:'Moltres',price:50000},
  {id:243,name:'Raikou',price:50000},{id:244,name:'Entei',price:50000},{id:245,name:'Suicune',price:50000},
  {id:377,name:'Regirock',price:50000},{id:378,name:'Regice',price:50000},{id:379,name:'Registeel',price:50000},
  {id:380,name:'Latias',price:50000},{id:381,name:'Latios',price:50000},
  {id:480,name:'Uxie',price:50000},{id:481,name:'Mesprit',price:50000},{id:482,name:'Azelf',price:50000},
  {id:485,name:'Heatran',price:50000},{id:488,name:'Cresselia',price:50000},
  {id:638,name:'Cobalion',price:50000},{id:639,name:'Terrakion',price:50000},{id:640,name:'Virizion',price:50000},
  {id:641,name:'Tornadus',price:50000},{id:642,name:'Thundurus',price:50000},{id:645,name:'Landorus',price:50000},
  {id:647,name:'Keldeo',price:50000},
  {id:785,name:'Tapu Koko',price:50000},{id:786,name:'Tapu Lele',price:50000},{id:787,name:'Tapu Bulu',price:50000},{id:788,name:'Tapu Fini',price:50000},
  {id:894,name:'Regieleki',price:50000},{id:895,name:'Regidrago',price:50000},
  {id:896,name:'Glastrier',price:50000},{id:897,name:'Spectrier',price:50000},
  // 100k€
  {id:150,name:'Mewtwo',price:100000},{id:151,name:'Mew',price:100000},
  {id:249,name:'Lugia',price:100000},{id:250,name:'Ho-Oh',price:100000},{id:251,name:'Celebi',price:100000},
  {id:382,name:'Kyogre',price:100000},{id:383,name:'Groudon',price:100000},{id:384,name:'Rayquaza',price:100000},
  {id:385,name:'Jirachi',price:100000},{id:386,name:'Deoxys',price:100000},
  {id:483,name:'Dialga',price:100000},{id:484,name:'Palkia',price:100000},{id:487,name:'Giratina',price:100000},
  {id:486,name:'Regigigas',price:100000},
  {id:491,name:'Darkrai',price:100000},{id:492,name:'Shaymin',price:100000},{id:493,name:'Arceus',price:100000},
  {id:494,name:'Victini',price:100000},
  {id:643,name:'Reshiram',price:100000},{id:644,name:'Zekrom',price:100000},{id:646,name:'Kyurem',price:100000},
  {id:649,name:'Genesect',price:100000},{id:648,name:'Meloetta',price:100000},
  {id:716,name:'Xerneas',price:100000},{id:717,name:'Yveltal',price:100000},{id:718,name:'Zygarde',price:100000},
  {id:719,name:'Diancie',price:100000},{id:720,name:'Hoopa',price:100000},{id:721,name:'Volcanion',price:100000},
  {id:791,name:'Solgaleo',price:100000},{id:792,name:'Lunala',price:100000},{id:800,name:'Necrozma',price:100000},
  {id:802,name:'Marshadow',price:100000},{id:807,name:'Zeraora',price:100000},{id:801,name:'Magearna',price:100000},
  {id:888,name:'Zacian',price:100000},{id:889,name:'Zamazenta',price:100000},{id:890,name:'Eternatus',price:100000},
  {id:893,name:'Zarude',price:100000},{id:898,name:'Calyrex',price:100000},
  {id:789,name:'Cosmog',price:100000},
];

// ===== BATTAGLIA POKEMON (Showdown-style) =====
const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
const TYPE_CHART = {
  normal:{rock:.5,ghost:0,steel:.5}, fire:{fire:.5,water:.5,grass:2,ice:2,bug:2,rock:.5,dragon:.5,steel:2},
  water:{fire:2,water:.5,grass:.5,ground:2,rock:2,dragon:.5}, electric:{water:2,electric:.5,grass:.5,ground:0,flying:2,dragon:.5},
  grass:{fire:.5,water:2,electric:2,grass:.5,poison:.5,ground:2,flying:.5,bug:.5,rock:2,dragon:.5,steel:.5},
  ice:{fire:.5,water:.5,grass:2,ice:.5,ground:2,flying:2,dragon:2,steel:.5},
  fighting:{normal:2,ice:2,poison:.5,flying:.5,psychic:.5,bug:.5,rock:2,ghost:0,dark:2,steel:2,fairy:.5},
  poison:{grass:2,poison:.5,ground:.5,bug:2,rock:.5,ghost:.5,steel:0,fairy:2},
  ground:{fire:2,electric:2,grass:.5,poison:2,flying:0,bug:.5,rock:2,dragon:.5,steel:2},
  flying:{electric:.5,grass:2,fighting:2,bug:2,rock:.5,steel:.5},
  psychic:{fighting:2,poison:2,psychic:.5,bug:.5,rock:.5,ghost:0,dark:0,steel:.5},
  bug:{fire:.5,grass:2,fighting:.5,poison:.5,flying:.5,psychic:2,rock:.5,ghost:.5,dark:2,steel:.5,fairy:.5},
  rock:{fire:2,ice:2,fighting:.5,ground:.5,flying:2,bug:2,poison:2,steel:.5},
  ghost:{normal:0,psychic:2,ghost:2,dark:.5}, dragon:{dragon:2,steel:.5,fairy:0},
  dark:{fighting:.5,psychic:2,bug:.5,ghost:2,dark:.5,fairy:.5},
  steel:{fire:.5,water:.5,electric:.5,ice:2,rock:2,steel:.5,fairy:2},
  fairy:{fire:.5,fighting:2,poison:.5,dragon:2,dark:2,steel:.5}
};
function getEffectiveness(atkType, defTypes) {
  let mult = 1;
  defTypes.forEach(t => { if(TYPE_CHART[atkType] && TYPE_CHART[atkType][t] !== undefined) mult *= TYPE_CHART[atkType][t]; });
  return mult;
}
// Pokemon type assignments (by dex ID) — copre claw pool, starter evo, e negozio leggendari
const POKE_TYPES = {
  4:['fire'],5:['fire'],6:['fire','flying'],
  7:['water'],8:['water'],9:['water'],
  10:['bug'],11:['bug'],12:['bug','flying'],
  13:['bug','poison'],14:['bug','poison'],15:['bug','poison'],
  16:['normal','flying'],17:['normal','flying'],18:['normal','flying'],
  19:['normal'],20:['normal'],
  21:['normal','flying'],22:['normal','flying'],
  23:['poison'],24:['poison'],
  25:['electric'],26:['electric'],
  27:['ground'],28:['ground'],
  29:['poison'],30:['poison'],31:['poison','ground'],
  32:['poison'],33:['poison'],34:['poison','ground'],
  35:['fairy'],36:['fairy'],
  37:['fire'],38:['fire'],
  39:['normal','fairy'],40:['normal','fairy'],
  41:['poison','flying'],42:['poison','flying'],
  43:['grass','poison'],44:['grass','poison'],45:['grass','poison'],
  46:['bug','grass'],47:['bug','grass'],
  52:['dark'],53:['dark'],
  54:['water'],55:['water'],
  56:['fighting'],57:['fighting'],
  58:['fire'],59:['fire'],
  60:['water'],61:['water'],62:['water','fighting'],
  63:['psychic'],64:['psychic'],65:['psychic'],
  66:['fighting'],67:['fighting'],68:['fighting'],
  69:['grass','poison'],70:['grass','poison'],71:['grass','poison'],
  72:['water','poison'],73:['water','poison'],
  74:['rock','ground'],75:['rock','ground'],76:['rock','ground'],
  77:['fire'],78:['fire'],
  79:['water','psychic'],80:['water','psychic'],
  81:['electric','steel'],82:['electric','steel'],
  83:['normal','flying'],84:['normal','flying'],85:['normal','flying'],
  86:['water'],87:['water','ice'],
  88:['poison'],89:['poison'],
  90:['water'],91:['water','ice'],
  92:['ghost','poison'],93:['ghost','poison'],94:['ghost','poison'],
  95:['rock','ground'],
  96:['psychic'],97:['psychic'],
  98:['water'],99:['water'],
  100:['electric'],101:['electric'],
  102:['grass','psychic'],103:['grass','psychic'],
  104:['ground'],105:['ground'],
  106:['fighting'],107:['fighting'],
  108:['normal'],
  111:['ground','rock'],112:['ground','rock'],
  113:['normal'],
  114:['grass'],
  115:['normal'],
  116:['water'],117:['water'],118:['water'],119:['water'],
  120:['water'],121:['water','psychic'],
  122:['psychic','fairy'],
  123:['bug','flying'],
  124:['ice','psychic'],125:['electric'],126:['fire'],
  127:['bug'],
  128:['normal'],
  129:['water'],130:['water','flying'],
  131:['water','ice'],
  132:['normal'],
  133:['normal'],
  134:['water'],135:['electric'],136:['fire'],137:['normal'],
  138:['rock','water'],139:['rock','water'],
  140:['rock','water'],141:['rock','water'],
  142:['rock','flying'],
  143:['normal'],
  144:['ice','flying'],145:['electric','flying'],146:['fire','flying'],
  147:['dragon'],148:['dragon'],149:['dragon','flying'],
  150:['psychic'],151:['psychic'],
  152:['grass'],153:['grass'],154:['grass'],
  155:['fire'],156:['fire'],157:['fire'],
  158:['water'],159:['water'],160:['water'],
  161:['normal'],162:['normal'],
  163:['normal','flying'],164:['normal','flying'],
  165:['bug','flying'],166:['bug','flying'],
  167:['bug','poison'],168:['bug','poison'],
  169:['poison','flying'],
  170:['water','electric'],171:['water','electric'],
  172:['electric'],
  173:['fairy'],
  174:['normal','fairy'],
  175:['fairy'],176:['fairy','flying'],
  177:['psychic','flying'],178:['psychic','flying'],
  179:['electric'],180:['electric'],181:['electric'],
  182:['grass'],
  183:['water','fairy'],184:['water','fairy'],
  185:['rock'],
  186:['water'],
  187:['grass','flying'],188:['grass','flying'],189:['grass','flying'],
  190:['normal'],
  191:['grass'],192:['grass'],
  193:['bug','flying'],
  194:['water','ground'],195:['water','ground'],
  196:['psychic'],197:['dark'],
  198:['dark','flying'],199:['water','psychic'],
  200:['ghost'],
  201:['psychic'],
  202:['psychic'],
  203:['normal','psychic'],
  204:['bug'],205:['bug','steel'],
  206:['normal'],
  207:['ground','flying'],
  208:['steel','ground'],
  209:['fairy'],210:['fairy'],
  211:['water','poison'],
  212:['bug','steel'],
  213:['bug','rock'],
  214:['bug','fighting'],
  215:['dark','ice'],
  216:['normal'],217:['normal'],
  218:['fire'],219:['fire'],
  220:['ice','ground'],221:['ice','ground'],
  222:['water','rock'],
  223:['water'],224:['water'],
  225:['ice','flying'],
  226:['water','flying'],
  227:['steel','flying'],
  228:['dark','fire'],229:['dark','fire'],
  230:['water','dragon'],
  231:['ground'],232:['ground'],
  233:['normal'],
  234:['normal'],
  235:['normal'],
  236:['fighting'],
  237:['fighting'],
  238:['ice','psychic'],
  239:['electric'],
  240:['fire'],
  241:['normal'],
  242:['normal'],
  243:['electric'],244:['fire'],245:['water'],
  246:['rock','ground'],247:['rock','ground'],248:['rock','dark'],
  249:['psychic','flying'],250:['fire','flying'],251:['psychic','grass'],
  252:['grass'],253:['grass'],254:['grass'],
  255:['fire'],256:['fire','fighting'],257:['fire','fighting'],
  258:['water'],259:['water','ground'],260:['water','ground'],
  261:['dark'],262:['dark'],
  263:['normal'],264:['normal'],
  265:['bug'],266:['bug'],267:['bug','flying'],
  268:['bug'],269:['bug','poison'],
  270:['water','grass'],271:['water','grass'],272:['water','grass'],
  273:['grass'],274:['grass','dark'],275:['grass','dark'],
  276:['normal','flying'],277:['normal','flying'],
  278:['water','flying'],279:['water','flying'],
  280:['psychic'],281:['psychic'],282:['psychic'],
  283:['bug','water'],284:['bug','flying'],
  285:['grass'],286:['grass','fighting'],
  287:['normal'],288:['normal'],289:['normal'],
  290:['bug','ground'],291:['bug','flying'],292:['bug','ghost'],
  293:['normal'],294:['normal'],295:['normal'],
  296:['fighting'],297:['fighting'],
  298:['normal','fairy'],
  299:['rock'],
  300:['normal'],301:['normal'],
  302:['dark','ghost'],
  303:['steel','fairy'],
  304:['steel','rock'],305:['steel','rock'],306:['steel','rock'],
  307:['fighting','psychic'],308:['fighting','psychic'],
  309:['electric'],310:['electric'],
  311:['electric'],312:['electric'],
  313:['bug'],314:['bug'],
  315:['grass','poison'],
  316:['poison'],317:['poison'],
  318:['water','dark'],319:['water','dark'],
  320:['water'],321:['water'],
  322:['fire','ground'],323:['fire','ground'],
  324:['fire'],
  325:['psychic'],326:['psychic'],
  327:['normal'],
  328:['ground'],329:['ground','dragon'],330:['ground','dragon'],
  331:['grass'],332:['grass','dark'],
  333:['normal','flying'],334:['dragon','flying'],
  335:['normal'],
  336:['poison'],
  337:['rock','psychic'],338:['rock','psychic'],
  339:['water','ground'],340:['water','ground'],
  341:['water'],342:['water','dark'],
  343:['ground','psychic'],344:['ground','psychic'],
  345:['rock','grass'],346:['rock','grass'],
  347:['rock','bug'],348:['rock','bug'],
  349:['water'],350:['water'],
  351:['normal'],
  352:['normal'],
  353:['ghost'],354:['ghost'],
  355:['ghost'],356:['ghost'],
  357:['grass','flying'],
  358:['psychic','flying'],
  359:['dark'],
  360:['psychic'],
  361:['ice'],362:['ice'],
  363:['ice','water'],364:['ice','water'],365:['ice','water'],
  366:['water'],367:['water'],368:['water'],
  369:['water','rock'],
  370:['water'],
  371:['dragon'],372:['dragon'],373:['dragon','flying'],
  374:['steel','psychic'],375:['steel','psychic'],376:['steel','psychic'],
  377:['rock'],378:['ice'],379:['steel'],
  380:['dragon','psychic'],381:['dragon','psychic'],
  382:['water'],383:['ground'],384:['dragon','flying'],
  385:['steel','psychic'],386:['psychic'],
  387:['grass'],388:['grass'],389:['grass'],
  390:['fire'],391:['fire','fighting'],392:['fire','fighting'],
  393:['water'],394:['water'],395:['water'],
  396:['normal','flying'],397:['normal','flying'],398:['normal','flying'],
  399:['normal'],400:['normal'],
  401:['bug'],402:['bug'],
  403:['electric'],404:['electric'],405:['electric'],
  406:['grass','poison'],407:['grass','poison'],
  408:['rock'],409:['rock'],
  410:['rock','steel'],411:['rock','steel'],
  412:['bug'],413:['bug'],
  414:['bug','flying'],
  415:['bug','flying'],416:['bug','flying'],
  417:['electric'],
  418:['water'],419:['water'],
  420:['grass'],421:['grass'],
  422:['water'],423:['water','ground'],
  424:['normal'],
  425:['ghost','flying'],426:['ghost','flying'],
  427:['normal'],428:['normal'],
  429:['ghost'],
  430:['dark','flying'],
  431:['normal'],432:['normal'],
  433:['psychic'],
  434:['poison','dark'],435:['poison','dark'],
  436:['steel','psychic'],437:['steel','psychic'],
  438:['rock'],
  439:['psychic','fairy'],
  440:['normal'],
  441:['normal','flying'],
  442:['ghost','dark'],
  443:['dragon','ground'],444:['dragon','ground'],445:['dragon','ground'],
  446:['normal'],
  447:['fighting'],448:['fighting','steel'],
  449:['ground'],450:['ground'],
  451:['poison','bug'],452:['poison','dark'],
  453:['poison','fighting'],454:['poison','fighting'],
  455:['grass'],
  456:['water'],457:['water'],
  458:['water','flying'],
  459:['grass','ice'],460:['grass','ice'],
  461:['dark','ice'],
  462:['electric','steel'],
  463:['normal'],
  464:['ground','rock'],
  465:['grass'],
  466:['electric'],
  467:['fire'],
  468:['fairy','flying'],
  469:['bug','flying'],
  470:['grass'],471:['ice'],
  472:['ground','flying'],
  473:['ice','ground'],
  474:['normal'],
  475:['psychic','fighting'],
  476:['rock','steel'],
  477:['ghost'],
  478:['ice','ghost'],
  479:['electric','ghost'],
  480:['psychic'],481:['psychic'],482:['psychic'],
  483:['steel','dragon'],484:['water','dragon'],
  485:['fire','steel'],
  486:['normal'],
  487:['ghost','dragon'],
  488:['psychic'],
  489:['water'],490:['water'],
  491:['dark'],492:['grass'],493:['normal'],
  494:['psychic','fire'],
  495:['grass'],496:['grass'],497:['grass'],
  498:['fire'],499:['fire','fighting'],500:['fire','fighting'],
  501:['water'],502:['water'],503:['water'],
  504:['normal'],505:['normal'],
  506:['normal'],507:['normal'],508:['normal'],
  509:['dark'],510:['dark'],
  511:['grass'],512:['grass'],513:['fire'],514:['fire'],515:['water'],516:['water'],
  517:['psychic'],518:['psychic'],
  519:['normal','flying'],520:['normal','flying'],521:['normal','flying'],
  522:['electric'],523:['electric'],
  524:['rock'],525:['rock'],526:['rock'],
  527:['psychic','flying'],528:['psychic','flying'],
  529:['ground'],530:['ground','steel'],
  531:['normal'],
  532:['fighting'],533:['fighting'],534:['fighting'],
  535:['water'],536:['water','ground'],537:['water','ground'],
  538:['fighting'],539:['fighting'],
  540:['bug','grass'],541:['bug','grass'],542:['bug','grass'],
  543:['bug','poison'],544:['bug','poison'],545:['bug','poison'],
  546:['grass','fairy'],547:['grass','fairy'],
  548:['grass'],549:['grass'],
  550:['water'],
  551:['ground','dark'],552:['ground','dark'],553:['ground','dark'],
  554:['fire'],555:['fire'],
  556:['grass'],
  557:['bug','rock'],558:['bug','rock'],
  559:['dark','fighting'],560:['dark','fighting'],
  561:['psychic','flying'],
  562:['ghost'],563:['ghost'],
  564:['water','rock'],565:['water','rock'],
  566:['rock','flying'],567:['rock','flying'],
  568:['poison'],569:['poison'],
  570:['dark'],571:['dark'],
  572:['normal'],573:['normal'],
  574:['psychic'],575:['psychic'],576:['psychic'],
  577:['psychic'],578:['psychic'],579:['psychic'],
  580:['water','flying'],581:['water','flying'],
  582:['ice'],583:['ice'],584:['ice'],
  585:['normal','grass'],586:['normal','grass'],
  587:['electric','flying'],588:['bug'],589:['bug','steel'],
  590:['grass','poison'],591:['grass','poison'],
  592:['water','ghost'],593:['water','ghost'],
  594:['water'],
  595:['bug','electric'],596:['bug','electric'],
  597:['grass','steel'],598:['grass','steel'],
  599:['steel'],600:['steel'],601:['steel'],
  602:['electric'],603:['electric'],604:['electric'],
  605:['psychic'],606:['psychic'],
  607:['fire','ghost'],608:['fire','ghost'],609:['fire','ghost'],
  610:['dragon'],611:['dragon'],612:['dragon'],
  613:['ice'],614:['ice'],
  615:['ice'],
  616:['bug'],617:['bug'],
  618:['ground','electric'],
  619:['fighting'],620:['fighting'],
  621:['dragon'],
  622:['ground','ghost'],623:['ground','ghost'],
  624:['dark','steel'],625:['dark','steel'],
  626:['normal'],
  627:['normal','flying'],628:['normal','flying'],
  629:['dark','flying'],630:['dark','flying'],
  631:['fire'],
  632:['bug','steel'],
  633:['dark','dragon'],634:['dark','dragon'],635:['dark','dragon'],
  636:['bug','fire'],637:['bug','fire'],
  638:['steel','fighting'],639:['rock','fighting'],640:['grass','fighting'],
  641:['flying'],642:['electric','flying'],
  643:['dragon','fire'],644:['dragon','electric'],
  645:['ground','flying'],
  646:['dragon','ice'],
  647:['water','fighting'],
  648:['normal','psychic'],
  649:['bug','steel'],
  650:['grass'],651:['grass'],652:['grass'],
  653:['fire'],654:['fire'],655:['fire'],
  656:['water'],657:['water'],658:['water'],
  659:['normal'],660:['normal'],
  661:['normal','flying'],662:['normal','flying'],663:['normal','flying'],
  664:['bug'],665:['bug'],666:['bug','flying'],
  667:['fire','normal'],668:['fire','normal'],
  669:['fairy'],670:['fairy'],
  671:['fairy'],
  672:['grass'],673:['grass'],
  674:['fighting'],675:['fighting'],
  676:['normal'],
  677:['psychic'],678:['psychic'],
  679:['steel','ghost'],680:['steel','ghost'],681:['steel','ghost'],
  682:['fairy'],683:['fairy'],
  684:['fairy'],685:['fairy'],
  686:['dark','psychic'],687:['dark','psychic'],
  688:['water','rock'],689:['water','rock'],
  690:['poison','water'],691:['poison','dragon'],
  692:['water'],693:['water'],
  694:['electric','normal'],695:['electric','normal'],
  696:['rock','dragon'],697:['rock','dragon'],
  698:['rock','ice'],699:['rock','ice'],
  700:['fairy'],
  701:['fighting','flying'],
  702:['electric','fairy'],
  703:['rock','fairy'],
  704:['dragon'],705:['dragon'],706:['dragon'],
  707:['steel','fairy'],
  708:['ghost','grass'],709:['ghost','grass'],
  710:['ghost','grass'],711:['ghost','grass'],
  712:['ice'],713:['ice'],
  714:['flying','dragon'],715:['flying','dragon'],
  716:['fairy'],717:['dark','flying'],718:['dragon','ground'],
  719:['rock','fairy'],720:['psychic','ghost'],721:['fire','water'],
  722:['grass','flying'],723:['grass','flying'],724:['grass','ghost'],
  725:['fire'],726:['fire'],727:['fire','dark'],
  728:['water'],729:['water'],730:['water','fairy'],
  731:['normal','flying'],732:['normal','flying'],733:['normal','flying'],
  734:['normal'],735:['normal'],
  736:['bug'],737:['bug','electric'],738:['bug','electric'],
  739:['fighting'],740:['fighting'],
  741:['fire','flying'],
  742:['bug','fairy'],743:['bug','fairy'],
  744:['rock'],745:['rock'],
  746:['water'],
  747:['poison','water'],748:['poison','water'],
  749:['ground'],750:['ground'],
  751:['water','bug'],752:['water','bug'],
  753:['grass'],754:['grass'],
  755:['grass','fairy'],756:['grass','fairy'],
  757:['poison','fire'],758:['poison','fire'],
  759:['fighting','normal'],760:['fighting','normal'],
  761:['grass'],762:['grass'],763:['grass'],
  764:['fairy'],
  765:['normal','psychic'],
  766:['fighting'],
  767:['water','bug'],768:['water','bug'],
  769:['ghost','ground'],770:['ghost','ground'],
  771:['water'],
  772:['normal'],773:['normal'],
  774:['rock','flying'],
  775:['normal'],
  776:['fire','dragon'],
  777:['electric','steel'],
  778:['ghost','fairy'],
  779:['water','psychic'],
  780:['normal','dragon'],
  781:['ghost','grass'],
  782:['dragon'],783:['dragon','fighting'],784:['dragon','fighting'],
  785:['electric','fairy'],786:['psychic','fairy'],
  787:['grass','fairy'],788:['water','fairy'],
  789:['psychic'],790:['psychic'],791:['psychic','steel'],
  792:['psychic','ghost'],
  793:['rock','poison'],
  794:['bug','fighting'],
  795:['bug','fighting'],
  796:['electric'],
  797:['steel','flying'],
  798:['grass','steel'],
  799:['dark','dragon'],
  800:['psychic'],
  801:['steel','fairy'],
  802:['fighting','ghost'],
  803:['poison'],804:['poison','dragon'],
  805:['rock','steel'],806:['fire','ghost'],
  807:['electric'],
  808:['electric','steel'],809:['electric','steel'],
  810:['grass'],811:['grass'],812:['grass'],
  813:['fire'],814:['fire'],815:['fire'],
  816:['water'],817:['water'],818:['water'],
  819:['normal'],820:['normal'],
  821:['flying'],822:['flying'],823:['flying','steel'],
  824:['bug'],825:['bug','psychic'],826:['bug','psychic'],
  827:['dark'],828:['dark'],
  829:['grass'],830:['grass'],
  831:['normal'],832:['normal'],
  833:['water'],834:['water','rock'],
  835:['electric'],836:['electric'],
  837:['rock'],838:['rock'],839:['rock'],
  840:['grass','dragon'],841:['grass','dragon'],842:['grass','dragon'],
  843:['ground'],844:['ground'],
  845:['flying','water'],
  846:['water'],847:['water','physical'],
  848:['electric','poison'],849:['electric','poison'],
  850:['fire','bug'],851:['fire','bug'],
  852:['fighting'],853:['fighting'],
  854:['psychic'],855:['psychic'],
  856:['psychic'],857:['psychic'],858:['psychic','fairy'],
  859:['dark','fairy'],860:['dark','fairy'],861:['dark','fairy'],
  862:['dark','normal'],
  863:['steel'],
  864:['ghost'],
  865:['fighting'],
  866:['ice','psychic'],
  867:['ground','ghost'],
  868:['fairy'],869:['fairy'],
  870:['fighting'],
  871:['electric'],
  872:['ice','bug'],873:['ice','bug'],
  874:['rock'],875:['ice'],
  876:['psychic','normal'],
  877:['electric','dark'],
  878:['steel'],879:['steel'],
  880:['electric','dragon'],881:['electric','dragon'],
  882:['water','dragon'],883:['water','dragon'],
  884:['steel','dragon'],
  885:['dragon','ghost'],886:['dragon','ghost'],887:['dragon','ghost'],
  888:['fairy'],889:['fighting'],
  890:['poison','dragon'],
  891:['fighting'],892:['fighting','dark'],
  893:['dark','grass'],
  894:['electric'],895:['dragon'],
  896:['ice'],897:['ghost'],
  898:['psychic','grass'],
};
const MOVE_POOL = {
  normal:[{n:'Ultraballata',p:40,acc:100,cat:'physical'},{n:'Taglio',p:50,acc:95,cat:'physical'},{n:'Rapata',p:80,acc:100,cat:'physical'},{n:'Colpo',p:70,acc:100,cat:'physical'}],
  fire:[{n:'Braciere',p:40,acc:100,cat:'special'},{n:'Lanciafiamme',p:90,acc:100,cat:'special'},{n:'Fuocobomba',p:110,acc:85,cat:'special'},{n:'Lanciafiamme',p:90,acc:100,cat:'special'}],
  water:[{n:'Pistolacqua',p:40,acc:100,cat:'special'},{n:'Idropompa',p:110,acc:80,cat:'special'},{n:'Cascata',p:80,acc:100,cat:'physical'},{n:'Surf',p:90,acc:100,cat:'special'}],
  electric:[{n:'Tuonoshock',p:40,acc:100,cat:'special'},{n:'Fulmine',p:90,acc:100,cat:'special'},{n:'Tuono',p:110,acc:70,cat:'special'},{n:'Scintilla',p:65,acc:100,cat:'physical'}],
  grass:[{n:'Foglielama',p:55,acc:95,cat:'physical'},{n:'Energipalla',p:90,acc:100,cat:'special'},{n:'Solarraggio',p:120,acc:100,cat:'special'},{n:'Semebomba',p:80,acc:100,cat:'physical'}],
  ice:[{n:'Geloraggio',p:90,acc:100,cat:'special'},{n:'Bora',p:110,acc:70,cat:'special'},{n:'Gelocolpo',p:75,acc:100,cat:'physical'},{n:'Ventogelato',p:55,acc:95,cat:'special'}],
  fighting:[{n:'Botta',p:40,acc:100,cat:'physical'},{n:'Calcio',p:60,acc:100,cat:'physical'},{n:'Tuonopugno',p:75,acc:100,cat:'physical'},{n:'Psicoshock',p:80,acc:100,cat:'physical'}],
  poison:[{n:'Lattoveleno',p:65,acc:100,cat:'physical'},{n:'Fangobomba',p:90,acc:100,cat:'special'},{n:'Velenpuntura',p:15,acc:100,cat:'physical'},{n:'Acidobomba',p:40,acc:100,cat:'special'}],
  ground:[{n:'Fossa',p:80,acc:100,cat:'physical'},{n:'Terremoto',p:100,acc:100,cat:'physical'},{n:'Rimbalzo',p:85,acc:95,cat:'physical'},{n:'Battiterra',p:60,acc:100,cat:'special'}],
  flying:[{n:'Aeroassalto',p:60,acc:100,cat:'physical'},{n:'Raffica',p:40,acc:100,cat:'special'},{n:'Divinazione',p:80,acc:100,cat:'physical'},{n:'Baldeali',p:120,acc:90,cat:'physical'}],
  psychic:[{n:'Confusione',p:50,acc:100,cat:'special'},{n:'Psichico',p:90,acc:100,cat:'special'},{n:'Psichicoshock',p:80,acc:100,cat:'special'},{n:'Fotocopiatura',p:70,acc:100,cat:'physical'}],
  bug:[{n:'Pugnalantena',p:60,acc:100,cat:'physical'},{n:'Morso',p:60,acc:100,cat:'physical'},{n:'Coleomorso',p:90,acc:100,cat:'physical'},{n:'Signalspecchio',p:75,acc:100,cat:'special'}],
  rock:[{n:'Frantumi',p:40,acc:100,cat:'physical'},{n:'Cadutamassi',p:75,acc:90,cat:'physical'},{n:'Rocciotomba',p:60,acc:95,cat:'physical'},{n:'Cascata',p:80,acc:100,cat:'special'}],
  ghost:[{n:'Ombrafitta',p:40,acc:100,cat:'physical'},{n:'Sferombra',p:80,acc:100,cat:'special'},{n:'Pugnodombra',p:60,acc:100,cat:'physical'},{n:'Lamaombra',p:70,acc:100,cat:'special'}],
  dragon:[{n:'Dragobreat',p:60,acc:100,cat:'special'},{n:'Dragopulsar',p:85,acc:100,cat:'special'},{n:'Dragartigli',p:80,acc:100,cat:'physical'},{n:'Comete',p:120,acc:90,cat:'special'}],
  dark:[{n:'Sgranocchio',p:80,acc:100,cat:'physical'},{n:'Sfuriate',p:15,acc:85,cat:'physical'},{n:'Neropulsar',p:80,acc:100,cat:'special'},{n:'Furtivombra',p:70,acc:100,cat:'physical'}],
  steel:[{n:'Laminacciaio',p:50,acc:100,cat:'physical'},{n:'Stellicida',p:100,acc:100,cat:'special'},{n:'Codacciaio',p:100,acc:75,cat:'physical'},{n:'Metaltestata',p:80,acc:100,cat:'physical'}],
  fairy:[{n:'Magichicco',p:70,acc:100,cat:'special'},{n:'Dolcebacio',p:50,acc:100,cat:'physical'},{n:'Bagliorfata',p:80,acc:100,cat:'special'},{n:'Sferafata',p:90,acc:100,cat:'physical'}],
};
function getMovesForTypes(types) {
  let moves = [];
  types.forEach(t => {
    if(MOVE_POOL[t]) { MOVE_POOL[t].forEach(m => moves.push({...m, t: t})); }
  });
  // Shuffle and pick 4
  for(let i=moves.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[moves[i],moves[j]]=[moves[j],moves[i]];}
  if(moves.length>4) moves=moves.slice(0,4);
  while(moves.length<4) moves.push({n:'Azione',p:50,acc:100,cat:'physical'});
  moves.forEach(m => { m.pp = 10; m.maxPp = 10; });
  return moves;
}
function getBST(stage,isLegendary) {
  if(isLegendary) return 600;
  return stage>=2?500:stage>=1?380:280;
}
function generatePokeStats(species, img, types, stage, isLegend) {
  const bst = getBST(stage, isLegend);
  const hp = Math.round(bst*0.25+15+Math.random()*20);
  const atk = Math.round(bst*0.18+10+Math.random()*15);
  const def = Math.round(bst*0.18+10+Math.random()*15);
  const spa = Math.round(bst*0.18+10+Math.random()*15);
  const spd = Math.round(bst*0.18+10+Math.random()*15);
  const spe = Math.round(bst*0.12+10+Math.random()*15);
  const moves = getMovesForTypes(types);
  return { species, img, types, stats:{hp,atk,def,spa,spd,spe}, maxHp:hp, currentHp:hp, status:null, moves, boosts:{atk:0,def:0,spa:0,spd:0,spe:0}, fainted:false };
}
const battles = {};
let battleIdCounter = 0;
function battleDamage(attacker, defender, move) {
  const isSpecial = move.cat === 'special';
  const atkStat = isSpecial ? attacker.stats.spa : attacker.stats.atk;
  const defStat = isSpecial ? defender.stats.spd : defender.stats.def;
  const atkBoost = attacker.boosts[isSpecial?'spa':'atk'];
  const defBoost = defender.boosts[isSpecial?'spd':'def'];
  const atkEff = atkBoost>=0?((atkBoost+2)/2):(2/(Math.abs(atkBoost)+2));
  const defEff = defBoost>=0?((defBoost+2)/2):(2/(Math.abs(defBoost)+2));
  const effAtk = atkStat * atkEff;
  const effDef = defStat * defEff;
  const level = 25;
  const base = ((2*level/5+2)*move.p*effAtk/effDef)/50+2;
  const stab = attacker.types.includes(move.t)?1.5:1;
  const effectiveness = getEffectiveness(move.t, defender.types);
  const random = 0.85 + Math.random()*0.15;
  const damage = Math.round(base * stab * effectiveness * random);
  return Math.max(1, damage);
}
function battleTurn(battleId, playerIdx, action) {
  const b = battles[battleId]; if(!b) return;
  if(b.state !== 'playing' || b.turnPlayer !== playerIdx) return;
  const p = b.players[playerIdx], o = b.players[1-playerIdx];
  const pPoke = p.team[p.currentPoke], oPoke = o.team[o.currentPoke];
  if(action.type === 'move') {
    if(!pPoke||pPoke.fainted) return;
    const move = pPoke.moves[action.index];
    if(!move||move.pp<=0) return;
    move.pp--;
    const dmg = battleDamage(pPoke, oPoke, move);
    oPoke.currentHp = Math.max(0, oPoke.currentHp - dmg);
    const eff = getEffectiveness(move.t, oPoke.types);
    let msg = `${p.nick} usa ${move.n}!`;
    if(eff>1) msg += ' [SUPEREFFICACE!]';
    else if(eff<1&&eff>0) msg += ' [Poco efficace...]';
    else if(eff===0) msg += ' [Nessun effetto!]';
    msg += ` (${dmg} danni)`;
    const killed = oPoke.currentHp <= 0;
    if(killed) { oPoke.fainted = true; msg += ` | ${oPoke.species} è esausto!`; }
    b.log.push(msg);
    p.lastMove = action.type;
    if(killed) {
      // Check if opponent has remaining Pokemon
      const aliveIdx = o.team.findIndex(pk=>!pk.fainted);
      if(aliveIdx === -1) { b.state = 'ended'; b.winner = p.id; return; }
      // Auto-switch to first alive Pokemon (come nei giochi ufficiali)
      const oldName = oPoke.species;
      o.currentPoke = aliveIdx;
      b.log.push(`${o.nick} manda ${o.team[aliveIdx].species}!`);
    }
    b.turnPlayer = 1 - playerIdx;
    b.lastAction = action;
  } else if(action.type === 'switch') {
    const idx = action.index;
    if(idx === p.currentPoke || idx<0 || idx>=p.team.length) return;
    const target = p.team[idx];
    if(!target||target.fainted) return;
    const oldName = pPoke ? pPoke.species : 'nessuno';
    p.currentPoke = idx;
    b.log.push(`${p.nick} richiama ${oldName} e manda ${target.species}!`);
    b.turnPlayer = 1 - playerIdx;
    p.lastMove = action.type;
  }
}

io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  console.log(`[${new Date().toLocaleTimeString()}] Connesso: ${socket.id} — IP: ${ip}`);

  socket.on('join lobby', ({ nick, avatar, token, pin }) => {
    // === VERIFICA PIN (se il nickname è protetto) ===
    const existingAuth = nickAuth[nick];
    if (existingAuth) {
      if (!pin || existingAuth.pin !== pin) {
        return socket.emit('lobby:pinRequired', { msg: 'Questo nickname è protetto da PIN. Inserisci il PIN per accedere.' });
      }
      // PIN corretto → sincronizza i dati sul token corrente
      const srcToken = existingAuth.token;
      if (srcToken && srcToken !== token) {
        let srcData = dataByToken[srcToken];
        // Fallback: se dataByToken è vuoto (es. Render restart), usa nickData
        if (!srcData && nickData[nick]) srcData = nickData[nick];
        if (srcData) {
          dataByToken[token] = { ...srcData };
          dataByToken[srcToken] = { ...srcData };
        }
      }
      existingAuth.token = token;
    }

    users[socket.id] = { id: socket.id, nick, avatar, ip };
    console.log(`[${new Date().toLocaleTimeString()}] ${nick} è entrato — IP: ${ip}`);

    // === PERSISTENZA: ripristina da nickData (by nickname, robusto contro token persi) ===
    const nd = nickData[nick];
    if (nd) {
      if (nd.casinoBal != null) casinoBals[socket.id] = nd.casinoBal;
      if (nd.casinoEarnings != null) casinoEarnings[socket.id] = nd.casinoEarnings;
      if (nd.pokemon) { pokemonData[socket.id] = nd.pokemon; migratePokemonData(pokemonData[socket.id]); }
      if (nd.clawCounter != null) clawCounters[socket.id] = nd.clawCounter;
      console.log(`[Server] ${nick} riconnesso da nickData — €${nd.casinoBal}`);
    }
    // Aggiorna dataByToken per compatibilità MongoDB
    if (token) {
      tokenForSocket[socket.id] = token;
      if (!dataByToken[token]) dataByToken[token] = {};
      dataByToken[token].nick = nick;
      dataByToken[token].avatar = avatar;
    }
    if (pin && !existingAuth) nickAuth[nick] = { pin, token: token || '' };

    // Migrate old clawPoke format
    if (pokemonData[socket.id]) migratePokemonData(pokemonData[socket.id]);
    socket.emit('pokemon:status', { hasPokemon: !!pokemonData[socket.id] });
    // Invia il saldo corretto (sovrascrive il valore iniziale di 10000)
    socket.emit('casino:balance', getBal(socket.id));
    io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
    io.emit('queue update', queue);
    io.emit('chat message', {
      id: ++msgCounter,
      nick: 'Sistema',
      avatar: '💬',
      msg: `${nick} è entrato in lobby!`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      system: true,
      reactions: {},
    });

    // === BATTLE RECONNECTION ===
    Object.keys(battles).forEach(bid => {
      const b = battles[bid];
      const pIdx = b.players.findIndex(p => p.id !== socket.id && p.disconnected);
      if (pIdx !== -1 && b.players[pIdx].nick === nick) {
        // This is the returning player — restore their socket id
        clearTimeout(b.players[pIdx].discTimer);
        b.players[pIdx].id = socket.id;
        b.players[pIdx].disconnected = false;
        b.players[pIdx].discTimer = null;
        // Send current battle state to the reconnected player
        const myIdx = b.players.findIndex(p => p.id === socket.id);
        socket.emit('battle:start', {
          battleId: bid, myIdx: myIdx,
          players: b.players.map(p => ({ id: p.id, nick: p.nick, currentPoke: p.currentPoke,
            team: p.team.map(pk => ({ species:pk.species, img:pk.img, types:pk.types, stats:pk.stats, maxHp:pk.maxHp, currentHp:pk.currentHp, status:pk.status, moves:pk.moves }))
          })),
          turnPlayer: b.turnPlayer, log: b.log, state: b.state
        });
        // Notify opponent
        const other = b.players[1 - myIdx];
        if (other && !other.id.startsWith('bot_')) {
          io.to(other.id).emit('battle:opponentReconnect', { nick: nick });
        }
        console.log(`[Battle] ${nick} riconnesso alla battaglia ${bid}`);
      }
    });
  });

  socket.on('change nick', ({ nick }) => {
    const u = users[socket.id];
    if (!u || !nick || nick.trim().length < 2) return;
    const oldNick = u.nick;
    u.nick = nick.trim();
    if (pokemonData[socket.id]) pokemonData[socket.id].nick = nick;
    saveNickData(socket.id);
    // Trasferisci nickAuth al nuovo nickname
    if (nickAuth[oldNick]) {
      nickAuth[nick] = nickAuth[oldNick];
      delete nickAuth[oldNick];
    }
    socket.emit('nick changed', { nick: u.nick });
    io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
    io.emit('chat message', {
      id: ++msgCounter, nick: 'Sistema', avatar: '💬',
      msg: `${oldNick} ora si chiama ${nick}!`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      system: true, reactions: {},
    });
  });

  socket.on('account:setPin', ({ pin }) => {
    const u2 = users[socket.id];
    if (!u2 || !pin || pin.length < 1) return;
    const tok = tokenForSocket[socket.id];
    nickAuth[u2.nick] = { pin, token: tok };
    socket.emit('account:pinSet', { ok: true });
  });

  socket.on('account:checkPin', ({ nick }) => {
    socket.emit('account:pinStatus', { hasPin: !!nickAuth[nick] });
  });

  socket.on('chat message', (msg) => {
    const u = users[socket.id];
    if (!u) return;
    // /clearchat command
    if (msg === '/clearchat') {
      io.emit('chat:clear');
      io.emit('chat message', {
        id: ++msgCounter, nick: 'Sistema', avatar: '💬',
        msg: `${u.nick} ha ripulito la chat!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        system: true, reactions: {},
      });
      return;
    }
    // /save command — salva manualmente i dati del giocatore
    if (msg === '/save') {
      saveNickData(socket.id);
      saveData();
      socket.emit('chat message', {
        id: ++msgCounter, nick: 'Sistema', avatar: '💾',
        msg: `Dati di ${u.nick} salvati!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        system: true, reactions: {},
      });
      return;
    }
    // /money command (solo admin ERRJACE, silenzioso)
    const moneyMatch = msg.match(/^\/money\s+(\d+)$/i);
    if (moneyMatch && u.nick === 'ERRJACE') {
      const amount = parseInt(moneyMatch[1]);
      casinoBals[socket.id] = amount;
      saveNickData(socket.id);
      saveData();
      socket.emit('casino:balance', amount);
      return;
    }
    // /remove money <amount> — admin: mostra picker utenti lato client
    const removeMoneyMatch = msg.match(/^\/remove\s+money\s+(\d+)$/i);
    if (removeMoneyMatch && u.nick === 'ERRJACE') {
      const amount = parseInt(removeMoneyMatch[1]);
      const onlineList = Object.entries(users).filter(([sid, v]) => v.nick !== 'ERRJACE').map(([sid, v]) => ({ id: sid, nick: v.nick, avatar: v.avatar }));
      socket.emit('admin:removeMoneyList', { amount, users: onlineList });
      return;
    }
    // /bal — admin: mostra saldi di tutti gli utenti online
    if (msg === '/bal' && u.nick === 'ERRJACE') {
      const balList = Object.entries(users).map(([sid, v]) => ({ nick: v.nick, avatar: v.avatar, bal: getBal(sid) })).sort((a, b) => b.bal - a.bal);
      socket.emit('admin:balList', { users: balList });
      return;
    }
    // /release command (supporta nome o numero slot)
    const relMatch = msg.match(/^\/release\s+(.+)/i);
    if (relMatch) {
      const pd = pokemonData[socket.id];
      if (!pd || !pd.team || pd.team.length === 0) {
        socket.emit('chat message', { id: ++msgCounter, nick: 'Sistema', avatar: '💬', msg: 'Non hai Pokémon nel team da rilasciare!', time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system: true, reactions: {} });
        return;
      }
      const arg = relMatch[1].trim();
      let idx;
      const num = parseInt(arg);
      if (!isNaN(num) && num > 0 && num <= pd.team.length) {
        idx = num - 1;
      } else {
        idx = pd.team.findIndex(p => p.name.toLowerCase() === arg.toLowerCase());
      }
      if (idx === -1 || idx >= pd.team.length) {
        socket.emit('chat message', { id: ++msgCounter, nick: 'Sistema', avatar: '💬', msg: 'Pokémon non trovato! Usa /team per vedere la lista.', time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system: true, reactions: {} });
        return;
      }
      const released = pd.team.splice(idx, 1)[0];
      saveNickData(socket.id);
      io.emit('chat message', { id: ++msgCounter, nick: 'Sistema', avatar: '💬', msg: `${u.nick} ha rilasciato ${released.name}!`, time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system: true, reactions: {} });
      io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
      return;
    }
    // /team command
    if (msg === '/team') {
      const pd = pokemonData[socket.id];
      if (!pd || !pd.team) { socket.emit('chat message', { id: ++msgCounter, nick: 'Sistema', avatar: '💬', msg: 'Non hai ancora un Pokémon!', time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system: true, reactions: {} }); return; }
      let list = pd.team.map((p,i) => `#${i+1} ${p.name}${p.legendary?' 🌟':''}`).join(', ');
      let total = `Starter: ${pd.currentForm} | Team (${pd.team.length}/5): ${list || 'vuoto'}`;
      socket.emit('chat message', { id: ++msgCounter, nick: 'Sistema', avatar: '💬', msg: `📋 ${total}`, time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system: true, reactions: {} });
      return;
    }
    // /reset team — resetta starter e team Pokémon
    if (msg === '/reset team') {
      const pd = pokemonData[socket.id];
      if (!pd) {
        socket.emit('chat message', { id: ++msgCounter, nick: 'Sistema', avatar: '💬', msg: 'Non hai nessun Pokémon da resettare!', time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system: true, reactions: {} });
        return;
      }
      const oldStarter = pd.currentForm || pd.starter;
      delete pokemonData[socket.id];
      saveNickData(socket.id);
      socket.emit('pokemon:status', { hasPokemon: false });
      socket.emit('chat message', { id: ++msgCounter, nick: 'Sistema', avatar: '🔄', msg: `${u.nick} ha resettato il team! Arrivederci ${oldStarter}!`, time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system: true, reactions: {} });
      io.emit('users online', Object.values(users).map(u2 => ({...u2, pokemon: pokemonData[u2.id] || null })));
      return;
    }
    addPokeXP(socket.id, 2, 'chat');
    io.emit('chat message', {
      id: ++msgCounter,
      nick: u.nick,
      avatar: u.avatar,
      msg,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      reactions: {},
    });
  });

  socket.on('typing start', () => {
    const u = users[socket.id];
    if (!u) return;
    socket.broadcast.emit('typing start', u.nick);
  });

  socket.on('typing stop', () => {
    socket.broadcast.emit('typing stop');
  });

  socket.on('message react', ({ msgId, emoji }) => {
    if (!messageReactions[msgId]) messageReactions[msgId] = {};
    if (!messageReactions[msgId][emoji]) messageReactions[msgId][emoji] = 0;
    const u = users[socket.id];
    if (!u) return;
    const key = `${msgId}-${emoji}-${socket.id}`;
    if (socket.reactedKeys && socket.reactedKeys[key]) {
      messageReactions[msgId][emoji]--;
      delete socket.reactedKeys[key];
    } else {
      messageReactions[msgId][emoji]++;
      if (!socket.reactedKeys) socket.reactedKeys = {};
      socket.reactedKeys[key] = true;
    }
    io.emit('message reactions', { msgId, reactions: messageReactions[msgId] });
  });

  socket.on('music play', (data) => {
    const u = users[socket.id];
    data.addedBy = u ? u.nick : 'Qualcuno';
    queue.push(data);
    console.log(`[${new Date().toLocaleTimeString()}] Musica: ${data.addedBy} ha aggiunto "${data.title}"`);
    io.emit('music play', data);
    io.emit('queue update', queue);
  });

  socket.on('music pause', () => {
    io.emit('music pause');
  });

  socket.on('music resume', () => {
    io.emit('music resume');
  });

  socket.on('music stop', () => {
    io.emit('music stop');
  });

  socket.on('music ended', () => {
    queue.shift();
    io.emit('queue update', queue);
    if (queue.length > 0) {
      io.emit('music play', queue[0]);
    } else {
      io.emit('music stop');
    }
  });

  socket.on('queue remove', (index) => {
    const u = users[socket.id];
    if (!u) return;
    if (index >= 0 && index < queue.length) {
      queue.splice(index, 1);
      io.emit('queue update', queue);
    }
  });

  // DAMA Game events
  socket.on('game challenge', ({ to }) => {
    const fromUser = users[socket.id];
    if (!fromUser || !users[to]) return;
    io.to(to).emit('game challenge', { from: socket.id, nick: fromUser.nick });
  });

  socket.on('game accept', ({ from }) => {
    const u1 = users[from];
    const u2 = users[socket.id];
    if (!u1 || !u2) return;
    const gameId = 'game_' + (++gameIdCounter);
    const board = createBoard();
    const game = {
      id: gameId,
      player1: from,
      player2: socket.id,
      nick1: u1.nick,
      nick2: u2.nick,
      board,
      turn: from,
      status: 'playing',
      winner: null,
    };
    games[gameId] = game;
    const clients = [from, socket.id];
    clients.forEach(id => {
      io.to(id).emit('game start', game);
    });
    console.log(`[${new Date().toLocaleTimeString()}] Dama: ${u1.nick} vs ${u2.nick} iniziata`);
  });

  socket.on('game decline', ({ from }) => {
    const u = users[socket.id];
    if (u && users[from]) {
      io.to(from).emit('chat message', {
        id: ++msgCounter,
        nick: 'Sistema', avatar: '💬',
        msg: `${u.nick} ha rifiutato la sfida a Dama.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        system: true, reactions: {},
      });
    }
  });

  socket.on('game move', ({ gameId, from, to }) => {
    const game = games[gameId];
    if (!game || game.status !== 'playing') return;
    if (game.turn !== socket.id) return;
    const player = socket.id === game.player1 ? (1) : (2);
    const piece = game.board[from[0]][from[1]];
    if (player === 1 && piece !== 1 && piece !== 3) return;
    if (player === 2 && piece !== 2 && piece !== 4) return;
    if (!isValidGameMove(game.board, from, to, piece)) return;
    applyMove(game.board, from, to);
    game.turn = game.turn === game.player1 ? game.player2 : game.player1;
    const enemyPieces = getPlayerPieces(game.board, player === 1 ? 2 : 1);
    if (enemyPieces.length === 0) {
      game.status = 'won';
      game.winner = socket.id;
      addPokeXP(socket.id, 20, 'vittoria dama');
      const clients = [game.player1, game.player2];
      clients.forEach(id => io.to(id).emit('game state', game));
      clients.forEach(id => io.to(id).emit('game end', { reason: 'Vittoria!', winner: socket.id }));
      console.log(`[${new Date().toLocaleTimeString()}] Dama finita: ${users[socket.id]?.nick} ha vinto`);
      delete games[gameId];
      return;
    }
    const hasMoves = hasValidMoves(game.board, game.turn === game.player1 ? 1 : 2);
    if (!hasMoves) {
      game.status = 'won';
      game.winner = socket.id;
      addPokeXP(socket.id, 20, 'vittoria dama');
      const clients = [game.player1, game.player2];
      clients.forEach(id => io.to(id).emit('game state', game));
      clients.forEach(id => io.to(id).emit('game end', { reason: 'Vittoria!', winner: socket.id }));
      delete games[gameId];
      return;
    }
    addPokeXP(socket.id, 3, 'mossa dama');
    [game.player1, game.player2].forEach(id => io.to(id).emit('game state', game));
  });

  socket.on('game leave', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    const other = game.player1 === socket.id ? game.player2 : game.player1;
    io.to(other).emit('game end', { reason: 'Avversario ha lasciato la partita' });
    delete games[gameId];
  });

  // UNO Game events
  socket.on('uno:list', () => {
    const a = Object.values(unoGames).filter(g => g.status === 'waiting' && g.players.length < g.maxPlayers).map(g => ({ id: g.id, hostNick: g.players[0]?.nick || '?', playerCount: g.players.length, maxPlayers: g.maxPlayers }));
    socket.emit('uno:list', a);
  });

  socket.on('uno:create', ({ maxPlayers }) => {
    const u = users[socket.id]; if (!u) return;
    for (const gid in unoGames) { if (unoGames[gid].players.some(p => p.id === socket.id)) { socket.emit('uno:error', 'Già in una partita!'); return; } }
    const id = 'uno_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const game = { id, host: socket.id, status: 'waiting', players: [{id:socket.id,nick:u.nick,avatar:u.avatar,cards:[]}], maxPlayers: Math.max(2,Math.min(6,maxPlayers||4)), deck:[], discardPile:[], currentColor:'', direction:1, currentPlayerIndex:0, winner:null, lastAction:'', };
    unoGames[id] = game;
    socket.join(id);
    socket.emit('uno:joined', { gameId: id });
    socket.emit('uno:state', getUnoState(game, socket.id));
    console.log(`[${new Date().toLocaleTimeString()}] UNO: ${u.nick} ha creato ${id}`);
  });

  socket.on('uno:join', ({ gameId }) => {
    const u = users[socket.id]; if (!u) return;
    const game = unoGames[gameId]; if (!game) { socket.emit('uno:error','Partita non trovata'); return; }
    if (game.status !== 'waiting') { socket.emit('uno:error','Già iniziata'); return; }
    if (game.players.length >= game.maxPlayers) { socket.emit('uno:error','Partita piena'); return; }
    for (const gid in unoGames) { if (unoGames[gid].players.some(p => p.id === socket.id)) { socket.emit('uno:error','Già in una partita!'); return; } }
    game.players.push({id:socket.id,nick:u.nick,avatar:u.avatar,cards:[]});
    socket.join(gameId);
    socket.emit('uno:joined', { gameId });
    game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id)));
    io.to(gameId).emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`${u.nick} si è unito a UNO! (${game.players.length}/${game.maxPlayers})`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
  });

  socket.on('uno:start', ({ gameId }) => {
    const game = unoGames[gameId]; if (!game) return;
    if (game.host !== socket.id) { socket.emit('uno:error','Solo l\'host può iniziare'); return; }
    if (game.players.length < 2) { socket.emit('uno:error','Servono almeno 2 giocatori'); return; }
    const deck = shuffle(createUnoDeck());
    game.players.forEach(p => { p.cards = deck.splice(0, 7); });
    let ti = 0; while (ti < deck.length && deck[ti].c === 'wild') ti++;
    if (ti >= deck.length) game.discardPile.push(deck.pop());
    else game.discardPile.push(deck.splice(ti,1)[0]);
    game.deck = deck;
    game.status = 'playing'; game.currentPlayerIndex = 0; game.direction = 1;
    game.currentColor = game.discardPile[0].c; game.winner = null;
    game.lastAction = 'Partita iniziata!';
    game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id)));
    console.log(`[${new Date().toLocaleTimeString()}] UNO: ${gameId} iniziata (${game.players.length} giocatori)`);
  });

  socket.on('uno:playCard', ({ gameId, cardIndex, chosenColor }) => {
    const u = users[socket.id]; if (!u) return;
    const game = unoGames[gameId]; if (!game || game.status !== 'playing') return;
    const pIdx = game.players.findIndex(p => p.id === socket.id);
    if (pIdx === -1 || pIdx !== game.currentPlayerIndex) return;
    const player = game.players[pIdx];
    const card = player.cards[cardIndex]; if (!card) return;
    if (!canPlayUno(card, game.discardPile[game.discardPile.length-1], game.currentColor)) return;
    player.cards.splice(cardIndex, 1);
    game.discardPile.push(card);
    game.currentColor = card.c === 'wild' ? (chosenColor||'red') : card.c;
    let skip = false, draw = 0;
    if (card.v === 'skip') { skip = true; game.lastAction = `${u.nick} salta!`; }
    else if (card.v === 'reverse') { if (game.players.length === 2) skip = true; else game.direction *= -1; game.lastAction = `${u.nick} inverte!`; }
    else if (card.v === 'draw2') { draw = 2; skip = true; game.lastAction = `${u.nick} +2!`; }
    else if (card.v === 'wild4') { draw = 4; skip = true; game.lastAction = `${u.nick} +4!`; }
    else game.lastAction = `${u.nick} gioca ${card.v}`;
    addPokeXP(socket.id, 3, 'carta uno');
    if (player.cards.length === 0) {
      game.status = 'finished'; game.winner = socket.id;
      addPokeXP(socket.id, 50, 'vittoria uno');
      game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id)));
      io.to(gameId).emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`🎉 ${u.nick} ha vinto a UNO!`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
      delete unoGames[gameId]; return;
    }
    if (skip) advanceTurn(game);
    advanceTurn(game);
    if (draw > 0) {
      const np = game.players[game.currentPlayerIndex];
      if (game.deck.length < draw) { game.deck = shuffle(game.discardPile.slice(0,-1)); game.discardPile = [game.discardPile[game.discardPile.length-1]]; }
      for (let i = 0; i < draw && game.deck.length > 0; i++) np.cards.push(game.deck.pop());
      game.lastAction += ` ${np.nick} pesca ${draw}!`;
    }
    game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id)));
  });

  socket.on('uno:drawCard', ({ gameId }) => {
    const game = unoGames[gameId]; if (!game || game.status !== 'playing') return;
    const pIdx = game.players.findIndex(p => p.id === socket.id);
    if (pIdx === -1 || pIdx !== game.currentPlayerIndex) return;
    if (game.deck.length === 0) { game.deck = shuffle(game.discardPile.slice(0,-1)); game.discardPile = [game.discardPile[game.discardPile.length-1]]; }
    if (game.deck.length === 0) return;
    const card = game.deck.pop();
    game.players[pIdx].cards.push(card);
    if (!canPlayUno(card, game.discardPile[game.discardPile.length-1], game.currentColor)) { advanceTurn(game); game.lastAction = `${users[socket.id]?.nick} pesca e passa`; }
    else game.lastAction = `${users[socket.id]?.nick} pesca (giocabile)`;
    game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id)));
  });

  socket.on('uno:pass', ({ gameId }) => {
    const game = unoGames[gameId]; if (!game || game.status !== 'playing') return;
    if (game.players.findIndex(p => p.id === socket.id) !== game.currentPlayerIndex) return;
    advanceTurn(game);
    game.lastAction = `${users[socket.id]?.nick} passa`;
    game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id)));
  });

  socket.on('uno:sayUno', ({ gameId }) => {
    const game = unoGames[gameId]; if (!game) return;
    if (!game.players.some(p => p.id === socket.id)) return;
    io.to(gameId).emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`🔔 ${users[socket.id]?.nick} grida UNO!`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
  });

  socket.on('uno:leave', ({ gameId }) => {
    const game = unoGames[gameId]; if (!game) return;
    const pIdx = game.players.findIndex(p => p.id === socket.id);
    if (pIdx === -1) return;
    const u = users[socket.id];
    if (game.status === 'waiting') {
      game.players.splice(pIdx, 1);
      if (game.players.length === 0) { delete unoGames[gameId]; return; }
      if (game.host === socket.id) game.host = game.players[0].id;
      game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id)));
    } else {
      game.players.splice(pIdx, 1);
      if (game.players.length < 2) { game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id))); delete unoGames[gameId]; }
      else { if (game.host === socket.id) game.host = game.players[0].id; game.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(game, p.id))); }
    }
    if (u) io.to(gameId).emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`${u.nick} ha lasciato UNO.`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
  });

  // CASINO events
  socket.on('casino:open', () => { socket.emit('casino:balance', getBal(socket.id)); });

  socket.on('casino:spin', ({ bet }) => {
    const u = users[socket.id]; if (!u) return;
    const bal = getBal(socket.id);
    if (bet < 1 || bet > bal) return;
    casinoBals[socket.id] = bal - bet;
    const reels = spinSlots();
    const payout = calcSlot(reels, bet);
    casinoBals[socket.id] += payout;
    saveNickData(socket.id);
    socket.emit('casino:result', { reels: reels.map(r=>r.e), payout, balance: casinoBals[socket.id], bet });
    addPokeXP(socket.id, 1, 'slot');
    if (payout > 0) {
      const isJackpot = payout >= bet * 50;
      addPokeXP(socket.id, isJackpot ? 25 : 5, isJackpot ? 'jackpot' : 'vincita slot');
      const netEarn = payout - bet;
      casinoEarnings[socket.id] = (casinoEarnings[socket.id] || 0) + netEarn;
      if (isJackpot) {
        io.emit('chat message', { id:++msgCounter, nick:'Casinò', avatar:'💰', msg:`👑 ${u.nick} ha fatto JACKPOT! €${payout} 🎰`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
      }
      broadcastCasinoLeaderboard();
    }
  });

  // SEND MONEY
  socket.on('send:transfer', ({ to, amount }) => {
    const from = users[socket.id];
    const target = users[to];
    if (!from || !target) return;
    const bal = getBal(socket.id);
    if (amount < 1 || amount > bal) return;
    casinoBals[socket.id] = bal - amount;
    casinoBals[to] = getBal(to) + amount;
    saveNickData(socket.id);
    saveNickData(to);
    io.emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💰', msg:`${from.nick} ha inviato €${amount.toLocaleString()} a ${target.nick}!`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
    socket.emit('send:done', { balance: casinoBals[socket.id] });
    socket.emit('casino:balance', casinoBals[socket.id]);
    io.to(to).emit('casino:balance', casinoBals[to]);
    broadcastCasinoLeaderboard();
  });

  // NEGOZIO LEGGENDARI
  socket.on('admin:removeMoney', ({ to, amount }) => {
    const u = users[socket.id];
    if (!u || u.nick !== 'ERRJACE') return;
    if (!to || !amount || amount < 1) return;
    const target = users[to];
    if (target) {
      casinoBals[to] = Math.max(0, getBal(to) - amount);
      saveNickData(to);
      io.to(to).emit('casino:balance', casinoBals[to]);
    }
    saveData();
    socket.emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💰', msg:`Tolti €${amount.toLocaleString()} a ${target ? target.nick : to}.`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
    if (target) {
      io.to(to).emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💰', msg:`💰 €${amount.toLocaleString()} sono stati rimossi dal tuo conto!`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
    }
    broadcastCasinoLeaderboard();
  });
  socket.on('legendary:list', () => {
    socket.emit('legendary:list', LEGENDARY_SHOP);
  });

  socket.on('legendary:buy', ({ id }) => {
    const u = users[socket.id];
    if (!u) return;
    const poke = LEGENDARY_SHOP.find(p => p.id === id);
    if (!poke) return;
    const bal = getBal(socket.id);
    if (bal < poke.price) { socket.emit('legendary:error', { msg: 'Saldo insufficiente!' }); return; }
    const pd = pokemonData[socket.id];
    if (!pd) { socket.emit('legendary:error', { msg: 'Prima scegli un Pokémon starter con ⚡!' }); return; }
    if (pd.team && pd.team.length >= 5) { socket.emit('legendary:error', { msg: 'Team pieno! Rilascia un Pokémon con /release <numero>' }); return; }
    casinoBals[socket.id] = bal - poke.price;
    socket.emit('casino:balance', casinoBals[socket.id]);
    if (!pd.team) pd.team = [];
    pd.team.push({ name: poke.name, id: poke.id, img: POKE_IMG+poke.id+'.png', legendary: true, lv: 1 });
    saveNickData(socket.id);
    socket.emit('legendary:bought', { name: poke.name });
    io.emit('users online', Object.values(users).map(u2 => ({...u2, pokemon: pokemonData[u2.id] || null })));
    io.emit('chat message', { id:++msgCounter, nick:'🏪 NEGOZIO', avatar:'🏪', msg:`${u.nick} ha acquistato ${poke.name}! ✨`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
  });

  // CARAMMELLA RARA - Buy levels
  socket.on('candy:list', () => {
    const u = users[socket.id];
    if (!u) return;
    const pd = pokemonData[socket.id];
    if (!pd) return;
    const lv = getPokemonLv(pd.xp || 0);
    const team = (pd.team || []).map((p, i) => ({ name: p.name, img: p.img, lv: p.lv || 1, idx: i }));
    socket.emit('candy:list', { starterLv: lv, starterName: pd.currentForm || 'Starter', starterImg: POKE_IMG + STARTERS[pd.starter].imgs[getPokeStage(lv)] + '.png', team: team, cost: CANDY_COST });
  });
  socket.on('candy:buy', ({ target, index }) => {
    const u = users[socket.id];
    if (!u) return;
    const pd = pokemonData[socket.id];
    if (!pd) { socket.emit('candy:error', { msg: 'Prima scegli un Pokémon starter!' }); return; }
    const bal = getBal(socket.id);
    if (bal < CANDY_COST) { socket.emit('candy:error', { msg: 'Saldo insufficiente! Servono €50.000' }); return; }
    if (target === 'starter') {
      const oldLv = getPokemonLv(pd.xp || 0);
      if (oldLv >= 16) { socket.emit('candy:error', { msg: 'Lo Starter è già al livello massimo (16)!' }); return; }
      const nextXp = EVO_THRESH[oldLv] || (EVO_THRESH[EVO_THRESH.length-1] + 2000);
      pd.xp = nextXp;
      const newLv = getPokemonLv(pd.xp);
      casinoBals[socket.id] = bal - CANDY_COST;
      saveNickData(socket.id);
      socket.emit('candy:bought', { name: pd.currentForm, oldLv: oldLv, newLv: newLv, balance: casinoBals[socket.id] });
      io.emit('users online', Object.values(users).map(u2 => ({...u2, pokemon: pokemonData[u2.id] || null })));
    } else if (target === 'team') {
      const idx = parseInt(index);
      if (!pd.team || idx < 0 || idx >= pd.team.length) { socket.emit('candy:error', { msg: 'Pokémon non valido!' }); return; }
      const poke = pd.team[idx];
      const oldLv = poke.lv || 1;
      if (oldLv >= 16) { socket.emit('candy:error', { msg: poke.name + ' è già al livello massimo (16)!' }); return; }
      poke.lv = oldLv + 1;
      casinoBals[socket.id] = bal - CANDY_COST;
      saveNickData(socket.id);
      socket.emit('candy:bought', { name: poke.name, oldLv: oldLv, newLv: poke.lv, balance: casinoBals[socket.id] });
      io.emit('users online', Object.values(users).map(u2 => ({...u2, pokemon: pokemonData[u2.id] || null })));
    }
  });

  // CARAMMELLA MAX - Porta TUTTI i Pokemon al livello max (16)
  socket.on('candy:max:buy', () => {
    const u = users[socket.id];
    if (!u) return;
    const pd = pokemonData[socket.id];
    if (!pd) { socket.emit('candy:error', { msg: 'Prima scegli un Pokémon starter!' }); return; }
    const bal = getBal(socket.id);
    if (bal < CANDY_MAX_COST) { socket.emit('candy:error', { msg: 'Servono €500.000 per la Caramella Max!' }); return; }
    const MAX_LV = 16;
    // Level up starter
    const oldStarterLv = getPokemonLv(pd.xp || 0);
    if (oldStarterLv < MAX_LV) {
      pd.xp = EVO_THRESH[MAX_LV - 1] || EVO_THRESH[EVO_THRESH.length - 1];
    }
    // Level up team
    var upgraded = [];
    if (pd.team) {
      pd.team.forEach(function(p) {
        var olv = p.lv || 1;
        if (olv < MAX_LV) { p.lv = MAX_LV; upgraded.push(p.name); }
      });
    }
    var starterNewLv = getPokemonLv(pd.xp);
    casinoBals[socket.id] = bal - CANDY_MAX_COST;
    saveNickData(socket.id);
    socket.emit('candy:max:bought', { starterLv: starterNewLv, balance: casinoBals[socket.id], team: pd.team || [] });
    io.emit('users online', Object.values(users).map(u2 => ({...u2, pokemon: pokemonData[u2.id] || null })));
  });

  // QUIZ events
  socket.on('quiz:answer', ({ answer }) => {
    if (!currentQuiz) { socket.emit('quiz:expired'); return; }
    if (quizAnswered.has(socket.id)) { socket.emit('quiz:already'); return; }
    quizAnswered.add(socket.id);
    if (answer === currentQuiz.a) {
      casinoBals[socket.id] = getBal(socket.id) + QUIZ_PRIZE;
      saveNickData(socket.id);
      addPokeXP(socket.id, 30, 'quiz');
      casinoEarnings[socket.id] = (casinoEarnings[socket.id] || 0) + QUIZ_PRIZE;
      broadcastCasinoLeaderboard();
      const u = users[socket.id];
      socket.emit('casino:balance', casinoBals[socket.id]);
      io.emit('quiz:correct', { nick: u ? u.nick : 'Qualcuno', prize: QUIZ_PRIZE });
    } else {
      socket.emit('quiz:wrong');
    }
  });

  // TIRO AL BERSAGLIO events
  socket.on('target:play', () => {
    const bal = getBal(socket.id);
    if (bal < 2000) { socket.emit('target:error', { msg: 'Saldo insufficiente!' }); return; }
    casinoBals[socket.id] = bal - 2000;
    saveNickData(socket.id);
    socket.emit('casino:balance', casinoBals[socket.id]);
  });
  socket.on('target:win', ({ score }) => {
    if (score >= 5) {
      casinoBals[socket.id] = getBal(socket.id) + 10000;
      saveNickData(socket.id);
      addPokeXP(socket.id, 15, 'bersaglio');
      casinoEarnings[socket.id] = (casinoEarnings[socket.id] || 0) + 8000;
      broadcastCasinoLeaderboard();
      socket.emit('casino:balance', casinoBals[socket.id]);
    }
  });

  // POKECLAW events
  socket.on('pokeclaw:play', () => {
    const u = users[socket.id]; if (!u) return;
    const bal = getBal(socket.id);
    if (bal < CLAW_COST) { socket.emit('pokeclaw:result', { error: 'Ops! soldi terminati xD' }); return; }
    // Check team size before deducting
    const pokeData = pokemonData[socket.id];
    if(pokeData && pokeData.team && pokeData.team.length >= 5) {
      socket.emit('pokeclaw:result', { error: 'Hai già 5 Pokémon nel team! Rilasciane uno con /release <nome>' });
      return;
    }
    casinoBals[socket.id] = bal - CLAW_COST;
    if (!clawCounters[socket.id]) clawCounters[socket.id] = 0;
    clawCounters[socket.id]++;
    const com=CLAW_POOL.filter(p=>p.t===0), ra=CLAW_POOL.filter(p=>p.t===1), leg=CLAW_POOL.filter(p=>p.t===2);
    var sel=[], forceLeg=clawCounters[socket.id]>=3, hit=null;
    for(var i=0;i<4;i++){var c=[...com];sel.push(c[Math.floor(Math.random()*c.length)]||{n:'Magikarp',i:129,t:0});}
    sel.push(ra[Math.floor(Math.random()*ra.length)]||{n:'Pikachu',i:25,t:1});
    if(forceLeg){
      hit=leg[Math.floor(Math.random()*leg.length)]||{n:'Mewtwo',i:150,t:2};
      sel.push(hit);
      delete clawCounters[socket.id];
    }else{
      var r2=Math.random();
      sel.push(r2<0.7?(com[Math.floor(Math.random()*com.length)]||{n:'Pidgey',i:16,t:0}):r2<0.95?(ra[Math.floor(Math.random()*ra.length)]||{n:'Eevee',i:133,t:1}):(leg[Math.floor(Math.random()*leg.length)]||{n:'Mewtwo',i:150,t:2}));
      hit=sel[Math.floor(Math.random()*sel.length)];
      if(hit.t===2) delete clawCounters[socket.id];
    }
    if(pokeData) {
      if(!pokeData.team) pokeData.team = [];
      pokeData.team.push({ name: hit.n, id: hit.i, img: POKE_IMG+hit.i+'.png', legendary: hit.t===2, lv: 1 });
    }
    socket.emit('pokeclaw:result',{pokemon:sel.map(p=>({name:p.n,id:p.i})),caught:{name:hit.n,id:hit.i,legendary:hit.t===2,img:POKE_IMG+hit.i+'.png'},team:pokeData?pokeData.team:[],balance:casinoBals[socket.id]});
    addPokeXP(socket.id, 10, 'pokéclaw'); // broadcasts users online
    if(hit.t===2){
      io.emit('chat message',{id:++msgCounter,nick:'🌟 LEGGENDARIO!',avatar:'<img src="'+POKE_IMG+hit.i+'.png" style="width:22px;height:22px;vertical-align:middle">',msg:`✨✨ ${u.nick.toUpperCase()} HA TROVATO ${hit.n.toUpperCase()}! ✨✨`,time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),system:true,reactions:{}});
      io.emit('pokeclaw:legendary',{nick:u.nick,pokemon:hit.n,img:POKE_IMG+hit.i+'.png'});
    }
  });

  // POKEMON events
  socket.on('pokemon:pick', ({ starter }) => {
    const u = users[socket.id];
    if (!STARTERS[starter] || pokemonData[socket.id]) { socket.emit('pokemon:picked',{error:'Già scelto o non valido'}); return; }
    const d = { starter, currentForm: STARTERS[starter].evos[0], xp: 0, nick: u?u.nick:'', team: [] };
    pokemonData[socket.id] = d;
    saveNickData(socket.id);
    socket.emit('pokemon:picked', { starter, form: d.currentForm, img: POKE_IMG + STARTERS[d.starter].imgs[0] + '.png', level: 1, xp: 0 });
    io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
  });

  socket.on('pokemon:leaderboard', () => {
    const list = Object.entries(pokemonData).filter(([id]) => users[id]).map(([id, d]) => {
      const lv = getPokemonLv(d.xp);
      return { nick: users[id].nick, avatar: users[id].avatar, starter: d.starter, form: d.currentForm, img: POKE_IMG + STARTERS[d.starter].imgs[getPokeStage(lv)] + '.png', xp: d.xp, level: lv, team: d.team };
    }).sort((a,b) => b.xp - a.xp).slice(0, 20);
    socket.emit('pokemon:leaderboard', list);
  });

  // === SCAMBIO POKEMON CON SELEZIONE ===
  socket.on('pokemon:tradeRequest', ({ to }) => {
    if (!users[to]) return;
    if (!pokemonData[socket.id] || !pokemonData[to]) return;
    if ((pokemonData[socket.id].team || []).length === 0 || (pokemonData[to].team || []).length === 0) return;
    const from = users[socket.id];
    io.to(to).emit('pokemon:tradeOffer', { from: socket.id, nick: from.nick });
  });

  socket.on('pokemon:tradeAccept', ({ from }) => {
    if (!pokemonData[from] || !pokemonData[socket.id]) return;
    const teamA = pokemonData[from].team || [];
    const teamB = pokemonData[socket.id].team || [];
    if (teamA.length === 0 || teamB.length === 0) return;
    const tradeId = from + '-' + socket.id + '-' + Date.now();
    tradeSessions[tradeId] = {
      players: [
        { id: from, teamLen: teamA.length, pick: null },
        { id: socket.id, teamLen: teamB.length, pick: null }
      ],
      state: 'selecting'
    };
    // Manda a entrambi la lista del loro team per scegliere
    [from, socket.id].forEach(sid => {
      const team = pokemonData[sid].team || [];
      io.to(sid).emit('pokemon:tradeSelect', {
        tradeId,
        team: team.map((p, i) => ({ index: i, name: p.name, img: p.img, id: p.id })),
        nick: users[sid === from ? socket.id : from].nick
      });
    });
  });

  socket.on('pokemon:tradeSelected', ({ tradeId, index }) => {
    const session = tradeSessions[tradeId];
    if (!session || session.state !== 'selecting') return;
    const player = session.players.find(p => p.id === socket.id);
    if (!player) return;
    if (index < 0 || index >= player.teamLen) return;
    player.pick = index;
    // Notify partner that selection was made
    const partner = session.players.find(p => p.id !== socket.id);
    if (partner) io.to(partner.id).emit('pokemon:tradePartnerPicked', { tradeId });
    // Check if both picked
    if (session.players[0].pick !== null && session.players[1].pick !== null) {
      session.state = 'swapping';
      const p1 = session.players[0], p2 = session.players[1];
      const poke1 = JSON.parse(JSON.stringify(pokemonData[p1.id].team[p1.pick]));
      const poke2 = JSON.parse(JSON.stringify(pokemonData[p2.id].team[p2.pick]));
      if (!poke1 || !poke2) { delete tradeSessions[tradeId]; return; }
      pokemonData[p1.id].team[p1.pick] = poke2;
      pokemonData[p2.id].team[p2.pick] = poke1;
      const u1 = users[p1.id], u2 = users[p2.id];
      if (u1 && u2) {
        io.emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`🔄 ${u1.nick} e ${u2.nick} si sono scambiati Pokémon!`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
        io.to(p1.id).emit('pokemon:traded', { team: pokemonData[p1.id].team, name: poke2.name, img: poke2.img });
        io.to(p2.id).emit('pokemon:traded', { team: pokemonData[p2.id].team, name: poke1.name, img: poke1.img });
        io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
        saveNickData(p1.id);
        saveNickData(p2.id);
      }
      delete tradeSessions[tradeId];
    }
  });

  socket.on('pokemon:tradeDecline', ({ from }) => {
    const u = users[socket.id];
    if (u && users[from]) io.to(from).emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`${u.nick} ha rifiutato lo scambio Pokémon.`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
    // Clean up any pending session
    for (const tid in tradeSessions) {
      if (tradeSessions[tid].players.some(p => p.id === socket.id || p.id === from)) {
        delete tradeSessions[tid];
      }
    }
  });

  // Start quiz timer + get initial balance
  if (!quizTimer) startQuiz();
  socket.emit('casino:balance', getBal(socket.id));

  // Voice Chat signaling
  socket.on('voice join', () => {
    const u = users[socket.id];
    if (!u) return;
    socket.broadcast.emit('voice user joined', { id: socket.id, nick: u.nick, avatar: u.avatar });
  });

  socket.on('voice leave', () => {
    socket.broadcast.emit('voice user left', { id: socket.id });
  });

  socket.on('voice signal', ({ to, signal }) => {
    io.to(to).emit('voice signal', { from: socket.id, signal });
  });

  socket.on('map:join', ({ char }) => {
    const u = users[socket.id];
    if (!u) return;
    // Fixed spawn al centro mappa
    var spawnX = Math.floor(MAP_W / 2), spawnY = Math.floor(MAP_H / 2);
    if (Object.values(mapPlayers).some(p => p.x === spawnX && p.y === spawnY)) {
      var offsets = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]];
      var found = false;
      for (var o of offsets) {
        var nx = spawnX + o[0], ny = spawnY + o[1];
        if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H &&
            !Object.values(mapPlayers).some(p => p.x === nx && p.y === ny)) {
          spawnX = nx; spawnY = ny; found = true; break;
        }
      }
      if (!found) {
        var attempts = 0;
        do { spawnX = Math.floor(Math.random() * MAP_W); spawnY = Math.floor(Math.random() * MAP_H); attempts++; }
        while (Object.values(mapPlayers).some(p => p.x === spawnX && p.y === spawnY) && attempts < 100);
      }
    }
    mapPlayers[socket.id] = { x: spawnX, y: spawnY, char: char || 'hero', nick: u.nick, avatar: u.avatar };
    socket.emit('map:init', { w: MAP_W, h: MAP_H, players: mapPlayers, myId: socket.id, chars: MAP_CHARS, wildPokes: mapWildPokes });
    socket.broadcast.emit('map:playerJoin', { id: socket.id, ...mapPlayers[socket.id] });
    // Invito in lobby per tutti (escluso chi entra)
    socket.broadcast.emit('chat message', {
      id: ++msgCounter,
      nick: '🗺️ Overworld',
      avatar: '🌍',
      msg: `vuoi unirti anche tu all overworld con ${u.nick}?`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      system: true,
      inviteMap: { nick: u.nick },
      reactions: {},
    });
  });

  socket.on('map:move', ({ x, y }) => {
    if (!mapPlayers[socket.id]) return;
    if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return;
    if (Math.abs(x - mapPlayers[socket.id].x) + Math.abs(y - mapPlayers[socket.id].y) > 1) return;
    mapPlayers[socket.id].x = x;
    mapPlayers[socket.id].y = y;
    socket.broadcast.emit('map:move', { id: socket.id, x, y, char: mapPlayers[socket.id].char });
  });

  socket.on('map:catchPoke', ({ x, y }) => {
    const idx = mapWildPokes.findIndex(p => p.x === x && p.y === y);
    if (idx === -1) return;
    const pk = mapWildPokes[idx];
    mapWildPokes.splice(idx, 1);
    socket.emit('map:caught', { id: pk.id, name: pk.name });
    // Respawn after 30s
    setTimeout(() => {
      const pool = [
        { id: 28, name: 'Sandslash' }, { id: 42, name: 'Golbat' },
        { id: 44, name: 'Gloom' }, { id: 45, name: 'Vileplume' },
        { id: 61, name: 'Poliwhirl' }, { id: 75, name: 'Graveler' },
        { id: 78, name: 'Rapidash' }, { id: 80, name: 'Slowbro' },
        { id: 82, name: 'Magneton' }, { id: 87, name: 'Dewgong' },
        { id: 93, name: 'Haunter' }, { id: 97, name: 'Hypno' },
        { id: 117, name: 'Seadra' }, { id: 119, name: 'Seaking' },
        { id: 22, name: 'Fearow' }, { id: 17, name: 'Pidgeotto' },
      ];
      const np = pool[Math.floor(Math.random() * pool.length)];
      mapWildPokes.push({ id: np.id, name: np.name, x: Math.floor(Math.random()*MAP_W), y: Math.floor(Math.random()*MAP_H), spawnTime: Date.now() });
      io.emit('map:wildPokes', mapWildPokes);
    }, 30000);
    io.emit('map:wildPokes', mapWildPokes);
  });

  socket.on('map:leave', () => {
    if (mapPlayers[socket.id]) {
      delete mapPlayers[socket.id];
      io.emit('map:playerLeave', { id: socket.id });
    }
  });

  // ===== BATTLE EVENTS =====
  socket.on('battle:challenge', ({ to }) => {
    const u = users[socket.id], tu = users[to];
    if (!u || !tu || !pokemonData[socket.id] || !pokemonData[to]) return;
    io.to(to).emit('battle:challenge', { from: socket.id, nick: u.nick, avatar: u.avatar });
  });
  socket.on('battle:cancel', ({ to }) => { io.to(to).emit('battle:cancel'); });
  socket.on('battle:accept', ({ from }) => {
    if (!users[from] || !users[socket.id] || !pokemonData[from] || !pokemonData[socket.id]) return;
    const id = 'b' + (++battleIdCounter);
    const mkTeam = (sid) => {
      const pd = pokemonData[sid];
      if (pd) migratePokemonData(pd);
      const lv = getPokemonLv(pd.xp);
      const stage = getPokeStage(lv);
      const s = STARTERS[pd.starter];
      const starter = generatePokeStats(pd.currentForm, POKE_IMG + s.imgs[stage] + '.png', POKE_TYPES[s.imgs[stage]]||['normal'], stage, false);
      starter.xpLv = lv;
      const team = [starter];
      if (pd.team && pd.team.length > 0) {
        pd.team.forEach(cp => {
          const cTypes = POKE_TYPES[cp.id] || ['normal'];
          const claw = generatePokeStats(cp.name, POKE_IMG + cp.id + '.png', cTypes, cp.legendary?3:1, !!cp.legendary);
          claw.xpLv = '-';
          team.push(claw);
        });
      }
      return team;
    };
    const b = {
      id, turnPlayer: Math.random() < 0.5 ? 0 : 1,
      players: [
        { id: from, nick: users[from].nick, team: mkTeam(from), currentPoke: 0 },
        { id: socket.id, nick: users[socket.id].nick, team: mkTeam(socket.id), currentPoke: 0 }
      ],
      state: 'playing', log: [], winner: null
    };
    battles[id] = b;
    [from, socket.id].forEach(sid => {
      const p = b.players.find(p => p.id === sid);
      io.to(sid).emit('battle:start', {
        battleId: id, myIdx: b.players.findIndex(p => p.id === sid),
        players: b.players.map(p => ({ id: p.id, nick: p.nick, team: p.team.map(pk => ({ species:pk.species, img:pk.img, types:pk.types, stats:pk.stats, maxHp:pk.maxHp, currentHp:pk.currentHp, status:pk.status, moves:pk.moves })), currentPoke: p.currentPoke })),
        turnPlayer: b.turnPlayer, log: [], state: 'playing'
      });
    });
  });
  socket.on('battle:decline', ({ from }) => {
    const u = users[socket.id];
    if (u && users[from]) io.to(from).emit('battle:decline', { nick: u.nick });
  });
  socket.on('battle:move', ({ battleId, index }) => {
    const b = battles[battleId]; if(!b || b.state !== 'playing') return;
    const pIdx = b.players.findIndex(p => p.id === socket.id);
    if(pIdx === -1 || b.turnPlayer !== pIdx) return;
    battleTurn(battleId, pIdx, { type:'move', index });
    // Send updated state to both
    b.players.forEach((p, i) => {
      io.to(p.id).emit('battle:state', {
        players: b.players.map(p2 => ({ id:p2.id, nick:p2.nick, currentPoke:p2.currentPoke,
          team: p2.team.map(pk => ({ species:pk.species, img:pk.img, currentHp:pk.currentHp, maxHp:pk.maxHp, status:pk.status, fainted:pk.fainted }))
        })),
        turnPlayer: b.turnPlayer, log: b.log, state: b.state, winner: b.winner
      });
    });
    if(b.state === 'ended') {
      const winner = b.winner;
      const loser = b.players.find(p => p.id !== winner);
      const loserData = pokemonData[loser.id];
      const winnerData = pokemonData[winner];
      if (winnerData) addPokeXP(winner, 100, 'battle win');
      if (loserData) addPokeXP(loser.id, 10, 'battle loss');
      io.emit('chat message', {
        id: ++msgCounter, nick: 'Pokémon', avatar: '⚔️',
        msg: `🏆 ${b.players.find(p => p.id === winner).nick} ha vinto la battaglia Pokémon contro ${b.players.find(p => p.id !== winner).nick}!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), system: true, reactions: {}
      });
      setTimeout(() => { delete battles[battleId]; }, 5000);
    } else if (b.isBot && b.turnPlayer === 1) {
      setTimeout(() => botAutoPlay(battleId), 1200);
    }
  });
  socket.on('battle:switch', ({ battleId, index }) => {
    const b = battles[battleId]; if(!b || b.state !== 'playing') return;
    const pIdx = b.players.findIndex(p => p.id === socket.id);
    if(pIdx === -1 || b.turnPlayer !== pIdx) return;
    battleTurn(battleId, pIdx, { type:'switch', index });
    b.players.forEach((p, i) => {
      io.to(p.id).emit('battle:state', {
        players: b.players.map(p2 => ({ id:p2.id, nick:p2.nick, currentPoke:p2.currentPoke,
          team: p2.team.map(pk => ({ species:pk.species, img:pk.img, currentHp:pk.currentHp, maxHp:pk.maxHp, status:pk.status, fainted:pk.fainted }))
        })),
        turnPlayer: b.turnPlayer, log: b.log, state: b.state, winner: b.winner
      });
    });
    if (b.isBot && b.turnPlayer === 1) {
      setTimeout(() => botAutoPlay(battleId), 1200);
    }
  });

  socket.on('battle:forfeit', ({ battleId }) => {
    const b = battles[battleId]; if(!b || b.state !== 'playing') return;
    b.state = 'ended'; b.winner = b.players.find(p => p.id !== socket.id).id;
    b.players.forEach((p) => {
      if (p.id.startsWith('bot_')) return; // skip bot socket
      io.to(p.id).emit('battle:state', {
        players: b.players.map(p2 => ({ id:p2.id, nick:p2.nick, currentPoke:p2.currentPoke,
          team: p2.team.map(pk => ({ species:pk.species, img:pk.img, currentHp:pk.currentHp, maxHp:pk.maxHp, status:pk.status, fainted:pk.fainted }))
        })),
        turnPlayer: b.turnPlayer, log: b.log.concat([users[socket.id]?.nick + ' si è arreso!']), state: b.state, winner: b.winner
      });
    });
    const loserData = pokemonData[socket.id];
    if (loserData) addPokeXP(socket.id, b.isBot ? 5 : 5, 'battle forfeit loss');
    if (b.isBot) {
      // Bot battle forfeit — just tell the player
      io.to(socket.id).emit('chat message', {
        id: ++msgCounter, nick: 'Pokémon', avatar: '🤖',
        msg: `😔 Ti sei arreso dall'allenamento. (+5 XP)`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), system: true, reactions: {}
      });
    } else {
      const winner = b.winner;
      const winnerData = pokemonData[winner];
      if (winnerData) addPokeXP(winner, 15, 'battle forfeit win');
      io.emit('chat message', {
        id: ++msgCounter, nick: 'Pokémon', avatar: '⚔️',
        msg: `🏆 ${b.players.find(p => p.id === winner).nick} ha vinto la battaglia Pokémon contro ${b.players.find(p => p.id !== winner).nick}!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), system: true, reactions: {}
      });
    }
    setTimeout(() => { delete battles[battleId]; }, 5000);
  });

  // BATTLE REACTIONS - Emoji during 1v1
  socket.on('battle:react', ({ battleId, emoji }) => {
    const b = battles[battleId];
    if (!b || b.state !== 'playing') return;
    const player = b.players.find(p => p.id === socket.id);
    if (!player) return;
    const opponent = b.players.find(p => p.id !== socket.id);
    if (!opponent || opponent.id.startsWith('bot_')) return;
    const allowed = ['🔥','💪','😂','😢','👏','😡','💀','❤️','🎉'];
    if (!emoji || allowed.indexOf(emoji) === -1) return;
    io.to(opponent.id).emit('battle:reaction', { emoji: emoji, from: player.nick });
  });

  // ===== BOT TRAINER (Allenamento 1v1) =====
  const BOT_NAMES = ['Prof. Oak','Gary','Red','Blue','Misty','Brock','Lt. Surge','Erika','Koga','Sabrina','Blaine','Giovanni','Lorelei','Bruno','Agatha','Lance'];
  const BOT_POOL = [
    {n:'Pikachu',i:25,types:['electric']},{n:'Charizard',i:6,types:['fire','flying']},
    {n:'Blastoise',i:9,types:['water']},{n:'Venusaur',i:3,types:['grass','poison']},
    {n:'Gengar',i:94,types:['ghost','poison']},{n:'Machamp',i:68,types:['fighting']},
    {n:'Alakazam',i:65,types:['psychic']},{n:'Golem',i:76,types:['rock','ground']},
    {n:'Dragonite',i:149,types:['dragon','flying']},{n:'Gyarados',i:130,types:['water','flying']},
    {n:'Snorlax',i:143,types:['normal']},{n:'Arcanine',i:59,types:['fire']},
    {n:'Lapras',i:131,types:['water','ice']},{n:'Rhydon',i:112,types:['ground','rock']},
    {n:'Jolteon',i:135,types:['electric']},{n:'Vaporeon',i:134,types:['water']},
    {n:'Flareon',i:136,types:['fire']},{n:'Haunter',i:93,types:['ghost','poison']},
    {n:'Kadabra',i:64,types:['psychic']},{n:'Machoke',i:67,types:['fighting']},
    {n:'Poliwrath',i:62,types:['water','fighting']},{n:'Nidoking',i:34,types:['poison','ground']},
    {n:'Nidoqueen',i:31,types:['poison','ground']},{n:'Cloyster',i:91,types:['water','ice']},
    {n:'Electabuzz',i:125,types:['electric']},{n:'Magmar',i:126,types:['fire']},
    {n:'Scyther',i:123,types:['bug','flying']},{n:'Magneton',i:82,types:['electric','steel']},
    {n:'Kingler',i:99,types:['water']},{n:'Marowak',i:105,types:['ground']}
  ];
  function botAutoPlay(battleId) {
    const b = battles[battleId];
    if (!b || b.state !== 'playing' || !b.isBot) return;
    const botIdx = 1;
    if (b.turnPlayer !== botIdx) return;
    const bot = b.players[botIdx];
    const poke = bot.team[bot.currentPoke];
    if (!poke || poke.fainted) return;
    // Pick a random move with PP > 0
    const valid = poke.moves.map((m,i) => ({m,i})).filter(x => x.m.pp > 0);
    let pick;
    if (valid.length > 0) {
      pick = valid[Math.floor(Math.random() * valid.length)];
    } else {
      // All PP depleted — use first move anyway (Struggle)
      pick = { m: poke.moves[0], i: 0 };
      pick.m.pp = 1;
    }
    battleTurn(battleId, botIdx, { type:'move', index: pick.i });
    // Send state to the real player only
    const realPlayer = b.players[0];
    io.to(realPlayer.id).emit('battle:state', {
      players: b.players.map(p => ({ id:p.id, nick:p.nick, currentPoke:p.currentPoke,
        team: p.team.map(pk => ({ species:pk.species, img:pk.img, currentHp:pk.currentHp, maxHp:pk.maxHp, status:pk.status, fainted:pk.fainted }))
      })),
      turnPlayer: b.turnPlayer, log: b.log, state: b.state, winner: b.winner
    });
    if (b.state === 'ended') {
      const won = b.winner === realPlayer.id;
      if (pokemonData[realPlayer.id]) addPokeXP(realPlayer.id, won ? 100 : 10, won ? 'bot battle win' : 'bot battle loss');
      io.to(realPlayer.id).emit('chat message', {
        id: ++msgCounter, nick: 'Pokémon', avatar: '🤖',
        msg: won ? '🏆 Hai vinto l\'allenamento contro '+bot.nick+'! (+100 XP)' : '😞 Hai perso l\'allenamento contro '+bot.nick+'. (+10 XP)',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), system: true, reactions: {}
      });
      setTimeout(() => { delete battles[battleId]; }, 5000);
    } else if (b.turnPlayer === botIdx) {
      // Bot goes again (e.g. after a switch)
      setTimeout(() => botAutoPlay(battleId), 1200);
    }
  }
  socket.on('battle:botChallenge', () => {
    const u = users[socket.id];
    if (!u || !pokemonData[socket.id]) return;
    const pd = pokemonData[socket.id];
    migratePokemonData(pd);
    const lv = getPokemonLv(pd.xp);
    const stage = getPokeStage(lv);
    // Build player team (same as normal battle)
    const mkTeam = (sid) => {
      const pd2 = pokemonData[sid];
      if (pd2) migratePokemonData(pd2);
      const lv2 = getPokemonLv(pd2.xp);
      const stage2 = getPokeStage(lv2);
      const s = STARTERS[pd2.starter];
      const starter = generatePokeStats(pd2.currentForm, POKE_IMG + s.imgs[stage2] + '.png', POKE_TYPES[s.imgs[stage2]]||['normal'], stage2, false);
      starter.xpLv = lv2;
      const team = [starter];
      if (pd2.team && pd2.team.length > 0) {
        pd2.team.forEach(cp => {
          const cTypes = POKE_TYPES[cp.id] || ['normal'];
          const claw = generatePokeStats(cp.name, POKE_IMG + cp.id + '.png', cTypes, cp.legendary?3:1, !!cp.legendary);
          claw.xpLv = '-';
          team.push(claw);
        });
      }
      return team;
    };
    // Build bot team — 6 random Pokemon
    const botTeamSize = 6;
    const botTeam = [];
    const usedIdx = new Set();
    for (let i = 0; i < botTeamSize; i++) {
      let pi;
      do { pi = Math.floor(Math.random() * BOT_POOL.length); } while (usedIdx.has(pi) && usedIdx.size < BOT_POOL.length);
      usedIdx.add(pi);
      const bp = BOT_POOL[pi];
      const botStage = Math.min(stage, bp.n === 'Pikachu' || bp.n === 'Haunter' || bp.n === 'Kadabra' || bp.n === 'Machoke' || bp.n === 'Kingler' ? 1 : 2);
      const pk = generatePokeStats(bp.n, POKE_IMG + bp.i + '.png', bp.types, botStage, false);
      pk.xpLv = '-';
      botTeam.push(pk);
    }
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const id = 'b' + (++battleIdCounter);
    const b = {
      id, isBot: true,
      turnPlayer: Math.random() < 0.5 ? 0 : 1,
      players: [
        { id: socket.id, nick: u.nick, team: mkTeam(socket.id), currentPoke: 0 },
        { id: 'bot_' + id, nick: '🤖 ' + botName, team: botTeam, currentPoke: 0 }
      ],
      state: 'playing', log: [], winner: null
    };
    b.log.push('Allenamento: ' + botName + ' ti sfida!');
    battles[id] = b;
    // Send to real player only
    io.to(socket.id).emit('battle:start', {
      battleId: id, myIdx: 0, isBot: true,
      players: b.players.map(p => ({ id: p.id, nick: p.nick, team: p.team.map(pk => ({ species:pk.species, img:pk.img, types:pk.types, stats:pk.stats, maxHp:pk.maxHp, currentHp:pk.currentHp, status:pk.status, moves:pk.moves })), currentPoke: p.currentPoke })),
      turnPlayer: b.turnPlayer, log: b.log, state: 'playing'
    });
    // If bot goes first, auto-play
    if (b.turnPlayer === 1) {
      setTimeout(() => botAutoPlay(id), 1200);
    }
  });
  // ===== TIRO AL BERSAGLIO 1v1 =====
  const targetChallenges = {};
  const targetGames = {};
  let targetGameIdCounter = 0;
  const TARGET_ENTRY = 2000;
  const TARGET_PRIZE = 4000;
  const TARGET_DURATION = 12;

  socket.on('target:challenge', ({ to }) => {
    const u = users[socket.id], tu = users[to];
    if (!u || !tu) return;
    const bal = getBal(socket.id);
    if (bal < TARGET_ENTRY) { socket.emit('target:error', { msg: 'Saldo insufficiente! Servono €2K' }); return; }
    targetChallenges[to] = socket.id;
    io.to(to).emit('target:challenge', { from: socket.id, nick: u.nick, avatar: u.avatar });
  });
  socket.on('target:cancel', ({ to }) => {
    delete targetChallenges[to];
    io.to(to).emit('target:cancel');
  });
  socket.on('target:decline', ({ from }) => {
    delete targetChallenges[from];
    const u = users[socket.id];
    if (u && users[from]) io.to(from).emit('target:decline', { nick: u.nick });
  });
  socket.on('target:accept', ({ from }) => {
    if (!users[from] || !users[socket.id]) return;
    const bal1 = getBal(from), bal2 = getBal(socket.id);
    if (bal1 < TARGET_ENTRY || bal2 < TARGET_ENTRY) {
      io.to(from).emit('target:cancel');
      socket.emit('target:cancel');
      return;
    }
    casinoBals[from] = bal1 - TARGET_ENTRY;
    casinoBals[socket.id] = bal2 - TARGET_ENTRY;
    saveNickData(from);
    saveNickData(socket.id);
    const id = 'tg' + (++targetGameIdCounter);
    const game = {
      id,
      players: [
        { id: from, nick: users[from].nick, score: 0 },
        { id: socket.id, nick: users[socket.id].nick, score: 0 }
      ],
      state: 'countdown',
      timeLeft: TARGET_DURATION,
      targets: {}, // id -> { points, hitBy: null }
      targetIds: [],
      spawnTimer: null,
      gameTimer: null,
    };
    targetGames[id] = game;
    [from, socket.id].forEach(sid => {
      io.to(sid).emit('target:start', {
        gameId: id,
        oppNick: users[sid === from ? socket.id : from].nick,
        myScore: 0,
        oppScore: 0,
        timeLeft: TARGET_DURATION
      });
    });
    // 3-2-1 countdown
    let c = 3;
    const ci = setInterval(() => {
      c--;
      [from, socket.id].forEach(sid => io.to(sid).emit('target:countdown', { countdown: c }));
      if (c <= 0) {
        clearInterval(ci);
        game.state = 'playing';
        [from, socket.id].forEach(sid => io.to(sid).emit('target:go'));
        // Spawn loop
        game.spawnTimer = setInterval(() => {
          if (game.state !== 'playing') return;
          const isRare = Math.random() < 0.15;
          const isLegendary = Math.random() < 0.03;
          const tid = id + '_t' + (++targetGameIdCounter);
          const target = {
            id: tid,
            points: isLegendary ? 3 : isRare ? 2 : 1,
            isRare, isLegendary,
            left: Math.random() * 80 + 10,
            top: Math.random() * 80 + 10,
            hitBy: null,
          };
          game.targets[tid] = target;
          game.targetIds.push(tid);
          [from, socket.id].forEach(sid => {
            io.to(sid).emit('target:spawn', {
              id: tid,
              points: target.points,
              isRare: target.isRare,
              isLegendary: target.isLegendary,
              left: target.left,
              top: target.top,
            });
          });
          // Auto remove after duration
          const dur = isLegendary ? 1200 : isRare ? 1500 : 1000;
          setTimeout(() => {
            if (game.state === 'playing' && game.targets[tid] && !game.targets[tid].hitBy) {
              delete game.targets[tid];
              [from, socket.id].forEach(sid => io.to(sid).emit('target:remove', { id: tid }));
            }
          }, dur);
        }, 700);
        // Game timer
        game.gameTimer = setInterval(() => {
          game.timeLeft--;
          [from, socket.id].forEach(sid => io.to(sid).emit('target:tick', { timeLeft: game.timeLeft }));
          if (game.timeLeft <= 0) {
            endTargetGame(game, from, socket.id);
          }
        }, 1000);
      }
    }, 1000);
  });

  function endTargetGame(game, p1, p2) {
    game.state = 'ended';
    if (game.spawnTimer) { clearInterval(game.spawnTimer); game.spawnTimer = null; }
    if (game.gameTimer) { clearInterval(game.gameTimer); game.gameTimer = null; }
    const s1 = game.players[0].score, s2 = game.players[1].score;
    let winner = null;
    if (s1 > s2) winner = game.players[0].id;
    else if (s2 > s1) winner = game.players[1].id;
    const winnerNick = winner ? game.players.find(p => p.id === winner).nick : null;
    if (winner) {
      casinoBals[winner] = getBal(winner) + TARGET_PRIZE;
      saveNickData(winner);
      addPokeXP(winner, 15, 'bersaglio 1v1');
      casinoEarnings[winner] = (casinoEarnings[winner] || 0) + 2000;
      broadcastCasinoLeaderboard();
    } else {
      // Draw - refund
      casinoBals[p1] = getBal(p1) + TARGET_ENTRY;
      casinoBals[p2] = getBal(p2) + TARGET_ENTRY;
      saveNickData(p1);
      saveNickData(p2);
    }
    [p1, p2].forEach(sid => {
      io.to(sid).emit('casino:balance', casinoBals[sid]);
      io.to(sid).emit('target:end', {
        myScore: game.players.find(p => p.id === sid).score,
        oppScore: game.players.find(p => p.id !== sid).score,
        winner,
        winnerNick,
        draw: !winner,
      });
    });
    io.emit('chat message', {
      id: ++msgCounter, nick: 'Tiro al Bersaglio', avatar: '🎯',
      msg: winner
        ? `🏆 ${winnerNick} ha vinto a Tiro al Bersaglio contro ${game.players.find(p => p.id !== winner).nick}! (${s1}-${s2})`
        : `🤝 Pareggio tra ${game.players[0].nick} e ${game.players[1].nick} a Tiro al Bersaglio! (${s1}-${s2})`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), system: true, reactions: {}
    });
    setTimeout(() => { delete targetGames[game.id]; }, 5000);
  }

  socket.on('target:hit', ({ gameId, targetId }) => {
    const g = targetGames[gameId];
    if (!g || g.state !== 'playing') return;
    const t = g.targets[targetId];
    if (!t || t.hitBy) return;
    t.hitBy = socket.id;
    const p = g.players.find(p => p.id === socket.id);
    if (!p) return;
    p.score += t.points;
    const opp = g.players.find(p => p.id !== socket.id);
    [socket.id, opp.id].forEach(sid => {
      const ms = g.players.find(p => p.id === sid).score;
      const os = g.players.find(p => p.id !== sid).score;
      io.to(sid).emit('target:score', {
        myScore: ms,
        oppScore: os,
        targetId,
        points: t.points,
        left: t.left,
        top: t.top,
      });
    });
  });

  socket.on('disconnect', async () => {
    const u = users[socket.id];

    // === PERSISTENZA: salva dati utente prima della disconnessione ===
    const token = tokenForSocket[socket.id];
    if (token) {
      saveNickData(socket.id);
      await saveData();
      delete tokenForSocket[socket.id];
    }

    // Clean up target challenges
    if (targetChallenges[socket.id]) delete targetChallenges[socket.id];
    for (const k in targetChallenges) {
      if (targetChallenges[k] === socket.id) {
        io.to(k).emit('target:cancel');
        delete targetChallenges[k];
      }
    }
    // Clean up target games
    for (const gid in targetGames) {
      const g = targetGames[gid];
      const pIdx = g.players.findIndex(p => p.id === socket.id);
      if (pIdx !== -1) {
        if (g.spawnTimer) clearInterval(g.spawnTimer);
        if (g.gameTimer) clearInterval(g.gameTimer);
        g.state = 'ended';
        const other = g.players[1 - pIdx];
        io.to(other.id).emit('target:end', { myScore: other.score, oppScore: g.players[pIdx].score, winner: other.id, winnerNick: other.nick, draw: false, disconnect: true });
        casinoBals[other.id] = getBal(other.id) + TARGET_PRIZE;
        saveNickData(other.id);
        io.to(other.id).emit('casino:balance', casinoBals[other.id]);
        delete targetGames[gid];
      }
    }
    // Clean up battle challenges (with 10s grace period for mobile reconnection)
    Object.keys(battles).forEach(bid => {
      const b = battles[bid];
      const pIdx = b.players.findIndex(p => p.id === socket.id);
      if (pIdx !== -1) {
        const other = b.players[1 - pIdx];
        if (other.id.startsWith('bot_')) return;
        b.players[pIdx].disconnected = true;
        b.players[pIdx].discTimer = setTimeout(() => {
          if (battles[bid] && b.players[pIdx].disconnected) {
            delete battles[bid];
            io.to(other.id).emit('battle:end', { reason: 'Avversario disconnesso (10s)', winner: other.id });
          }
        }, 10000);
        io.to(other.id).emit('battle:opponentDisconnect', { nick: b.players[pIdx].nick, seconds: 10 });
      }
    });
    if (mapPlayers[socket.id]) { delete mapPlayers[socket.id]; io.emit('map:playerLeave', { id: socket.id }); }
    if (u) {
      // Clean up any active games
      for (const gid in games) {
        const g = games[gid];
        if (g.player1 === socket.id || g.player2 === socket.id) {
          const other = g.player1 === socket.id ? g.player2 : g.player1;
          io.to(other).emit('game end', { reason: 'Avversario si è disconnesso' });
          delete games[gid];
        }
      }
      // Clean up UNO games
      for (const gid in unoGames) {
        const g = unoGames[gid];
        const pIdx = g.players.findIndex(p => p.id === socket.id);
        if (pIdx !== -1) {
          g.players.splice(pIdx, 1);
          if (g.players.length < 2) { g.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(g, p.id))); delete unoGames[gid]; }
          else { if (g.host === socket.id) g.host = g.players[0].id; g.players.forEach(p => io.to(p.id).emit('uno:state', getUnoState(g, p.id))); }
        }
      }
      io.emit('chat message', {
        id: ++msgCounter,
        nick: 'Sistema',
        avatar: '💬',
        msg: `${u.nick} è uscito dalla lobby.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        system: true,
        reactions: {},
      });
      delete users[socket.id];
      io.emit('users online', Object.values(users).map(u2 => ({...u2, pokemon: pokemonData[u2.id] || null })));
    }
    if (u) console.log(`[${new Date().toLocaleTimeString()}] ${u.nick} è uscito — IP: ${u.ip}`);
    else console.log(`[${new Date().toLocaleTimeString()}] Disconnesso: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  const MONGO_URI = process.env.MONGODB_URI;
  if (MONGO_URI) {
    try {
      await mongoose.connect(MONGO_URI);
      useMongo = true;
      console.log('[DB] Connesso a MongoDB');
    } catch(e) {
      console.error('[DB] Errore MongoDB, uso file locale:', e.message);
    }
  }
  await loadData();
  server.listen(PORT, () => {
    console.log(`Server ERRJACE attivo su http://localhost:${PORT}`);
  });
}

start().catch(e => { console.error('Errore avvio:', e); process.exit(1); });

// Salva dati su SIGTERM/SIGINT (Render free tier spin-down, Ctrl+C)
['SIGTERM', 'SIGINT'].forEach(sig => {
  process.on(sig, async () => {
    console.log(`[${new Date().toLocaleTimeString()}] Ricevuto ${sig}, salvataggio dati...`);
    for (const sid of Object.keys(users)) { saveNickData(sid); }
    try { await saveData(); } catch(e) { console.error('Errore salvataggio su spegnimento:', e); }
    process.exit(0);
  });
});
