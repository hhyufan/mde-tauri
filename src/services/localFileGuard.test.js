import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyFileVersions,
  clearDiskBaselines,
  metadataMatchesBaseline,
  moveDiskBaseline,
  normalizeFileMetadata,
  rememberDiskBaseline,
} from './localFileGuard';

describe('localFileGuard', () => {
  beforeEach(() => clearDiskBaselines());

  it('normalizes precise desktop and legacy metadata', () => {
    expect(normalizeFileMetadata({ modified_ms: 1234, modified: 1, size: 8 }))
      .toEqual({ modifiedAt: 1234, size: 8 });
    expect(normalizeFileMetadata({ modified: 12, size: 3 }))
      .toEqual({ modifiedAt: 12000, size: 3 });
  });

  it('uses metadata only as the fast unchanged gate', () => {
    rememberDiskBaseline('C:\\note.md', 'base', { modified_ms: 10, size: 4 });
    expect(metadataMatchesBaseline('C:\\note.md', { modifiedAt: 10, size: 4 })).toBe(true);
    expect(metadataMatchesBaseline('C:\\note.md', { modifiedAt: 11, size: 4 })).toBe(false);
    moveDiskBaseline('C:\\note.md', 'C:\\renamed.md');
    expect(metadataMatchesBaseline('C:\\renamed.md', { modifiedAt: 10, size: 4 })).toBe(true);
  });

  it.each([
    ['base', 'editor change', 'base', 'unchanged'],
    ['base', 'same result', 'same result', 'converged'],
    ['base', 'base', 'external change', 'external-only'],
    ['base', 'editor change', 'external change', 'conflict'],
  ])('classifies base=%s editor=%s disk=%s as %s', (base, editor, disk, expected) => {
    expect(classifyFileVersions({
      baseContent: base,
      editorContent: editor,
      diskContent: disk,
    })).toBe(expected);
  });
});

