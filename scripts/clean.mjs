import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const dirsToClean = [
  'apps/builder/dist',
  'packages/contracts/dist',
  'packages/core/dist',
  'packages/auth/dist',
  'packages/navigation/dist',
  'packages/integration/dist',
  'packages/expo-generator/dist',
  'packages/testing/dist',
];

for (const rel of dirsToClean) {
  const fullPath = path.join(rootDir, rel);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}
console.log('Cleaned workspace build artifacts.');
