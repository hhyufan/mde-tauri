import { readFile, writeFile } from 'node:fs/promises';

const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const version = config.version;
if (!/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid Tauri version: ${version}`);
}

for (const file of ['package.json', 'package-lock.json', 'installer/src-tauri/tauri.conf.json']) {
  const json = JSON.parse(await readFile(file, 'utf8'));
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
}

for (const [directory, name] of [
  ['src-tauri', 'mokidown'],
  ['installer/src-tauri', 'mokidown-installer'],
]) {
  const cargoPath = `${directory}/Cargo.toml`;
  const cargo = await readFile(cargoPath, 'utf8');
  await writeFile(
    cargoPath,
    cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+"/, `$1${version}"`),
  );
  const lockPath = `${directory}/Cargo.lock`;
  const lock = await readFile(lockPath, 'utf8');
  await writeFile(
    lockPath,
    lock.replace(
      new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")[^"]+"`),
      `$1${version}"`,
    ),
  );
}
console.log(`Synchronized release version ${version}`);
