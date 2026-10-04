import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializeMsvc } from './windows-msvc.mjs';

const args = process.argv.slice(2);
try {
  initializeMsvc(args);
  if (!process.env.CARGO_TARGET_DIR) {
    process.env.CARGO_TARGET_DIR = fileURLToPath(new URL('../src-tauri/target', import.meta.url));
  }
  // Load the native CLI after initializing its inherited compiler environment.
  const require = createRequire(import.meta.url);
  const cli = require('@tauri-apps/cli');
  await cli.run(args, 'npm run tauri');
} catch (error) {
  console.error(`[mde] ${error.message}`);
  process.exitCode = 1;
}
