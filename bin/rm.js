import { rm } from "node:fs/promises";
/**
 * Cross platform `rm -rf` for package scripts
 */

for (let i = 2; i < process.argv.length; i++) {
  let arg = process.argv[i];
  if (arg === '--') {
    continue;
  }
  try {
    await rm(arg, { recursive: true });
  } catch { /* */ }
}
