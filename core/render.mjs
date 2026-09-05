// 모델 → 단일 self-contained HTML
import { marked } from 'marked';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// data: URL 중 이미지만 허용한다. (SVG 는 스크립트를 품을 수 있어 제외)
const SAFE_DATA_URL = /^data:image\/(?!svg)[a-z0-9.+-]+[;,]/;
const BAD_SCHEME = /^(javascript|vbscript|data|file|blob|about):/;

// 브라우저는 href 안의 HTML 엔티티를 풀어서 해석하므로, 판정 전에 같은 방식으로 풀어 준다.
// (javascript&#58;alert(1) 같은 우회 차단)
function decodeEntities(s) {
  const chr = (n) => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => chr(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => chr(Number(d)))
    .replace(/&colon;?/gi, ':')
    .replace(/&(tab|newline|nbsp);?/gi, ' ');
}

// 링크/이미지 URL 무력화: 명세의 description 은 신뢰할 수 없는 입력이다.
// 프로토콜 상대 URL(//host/...)도 '#' 로 막는다. 내보낸 문서는 오프라인 self-contained 가
// 목적이므로 스킴 없이 외부 호스트를 불러오는 형태를 허용하지 않는다.
function safeUrl(href) {
  const raw = String(href ?? '');
  // 스킴 판정 전에 엔티티를 풀고 제어문자를 걷어낸다. (판정용 사본이며 출력은 원본)
  const probe = decodeEntities(raw).replace(/[\u0000-\u0020]/g, '').toLowerCase();
  if (probe.startsWith('//')) return '#';
  if (!BAD_SCHEME.test(probe)) return raw;
  return SAFE_DATA_URL.test(probe) ? raw : '#';
}

// 원본 HTML 토큰은 렌더링하지 않고 그대로 이스케이프한다. (미리보기/내보낸 HTML 의 XSS 차단)
marked.use({
  gfm: true,
  breaks: true,
  walkTokens(token) {
    if (token.type === 'link' || token.type === 'image') token.href = safeUrl(token.href);
  },
  renderer: {
    html(token) {
      return esc(typeof token === 'string' ? token : token.text);
    },
    // marked 15 의 기본 image 렌더러는 alt(text) 를 이스케이프하지 않아 속성 탈출이 가능하다.
    // (link 의 title/text 는 marked 가 이미 이스케이프하므로 그대로 둔다)
    image({ href, title, text }) {
      return `<img src="${esc(safeUrl(href))}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''}>`;
    },
  },
});

const md = (s) => (s ? `<div class="md">${marked.parse(String(s))}</div>` : '');
const mdInline = (s) => (s ? `<div class="md md-cell">${marked.parse(String(s))}</div>` : '');

