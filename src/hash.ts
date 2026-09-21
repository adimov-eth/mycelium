/**
 * Content-Addressing
 *
 * Hash(x) = SHA-256(UTF-8(CSEXP-1(x)))
 * Display: lowercase base32, no padding (52 characters)
 */

import { createHash } from 'crypto';
import type { Hash, MyceliumObject } from './types.js';
import { canonical } from './canonical.js';

/**
 * Encode bytes to lowercase base32 (RFC 4648, no padding)
 */
function toBase32(buffer: Buffer): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Compute SHA-256 hash of UTF-8 string, return as lowercase base32
 */
export function sha256base32(input: string): Hash {
  const hash = createHash('sha256').update(input, 'utf8').digest();
  return toBase32(hash) as Hash;
}

/**
 * Compute content-address hash for a Mycelium object
 */
export function hashObject(obj: MyceliumObject): Hash {
  const canonicalForm = canonical(obj);
  return sha256base32(canonicalForm);
}

/**
 * Validate that a string looks like a valid hash (52 lowercase base32 chars)
 */
export function isValidHash(s: string): s is Hash {
  return /^[a-z2-7]{52}$/.test(s);
}

/**
 * Assert that a string is a valid hash, throw if not
 */
export function assertHash(s: string): Hash {
  if (!isValidHash(s)) {
    throw new Error(`Invalid hash: ${s}`);
  }
  return s;
}
