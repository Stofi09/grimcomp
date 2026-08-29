import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');
const importPatterns = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  /^\s*import\s*['"]([^'"]+)['"]/gm,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(entry.name) === '.ts' ? [path] : [];
  }));
  return nested.flat();
}

const violations = [];
for (const path of await sourceFiles(sourceRoot)) {
  const source = await readFile(path, 'utf8');
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) {
        violations.push(`${relative(packageRoot, path)} imports ${JSON.stringify(specifier)}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('@grimcomp/core must remain dependency-free and platform-neutral:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}
