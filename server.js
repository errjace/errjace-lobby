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
const QUIZ_TIME = 30000;
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
function getBal(id) { if (casinoBals[id] === undefined) casinoBals[id] = CASINO_START; syncTokenData(id); return casinoBals[id]; }
function resetQuiz() { quizActive = false; currentQuiz = null; quizAnswered = new Set(); }
function sendQuiz() {
  if (Object.keys(users).length < 1) return;
  const q = QUIZ_QUESTIONS[Math.floor(Math.random() * QUIZ_QUESTIONS.length)];
  currentQuiz = q; quizActive = true; quizAnswered = new Set();
  io.emit('quiz:question', { question: q.q, options: q.o, prize: QUIZ_PRIZE, timeLeft: 30 });
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
}
const clawCounters = {};

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
  // Backup per nickname (usato come fallback per PIN login)
  if (d.nick) nickData[d.nick] = { ...d, token };
}

setInterval(() => saveData(), 30000);
setInterval(() => {
  try { fs.writeFileSync(NICKAUTH_FILE, JSON.stringify(nickAuth, null, 2)); }
  catch(e) { console.error('Errore salvataggio nickauth:', e); }
}, 30000);
// =========================

const EVO_THRESH = [0,30,80,150,250,400,600,900,1300,2000];
const POKE_IMG = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/';
const CLAW_COST = 5000;
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
function getPokeStage(lv) { return lv>=6?2:lv>=3?1:0; }
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
  syncTokenData(id);
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
// Pokemon type assignments (by dex ID)
const POKE_TYPES = {
  4:['fire'],5:['fire'],6:['fire','flying'],778:['ghost','fairy'],447:['fighting'],448:['fighting','steel'],
  220:['ice','ground'],221:['ice','ground'],473:['ice','ground'],
  16:['normal','flying'],17:['normal','flying'],18:['normal','flying'],19:['normal'],20:['normal'],
  21:['normal','flying'],22:['normal','flying'],23:['poison'],24:['poison'],
  25:['electric'],26:['electric'],27:['ground'],28:['ground'],29:['poison'],
  38:['fire'],40:['normal','fairy'],41:['poison','flying'],42:['poison','flying'],
  43:['grass','poison'],44:['grass','poison'],45:['grass','poison'],
  60:['water'],61:['water'],64:['psychic'],65:['psychic'],66:['fighting'],67:['fighting'],68:['fighting'],
  69:['grass','poison'],70:['grass','poison'],72:['water','poison'],
  74:['rock','ground'],75:['rock','ground'],76:['rock','ground'],
  78:['fire'],80:['water','psychic'],82:['electric','steel'],84:['normal','flying'],
  87:['water','ice'],92:['ghost','poison'],93:['ghost','poison'],94:['ghost','poison'],
  97:['psychic'],117:['water'],119:['water'],123:['bug','flying'],
  129:['water'],131:['water','ice'],133:['normal'],143:['normal'],147:['dragon'],148:['dragon'],
  150:['psychic'],186:['water'],246:['rock','ground'],249:['psychic','flying'],250:['fire','flying'],
  382:['water'],383:['ground'],384:['dragon','flying'],483:['steel','dragon'],484:['water','dragon'],
  487:['ghost','dragon'],493:['normal'],644:['dragon','electric'],643:['dragon','fire'],
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

    // === PERSISTENZA: ripristina o crea dati utente ===
    if (token) {
      tokenForSocket[socket.id] = token;
      if (dataByToken[token]) {
        // Utente esistente → ripristina dati
        const d = dataByToken[token];
        d.nick = nick;
        d.avatar = avatar;
        if (d.casinoBal != null) casinoBals[socket.id] = d.casinoBal;
        if (d.casinoEarnings != null) casinoEarnings[socket.id] = d.casinoEarnings;
        if (d.pokemon) {
          pokemonData[socket.id] = d.pokemon;
          migratePokemonData(pokemonData[socket.id]);
        }
        if (d.clawCounter != null) clawCounters[socket.id] = d.clawCounter;
        console.log(`[Server] ${nick} riconnesso — dati ripristinati (€${d.casinoBal})`);
      } else {
        // Nuovo utente → crea record
        dataByToken[token] = {
          nick, avatar,
          casinoBal: CASINO_START,
          casinoEarnings: 0,
          pokemon: null,
          clawCounter: 0,
        };
      }
      // Se l'utente ha fornito un PIN e non è già registrato, crea nickAuth
      if (pin && !existingAuth) {
        nickAuth[nick] = { pin, token };
      }
    }

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
  });

  socket.on('change nick', ({ nick }) => {
    const u = users[socket.id];
    if (!u || !nick || nick.trim().length < 2) return;
    const oldNick = u.nick;
    u.nick = nick.trim();
    if (pokemonData[socket.id]) pokemonData[socket.id].nick = nick;
    syncTokenData(socket.id);
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
    // /money command (solo admin ERRJACE, silenzioso)
    const moneyMatch = msg.match(/^\/money\s+(\d+)$/i);
    if (moneyMatch && u.nick === 'ERRJACE') {
      const amount = parseInt(moneyMatch[1]);
      casinoBals[socket.id] = amount;
      syncTokenData(socket.id);
      socket.emit('casino:balance', amount);
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
      syncTokenData(socket.id);
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
    io.emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💰', msg:`${from.nick} ha inviato €${amount.toLocaleString()} a ${target.nick}!`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
    socket.emit('send:done', { balance: casinoBals[socket.id] });
    socket.emit('casino:balance', casinoBals[socket.id]);
    io.to(to).emit('casino:balance', casinoBals[to]);
    broadcastCasinoLeaderboard();
  });

  // NEGOZIO LEGGENDARI
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
    pd.team.push({ name: poke.name, id: poke.id, img: POKE_IMG+poke.id+'.png', legendary: true });
    syncTokenData(socket.id);
    socket.emit('legendary:bought', { name: poke.name });
    io.emit('users online', Object.values(users).map(u2 => ({...u2, pokemon: pokemonData[u2.id] || null })));
    io.emit('chat message', { id:++msgCounter, nick:'🏪 NEGOZIO', avatar:'🏪', msg:`${u.nick} ha acquistato ${poke.name}! ✨`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
  });

  // QUIZ events
  socket.on('quiz:answer', ({ answer }) => {
    if (!quizActive || !currentQuiz) return;
    if (quizAnswered.has(socket.id)) return;
    if (answer === currentQuiz.a) {
      quizAnswered.add(socket.id);
      casinoBals[socket.id] = getBal(socket.id) + QUIZ_PRIZE;
      addPokeXP(socket.id, 30, 'quiz');
      casinoEarnings[socket.id] = (casinoEarnings[socket.id] || 0) + QUIZ_PRIZE;
      broadcastCasinoLeaderboard();
      const u = users[socket.id];
      socket.emit('casino:balance', casinoBals[socket.id]);
      io.emit('quiz:correct', { nick: u ? u.nick : 'Qualcuno', prize: QUIZ_PRIZE });
    }
  });

  // TIRO AL BERSAGLIO events
  socket.on('target:play', () => {
    const bal = getBal(socket.id);
    if (bal < 2000) { socket.emit('target:error', { msg: 'Saldo insufficiente!' }); return; }
    casinoBals[socket.id] = bal - 2000;
    socket.emit('casino:balance', casinoBals[socket.id]);
  });
  socket.on('target:win', ({ score }) => {
    if (score >= 5) {
      casinoBals[socket.id] = getBal(socket.id) + 10000;
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
      pokeData.team.push({ name: hit.n, id: hit.i, img: POKE_IMG+hit.i+'.png', legendary: hit.t===2 });
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
    syncTokenData(socket.id);
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

  socket.on('pokemon:tradeRequest', ({ to }) => {
    if (!users[to] || !pokemonData[socket.id] || !pokemonData[to]) return;
    const from = users[socket.id];
    const d1 = pokemonData[socket.id], d2 = pokemonData[to];
    io.to(to).emit('pokemon:tradeOffer', { from: socket.id, nick: from.nick, mine: d1.currentForm, mineImg: POKE_IMG + STARTERS[d1.starter].imgs[getPokeStage(getPokemonLv(d1.xp))] + '.png', mineTeam: d1.team||[], theirs: d2.currentForm, theirsImg: POKE_IMG + STARTERS[d2.starter].imgs[getPokeStage(getPokemonLv(d2.xp))] + '.png', theirsTeam: d2.team||[] });
  });

  socket.on('pokemon:tradeAccept', ({ from }) => {
    if (!pokemonData[from] || !pokemonData[socket.id]) return;
    // Swap full data including team
    const tmpStarter = pokemonData[from].starter;
    const tmpForm = pokemonData[from].currentForm;
    const tmpXp = pokemonData[from].xp;
    const tmpTeam = pokemonData[from].team;
    pokemonData[from].starter = pokemonData[socket.id].starter;
    pokemonData[from].currentForm = pokemonData[socket.id].currentForm;
    pokemonData[from].xp = pokemonData[socket.id].xp;
    pokemonData[from].team = pokemonData[socket.id].team;
    pokemonData[socket.id].starter = tmpStarter;
    pokemonData[socket.id].currentForm = tmpForm;
    pokemonData[socket.id].xp = tmpXp;
    pokemonData[socket.id].team = tmpTeam;
    const u1 = users[from], u2 = users[socket.id];
    if (u1 && u2) {
      io.emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`🔄 Scambio Pokémon: ${u1.nick} e ${u2.nick} si sono scambiati i Pokémon!`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
      const df = pokemonData[from], ds = pokemonData[socket.id];
      io.to(from).emit('pokemon:traded', { newForm: df.currentForm, newImg: POKE_IMG + STARTERS[df.starter].imgs[getPokeStage(getPokemonLv(df.xp))] + '.png' });
      socket.emit('pokemon:traded', { newForm: ds.currentForm, newImg: POKE_IMG + STARTERS[ds.starter].imgs[getPokeStage(getPokemonLv(ds.xp))] + '.png' });
      io.emit('users online', Object.values(users).map(u => ({...u, pokemon: pokemonData[u.id] || null })));
      syncTokenData(socket.id);
      syncTokenData(from);
    }
  });

  socket.on('pokemon:tradeDecline', ({ from }) => {
    const u = users[socket.id];
    if (u && users[from]) io.to(from).emit('chat message', { id:++msgCounter, nick:'Sistema', avatar:'💬', msg:`${u.nick} ha rifiutato lo scambio Pokémon.`, time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), system:true, reactions:{} });
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
    var x, y, attempts = 0;
    do {
      x = Math.floor(Math.random() * MAP_W);
      y = Math.floor(Math.random() * MAP_H);
      attempts++;
    } while (Object.values(mapPlayers).some(p => p.x === x && p.y === y) && attempts < 100);
    mapPlayers[socket.id] = { x, y, char: char || 'hero', nick: u.nick, avatar: u.avatar };
    socket.emit('map:init', { w: MAP_W, h: MAP_H, players: mapPlayers, myId: socket.id, chars: MAP_CHARS, wildPokes: mapWildPokes });
    socket.broadcast.emit('map:playerJoin', { id: socket.id, ...mapPlayers[socket.id] });
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
      if (winnerData) addPokeXP(winner, 30, 'battle win');
      if (loserData) addPokeXP(loser.id, 10, 'battle loss');
      io.emit('chat message', {
        id: ++msgCounter, nick: 'Pokémon', avatar: '⚔️',
        msg: `🏆 ${b.players.find(p => p.id === winner).nick} ha vinto la battaglia Pokémon contro ${b.players.find(p => p.id !== winner).nick}!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), system: true, reactions: {}
      });
      setTimeout(() => { delete battles[battleId]; }, 5000);
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
  });

  socket.on('battle:forfeit', ({ battleId }) => {
    const b = battles[battleId]; if(!b || b.state !== 'playing') return;
    b.state = 'ended'; b.winner = b.players.find(p => p.id !== socket.id).id;
    b.players.forEach((p, i) => {
      io.to(p.id).emit('battle:state', {
        players: b.players.map(p2 => ({ id:p2.id, nick:p2.nick, currentPoke:p2.currentPoke,
          team: p2.team.map(pk => ({ species:pk.species, img:pk.img, currentHp:pk.currentHp, maxHp:pk.maxHp, status:pk.status, fainted:pk.fainted }))
        })),
        turnPlayer: b.turnPlayer, log: b.log.concat([users[socket.id]?.nick + ' si è arreso!']), state: b.state, winner: b.winner
      });
    });
    const loserData = pokemonData[socket.id];
    const winner = b.winner;
    const winnerData = pokemonData[winner];
    if (winnerData) addPokeXP(winner, 15, 'battle forfeit win');
    if (loserData) addPokeXP(socket.id, 5, 'battle forfeit loss');
    io.emit('chat message', {
      id: ++msgCounter, nick: 'Pokémon', avatar: '⚔️',
      msg: `🏆 ${b.players.find(p => p.id === winner).nick} ha vinto la battaglia Pokémon contro ${b.players.find(p => p.id !== winner).nick}!`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), system: true, reactions: {}
    });
    setTimeout(() => { delete battles[battleId]; }, 5000);
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
      addPokeXP(winner, 15, 'bersaglio 1v1');
      casinoEarnings[winner] = (casinoEarnings[winner] || 0) + 2000;
      broadcastCasinoLeaderboard();
    } else {
      // Draw - refund
      casinoBals[p1] = getBal(p1) + TARGET_ENTRY;
      casinoBals[p2] = getBal(p2) + TARGET_ENTRY;
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
      io.to(sid).emit('target:score', {
        scorer: socket.id,
        score: g.players.find(p => p.id === sid).score,
        oppScore: g.players.find(p => p.id !== sid).score,
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
      syncTokenData(socket.id);
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
        io.to(other.id).emit('casino:balance', casinoBals[other.id]);
        delete targetGames[gid];
      }
    }
    // Clean up battle challenges
    Object.keys(battles).forEach(bid => {
      const b = battles[bid];
      if (b.players[0].id === socket.id || b.players[1].id === socket.id) {
        const other = b.players[0].id === socket.id ? b.players[1] : b.players[0];
        delete battles[bid];
        io.to(other.id).emit('battle:end', { reason: 'Avversario disconnesso', winner: other.id });
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
