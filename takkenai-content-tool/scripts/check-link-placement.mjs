import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'data', 'generated');
if (!fs.existsSync(dir)) {
  console.log('data/generated not found');
  process.exit(0);
}

const args = process.argv.slice(2);
const dateArg = args.find((arg) => arg.startsWith('--date='))?.slice('--date='.length);
const onlyDate = (dateArg || '').trim();

const files = fs
  .readdirSync(dir)
  .filter((f) => /\d{4}-\d{2}-\d{2}-(ameba|note|hatena)\.json$/.test(f))
  .filter((f) => (onlyDate ? f.startsWith(`${onlyDate}-`) : true))
  .sort();

if (files.length === 0) {
  console.log(onlyDate ? `PASS: no files found for date ${onlyDate}` : 'PASS: no generated files found');
  process.exit(0);
}

const issues = [];

for (const file of files) {
  const full = path.join(dir, file);
  let j;
  try {
    j = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    continue;
  }
  const body = String(j.body || '');
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) continue;
  const urlLineIndexes = lines
    .map((line, idx) => ({ line, idx }))
    .filter((x) => /https?:\/\/\S+/.test(x.line))
    .map((x) => x.idx);

  if (urlLineIndexes.length !== 1) {
    issues.push({ file, kind: 'url_count', detail: `url lines=${urlLineIndexes.length}` });
    continue;
  }

  const urlIdx = urlLineIndexes[0];
  const tailThreshold = Math.max(0, lines.length - 2);
  if (urlIdx >= tailThreshold) {
    issues.push({ file, kind: 'tail_url', detail: `url line near tail (${urlIdx + 1}/${lines.length})` });
  }

  if (/関連ツール・リソース/.test(body) && /不法行為・事務管理/.test(body)) {
    issues.push({ file, kind: 'off_topic_related', detail: 'related section contains unrelated topic phrase' });
  }
}

if (issues.length === 0) {
  console.log('PASS: no link placement issues found');
  process.exit(0);
}

console.log('FAIL: link placement issues found');
for (const it of issues) {
  console.log(`- ${it.file} [${it.kind}] ${it.detail}`);
}
process.exit(1);
