/**
 * 原样复制启动图：保留 PNG 的全部像素，避免缩小和 WebP 有损压缩。
 * 静态启动页不经过 Vite，素材需要放在 public/splash 中。
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const output = new URL('../public/splash/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const name of ['hello-light.png', 'hello-dark.png']) {
  const source = new URL(`../src/assets/characters/${name}`, import.meta.url);
  const destination = new URL(name, output);
  copyFileSync(source, destination);
  const image = readFileSync(destination);
  console.log(`${name}: ${image.readUInt32BE(16)}×${image.readUInt32BE(20)}, original PNG`);
}