// 태그 이름 → 앵커 id 조각. 한글/영문/숫자는 남기고 공백·특수문자는 '-' 로 바꾼다.
export function slugify(name) {
  const s = String(name ?? '')
    .trim()
    .replace(/[^0-9A-Za-z_\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7A3-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'tag';
}

// 태그 목록 전체에 대해 충돌 없는 slug 배열을 만든다.
// base 별 카운터만 쓰면 ['A','A!','A-2'] 처럼 붙인 번호가 다른 태그와 겹칠 수 있으므로,
// 최종 slug 를 taken 에 모아 실제로 비어 있는 번호를 찾을 때까지 올린다.
function tagSlugs(groups) {
  const used = new Map();
  const taken = new Set();
  return groups.map((g) => {
    const base = slugify(g.tag);
    let n = used.get(base) ?? 1;
    let slug = n === 1 ? base : `${base}-${n}`;
    while (taken.has(slug)) {
      n += 1;
      slug = `${base}-${n}`;
    }
    used.set(base, n + 1);
    taken.add(slug);
    return slug;
  });
}
// 목차 검색 색인: ID·요약·메서드·경로·태그 + 파라미터/본문/응답 필드명 + 설명(앞부분)
function searchIndex(op, tag) {
  const names = [];
  for (const g of op.parameters) for (const r of g.rows) names.push(r.name);
  if (op.requestBody) for (const r of op.requestBody.rows) names.push(r.name);
  for (const res of op.responses) for (const r of res.rows) names.push(r.name);
  const desc = String(op.description ?? '').replace(/\s+/g, ' ').slice(0, 300);
  return [op.operationId, op.summary, op.method, op.path, tag, ...names, desc]
    .filter(Boolean).join(' ').toLowerCase();
}
const json = (v) => esc(JSON.stringify(v, null, 2));
const jsonInline = (v) => (v === undefined ? '' : typeof v === 'object' ? esc(JSON.stringify(v)) : esc(String(v)));

const METHOD_CLASS = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'get', OPTIONS: 'get' };
const PARAM_LABEL = { path: 'Path 파라미터', query: 'Query 파라미터', header: '요청 헤더', cookie: 'Cookie' };

export function renderHtml(model, opts = {}) {
  const title = model.info.title ?? 'API 명세서';
  // 버전에 이미 'v' 접두어가 있으면(v0.1 등) 중복 방지
  const version = model.info.version ? `v${String(model.info.version).replace(/^v/i, '')}` : '';
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  const theme = THEME_CSS[opts.theme] !== undefined ? opts.theme : 'editorial';

  // 문서 섹션 번호: 1 개요, (2 인증), 이후 태그 그룹 순번
  let secNo = 1;
  const numOverview = secNo++;
  const numSecurity = model.security.length ? secNo++ : null;
  const groupNo = model.groups.map(() => secNo++);
  // 태그 이름을 그대로 id 에 쓰면 공백·특수문자에서 앵커가 깨진다.
  const groupSlug = tagSlugs(model.groups);

  return `<!doctype html>
<html lang="ko" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} ${esc(version)} API 명세서</title>
<style>${CSS}${THEME_CSS[theme]}</style>
</head>
<body>
<button class="nav-toggle" id="navToggle" aria-label="목차 열기">☰</button>
<aside class="sidebar" id="sidebar">
  <div class="sidebar-head">
    <div class="sidebar-title">${esc(title)}</div>
    <div class="sidebar-version">${esc(version)}</div>
    <input type="search" id="navSearch" placeholder="API 검색 (이름, 경로, 필드명…)" autocomplete="off">
    <div class="nav-search-count" id="navSearchCount"></div>
  </div>
  <nav class="nav">
    <a class="nav-link nav-top" href="#overview" data-search="개요 overview"><span class="nav-num">${numOverview}</span><span class="nav-text-flex">개요</span></a>
    ${numSecurity ? `<a class="nav-link nav-top" href="#security" data-search="인증 security"><span class="nav-num">${numSecurity}</span><span class="nav-text-flex">인증</span></a>` : ''}
    <div class="nav-empty hidden">검색 결과 없음</div>
    ${model.groups
      .map(
        (g, gi) => `
    <div class="nav-group" data-tag="${esc(g.tag)}">
      <a class="nav-group-title" href="#tag-${esc(groupSlug[gi])}"><span class="nav-num">${groupNo[gi]}</span><span class="nav-text-flex">${esc(g.tag)} <span class="nav-count">${g.ops.length}</span><button class="nav-toggle-group" aria-label="그룹 접기/펼치기">▾</button></span></a>
      ${g.ops
        .map(
          (op, oi) => `
      <a class="nav-link" href="#${op.id}" data-search="${esc(searchIndex(op, g.tag))}">
        <span class="nav-num">${groupNo[gi]}.${oi + 1}</span>
        <span class="nav-text">
          <span class="nav-id">${esc(op.operationId || op.summary || op.path)}</span>
          <span class="nav-sub"><span class="m m-${METHOD_CLASS[op.method]}">${op.method}</span> <code>${esc(op.path)}</code></span>
        </span>
      </a>`,
        )
        .join('')}
    </div>`,
      )
      .join('')}
  </nav>
</aside>

<main class="main">
  <header class="doc-head" id="overview">
    <div class="doc-overline">API 연계 명세서</div>
    <h1>${esc(title)} <span class="doc-version">${esc(version)}</span></h1>
    <div class="doc-meta">
      <span>API <strong>${model.ops.length}개</strong></span>
      <span>생성일 <strong>${esc(generatedAt)}</strong></span>
      ${model.info.contact?.email ? `<span>문의 <strong>${esc(model.info.contact.email)}</strong></span>` : ''}
    </div>
  </header>

  <section class="tag-section">
    <h2 class="tag-title"><span class="sec-num">${numOverview}</span>개요</h2>
    ${renderServers(model.servers)}
    ${md(model.info.description)}
  </section>

  ${renderSecurity(model.security, numSecurity)}

  ${model.groups
    .map(
      (g, gi) => `
  <section class="tag-section" id="tag-${esc(groupSlug[gi])}">
    <h2 class="tag-title"><span class="sec-num">${groupNo[gi]}</span>${esc(g.tag)}</h2>
    ${md(g.description)}
    ${renderTagIndex(g)}
    ${g.ops.map((op, oi) => renderOperation(op, `${groupNo[gi]}.${oi + 1}`)).join('\n')}
  </section>`,
    )
    .join('\n')}

  <footer class="doc-foot">이 문서는 OpenAPI 명세(YAML)로부터 자동 생성되었습니다. 원본 명세와 항상 동일한 내용을 유지합니다.</footer>
</main>
<script>${JS}</script>
</body>
</html>`;
}

function renderServers(servers) {
  if (!servers.length) return '';
  return `
    <table class="kv-table servers">
      <thead><tr><th>서버</th><th>URL</th></tr></thead>
      <tbody>
      ${servers
        .map((s) => {
          const vars = Object.entries(s.variables ?? {});
          return `<tr>
            <td>${esc(s.description ?? '')}</td>
            <td><code>${esc(s.url)}</code>${
              vars.length
                ? `<ul class="server-vars">${vars
                    .map(([k, v]) => `<li><code>{${esc(k)}}</code> ${esc(v.description ?? '')} <span class="muted">(기본값 <code>${esc(v.default)}</code>)</span></li>`)
                    .join('')}</ul>`
                : ''
            }</td></tr>`;
        })
        .join('')}
      </tbody>
    </table>`;
}

function renderSecurity(security, num) {
  if (!security.length) return '';
  return `
  <section class="tag-section" id="security">
    <h2 class="tag-title"><span class="sec-num">${num}</span>인증</h2>
    <table class="kv-table">
      <thead><tr><th>이름</th><th>방식</th><th>적용</th><th>설명</th></tr></thead>
      <tbody>
        ${security
          .map(
            (s) => `<tr><td><code>${esc(s.name)}</code></td><td>${esc(s.how)}</td><td>${s.global ? '전체 API' : '개별 지정'}</td><td>${mdInline(s.description)}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </section>`;
}

function renderTagIndex(group) {
  return `
    <table class="kv-table index-table">
      <thead><tr><th>ID</th><th>이름</th><th>메서드</th><th>경로</th></tr></thead>
      <tbody>
        ${group.ops
          .map(
            (op) => `<tr>
          <td><a href="#${op.id}">${esc(op.operationId || '-')}</a></td>
          <td>${esc(op.summary)}</td>
          <td><span class="m m-${METHOD_CLASS[op.method]}">${op.method}</span></td>
          <td><code>${esc(op.path)}</code></td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderOperation(op, num) {
  const ext = op.extensions;
  const note = ext['x-dsp-note'];
  const rspnsPaths = ext['x-dsp-rspns-paths'];
  const otherExt = Object.entries(ext).filter(([k]) => !['x-dsp-note', 'x-dsp-rspns-paths'].includes(k));

  return `
  <article class="op" id="${op.id}">
    <header class="op-head">
      <div class="op-title">
        <h3><span class="sec-num">${num}</span>${esc(op.summary || op.operationId || op.path)}${op.deprecated ? ' <span class="deprecated">Deprecated</span>' : ''}</h3>
        ${op.operationId ? `<span class="op-id">${esc(op.operationId)}</span>` : ''}
      </div>
      <div class="op-path"><span class="m m-${METHOD_CLASS[op.method]}">${op.method}</span><code>${esc(op.path)}</code><button class="copy-btn" data-copy="${esc(op.path)}" title="경로 복사">복사</button></div>
    </header>

    ${md(op.description)}
    ${note ? `<div class="callout callout-warn"><div class="callout-title">유의사항</div>${md(note)}</div>` : ''}

    ${
      rspnsPaths
        ? `<h4>수신 경로</h4>
    <table class="kv-table">
      <tbody>${Object.entries(rspnsPaths)
        .map(([k, v]) => `<tr><th class="kv-key">${esc(k === 'prod' ? '운영' : k === 'dev' ? '개발' : k)}</th><td><code>${esc(v)}</code></td></tr>`)
        .join('')}</tbody>
    </table>`
        : ''
    }

    ${op.parameters
      .map((g) => {
        // parameter.in 은 명세에서 온 임의 문자열이다. 라벨은 이스케이프하고 id 는 slug 로만 쓴다.
        const label = esc(Object.hasOwn(PARAM_LABEL, g.location) ? PARAM_LABEL[g.location] : g.location);
        return `<h4>${label}</h4>${renderSchemaTable(g.rows, `${op.id}-p-${slugify(g.location)}`)}`;
      })
      .join('')}

    ${renderRequestBody(op)}

    <h4>응답</h4>
    ${op.responses.map((r) => renderResponse(op, r)).join('')}

    ${
      otherExt.length
        ? `<details class="ext"><summary>확장 필드</summary><table class="kv-table"><tbody>${otherExt
            .map(([k, v]) => `<tr><th class="kv-key">${esc(k)}</th><td><pre>${json(v)}</pre></td></tr>`)
            .join('')}</tbody></table></details>`
        : ''
    }
  </article>`;
}

function renderRequestBody(op) {
  const rb = op.requestBody;
  if (!rb) return '';
  return `
    <h4>요청 본문 ${rb.contentType ? `<span class="ct">${esc(rb.contentType)}</span>` : ''} ${rb.required ? '<span class="req-flag">필수</span>' : '<span class="opt-flag">선택</span>'}</h4>
    ${md(rb.description)}
    ${rb.schemaDescription && !rb.rows.length ? md(rb.schemaDescription) : ''}
    ${rb.rows.length ? renderSchemaTable(rb.rows, `${op.id}-req`) : `<p class="muted">본문 스키마 없음 (${esc(rb.schemaType)})</p>`}
    ${renderExamples('요청 예시', rb, `${op.id}-req`)}
    ${rb.otherContentTypes.length ? `<p class="muted">그 외 지원 형식: ${rb.otherContentTypes.map((c) => `<code>${esc(c)}</code>`).join(', ')}</p>` : ''}`;
}

function renderResponse(op, r) {
  const cls = r.status.startsWith('2') ? 'ok' : r.status.startsWith('4') || r.status.startsWith('5') ? 'err' : 'other';
  const isError = cls === 'err';
  // 상태 코드 키도 명세에서 온 임의 문자열이므로 id 에는 slug 만 넣는다.
  const resId = `${op.id}-res-${slugify(r.status)}`;
  const body = `
      ${r.headers.length ? `<h5>응답 헤더</h5>${renderSimpleTable(r.headers)}` : ''}
      ${r.rows.length ? `${r.schemaName ? `<div class="schema-name">스키마: <code>${esc(r.schemaName)}</code></div>` : ''}${renderSchemaTable(r.rows, resId)}` : r.contentType ? `<p class="muted">본문: <code>${esc(r.contentType)}</code> ${esc(r.schemaType && r.schemaType !== 'any' ? `(${r.schemaType})` : '')}</p>` : '<p class="muted">본문 없음</p>'}
      ${renderNamedExamples(r)}
      ${r.namedExamples.length <= 1 ? renderExamples('응답 예시', r, resId) : ''}`;

  // 오류 응답은 기본 접힘. 성공 응답은 펼침.
  return `
    <div class="response response-${cls}">
      <details class="response-details" ${isError ? '' : 'open'}>
        <summary><span class="status status-${cls}">${esc(r.status)}</span> <span class="status-desc">${esc(r.description)}</span> ${r.contentType ? `<span class="ct">${esc(r.contentType)}</span>` : ''}</summary>
        <div class="response-body">${body}</div>
      </details>
    </div>`;
}

// media.examples 가 여러 개일 때: 값이 모두 평면 객체면 열을 합쳐 하나의 표로, 아니면 이름별 코드블록.
function renderNamedExamples(r) {
  const list = r.namedExamples;
  if (list.length <= 1) return '';
  const flat = list.every((e) => e.value && typeof e.value === 'object' && !Array.isArray(e.value) && Object.values(e.value).every((v) => typeof v !== 'object' || v === null));
  if (flat) {
    const cols = [...new Set(list.flatMap((e) => Object.keys(e.value)))];
    // 예시 이름이 값 중 하나와 같으면(예: "40001" → errorCode 40001) 구분 열은 중복이므로 생략
    const showLabel = list.some((e) => e.summary || !Object.values(e.value).some((v) => String(v) === e.name));
    return `
      <h5>응답 예시 (${list.length}건)</h5>
      <table class="kv-table examples-table">
        <thead><tr>${showLabel ? '<th>구분</th>' : ''}${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${list
          .map((e) => `<tr>${showLabel ? `<td>${esc(e.summary || e.name)}</td>` : ''}${cols.map((c) => `<td>${jsonInline(e.value[c])}</td>`).join('')}</tr>`)
          .join('')}</tbody>
      </table>`;
  }
  return `<h5>응답 예시 (${list.length}건)</h5>${list
    .map((e) => `<details class="example"><summary>${esc(e.summary || e.name)}</summary>${md(e.description)}<pre class="json">${json(e.value)}</pre></details>`)
    .join('')}`;
}

function renderExamples(label, media, id) {
  if (media.example === undefined) return '';
  // id 는 호출부에서 slug 로 만들어 넘기지만, 속성 자리이므로 여기서도 한 번 더 막는다.
  return `<details class="example"><summary>${esc(label)}</summary><pre class="json" id="${esc(id)}-example">${json(media.example)}</pre></details>`;
}

function renderSimpleTable(rows) {
  return `<table class="kv-table"><thead><tr><th>이름</th><th>타입</th><th>필수</th><th>설명</th></tr></thead><tbody>${rows
    .map((h) => `<tr><td><code>${esc(h.name)}</code></td><td>${esc(h.type)}</td><td>${h.required ? 'Y' : ''}</td><td>${mdInline(h.description)}</td></tr>`)
    .join('')}</tbody></table>`;
}

// 핵심: 평탄화된 스키마 행을 깊이 들여쓰기 표로 렌더링. 부모 행 클릭으로 하위 접기.
export function renderSchemaTable(rows, tableId) {
  const hasExample = rows.some((r) => r.example !== undefined);
  return `
    <div class="table-wrap">
    <table class="schema-table" id="${esc(tableId)}">
      <colgroup><col class="c-name"><col class="c-type"><col class="c-req"><col class="c-cons"><col class="c-desc">${hasExample ? '<col class="c-ex">' : ''}</colgroup>
      <thead><tr><th>항목</th><th>타입</th><th>필수</th><th>제약</th><th>설명</th>${hasExample ? '<th>예시</th>' : ''}</tr></thead>
      <tbody>
      ${rows
        .map((r) => {
          const nameCell = `
            <div class="name-cell" style="--depth:${r.depth}">
              ${r.hasChildren ? `<button class="tree-toggle" aria-label="하위 항목 접기/펼치기" aria-expanded="true">▾</button>` : `<span class="tree-leaf"></span>`}
              <span class="name${r.variant ? ' variant' : ''}">${esc(r.name)}</span>
              ${r.deprecated ? '<span class="deprecated">Deprecated</span>' : ''}
            </div>`;
          const typeCell = `${esc(r.type)}${r.nullable ? '<span class="nullable">nullable</span>' : ''}`;
          return `<tr class="row depth-${r.depth}${r.hasChildren ? ' has-children' : ''}" data-path="${esc(r.path)}" data-depth="${r.depth}">
          <td>${nameCell}</td>
          <td class="type">${typeCell}</td>
          <td class="req">${r.required ? '<span class="req-y">Y</span>' : ''}</td>
          <td class="cons">${r.constraints.map((c) => `<span class="con">${esc(c)}</span>`).join('')}</td>
          <td class="desc">${mdInline(r.description)}</td>
          ${hasExample ? `<td class="ex">${r.example !== undefined ? `<code>${jsonInline(r.example)}</code>` : ''}</td>` : ''}
        </tr>`;
        })
        .join('')}
      </tbody>
    </table>
    </div>`;
}

const CSS = `
:root {
  --paper: #fcfcfb; --panel: #f6f5f2; --ink: #23221d; --muted: #7b766c; --faint: #a39e93;
  --hair: #e8e6e0; --hair-strong: #b9b5aa; --rule: #33322c; --accent: #12616a; --accent-soft: #efeeea;
  --get: #22764c; --post: #2456a8; --put: #96660f; --patch: #6d4fa3; --delete: #a83a32;
  --ok: #22764c; --err: #a83a32;
  --field: #ddd9d0; --pre-ink: #45423b;
  --sidebar-w: 300px;
  --sans: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Malgun Gothic", "Segoe UI", Roboto, sans-serif;
  --serif: "Noto Serif KR", "Nanum Myeongjo", Batang, AppleMyungjo, serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "D2Coding", monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 16px; }
body { margin: 0; font-family: var(--sans); font-size: 14px; line-height: 1.62; color: var(--ink); background: var(--paper); }
code, pre { font-family: var(--mono); font-size: 12.5px; }
code { word-break: break-all; }
pre { background: var(--panel); border: 1px solid var(--hair); padding: 13px 16px; overflow-x: auto; margin: 8px 0; line-height: 1.5; color: var(--pre-ink); }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
h1 { font-size: 30px; margin: 0; font-family: var(--serif); font-weight: 700; letter-spacing: -.01em; line-height: 1.3; }
h2 { font-size: 21px; } h3 { font-size: 18px; margin: 0; }
h4 { font-size: 14.5px; font-weight: 700; margin: 30px 0 4px; }
h5 { font-size: 12.5px; font-weight: 600; margin: 16px 0 4px; color: var(--muted); }
.muted { color: var(--muted); }
.sec-num { font-family: var(--mono); font-weight: 400; color: var(--faint); margin-right: 12px; font-size: .78em; }

/* layout */
.sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: var(--sidebar-w); border-right: 1px solid var(--hair); background: var(--panel); display: flex; flex-direction: column; z-index: 10; }
.sidebar-head { padding: 22px 18px 14px; border-bottom: 1px solid var(--hair); }
.sidebar-title { font-family: var(--serif); font-weight: 700; font-size: 16px; line-height: 1.4; }
.sidebar-version { color: var(--muted); font-family: var(--mono); font-size: 11.5px; margin: 2px 0 12px; }
#navSearch { width: 100%; padding: 7px 10px; border: 1px solid var(--field); border-radius: 3px; font-size: 13px; font-family: inherit; background: var(--paper); }
#navSearch::placeholder { color: var(--faint); }
.nav { overflow-y: auto; padding: 10px 0 28px; flex: 1; }
.nav-group-title { display: flex; align-items: baseline; gap: 4px; padding: 5px 14px; font-size: 13px; font-weight: 700; line-height: 1.35; color: var(--ink); text-decoration: none; border-left: 2px solid transparent; }
.nav-group-title:hover { background: var(--accent-soft); color: var(--accent); text-decoration: none; }
.nav-group-title .nav-num { font-weight: 400; }
.nav-text-flex { display: flex; align-items: baseline; gap: 4px; flex: 1; min-width: 0; }
.nav-toggle-group { background: none; border: 0; padding: 0 4px; margin-left: auto; cursor: pointer; color: var(--faint); font-size: 11px; line-height: 1; }
.nav-toggle-group:hover { color: var(--accent); }
.nav-toggle-group.collapsed { transform: rotate(-90deg); display: inline-block; }
.nav-group.collapsed .nav-link { display: none; }
.nav-count { font-weight: 400; color: var(--faint); margin-left: 2px; }
.nav-num { display: inline-block; font-family: var(--mono); font-size: 11.5px; color: var(--faint); width: 36px; flex-shrink: 0; text-align: left; }
.nav-link { display: flex; gap: 4px; align-items: baseline; padding: 5px 14px 5px 34px; color: var(--ink); font-size: 12.5px; line-height: 1.35; border-left: 2px solid transparent; }
.nav-link:hover { background: var(--accent-soft); text-decoration: none; }
.nav-link.active { border-left-color: var(--accent); background: var(--accent-soft); }
.nav-link.active .nav-id { color: var(--accent); font-weight: 600; }
.nav-link.hidden, .nav-group.hidden { display: none; }
.nav-empty { padding: 12px 14px; color: var(--faint); font-size: 12.5px; }
.nav-search-count { font-size: 11px; color: var(--faint); margin-top: 6px; min-height: 14px; }
mark.hl { background: #ffe58a; color: inherit; padding: 0 1px; border-radius: 2px; }
mark.hl.current { background: #ffb63d; box-shadow: 0 0 0 2px #ffb63d; }
.nav-empty.hidden { display: none; }
.nav-top { padding-left: 14px; font-size: 13px; font-weight: 700; }
.nav-top .nav-num { font-weight: 400; }
.nav-top .nav-id { font-weight: 600; }
.nav-top:hover { background: var(--accent-soft); color: var(--accent); text-decoration: none; }
.nav-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.nav-id { word-break: break-all; }
.nav-sub { color: var(--muted); font-size: 11px; }
.nav-sub code { font-size: 11px; }
.nav-sub .m { font-size: 10px; min-width: 0; }
.nav-toggle { display: none; }
.main { margin-left: var(--sidebar-w); padding: 56px 64px 88px; max-width: 1080px; }

/* method label */
.m { display: inline-block; min-width: 44px; font-size: 11px; font-weight: 700; letter-spacing: .04em; font-family: var(--mono); flex-shrink: 0; }
.m-get { color: var(--get); } .m-post { color: var(--post); } .m-put { color: var(--put); } .m-patch { color: var(--patch); } .m-delete { color: var(--delete); }

/* header */
.doc-head { padding-bottom: 26px; border-bottom: 2px solid var(--rule); display: flex; flex-direction: column; gap: 10px; }
.doc-overline { font-size: 12px; letter-spacing: .18em; color: var(--muted); font-weight: 600; }
.doc-version { font-family: var(--mono); font-size: 15px; font-weight: 400; color: var(--muted); letter-spacing: 0; }
.doc-meta { display: flex; gap: 26px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.doc-meta strong { color: var(--ink); font-weight: 600; }
.server-vars { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--muted); }

/* markdown blocks */
.md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
.md p { margin: 6px 0; }
.md ul, .md ol { margin: 4px 0; padding-left: 22px; }
.md li { margin: 2px 0; }
.md h2 { font-size: 16px; margin: 28px 0 6px; } .md h3 { font-size: 14.5px; margin: 18px 0 4px; } .md h4 { font-size: 14px; margin: 14px 0 4px; }
.md table { border-collapse: collapse; margin: 10px 0 14px; font-size: 13px; min-width: 50%; }
.md th, .md td { padding: 7px 16px 7px 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--hair); }
.md th { font-size: 11.5px; font-weight: 600; letter-spacing: .05em; color: var(--muted); border-bottom-color: var(--hair-strong); }
.md-cell p { margin: 0; } .md-cell ul { margin: 2px 0; padding-left: 16px; }
.md-cell > * + * { margin-top: 4px; }

/* tables: 세로선 없이 가로 괘선만 */
.kv-table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 13.5px; }
.kv-table th, .kv-table td { padding: 9px 14px 9px 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--hair); }
.kv-table thead th { font-size: 11.5px; font-weight: 600; letter-spacing: .06em; color: var(--muted); border-bottom-color: var(--hair-strong); padding-bottom: 7px; }
.kv-table th.kv-key { font-weight: 600; }
.kv-table .kv-key { width: 100px; white-space: nowrap; }
.index-table td:nth-child(1) { white-space: nowrap; }
.table-wrap { overflow-x: auto; }
.schema-table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; font-size: 13px; min-width: 720px; }
.schema-table th, .schema-table td { padding: 8px 12px 8px 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--hair); }
.schema-table thead th { font-size: 11.5px; font-weight: 600; letter-spacing: .06em; color: var(--muted); border-bottom-color: var(--hair-strong); white-space: nowrap; }
.schema-table .c-name { width: 26%; } .schema-table .c-type { width: 10%; } .schema-table .c-req { width: 44px; } .schema-table .c-cons { width: 14%; } .schema-table .c-ex { width: 15%; }
.schema-table td.type { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: nowrap; }
.schema-table td.req { text-align: center; }
.req-y { color: var(--err); font-weight: 700; font-size: 12px; }
.schema-table td.cons { font-family: var(--mono); font-size: 11px; color: var(--faint); }
.con { display: block; word-break: break-all; }
.schema-table td.ex code { font-size: 11.5px; color: var(--muted); }
.nullable { display: inline-block; margin-left: 6px; font-size: 10px; color: var(--faint); border: 1px solid var(--field); border-radius: 2px; padding: 0 4px; font-family: var(--sans); }
.name-cell { display: flex; align-items: baseline; gap: 2px; padding-left: calc(var(--depth) * 18px); position: relative; }
.name-cell .name { font-family: var(--mono); font-size: 12.5px; font-weight: 600; word-break: break-all; }
.name-cell .name.variant { font-family: var(--sans); font-weight: 500; color: var(--muted); }
.depth-0 .name-cell .name { font-weight: 700; }
.tree-toggle { background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; color: var(--faint); font-size: 12px; line-height: 1; width: 16px; }
.tree-toggle.collapsed { transform: rotate(-90deg); transform-origin: 40% 50%; }
.tree-leaf { display: inline-block; width: 16px; }
.row[data-depth]:not([data-depth="0"]) .name-cell::before { content: ""; position: absolute; left: calc(var(--depth) * 18px - 10px); top: -8px; bottom: 50%; width: 8px; border-left: 1px solid var(--hair); border-bottom: 1px solid var(--hair); }
.row.collapsed-hidden { display: none; }
.schema-name { font-size: 12px; color: var(--muted); margin: 4px 0; }

/* operation */
.tag-section { margin-top: 56px; }
.tag-title { font-family: var(--serif); font-weight: 700; border-bottom: 1px solid var(--hair-strong); padding-bottom: 10px; margin: 0 0 16px; }
.op { margin: 44px 0 60px; padding-top: 28px; border-top: 1px solid var(--hair); }
.op-head { margin-bottom: 14px; }
.op-title { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.op-id { font-family: var(--mono); font-size: 12px; color: var(--accent); }
.op-path { display: flex; align-items: center; gap: 12px; margin-top: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--hair); }
.op-path code { font-size: 14px; }
.copy-btn { margin-left: auto; font-size: 11.5px; border: 1px solid var(--field); background: var(--paper); border-radius: 2px; padding: 2px 9px; cursor: pointer; color: var(--faint); }
.copy-btn:hover { color: var(--ink); border-color: var(--hair-strong); }
.deprecated { font-size: 11px; color: var(--err); border: 1px solid var(--err); border-radius: 2px; padding: 0 5px; margin-left: 8px; vertical-align: middle; font-family: var(--sans); font-weight: 500; }
.ct { font-family: var(--mono); font-size: 11px; font-weight: 400; color: var(--faint); margin-left: 6px; }
.req-flag { font-size: 11px; font-weight: 700; color: var(--err); margin-left: 8px; }
.opt-flag { font-size: 11px; font-weight: 600; color: var(--faint); margin-left: 8px; }
.callout { border-left: 2px solid var(--err); padding: 8px 0 8px 16px; margin: 16px 0; max-width: 760px; }
.callout-title { font-weight: 700; font-size: 12px; letter-spacing: .08em; color: var(--err); margin-bottom: 4px; }
.callout .md { font-size: 13px; color: var(--ink); }

/* responses: 괘선 행 + 상태 점 */
.response { margin: 0; }
.response-details > summary { cursor: pointer; padding: 10px 0; list-style: none; display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid var(--hair); user-select: none; }
.response-details[open] > summary { border-bottom-color: var(--hair-strong); }
.response-details > summary::-webkit-details-marker { display: none; }
.response-details > summary::before { content: "▸"; color: var(--faint); font-size: 11px; align-self: center; }
.response-details[open] > summary::before { content: "▾"; }
.response-body { padding: 4px 0 20px; }
.status { font-family: var(--mono); font-weight: 700; font-size: 13.5px; display: inline-flex; align-items: center; gap: 7px; }
.status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
.status-ok::before { background: var(--ok); } .status-err::before { background: var(--err); }
.status-desc { font-weight: 600; font-size: 13.5px; }
.response-err > .response-details > summary .status-desc { font-weight: 400; color: var(--muted); }
.examples-table td { font-family: var(--mono); font-size: 12px; }
.examples-table td:first-child { font-family: var(--sans); }

details.example, details.ext { margin: 10px 0; }
details.example > summary, details.ext > summary { cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--accent); user-select: none; }
pre.json { max-height: 480px; overflow: auto; }

