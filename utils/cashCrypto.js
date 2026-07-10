import crypto from 'crypto';

// Reversible encryption for the company Cash Password — unlike user login
// passwords (bcrypt-hashed), the Company Admin must be able to VIEW the
// password they set, so it's stored AES-256-GCM encrypted rather than hashed.
const KEY = crypto
  .createHash('sha256')
  .update(process.env.CASH_PASSWORD_SECRET || process.env.JWT_SECRET || 'samtek-cash-password-secret')
  .digest();

export function encryptCashPassword(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
}

export function decryptCashPassword(stored) {
  if (!stored) return null;
  try {
    const [ivHex, tagHex, encHex] = stored.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
