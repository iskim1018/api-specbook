// core/ 엔진 회귀 테스트 (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { buildModel } from '../core/model.mjs';
import { renderHtml, slugify } from '../core/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 최소 골격 위에 paths/components 를 얹어 주는 헬퍼
function spec({ paths = {}, components = {}, info = {}, tags } = {}) {
  const doc = {
    openapi: '3.0.3',
    info: { title: '테스트 API', version: '1.0', ...info },
    paths,
    components,
  };
  if (tags) doc.tags = tags;
  return doc;
}

function opWith(extra) {
  return { get: { operationId: 'test', summary: '테스트', tags: ['샘플'], responses: { 200: { description: 'OK' } }, ...extra } };
}

function html(doc) {
  return renderHtml(buildModel(doc), { generatedAt: '2026-01-01' });
}

// 태그 안에 살아 있는 on* 이벤트 핸들러만 잡아낸다.
// 따옴표로 감싼 속성값은 이미 이스케이프된 텍스트(title="a&quot; onmouseover=..." 등)이므로
// 검사 전에 비워서 오탐을 막는다. 진짜 핸들러는 속성 이름 자리에 남으므로 그대로 걸린다.
function hasEventHandler(html) {
  const stripped = String(html)
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''");
  return /<[a-z][^>]*\son[a-z]+\s*=/i.test(stripped);
}

// ---------------------------------------------------------------- A. 마크다운 XSS

test('A: description 의 원본 HTML·위험 URL 이 실행 가능한 형태로 나가지 않는다', () => {
  const payload = [
    '<img src=x onerror="alert(1)">',
    '',
    '<script>alert(1)</script>',
    '',
    '[x](javascript:alert(1))',
    '',
    '[y](JaVaScRiPt&#58;alert(2))',
    '',
    '![z](data:text/html;base64,PHNjcmlwdD4=)',
  ].join('\n');
  const out = html(spec({ info: { description: payload } }));
  const body = out.slice(out.indexOf('<main'));

  assert.ok(!body.includes('<img src=x'), '원본 img 태그가 그대로 통과함');
  // 실제 태그 안에 on* 이벤트 핸들러가 들어간 경우만 위험하다. (이스케이프된 텍스트는 무해)
  assert.ok(!hasEventHandler(body), 'on* 이벤트 핸들러가 태그로 남음');
  assert.ok(!body.includes('<script>alert(1)</script>'), '원본 script 태그가 그대로 통과함');
  assert.ok(!/href="javascript:/i.test(body), 'javascript: href 가 남음');
  assert.ok(!/href="[^"]*JaVaScRiPt/i.test(body), '난독화된 javascript: href 가 남음');
  assert.ok(!/src="data:text\/html/i.test(body), 'data:text/html 이미지가 남음');
  // 이스케이프된 형태로는 보여야 한다.
  assert.ok(body.includes('&lt;img src=x'), '원본 HTML 이 텍스트로 표시되지 않음');
  assert.ok(body.includes('&lt;script&gt;'), 'script 가 텍스트로 표시되지 않음');
});

test('A: 정상 마크다운(표·코드블록·강조·목록·https 링크)은 그대로 렌더링된다', () => {
  const src = [
    '| 이름 | 값 |',
    '| --- | --- |',
    '| a | 1 |',
    '',
    '**굵게** 그리고 *기울임*',
    '',
    '- 항목1',
    '- 항목2',
    '',
    '[사이트](https://example.com)',
    '',
    '```json',
    '{"a":1}',
    '```',
  ].join('\n');
  const body = html(spec({ info: { description: src } }));

  assert.ok(body.includes('<table>'), '표가 렌더링되지 않음');
  assert.ok(body.includes('<strong>굵게</strong>'), '강조가 렌더링되지 않음');
  assert.ok(body.includes('<em>기울임</em>'), '기울임이 렌더링되지 않음');
  assert.ok(body.includes('<li>항목1</li>'), '목록이 렌더링되지 않음');
  assert.ok(body.includes('<a href="https://example.com">사이트</a>'), 'https 링크가 유지되지 않음');
  assert.ok(body.includes('language-json'), '코드블록이 렌더링되지 않음');
});

// ---------------------------------------------------------------- B. 외부 폰트

test('B: 외부 폰트 링크 없이 self-contained 로 나온다', () => {
  const out = html(spec());
  assert.ok(!out.includes('fonts.googleapis.com'), 'Google Fonts 링크가 남아 있음');
  assert.ok(!out.includes('fonts.gstatic.com'), 'Google Fonts 링크가 남아 있음');
  assert.ok(!/<link\b/i.test(out), '외부 <link> 가 남아 있음');
  assert.ok(out.includes('"Nanum Myeongjo"'), '로컬 serif 스택이 사라짐');
});

// ---------------------------------------------------------------- C. 자기 참조 스키마

test('C: 자기 참조 스키마도 스택 오버플로 없이 렌더링된다', () => {
  const doc = spec({
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
    },
    paths: {
      '/nodes': opWith({
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } },
        },
      }),
    },
  });

  const model = buildModel(doc);
  const rows = model.ops[0].responses[0].rows;
  assert.ok(rows.some((r) => r.name === 'children'), 'children 행이 없음');
  const cyc = rows.find((r) => r.description.includes('순환 참조: Node'));
  assert.ok(cyc, '순환 지점이 "(순환 참조: Node)" 로 표시되지 않음');
  assert.equal(cyc.hasChildren, false, '순환 지점이 잎 행이 아님');

  const out = renderHtml(model, { generatedAt: '2026-01-01' });
  assert.ok(out.includes('(순환 참조: Node)'));
});

