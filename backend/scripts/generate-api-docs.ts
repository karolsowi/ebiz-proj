import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogToMarkdown } from '../src/openapi/generateApiMarkdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const docsDir = join(repoRoot, 'docs');
const outPath = join(docsDir, 'API.md');

mkdirSync(docsDir, { recursive: true });
writeFileSync(outPath, catalogToMarkdown(), 'utf8');
console.log(`Wrote ${outPath}`);
