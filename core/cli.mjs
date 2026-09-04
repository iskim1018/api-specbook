#!/usr/bin/env node
// 사용법: node src/cli.mjs <spec.yaml|json> [...more] [-o <출력파일|디렉터리>]
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { buildModel } from './model.mjs';
import { renderHtml } from './render.mjs';

const args = process.argv.slice(2);
const inputs = [];
let out = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' || args[i] === '--out') out = args[++i];
  else if (args[i] === '-h' || args[i] === '--help') usage(0);
  else inputs.push(args[i]);
}
if (!inputs.length) usage(1);

function usage(code) {
  console.error('사용법: oas2html <spec.yaml> [...more] [-o <출력 파일 또는 디렉터리>]');
  process.exit(code);
}

const outIsDir = inputs.length > 1 || (out && (out.endsWith('/') || (fs.existsSync(out) && fs.statSync(out).isDirectory())));
if (outIsDir) fs.mkdirSync(out ?? '.', { recursive: true });

for (const input of inputs) {
  const raw = fs.readFileSync(input, 'utf8');
  const doc = input.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
  if (!doc || typeof doc !== 'object' || !(doc.openapi || doc.swagger)) {
    console.error(`OpenAPI 문서가 아닙니다: ${input}`);
    process.exitCode = 1;
    continue;
  }
  if (doc.swagger) {
    console.error(`Swagger 2.0 은 지원하지 않습니다. OpenAPI 3.x 로 변환 후 사용하세요: ${input}`);
    process.exitCode = 1;
    continue;
  }
  const model = buildModel(doc);
  const html = renderHtml(model);
  const base = path.basename(input).replace(/\.(ya?ml|json)$/i, '') + '.html';
  const target = outIsDir ? path.join(out ?? '.', base) : out ?? path.join(path.dirname(input), base);
  fs.writeFileSync(target, html);
  console.log(`${input} → ${target} (${model.ops.length} APIs, ${(html.length / 1024).toFixed(0)} KB)`);
}
