import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseManifest({
  version,
  signature,
  repository,
  date = new Date().toISOString(),
}) {
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Invalid release version');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid GitHub repository');
  if (!signature?.trim()) throw new Error('The custom installer must be signed before publishing');
  const installer = {
    signature: signature.trim(),
    url: `https://github.com/${repository}/releases/download/v${version}/MokiDown_${version}_x64-setup.exe`,
  };
  return {
    version,
    notes: `MokiDown ${version}`,
    pub_date: date,
    platforms: {
      'windows-x86_64': installer,
      // Older clients can request an installer-specific target. Both must
      // migrate through the same branded EXE, including clients installed by MSI.
      'windows-x86_64-nsis': installer,
      'windows-x86_64-msi': installer,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { version } = JSON.parse(
    await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
  );
  const directory = path.join(root, 'src-tauri/target/release/bundle/react');
  const signature = await readFile(
    path.join(directory, `MokiDown_${version}_x64-setup.exe.sig`),
    'utf8',
  );
  const manifest = releaseManifest({
    version,
    signature,
    repository: process.env.GITHUB_REPOSITORY || 'hhyufan/mokidown',
  });
  await writeFile(path.join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