// ---------------------------------------------------------------- D. $ref 캐시

test('D: 같은 $ref 를 서로 다른 description 으로 두 번 써도 각자 설명을 지킨다', () => {
  const doc = spec({
    components: {
      schemas: {
        X: { type: 'string' },
        Wrapper: {
          type: 'object',
          properties: {
            first: { $ref: '#/components/schemas/X', description: '첫 번째 설명' },
            second: { $ref: '#/components/schemas/X', description: '두 번째 설명' },
            bare: { $ref: '#/components/schemas/X' },
          },
        },
      },
    },
    paths: {
      '/w': opWith({
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Wrapper' } } } },
        },
      }),
    },
  });

  const rows = buildModel(doc).ops[0].responses[0].rows;
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.first.description, '첫 번째 설명');
  assert.equal(by.second.description, '두 번째 설명');
  assert.equal(by.bare.description, '', '형제 키 없는 참조에 남의 설명이 새어 들어옴');
});

// ---------------------------------------------------------------- E. 없는 $ref

test('E: 없는 $ref 는 문서를 죽이지 않고 자리표시자 + 경고가 된다', () => {
  const doc = spec({
    paths: {
      '/missing': opWith({
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Nope' } } } },
        },
      }),
    },
  });

  const model = buildModel(doc);
  assert.equal(model.warnings.length, 1);
  assert.ok(model.warnings[0].includes('#/components/schemas/Nope'));
  const res = model.ops[0].responses[0];
  assert.ok(res.schemaDescription.includes('(정의를 찾을 수 없음: #/components/schemas/Nope)'));
  assert.doesNotThrow(() => renderHtml(model, { generatedAt: '2026-01-01' }));
});

test('E: 경고가 없으면 warnings 는 빈 배열이다', () => {
  assert.deepEqual(buildModel(spec({ paths: { '/ok': opWith({}) } })).warnings, []);
});

// ---------------------------------------------------------------- F. 태그 앵커 slug

