'use strict';

const MIN_ADMIN_USERNAME_LENGTH = 3;
const MAX_ADMIN_USERNAME_LENGTH = 64;
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const MAX_ADMIN_PASSWORD_LENGTH = 128;

function resolveAdminCredentials(rows, fallback) {
  const stored = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    username: stored.admin_username || fallback.username,
    passwordHash: stored.admin_password_hash || fallback.passwordHash,
  };
}

function validateAdminCredentials(username, newPassword) {
  const normalizedUsername = String(username || '').trim();
  const password = String(newPassword || '');

  if (normalizedUsername.length < MIN_ADMIN_USERNAME_LENGTH || normalizedUsername.length > MAX_ADMIN_USERNAME_LENGTH) {
    return { error: `Username must be ${MIN_ADMIN_USERNAME_LENGTH}-${MAX_ADMIN_USERNAME_LENGTH} characters.` };
  }
  if (password && (password.length < MIN_ADMIN_PASSWORD_LENGTH || password.length > MAX_ADMIN_PASSWORD_LENGTH)) {
    return { error: `New password must be ${MIN_ADMIN_PASSWORD_LENGTH}-${MAX_ADMIN_PASSWORD_LENGTH} characters.` };
  }
  return { username: normalizedUsername, newPassword: password };
}

module.exports = { resolveAdminCredentials, validateAdminCredentials };