import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseManifest({
  version,
  signature,
  repository,
  date = new Date().toISOString(),
  // 换成非 GitHub 的下载基址（例如 OSS）时用这个。产物文件名始终相同，
  // 只是托管位置不同：国内走 OSS，海外（以及 OSS 不可用时）走 GitHub Release。
  downloadBase,
}) {
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Invalid release version');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid GitHub repository');
  if (!signature?.trim()) throw new Error('The custom installer must be signed before publishing');
  const base = (
    downloadBase ?? `https://github.com/${repository}/releases/download/v${version}`
  ).replace(/\/+$/, '');
  const installer = {
    signature: signature.trim(),
    url: `${base}/MokiDown_${version}_x64-setup.exe`,
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
  const directory = path.join(root, 'src-tauri/target/release/react');
  const flag = (name) => {
    const prefix = `--${name}=`;
    const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  // 默认读构建产物旁边的签名；sync-oss 任务里产物是从 Release 下到 dist/ 的，
  // 用 --sig 指过去。
  const signaturePath =
    flag('sig') ?? path.join(directory, `MokiDown_${version}_x64-setup.exe.sig`);
  const signature = await readFile(signaturePath, 'utf8');
  // 默认写 GitHub 版清单；给 --oss-base 时写一份下载地址指向 OSS 的清单，
  // 用 --out 指定文件名，避免覆盖 GitHub 那份。两份都出自同一个 releaseManifest()，
  // 免得两处逻辑各自漂移。
  const ossBase = flag('oss-base');
  const out = flag('out') ?? path.join(directory, 'latest.json');
  const manifest = releaseManifest({
    version,
    signature,
    repository: process.env.GITHUB_REPOSITORY || 'hhyufan/mokidown',
    ...(ossBase ? { downloadBase: ossBase } : {}),
  });
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`已写入 ${out}`);
  console.log(`  下载地址 ${manifest.platforms['windows-x86_64'].url}`);
}
