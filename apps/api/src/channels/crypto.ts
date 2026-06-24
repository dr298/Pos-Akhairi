// AES-256-GCM symmetric encryption for channel credentials at rest.
// We use a single key derived from JWT_SECRET (production should set
// CHANNEL_ENCRYPTION_KEY as a 32-byte base64 string).

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const envKey = process.env.CHANNEL_ENCRYPTION_KEY;
  if (envKey) {
    // Accept base64 or hex; fall back to UTF-8.
    try {
      if (envKey.length === 44) return Buffer.from(envKey, 'base64');
      if (envKey.length === 64) return Buffer.from(envKey, 'hex');
    } catch {
      // fall through
    }
    return Buffer.from(envKey, 'utf8').subarray(0, 32);
  }
  // Production must provide CHANNEL_ENCRYPTION_KEY as 32-byte key
  if (!process.env.JWT_SECRET) {
    throw new Error('CHANNEL_ENCRYPTION_KEY or JWT_SECRET environment variable is required for encryption');
  }
  // Fallback: derive from JWT_SECRET with warning (not recommended for production)
  console.warn('WARNING: Using JWT_SECRET for channel encryption. Set CHANNEL_ENCRYPTION_KEY for production.');
  return createHash('sha256')
    .update(process.env.JWT_SECRET)
    .digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // base64 of iv | tag | ciphertext
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < 12 + 16) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString('utf8');
}
