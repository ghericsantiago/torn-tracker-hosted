'use strict';

module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin');
};
