const { safeStorage } = require('electron');

function encryptSecret(value) {
  if (!value) return '';
  const text = String(value);

  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(text, 'utf8').toString('base64');
  }

  return safeStorage.encryptString(text).toString('base64');
}

function decryptSecret(value) {
  if (!value) return '';
  const buffer = Buffer.from(value, 'base64');

  if (!safeStorage.isEncryptionAvailable()) {
    return buffer.toString('utf8');
  }

  return safeStorage.decryptString(buffer);
}

module.exports = {
  decryptSecret,
  encryptSecret
};
