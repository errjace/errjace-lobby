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
  res.sendFile(path.join(__dirname, 'amici.html'));
});

app.get('/amici.html', (req, res) => {
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

  socket.on('disconnect', () => {
    const u = users[socket.id];
    if (u) {
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
