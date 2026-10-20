'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAdminCredentials, validateAdminCredentials } = require('../services/admin-credentials');

test('stored credentials override environment bootstrap credentials', () => {
  assert.deepEqual(resolveAdminCredentials([
    { key: 'admin_username', value: 'owner' },
    { key: 'admin_password_hash', value: 'stored-hash' },
  ], { username: 'admin', passwordHash: 'env-hash' }), {
    username: 'owner',
    passwordHash: 'stored-hash',
  });
});

test('missing stored credentials fall back to environment bootstrap credentials', () => {
  assert.deepEqual(resolveAdminCredentials([], { username: 'admin', passwordHash: 'env-hash' }), {
    username: 'admin',
    passwordHash: 'env-hash',
  });
});

test('credential validation trims usernames and allows username-only changes', () => {
  assert.deepEqual(validateAdminCredentials(' owner ', ''), { username: 'owner', newPassword: '' });
});

test('credential validation rejects short usernames and weak new passwords', () => {
  assert.match(validateAdminCredentials('ab', '').error, /Username/);
  assert.match(validateAdminCredentials('owner', 'short').error, /password/i);
});

test('credential validation accepts a 12-character new password', () => {
  assert.deepEqual(validateAdminCredentials('owner', 'correct horse'), {
    username: 'owner',
    newPassword: 'correct horse',
  });
});