.doc-foot { margin-top: 72px; padding-top: 14px; border-top: 1px solid var(--hair-strong); color: var(--faint); font-size: 12px; }

/* responsive */
@media (max-width: 960px) {
  .sidebar { transform: translateX(-100%); transition: transform .2s; }
  .sidebar.open { transform: none; box-shadow: 0 0 0 100vw rgba(0,0,0,.25); }
  .nav-toggle { display: block; position: fixed; top: 10px; left: 10px; z-index: 20; border: 1px solid var(--hair-strong); background: var(--paper); border-radius: 3px; padding: 6px 10px; font-size: 16px; cursor: pointer; }
  .nav-toggle[aria-expanded="true"] { display: none; }
  .main { margin-left: 0; padding: 56px 18px 60px; }
}

/* print */
@media print {
  .sidebar, .nav-toggle, .copy-btn, .tree-toggle, .nav-toggle-group { display: none !important; }
  .main { margin: 0; padding: 0; max-width: none; }
  body { font-size: 11px; background: #fff; }
  .op { break-inside: avoid-page; page-break-inside: auto; }
  .op-head, .schema-table thead { break-after: avoid; }
  tr { break-inside: avoid; }
  details { display: block; } details > summary { list-style: none; }
  details:not([open]) > *:not(summary) { display: block !important; }
  .response-details > summary::before { content: ""; }
  .row.collapsed-hidden { display: table-row; }
  .nav-group.collapsed .nav-link { display: flex; }
  pre.json { max-height: none; }
  a { color: inherit; }
}
`;

// HTML 출력 테마 (기본 CSS의 :root 를 덮어씀)
export const HTML_THEMES = [
  { id: 'editorial', name: '기본 (에디토리얼)' },
  { id: 'dark', name: '다크' },
  { id: 'modern', name: '모던' },
];

const THEME_CSS = {
  editorial: '',
  dark: `:root{
  --paper:#16181c; --panel:#1c1f24; --ink:#e7e5df; --muted:#9a958b; --faint:#6f6a61;
  --hair:#2b2e34; --hair-strong:#3d424a; --rule:#4a4f57; --accent:#6bb6c3; --accent-soft:#20343a;
  --get:#4fae7a; --post:#5b8fe0; --put:#d1a24a; --patch:#a98be0; --delete:#e0776e;
  --ok:#4fae7a; --err:#e0776e; --field:#3d424a; --pre-ink:#c9c5bc;
}
::selection{background:#2f4a52;color:#fff;}
mark.hl{background:#5d4d14;} mark.hl.current{background:#8a6f1c;box-shadow:0 0 0 2px #8a6f1c;}`,
  modern: `:root{
  --paper:#ffffff; --panel:#f4f6f8; --ink:#1f2430; --muted:#68707d; --faint:#9aa2af;
  --hair:#e7ebef; --hair-strong:#c3cad3; --rule:#1f2430; --accent:#2f6feb; --accent-soft:#eef3fe;
  --get:#1a7f47; --post:#2f6feb; --put:#b5730a; --patch:#7a52c4; --delete:#d33a34;
  --ok:#1a7f47; --err:#d33a34; --field:#d4dae1; --pre-ink:#2f3742;
}
h1,h2,h3,.sidebar-title,.tag-title{font-family:var(--sans);}
h1{letter-spacing:-.02em;}`,
};

const JS = `
(function () {
  // 목차 + 본문 검색: 단어(공백 구분, AND)가 목차 색인 또는 본문 텍스트에 있으면 해당 API 를 남기고,
  // 본문 일치 부분은 <mark> 로 표시한다. Enter / Shift+Enter 로 일치 위치를 순서대로 이동.
  var search = document.getElementById('navSearch');
  var searchCount = document.getElementById('navSearchCount');
  var navEmpty = document.querySelector('.nav-empty');
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link[data-search]'));
  var groups = Array.prototype.slice.call(document.querySelectorAll('.nav-group'));
  var main = document.querySelector('.main');
  links.forEach(function (a) {
    var el = document.getElementById(a.getAttribute('href').slice(1));
    // 개요는 헤더(id) 와 그 다음 섹션(서버·설명)이 본문이다
    a._els = el ? (el.id === 'overview' && el.nextElementSibling ? [el, el.nextElementSibling] : [el]) : [];
    a._hay = (a.dataset.search || '').toLowerCase();
  });
  var marks = [], current = -1, timer = null;
  function clearMarks() {
    marks.forEach(function (m) {
      var p = m.parentNode; if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
    });
    marks = []; current = -1;
  }
  function markTerms(root, terms) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      var p = n.parentNode;
      if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.tagName === 'MARK') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    } });
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue, lower = text.toLowerCase(), ranges = [];
      terms.forEach(function (t) { var i = 0; while ((i = lower.indexOf(t, i)) >= 0) { ranges.push([i, i + t.length]); i += t.length; } });
      if (!ranges.length) return;
      ranges.sort(function (a, b) { return a[0] - b[0]; });
      var merged = [];
      ranges.forEach(function (r) { var last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); });
      var frag = document.createDocumentFragment(), pos = 0;
      merged.forEach(function (r) {
        if (r[0] > pos) frag.appendChild(document.createTextNode(text.slice(pos, r[0])));
        var m = document.createElement('mark'); m.className = 'hl'; m.textContent = text.slice(r[0], r[1]);
        frag.appendChild(m); marks.push(m); pos = r[1];
      });
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function hasMatch(a, terms) {
    return terms.every(function (t) {
      if (a._hay.indexOf(t) >= 0) return true;
      return a._els.some(function (el) { return el.textContent.toLowerCase().indexOf(t) >= 0; });
    });
  }
  function goTo(i) {
    if (!marks.length) return;
    if (current >= 0 && marks[current]) marks[current].classList.remove('current');
    current = (i + marks.length) % marks.length;
    var m = marks[current];
    m.classList.add('current');
    m.scrollIntoView({ block: 'center' });
    searchCount.textContent = (current + 1) + ' / ' + marks.length + ' 곳 · Enter 다음, Shift+Enter 이전';
  }
  function runSearch() {
    var terms = search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
    var q = terms.length > 0;
    clearMarks();
    links.forEach(function (a) { a.classList.toggle('hidden', q && !hasMatch(a, terms)); });
    if (navEmpty) navEmpty.classList.toggle('hidden', !q || links.some(function (a) { return !a.classList.contains('hidden'); }));
    groups.forEach(function (g) {
      var anyVisible = !!g.querySelector('.nav-link:not(.hidden)');
      g.classList.toggle('hidden', !anyVisible);
      if (anyVisible && q) {
        g.classList.remove('collapsed');
        var t = g.querySelector('.nav-toggle-group');
        if (t) t.classList.remove('collapsed');
      }
    });
    if (q) {
      markTerms(main, terms);
      // 접힌 응답(details) 안의 일치는 보이도록 펼친다
      marks.forEach(function (m) { var d = m.closest('details'); while (d) { d.open = true; d = d.parentElement ? d.parentElement.closest('details') : null; } });
      searchCount.textContent = marks.length ? '본문 ' + marks.length + ' 곳 · Enter 로 이동' : '본문 일치 없음';
    } else {
      searchCount.textContent = '';
    }
  }
  search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(runSearch, 120); });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (timer) { clearTimeout(timer); timer = null; runSearch(); } goTo(e.shiftKey ? current - 1 : current + 1); }
    if (e.key === 'Escape') { search.value = ''; runSearch(); }
  });

  // 현재 위치 강조
  var ops = Array.prototype.slice.call(document.querySelectorAll('.op'));
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  var current = null;
  function highlight() {
    var y = window.scrollY + 120, pick = null;
    for (var i = 0; i < ops.length; i++) { if (ops[i].offsetTop <= y) pick = ops[i]; else break; }
    if (pick === current) return;
    if (current && byId[current.id]) byId[current.id].classList.remove('active');
    current = pick;
    if (current && byId[current.id]) {
      byId[current.id].classList.add('active');
      var nav = document.querySelector('.nav');
      var r = byId[current.id].getBoundingClientRect(), nr = nav.getBoundingClientRect();
      if (r.top < nr.top || r.bottom > nr.bottom) byId[current.id].scrollIntoView({ block: 'center' });
    }
  }
  window.addEventListener('scroll', highlight, { passive: true });
  highlight();

  // 문서 내 앵커(#id) 이동은 해시 내비게이션 대신 스크롤로 처리한다.
  // srcdoc iframe(앱 미리보기)에서는 '#id' 가 부모 URL 기준으로 풀려 문서 전체가 다른 페이지로 이동해 버린다.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    var el = id && document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: 'start' });
    try { history.replaceState(null, '', '#' + id); } catch (_) {}
  });

  // 트리 접기: 부모 행 토글 → 경로가 prefix 로 시작하는 모든 하위 행 숨김
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.tree-toggle');
    if (btn) {
      var tr = btn.closest('tr'), table = tr.closest('table');
      var path = tr.dataset.path, collapsed = btn.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
      var rows = table.querySelectorAll('tr.row');
      var hiding = false;
      Array.prototype.forEach.call(rows, function (r) {
        if (r === tr) { hiding = true; return; }
        if (!hiding) return;
        if (Number(r.dataset.depth) <= Number(tr.dataset.depth)) { hiding = false; return; }
        if (collapsed) r.classList.add('collapsed-hidden');
        else {
          // 펼칠 때: 중간에 접힌 조상이 있으면 계속 숨김
          var ancestorCollapsed = false, d = Number(r.dataset.depth);
          var p = r.previousElementSibling;
          while (p && p !== tr) {
            if (Number(p.dataset.depth) < d) { d = Number(p.dataset.depth); if (p.querySelector('.tree-toggle.collapsed')) { ancestorCollapsed = true; break; } }
            p = p.previousElementSibling;
          }
          if (!ancestorCollapsed) r.classList.remove('collapsed-hidden');
        }
      });
      return;
    }
    var groupToggle = e.target.closest('.nav-toggle-group');
    if (groupToggle) {
      e.preventDefault();
      var group = groupToggle.closest('.nav-group');
      var collapsed = groupToggle.classList.toggle('collapsed');
      groupToggle.setAttribute('aria-expanded', String(!collapsed));
      group.classList.toggle('collapsed', collapsed);
      return;
    }
    var copy = e.target.closest('.copy-btn');
    if (copy && navigator.clipboard) {
      navigator.clipboard.writeText(copy.dataset.copy).then(function () {
        var t = copy.textContent; copy.textContent = '복사됨'; setTimeout(function () { copy.textContent = t; }, 1200);
      });
    }
  });

  // 모바일 목차
  var toggle = document.getElementById('navToggle'), sidebar = document.getElementById('sidebar');
  function setNav(open) { sidebar.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); }
  toggle.addEventListener('click', function (e) { e.stopPropagation(); setNav(!sidebar.classList.contains('open')); });
  // 링크 클릭 또는 사이드바 바깥 클릭 시 접기
  sidebar.addEventListener('click', function (e) { if (e.target.closest('a')) setNav(false); });
  document.addEventListener('click', function (e) {
    if (sidebar.classList.contains('open') && !e.target.closest('#sidebar') && !e.target.closest('#navToggle')) setNav(false);
  });
})();
`;
