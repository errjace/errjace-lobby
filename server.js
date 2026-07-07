const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

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

io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  console.log(`[${new Date().toLocaleTimeString()}] Connesso: ${socket.id} — IP: ${ip}`);

  socket.on('join lobby', ({ nick, avatar }) => {
    users[socket.id] = { id: socket.id, nick, avatar, ip };
    console.log(`[${new Date().toLocaleTimeString()}] ${nick} è entrato — IP: ${ip}`);
    io.emit('users online', Object.values(users));
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

  socket.on('chat message', (msg) => {
    const u = users[socket.id];
    if (!u) return;
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
      const clients = [game.player1, game.player2];
      clients.forEach(id => io.to(id).emit('game state', game));
      clients.forEach(id => io.to(id).emit('game end', { reason: 'Vittoria!', winner: socket.id }));
      delete games[gameId];
      return;
    }
    [game.player1, game.player2].forEach(id => io.to(id).emit('game state', game));
  });

  socket.on('game leave', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    const other = game.player1 === socket.id ? game.player2 : game.player1;
    io.to(other).emit('game end', { reason: 'Avversario ha lasciato la partita' });
    delete games[gameId];
  });

  // Voice Chat signaling
  socket.on('voice join', () => {
    const u = users[socket.id];
    if (!u) return;
    socket.broadcast.emit('voice user joined', { id: socket.id, nick: u.nick });
  });

  socket.on('voice leave', () => {
    socket.broadcast.emit('voice user left', { id: socket.id });
  });

  socket.on('voice signal', ({ to, signal }) => {
    io.to(to).emit('voice signal', { from: socket.id, signal });
  });

  socket.on('disconnect', () => {
    const u = users[socket.id];
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
      io.emit('users online', Object.values(users));
    }
    if (u) console.log(`[${new Date().toLocaleTimeString()}] ${u.nick} è uscito — IP: ${u.ip}`);
    else console.log(`[${new Date().toLocaleTimeString()}] Disconnesso: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server ERRJACE attivo su http://localhost:${PORT}`);
});
