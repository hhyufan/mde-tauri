import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findCompleteToolchain, parseDeveloperEnvironment } from './windows-msvc.mjs';

test('skip an incomplete newer Community compiler and use complete Build Tools', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mde-msvc-test-'));
  try {
    const community = path.join(root, 'Community');
    const buildTools = path.join(root, 'BuildTools');
    for (const installation of [community, buildTools]) {
      const files = [
        'VC/Auxiliary/Build/vcvarsall.bat',
        'VC/Tools/MSVC/14.51.36231/bin/Hostx64/x64/cl.exe',
        'VC/Tools/MSVC/14.51.36231/bin/Hostx64/x64/link.exe',
      ];
      if (installation === buildTools)
        files.push(
          'VC/Tools/MSVC/14.51.36231/include/vcruntime.h',
          'VC/Tools/MSVC/14.51.36231/lib/x64/libcmt.lib',
        );
      for (const file of files) {
        const destination = path.join(installation, file);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, 'fixture');
      }
    }
    assert.equal(findCompleteToolchain([community]), null);
    const selected = findCompleteToolchain([community, buildTools]);
    assert.equal(selected.installation, buildTools);
    assert.equal(selected.version, '14.51.36231');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('mde-msvc-test-'));
    rmSync(root, { recursive: true, force: true });
  }
});

test('parse compiler variables without breaking values containing equals or drive aliases', () => {
  assert.deepEqual(
    parseDeveloperEnvironment(
      'banner\r\n=C:=C:\\test\r\nINCLUDE=C:\\include\r\nLIB=C:\\lib\r\nTOKEN=a=b\r\n',
    ),
    { INCLUDE: 'C:\\include', LIB: 'C:\\lib', TOKEN: 'a=b' },
  );
});
