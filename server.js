const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me';
const db = new Database(path.join(__dirname, 'kawaii.db'));

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '🌸',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL CHECK(length(content) <= 500),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const avatars = ['🌸', '🦄', '🐰', '🐻', '🍓', '🌈', '🐱', '🧁', '✨', '🍡'];

function tokenFor(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}
function userView(user) { return { id: user.id, username: user.username, avatar: user.avatar }; }
function auth(req, res, next) {
  const token = req.cookies.kawaii_token || (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' }); }
}
function cleanText(value) { return String(value || '').trim().replace(/[<>]/g, ''); }

app.post('/api/auth/register', authLimiter, (req, res) => {
  const username = cleanText(req.body.username);
  const password = String(req.body.password || '');
  const avatar = avatars.includes(req.body.avatar) ? req.body.avatar : '🌸';
  if (!/^[\p{L}\d_]{3,20}$/u.test(username)) return res.status(400).json({ error: 'Tên cần 3–20 ký tự chữ, số hoặc dấu gạch dưới.' });
  if (password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Mật khẩu cần từ 6 đến 72 ký tự.' });
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, avatar) VALUES (?, ?, ?)').run(username, bcrypt.hashSync(password, 12), avatar);
    const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.cookie('kawaii_token', tokenFor(user), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
    res.status(201).json({ user: userView(user) });
  } catch { res.status(409).json({ error: 'Tên người dùng đã được sử dụng.' }); }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const username = cleanText(req.body.username);
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
  res.cookie('kawaii_token', tokenFor(user), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
  res.json({ user: userView(user) });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('kawaii_token'); res.json({ ok: true }); });
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Không tìm thấy tài khoản.' });
  res.json({ user: userView(user) });
});
app.get('/api/messages', auth, (req, res) => {
  const rows = db.prepare(`SELECT m.id, m.content, m.created_at AS createdAt, u.id AS userId, u.username, u.avatar FROM messages m JOIN users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT 100`).all().reverse();
  res.json({ messages: rows });
});

const online = new Map();
io.use((socket, next) => {
  try {
    const token = socket.handshake.headers.cookie?.match(/kawaii_token=([^;]+)/)?.[1];
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { next(new Error('Bạn cần đăng nhập để tham gia vương quốc.')); }
});
io.on('connection', (socket) => {
  const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(socket.user.id);
  if (!user) return socket.disconnect();
  online.set(socket.id, userView(user));
  io.emit('presence', Array.from(online.values()).filter((item, index, list) => list.findIndex(x => x.id === item.id) === index));
  socket.on('chat:send', (raw, callback) => {
    const content = cleanText(raw).slice(0, 500);
    if (!content) return callback?.({ error: 'Tin nhắn không được để trống.' });
    const result = db.prepare('INSERT INTO messages (user_id, content) VALUES (?, ?)').run(user.id, content);
    const message = { id: result.lastInsertRowid, content, userId: user.id, username: user.username, avatar: user.avatar, createdAt: new Date().toISOString() };
    io.emit('chat:message', message);
    callback?.({ ok: true });
  });
  socket.on('typing', () => socket.broadcast.emit('typing', { username: user.username }));
  socket.on('disconnect', () => { online.delete(socket.id); io.emit('presence', Array.from(online.values()).filter((item, index, list) => list.findIndex(x => x.id === item.id) === index)); });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`Kawaii Kingdom đang chạy tại http://localhost:${PORT}`));
