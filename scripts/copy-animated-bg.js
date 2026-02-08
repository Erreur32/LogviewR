/**
 * Sync AnimatedBackground.tsx from mynetwork_app to src/components.
 * Run from project root: node scripts/copy-animated-bg.js
 * Re-run whenever MynetworK animation code is updated (each animation lives in this single file).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'mynetwork_app', 'src', 'components', 'AnimatedBackground.tsx');
const dest = path.join(root, 'src', 'components', 'AnimatedBackground.tsx');

if (!fs.existsSync(src)) {
  console.error('Source not found:', src);
  process.exit(1);
}
const destDir = path.dirname(dest);
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}
fs.copyFileSync(src, dest);
console.log('Copied AnimatedBackground.tsx to', dest);
