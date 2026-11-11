// People with no login (2026-11-06, docs/client-features-2026-11/02a-people-no-login-logic.md).
import User from '../models/User.js';

// Kept as text, so 0005 stays 0005.
export const cleanDeviceCode = (code) => String(code ?? '').trim();

export async function deviceCodeTaken(companyId, deviceCode, exceptUserId = null) {
  return !!(await User.exists({
    companyId,
    deviceCode,
    ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}),
  }));
}

// Email's old unique index counted a blank as a value, so a second person with no
// email would be refused. Mongoose won't change an existing index by itself, so
// this swaps it at server start; there's no script to run on live. It does nothing
// once swapped. During the swap the controllers' own duplicate check still applies.
export async function ensureUserIndexes() {
  const indexes = await User.collection.indexes();
  const old = indexes.find((i) => i.name === 'email_1' && !i.partialFilterExpression);
  if (old) await User.collection.dropIndex('email_1');
  await User.createIndexes();
}
