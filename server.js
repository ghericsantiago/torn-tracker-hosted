require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const http     = require('http');
const { Server: SocketIO } = require('socket.io');

const app       = express();
const PORT      = process.env.PORT || 3001;

// Pre-hash admin password at startup
app.locals.adminHash = bcrypt.hashSync(process.env.ADMIN_PASS || 'changeme', 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 8 * 60 * 60 * 1000 }, // 8h
}));

// Static files
app.use('/admin',   express.static(path.join(__dirname, 'public/admin')));
app.use('/trade',   express.static(path.join(__dirname, 'public/trade')));
app.use('/receipt', express.static(path.join(__dirname, 'public/receipt')));
app.get('/receipt/*', (req, res) => res.sendFile(path.join(__dirname, 'public/receipt/index.html')));
app.use('/',        express.static(path.join(__dirname, 'public/client')));

// Routes
app.use('/',       require('./routes/receipt'));
app.use('/',       require('./routes/trade'));
app.use('/admin',  require('./routes/admin'));
app.use('/api',             require('./routes/api'));
app.use('/api/portfolio',   require('./routes/portfolio'));
app.use('/admin/torn',  require('./routes/torn'));
app.use('/torn',       require('./routes/torn'));

// Tampermonkey REST sync endpoints — GM_xmlhttpRequest bypasses Torn's CSP
// GET  /api/sync        → returns full syncStore as JSON
// PUT  /api/sync        → merges body into syncStore, returns updated store
app.get('/api/sync', (req, res) => {
  res.json(syncStore);
});
app.put('/api/sync', (req, res) => {
  const sections = req.body;
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    Object.assign(syncStore, sections);
    console.log(`[sync] REST PUT sections: ${Object.keys(sections).join(', ')}`);
  }
  res.json(syncStore);
});

// ── Trade remote-control endpoints ───────────────────────────────────────────
// Shared between the Tampermonkey script (GM_xmlhttpRequest) and the mobile
// control page (via Socket.IO).  Authenticated with the same receipt token.
const TRADE_CTRL_TOKEN = process.env.RECEIPT_TOKEN || '926cc7e6-5092-40cc-ba8a-a3f9b8070a6c';
const tradeCtrl = { command: null, state: { stage: 'idle', tradeId: null, error: '' } };

function requireTradeToken(req, res, next) {
  const token = req.headers['x-receipt-token'] || req.query.token;
  if (token === TRADE_CTRL_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Script polls this every few seconds; the command is consumed (cleared) on read
app.get('/api/trade/command', requireTradeToken, (req, res) => {
  const command = tradeCtrl.command;
  tradeCtrl.command = null;
  res.json({ command });
});

// Script pushes its current job state here; server fans it out via Socket.IO
app.put('/api/trade/state', requireTradeToken, (req, res) => {
  tradeCtrl.state = { ...req.body, updatedAt: Date.now() };
  io.to('trade-admins').emit('trade:state', tradeCtrl.state);
  res.json({ ok: true });
});

// Start server
const server = http.createServer(app);

// ── Socket.IO sync store ──────────────────────────────────────────────────────
// In-memory key-value store shared across all connected tampermonkey scripts.
// Each section (e.g. "autofly_opts", "vault", "itemmarket") is a top-level key.
const syncStore = {};

const io = new SocketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  console.log(`[sync] client connected: ${socket.id}`);

  // Client requests the current full store
  socket.on('sync:get', (cb) => {
    if (typeof cb === 'function') cb(syncStore);
  });

  // Client saves one or more sections: { section1: data, section2: data, ... }
  socket.on('sync:set', (sections) => {
    if (!sections || typeof sections !== 'object') return;
    Object.assign(syncStore, sections);
    // Broadcast to all OTHER clients so they receive real-time updates
    socket.broadcast.emit('sync:update', sections);
    console.log(`[sync] saved sections: ${Object.keys(sections).join(', ')}`);
  });

  // ── Trade remote-control events ─────────────────────────────────────────
  socket.on('trade:join', (role, auth) => {
    if (auth !== TRADE_CTRL_TOKEN) return;
    if (role === 'trade-admins') {
      socket.join('trade-admins');
      socket.emit('trade:state', tradeCtrl.state); // send current state on join
    } else if (role === 'trade-scripts') {
      socket.join('trade-scripts');
    }
  });

  // Script reports its current job state → forward to admin viewers
  socket.on('trade:state', (state, auth) => {
    if (auth !== TRADE_CTRL_TOKEN) return;
    tradeCtrl.state = { ...state, updatedAt: Date.now() };
    socket.to('trade-admins').emit('trade:state', tradeCtrl.state);
  });

  // Mobile sends a command → push directly to scripts + store for REST fallback
  socket.on('trade:command', (cmd, auth) => {
    if (auth !== TRADE_CTRL_TOKEN) return;
    if (!cmd || !['skip'].includes(cmd.action)) return;
    tradeCtrl.command = cmd.action; // REST polling fallback
    io.to('trade-scripts').emit('trade:command', cmd); // real-time push
    console.log(`[trade] command: ${cmd.action}`);
    socket.emit('trade:command-ack', { action: cmd.action, issuedAt: Date.now() });
  });

  socket.on('disconnect', () => {
    console.log(`[sync] client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Torn Tracker running at http://localhost:${PORT}`);
});

// Start scheduler (cron every minute)
require('./scheduler').start();

// Guard inventory monitor behind the same admin session auth
app.use('/admin/inventory', require('./middleware/auth'));

// Mount inventory monitor (async — starts its own poll loop after server is up)
require('./inventory-monitor').mount(app).catch(e => {
  console.error('[inventory] failed to start:', e.message);
});
