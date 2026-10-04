import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from './apiClient';

describe('normalizeBaseUrl', () => {
  it('normalizes an explicit HTTPS endpoint without changing its host', () => {
    expect(normalizeBaseUrl(' https://sync.example.test/ '))
      .toBe('https://sync.example.test');
  });

  it('adds HTTPS only to a non-empty hostname', () => {
    expect(normalizeBaseUrl('sync.example.test')).toBe('https://sync.example.test');
  });

  it.each([
    '',
    '   ',
    'http://[invalid',
    'ftp://sync.example.test',
    'https://user:secret@sync.example.test',
    'https://sync.example.test/api',
  ])('rejects an invalid endpoint instead of falling back', (value) => {
    expect(() => normalizeBaseUrl(value)).toThrow(expect.objectContaining({
      code: 'INVALID_SERVER_URL',
    }));
  });
});
