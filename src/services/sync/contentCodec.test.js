import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MAX_SYNC_DECODED_BYTES,
  SyncIntegrityError,
  decodeAndVerifySyncBody,
  encodeSyncBody,
} from './contentCodec';

describe('contentCodec', () => {
  beforeAll(() => {
    vi.stubGlobal('crypto', webcrypto);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips Unicode text without corrupting its UTF-8 size or hash', async () => {
    const content = '# 你好，云同步 🌏\nemoji: 👩🏽‍💻\n';

    const encoded = await encodeSyncBody(content);

    expect(encoded.compressed).toBe(false);
    expect(encoded.size).toBe(new TextEncoder().encode(content).byteLength);
    expect(encoded.checksum).toMatch(/^[a-f0-9]{64}$/);
    await expect(decodeAndVerifySyncBody(encoded)).resolves.toBe(content);
  });

  it('compresses and verifies a large Unicode snapshot', async () => {
    const content = '增量同步🙂\n'.repeat(4_096);

    const encoded = await encodeSyncBody(content);

    expect(encoded.compressed).toBe(true);
    expect(encoded.wireBytes).toBeLessThan(encoded.size);
    await expect(decodeAndVerifySyncBody(encoded)).resolves.toBe(content);
  });

  it('rejects malformed gzip data as an integrity error', async () => {
    await expect(decodeAndVerifySyncBody({
      content: 'bm90LWd6aXA=',
      compressed: true,
      size: 8,
    })).rejects.toMatchObject({
      name: 'SyncIntegrityError',
      code: 'SYNC_INTEGRITY_ERROR',
    });
  });

  it('rejects a snapshot whose checksum does not match its content', async () => {
    const content = 'trusted locally';

    await expect(decodeAndVerifySyncBody({
      content,
      compressed: false,
      size: new TextEncoder().encode(content).byteLength,
      checksum: '0'.repeat(64),
    })).rejects.toBeInstanceOf(SyncIntegrityError);
  });

  it.each([
    ['a non-zero declared size', 2],
    ['a zero declared size', 0],
  ])('rejects content that disagrees with %s', async (_label, size) => {
    await expect(decodeAndVerifySyncBody({
      content: 'abc',
      compressed: false,
      size,
    })).rejects.toMatchObject({
      code: 'SYNC_INTEGRITY_ERROR',
      details: {
        expectedSize: size,
        actualSize: 3,
      },
    });
  });

  it.each([-1, Number.NaN])('rejects invalid size metadata: %s', async (size) => {
    await expect(decodeAndVerifySyncBody({
      content: '',
      compressed: false,
      size,
    })).rejects.toBeInstanceOf(SyncIntegrityError);
  });

  it('rejects a declared decoded body above the safety limit before decoding', async () => {
    await expect(decodeAndVerifySyncBody({
      content: '',
      compressed: false,
      size: MAX_SYNC_DECODED_BYTES + 1,
    })).rejects.toBeInstanceOf(SyncIntegrityError);
  });
});
