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
