'use strict';

module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/') || req.xhr || req.headers['content-type'] === 'application/json') {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin');
};
