/**
 * End-to-End Encryption (E2EE) utilities using native Web Crypto API.
 * Uses AES-GCM 256-bit encryption with a fresh 96-bit (12-byte) IV per chunk.
 * Guarantees zero-knowledge privacy from relay servers and network sniffers.
 */

export interface E2EEMetadata {
  is_encrypted: boolean;
  algorithm: 'AES-256-GCM';
}

/**
 * Generate a cryptographically random 256-bit AES-GCM symmetric key.
 */
export async function generateTransferKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to a URL-safe Base64 string for signaling transmission.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await window.crypto.subtle.exportKey('raw', key);
  const bytes = new Uint8Array(raw);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Import a Base64 string back into a CryptoKey for decryption.
 */
export async function importKey(base64Key: string): Promise<CryptoKey> {
  const binary = atob(base64Key);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return window.crypto.subtle.importKey(
    'raw',
    bytes.buffer,
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts an ArrayBuffer chunk with AES-GCM 256-bit.
 * Prepend a unique 12-byte IV to the ciphertext.
 * Format: [12 bytes IV | ciphertext + 16 bytes GCM auth tag]
 */
export async function encryptBuffer(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    key,
    data
  );

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return combined.buffer;
}

/**
 * Decrypts an ArrayBuffer chunk formatted as [12 bytes IV | ciphertext + auth tag].
 * Verifies authenticated tag and returns plaintext ArrayBuffer.
 */
export async function decryptBuffer(
  encryptedData: ArrayBuffer,
  key: CryptoKey
): Promise<ArrayBuffer> {
  if (encryptedData.byteLength < 28) {
    throw new Error('Encrypted payload too short (must contain at least 12-byte IV + 16-byte auth tag)');
  }
  const iv = new Uint8Array(encryptedData, 0, 12);
  const ciphertext = new Uint8Array(encryptedData, 12);

  return window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    key,
    ciphertext
  );
}

/**
 * Encrypts a Blob payload using AES-GCM.
 */
export async function encryptBlob(
  blob: Blob,
  key: CryptoKey
): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  const encrypted = await encryptBuffer(buffer, key);
  return new Blob([encrypted], { type: 'application/octet-stream' });
}

/**
 * Decrypts an encrypted Blob back into a plaintext Blob.
 */
export async function decryptBlob(
  encryptedBlob: Blob,
  key: CryptoKey,
  mimeType = 'application/octet-stream'
): Promise<Blob> {
  const buffer = await encryptedBlob.arrayBuffer();
  const decrypted = await decryptBuffer(buffer, key);
  return new Blob([decrypted], { type: mimeType });
}
