import { readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(projectRoot, 'src');
const scratchFiles = [];

function collectScratchFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectScratchFiles(entryPath);
    } else if (entry.isFile() && entry.name.startsWith('__scratch')) {
      scratchFiles.push(relative(projectRoot, entryPath).split(sep).join('/'));
    }
  }
}

collectScratchFiles(sourceRoot);

if (scratchFiles.length > 0) {
  console.error('Scratch files are not allowed under web/src:');
  for (const file of scratchFiles) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log('No scratch files found under web/src.');
}
