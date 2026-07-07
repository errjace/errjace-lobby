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

const users = {};

io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  console.log(`[${new Date().toLocaleTimeString()}] Connesso: ${socket.id} — IP: ${ip}`);

  socket.on('join lobby', ({ nick, avatar }) => {
    users[socket.id] = { id: socket.id, nick, avatar, ip };
    console.log(`[${new Date().toLocaleTimeString()}] ${nick} è entrato — IP: ${ip}`);
    io.emit('users online', Object.values(users));
    io.emit('chat message', {
      nick: 'Sistema',
      avatar: '💬',
      msg: `${nick} è entrato in lobby!`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      system: true,
    });
  });

  socket.on('chat message', (msg) => {
    const u = users[socket.id];
    if (!u) return;
    io.emit('chat message', {
      nick: u.nick,
      avatar: u.avatar,
      msg,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  });

  socket.on('music play', (data) => {
    const u = users[socket.id];
    console.log(`[${new Date().toLocaleTimeString()}] Musica: ${u ? u.nick + ' ha avviato' : 'Qualcuno ha avviato'} "${data.title}"`);
    io.emit('music play', data);
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

  socket.on('disconnect', () => {
    const u = users[socket.id];
    if (u) {
      io.emit('chat message', {
        nick: 'Sistema',
        avatar: '💬',
        msg: `${u.nick} è uscito dalla lobby.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        system: true,
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
