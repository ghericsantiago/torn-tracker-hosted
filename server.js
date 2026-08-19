require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const path     = require('path');

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
app.use('/admin',  express.static(path.join(__dirname, 'public/admin')));
app.use('/trade',  express.static(path.join(__dirname, 'public/trade')));
app.use('/',       express.static(path.join(__dirname, 'public/client')));

// Routes
app.use('/',       require('./routes/trade'));
app.use('/admin',  require('./routes/admin'));
app.use('/api',             require('./routes/api'));
app.use('/api/portfolio',   require('./routes/portfolio'));
app.use('/admin/torn',  require('./routes/torn'));
app.use('/torn',       require('./routes/torn'));

// Start server
const server = app.listen(PORT, () => {
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