test('F: 공백·특수문자가 든 태그도 앵커가 일치하고 중복 시 구분된다', () => {
  const doc = spec({
    tags: [{ name: '안전 관리' }, { name: '안전/관리' }, { name: 'Users' }],
    paths: {
      '/a': { get: { operationId: 'a', tags: ['안전 관리'], responses: { 200: { description: 'OK' } } } },
      '/b': { get: { operationId: 'b', tags: ['안전/관리'], responses: { 200: { description: 'OK' } } } },
      '/c': { get: { operationId: 'c', tags: ['Users'], responses: { 200: { description: 'OK' } } } },
    },
  });
  const out = html(doc);

  const ids = [...out.matchAll(/<section class="tag-section" id="([^"]+)"/g)].map((m) => m[1]);
  const hrefs = [...out.matchAll(/<a class="nav-group-title" href="#([^"]+)"/g)].map((m) => m[1]);

  assert.deepEqual(ids, ['tag-안전-관리', 'tag-안전-관리-2', 'tag-Users']);
  assert.deepEqual(hrefs, ids, '목차 링크가 섹션 id 와 다름');
  assert.equal(new Set(ids).size, ids.length, 'id 가 중복됨');
  assert.ok(!ids.some((id) => /[\s/]/.test(id)), 'id 에 공백/슬래시가 남음');

  assert.equal(slugify('안전 관리'), '안전-관리');
  assert.equal(slugify('a b/c'), 'a-b-c');
  assert.equal(slugify('!!!'), 'tag');
});

// ---------------------------------------------------------------- G. 대표 media type

test('G: application/xml 이 먼저 와도 JSON 본문 표를 대표로 고른다', () => {
  const json = { type: 'object', properties: { id: { type: 'string' } } };
  const doc = spec({
    paths: {
      '/m': {
        post: {
          operationId: 'm',
          tags: ['샘플'],
          requestBody: { content: { 'application/xml': { schema: json }, 'application/json': { schema: json } } },
          responses: {
            200: {
              description: 'OK',
              content: { 'application/xml': { schema: json }, 'application/hal+json': { schema: json } },
            },
          },
        },
      },
    },
  });

  const op = buildModel(doc).ops[0];
  assert.equal(op.requestBody.contentType, 'application/json');
  assert.deepEqual(op.requestBody.otherContentTypes, ['application/xml']);
  assert.ok(op.requestBody.rows.length, 'JSON 본문 표가 비어 있음');
  assert.equal(op.responses[0].contentType, 'application/hal+json');
  assert.deepEqual(op.responses[0].otherContentTypes, ['application/xml']);
});

test('G: 우선순위에 없는 형식만 있으면 첫 번째를 쓴다 (기존 동작 유지)', () => {
  const doc = spec({
    paths: {
      '/m': {
        post: {
          operationId: 'm',
          tags: ['샘플'],
          requestBody: { content: { 'text/csv': {}, 'application/xml': {} } },
          responses: { 200: { description: 'OK' } },
        },
      },
    },
  });
  const rb = buildModel(doc).ops[0].requestBody;
  assert.equal(rb.contentType, 'text/csv');
  assert.deepEqual(rb.otherContentTypes, ['application/xml']);
});

// ---------------------------------------------------------------- H. 이미지 / URL

test('H: 이미지의 alt·title 페이로드가 속성을 탈출하지 못한다', () => {
  const payload = [
    '![x" onerror="alert(1)](https://a/b.png)',
    '',
    '![ok](https://a/c.png "t\\" onmouseover=\\"alert(2)")',
  ].join('\n');
  const out = html(spec({ info: { description: payload } }));
  const body = out.slice(out.indexOf('<main'));

  assert.ok(body.includes('<img '), '이미지가 렌더링되지 않음');
  assert.ok(!hasEventHandler(body), 'alt/title 페이로드가 이벤트 핸들러로 탈출함');
  assert.ok(body.includes('alt="x&quot; onerror=&quot;alert(1)"'), 'alt 가 이스케이프되지 않음');
  assert.ok(!/title="[^"]*"\s+on/i.test(body), 'title 뒤에 속성이 새로 생김');
});

