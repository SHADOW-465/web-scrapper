// Check the actual deployment file list, without falling back to local node_modules.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const trace = path.join(root, '.next/server/app/api/scan/route.js.nft.json');
const isolated = mkdtempSync(path.join(tmpdir(), 'scrape-trace-'));
try {
  const files = JSON.parse(readFileSync(trace, 'utf8')).files;
  let count = 0;
  for (const file of files) {
    const source = path.resolve(path.dirname(trace), file);
    const relative = path.relative(root, source);
    if (!relative.startsWith('node_modules' + path.sep)) continue;
    const dest = path.join(isolated, relative);
    mkdirSync(path.dirname(dest), {recursive:true});
    copyFileSync(source, dest);
    count++;
  }
  writeFileSync(path.join(isolated, 'check.mjs'), `
    await import('puppeteer-core');
    await import('linkedom');
    await import('@sparticuz/chromium');
    console.log('Traced browser and HTML dependencies start successfully.');
  `);
  const result = spawnSync(process.execPath, ['check.mjs'], {cwd:isolated, encoding:'utf8'});
  console.log(`Checked ${count} traced dependency files in an isolated directory.`);
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exitCode = result.status ?? 1;
} finally {
  // Only remove the unique directory created by this test.
  if (path.dirname(isolated) !== path.resolve(tmpdir()) || !path.basename(isolated).startsWith('scrape-trace-')) {
    throw new Error('Unexpected temporary directory; refusing cleanup.');
  }
  rmSync(isolated, {recursive:true, force:true});
}
