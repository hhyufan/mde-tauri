import pako from 'pako';

export const COMPRESS_THRESHOLD_BYTES = 16 * 1024;
export const MAX_SYNC_REQUEST_BYTES = 3.5 * 1024 * 1024;
export const MAX_SYNC_DECODED_BYTES = 32 * 1024 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class SyncIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SyncIntegrityError';
    this.code = 'SYNC_INTEGRITY_ERROR';
    this.details = details;
  }
}

/** Calculate a stable checksum for text before it crosses the sync boundary. */
export async function sha256Text(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new SyncIntegrityError('SHA-256 is unavailable in this runtime');
  }
  const digest = await subtle.digest('SHA-256', textEncoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Encode a complete document snapshot for the wire and the durable outbox. */
export async function encodeSyncBody(rawText) {
  if (typeof rawText !== 'string') {
    throw new TypeError('Sync content must be a string');
  }

  const rawBytes = textEncoder.encode(rawText);
  const checksum = await sha256Text(rawText);
  if (rawBytes.byteLength < COMPRESS_THRESHOLD_BYTES) {
    return {
      content: rawText,
      compressed: false,
      size: rawBytes.byteLength,
      checksum,
      wireBytes: rawBytes.byteLength,
    };
  }

  const compressed = pako.gzip(rawBytes);
  const content = bytesToBase64(compressed);
  return {
    content,
    compressed: true,
    size: rawBytes.byteLength,
    checksum,
    // Base64 is embedded directly in JSON, so its character count is the useful
    // request-size approximation rather than the smaller gzip byte count.
    wireBytes: content.length,
  };
}

/** Decode a snapshot. Integrity checks are intentionally handled separately. */
export function decodeSyncBody(body = {}) {
  if (typeof body.content !== 'string') {
    throw new SyncIntegrityError('The synchronized document has no text payload');
  }
  if (!body.compressed) return body.content;

  try {
    return textDecoder.decode(pako.ungzip(base64ToBytes(body.content)));
  } catch (error) {
    throw new SyncIntegrityError('The synchronized document cannot be decompressed', {
      cause: error?.message || String(error),
    });
  }
}

/** Decode and verify a remote snapshot before it is allowed to touch local data. */
export async function decodeAndVerifySyncBody(body = {}) {
  const hasExpectedSize = body.size !== undefined && body.size !== null;
  const expectedSize = Number(body.size);
  if (hasExpectedSize && (!Number.isFinite(expectedSize) || expectedSize < 0)) {
    throw new SyncIntegrityError('The synchronized document has invalid size metadata', {
      expectedSize: body.size,
    });
  }
  if (hasExpectedSize && expectedSize > MAX_SYNC_DECODED_BYTES) {
    throw new SyncIntegrityError('The synchronized document exceeds the decoded size limit', {
      expectedSize,
      maximumSize: MAX_SYNC_DECODED_BYTES,
    });
  }
  const content = decodeSyncBody(body);
  const actualSize = textEncoder.encode(content).byteLength;
  if (actualSize > MAX_SYNC_DECODED_BYTES) {
    throw new SyncIntegrityError('The synchronized document exceeds the decoded size limit', {
      actualSize,
      maximumSize: MAX_SYNC_DECODED_BYTES,
    });
  }
  if (hasExpectedSize && expectedSize !== actualSize) {
    throw new SyncIntegrityError('The synchronized document size does not match its metadata', {
      expectedSize,
      actualSize,
    });
  }

  const expectedChecksum = String(body.contentHash || body.checksum || '').toLowerCase();
  if (expectedChecksum) {
    const actualChecksum = await sha256Text(content);
    if (actualChecksum !== expectedChecksum) {
      throw new SyncIntegrityError('The synchronized document checksum does not match', {
        expectedChecksum,
        actualChecksum,
      });
    }
  }
  return content;
}

export function estimateSyncPayloadBytes(payload) {
  return textEncoder.encode(JSON.stringify(payload || {})).byteLength;
}

export function isSyncBodyTooLarge(body, envelope = {}) {
  if (Number(body?.size || 0) > MAX_SYNC_DECODED_BYTES) return true;
  return estimateSyncPayloadBytes({
    ...envelope,
    content: body?.content || '',
    compressed: Boolean(body?.compressed),
    size: Number(body?.size || 0),
    checksum: body?.checksum || '',
  }) > MAX_SYNC_REQUEST_BYTES;
}