test('H: 프로토콜 상대 URL(//host)은 무력화된다', () => {
  const payload = ['[a](//evil.example/x)', '', '![b](//evil.example/x.png)'].join('\n');
  const body = html(spec({ info: { description: payload } }));

  assert.ok(!body.includes('//evil.example'), '프로토콜 상대 URL 이 그대로 남음');
  assert.ok(body.includes('<a href="#">a</a>'), '링크가 # 로 대체되지 않음');
  assert.ok(body.includes('src="#"'), '이미지가 # 로 대체되지 않음');
});

// ---------------------------------------------------------------- I. 속성 자리 페이로드

test('I: parameter.in 값이 라벨·표 id 를 탈출하지 못한다', () => {
  const evil = '" onmouseover="alert(1)';
  const doc = spec({
    paths: {
      '/p': opWith({
        parameters: [{ name: 'q', in: evil, schema: { type: 'string' } }],
      }),
    },
  });
  const body = html(doc);

  assert.ok(!hasEventHandler(body), 'parameter.in 이 이벤트 핸들러로 탈출함');
  assert.ok(body.includes('&quot; onmouseover=&quot;alert(1)'), '라벨이 이스케이프된 형태로 보이지 않음');
  const ids = [...body.matchAll(/<table class="schema-table" id="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids.length, '파라미터 표가 없음');
  assert.ok(!ids.some((id) => /["'<>\s]/.test(id)), `표 id 에 위험한 문자가 남음: ${ids}`);
});

test('I: 응답 상태 코드 키가 id 속성을 탈출하지 못한다', () => {
  const evil = '2" onload="alert(1)';
  const doc = spec({
    paths: {
      '/r': opWith({
        responses: {
          [evil]: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object', properties: { a: { type: 'string' } } } } },
          },
        },
      }),
    },
  });
  const body = html(doc);

  assert.ok(!hasEventHandler(body), '상태 코드 키가 이벤트 핸들러로 탈출함');
  const ids = [...body.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(!ids.some((id) => /["'<>\s]/.test(id)), `id 에 위험한 문자가 남음: ${ids.filter((i) => /["'<>\s]/.test(i))}`);
  // 표시되는 상태 코드는 이스케이프된 텍스트로 남아야 한다.
  assert.ok(body.includes('2&quot; onload=&quot;alert(1)'), '상태 코드가 텍스트로 보이지 않음');
});

// ---------------------------------------------------------------- J. 순환 참조 (typeLabel / allOf)

function withSchemas(schemas, rootRef) {
  return spec({
    components: { schemas },
    paths: {
      '/x': opWith({
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: rootRef } } } } },
      }),
    },
  });
}

test('J: 자기 자신을 items 로 갖는 배열(A = array<A>)도 무한 재귀하지 않는다', () => {
  const doc = withSchemas({ A: { type: 'array', items: { $ref: '#/components/schemas/A' } } }, '#/components/schemas/A');
  let model;
  assert.doesNotThrow(() => {
    model = buildModel(doc);
  }, 'A = array<A> 에서 스택이 터짐');
  assert.ok(model.ops[0].responses[0].schemaType.includes('array<A>'), `배열 라벨이 이름으로 끊기지 않음: ${model.ops[0].responses[0].schemaType}`);
  assert.doesNotThrow(() => renderHtml(model, { generatedAt: '2026-01-01' }));
});

test('J: 배열끼리 상호 참조(C ↔ D)해도 무한 재귀하지 않는다', () => {
  const doc = withSchemas(
    {
      C: { type: 'array', items: { $ref: '#/components/schemas/D' } },
      D: { type: 'array', items: { $ref: '#/components/schemas/C' } },
    },
    '#/components/schemas/C',
  );
  let model;
  assert.doesNotThrow(() => {
    model = buildModel(doc);
  }, 'C ↔ D 상호 참조에서 스택이 터짐');
  assert.ok(model.ops[0].responses[0].schemaType.startsWith('array<'), '배열 라벨이 만들어지지 않음');
  assert.doesNotThrow(() => renderHtml(model, { generatedAt: '2026-01-01' }));
});

test('J: allOf 안에서 자기 자신을 참조해도(B: allOf[$ref B]) 무한 재귀하지 않는다', () => {
  const doc = withSchemas(
    {
      B: {
        allOf: [{ $ref: '#/components/schemas/B' }, { type: 'object', properties: { x: { type: 'string' } } }],
      },
    },
    '#/components/schemas/B',
  );
  let model;
  assert.doesNotThrow(() => {
    model = buildModel(doc);
  }, 'allOf 자기 참조에서 스택이 터짐');
  const rows = model.ops[0].responses[0].rows;
  assert.ok(rows.some((r) => r.name === 'x'), '자기 참조가 아닌 조각의 속성이 사라짐');
});

test('J: buildModel 은 입력 문서를 변경하지 않는다 (allOf 병합)', () => {
  const doc = withSchemas(
    {
      Base: {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { allOf: [{ type: 'object', properties: { b: { type: 'string' } } }] },
        ],
      },
    },
    '#/components/schemas/Base',
  );
  const before = JSON.stringify(doc);
  const model = buildModel(doc);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), JSON.parse(before), 'buildModel 이 입력 문서를 변경함');
  const names = model.ops[0].responses[0].rows.map((r) => r.name);
  assert.deepEqual(names.sort(), ['a', 'b'], 'allOf 병합 결과가 달라짐');
});

