'use strict';

/**
 * Password hashing for local (email + password) accounts.
 *
 * Uses scrypt from node:crypto — no third-party dependency. The stored format
 * carries its own parameters so cost can be raised later without invalidating
 * existing hashes:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<derived key base64>
 *
 * Verification is constant-time (timingSafeEqual) and every failure returns
 * the same false so callers cannot distinguish "no such account" from
 * "wrong password" by result alone.
 */

const crypto = require('node:crypto');

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// scrypt needs roughly 128 * N * r bytes; give it headroom or it errors.
const MAXMEM = 128 * N * R * 2;

function derive(password, salt, { keyLength = KEY_LENGTH, n = N, r = R, p = P } = {}) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLength,
      { N: n, r, p, maxmem: MAXMEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** @returns {Promise<string>} stored hash, safe to persist */
async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** @returns {Promise<boolean>} */
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = await derive(password, salt, {
      keyLength: expected.length,
      n: Number.parseInt(rawN, 10) || N,
      r: Number.parseInt(rawR, 10) || R,
      p: Number.parseInt(rawP, 10) || P,
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// A real hash of a random value, computed lazily on the first login attempt
// for an unknown email. Spending the same CPU time on misses as on hits keeps
// response timing from revealing which emails have accounts.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(crypto.randomBytes(24).toString('hex'));
  }
  return dummyHashPromise;
}

/** Burn the same work as a real verification when no account exists. */
async function burnPasswordTime(password) {
  const stored = await dummyHash();
  await verifyPassword(password, stored);
}

module.exports = { hashPassword, verifyPassword, burnPasswordTime };
