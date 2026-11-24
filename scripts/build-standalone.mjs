import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function stripModuleSyntax(code) {
  return code
    // Remove multi-line or single-line import statements
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    // Remove re-export statements like `export { Chess };`
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
    // Remove leading `export ` keywords on declarations
    .replace(/^(\s*)export\s+(?=(const|let|var|function|async\s+function|class)\b)/gm, '$1');
}

const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

const moduleOrder = [
  'vendor/chess.js',
  'js/pieces.js',
  'js/engine.js',
  'js/ai.js',
  'js/animator.js',
  'js/app.js',
];

const bundledJs = moduleOrder
  .map((relPath) => {
    const raw = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
    return `/* === ${relPath} === */\n${stripModuleSyntax(raw)}`;
  })
  .join('\n\n');

const standaloneHtml = html
  .replace('<link rel="stylesheet" href="./styles.css" />', () => `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="./js/app.js"></script>',
    () => `<script>\n(() => {\n'use strict';\n${bundledJs}\n})();\n</script>`
  );

const distDir = path.join(rootDir, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'sachy.html');
fs.writeFileSync(outPath, standaloneHtml, 'utf8');
console.log(`Built standalone HTML: ${outPath} (${(standaloneHtml.length / 1024).toFixed(1)} KB)`);