// ---------------------------------------------------------------- K. slug 충돌

test('K: 번호를 붙인 slug 가 다른 태그와 겹치지 않는다', () => {
  const doc = spec({
    tags: [{ name: 'A' }, { name: 'A!' }, { name: 'A-2' }],
    paths: {
      '/a': { get: { operationId: 'a', tags: ['A'], responses: { 200: { description: 'OK' } } } },
      '/b': { get: { operationId: 'b', tags: ['A!'], responses: { 200: { description: 'OK' } } } },
      '/c': { get: { operationId: 'c', tags: ['A-2'], responses: { 200: { description: 'OK' } } } },
    },
  });
  const out = html(doc);

  const ids = [...out.matchAll(/<section class="tag-section" id="([^"]+)"/g)].map((m) => m[1]);
  const hrefs = [...out.matchAll(/<a class="nav-group-title" href="#([^"]+)"/g)].map((m) => m[1]);

  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3, `slug 가 중복됨: ${ids}`);
  assert.deepEqual(hrefs, ids, '목차 링크가 섹션 id 와 다름');
});

// ---------------------------------------------------------------- L. CLI 종료 코드

test('L: 없는 $ref 가 있으면 CLI 가 파일은 쓰되 종료 코드 1 을 낸다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas2html-'));
  try {
    const specFile = path.join(dir, 'bad.yaml');
    fs.writeFileSync(
      specFile,
      yaml.dump(
        spec({
          paths: {
            '/missing': opWith({
              responses: {
                200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Nope' } } } },
              },
            }),
          },
        }),
      ),
    );
    const outFile = path.join(dir, 'bad.html');
    const res = spawnSync(process.execPath, [path.join(ROOT, 'core', 'cli.mjs'), specFile, '-o', outFile], { encoding: 'utf8' });

    assert.equal(res.status, 1, `종료 코드가 1 이 아님 (${res.status}) / stderr: ${res.stderr}`);
    assert.ok(res.stderr.includes('#/components/schemas/Nope'), '경고가 stderr 로 나오지 않음');
    assert.ok(fs.existsSync(outFile), '경고가 있어도 파일은 생성되어야 함');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- smoke

test('smoke: sample/example.yaml 이 렌더링되고 제목이 들어간다', () => {
  const file = path.join(ROOT, 'sample', 'example.yaml');
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  const model = buildModel(doc);
  const out = renderHtml(model, { generatedAt: '2026-01-01' });

  assert.deepEqual(model.warnings, []);
  assert.ok(model.ops.length > 0, 'API 가 하나도 없음');
  assert.ok(out.includes(`<title>${doc.info.title}`), '제목이 문서에 없음');
  assert.ok(out.startsWith('<!doctype html>'));
});
