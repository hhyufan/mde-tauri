import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const assetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const html = await readFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)), 'utf8');
const match = html.match(/<script[^>]+src="\/?assets\/([^"]+\.js)"/);
if (!match) throw new Error('Could not resolve the JavaScript entry from dist/index.html');
const entry = match[1];
const { size } = await stat(join(assetsDir, entry));
const budget = 700 * 1024;
if (size > budget) {
  throw new Error(`Entry bundle ${entry} is ${(size / 1024).toFixed(1)} KiB; budget is 700 KiB`);
}
console.log(`Entry bundle budget passed: ${(size / 1024).toFixed(1)} KiB / 700 KiB`);
