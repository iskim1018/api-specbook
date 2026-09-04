// OpenAPI 문서를 렌더링용 모델로 변환한다.
// - $ref(#/components/...) 해소
// - allOf 병합, oneOf/anyOf 는 "옵션" 하위 행으로 표현
// - 스키마를 표 행(row) 배열로 평탄화 (깊이 + 경로 보존)
// - 스키마의 example 값을 모아 예시 JSON 생성

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export function buildModel(doc) {
  const warnings = [];
  const resolver = makeResolver(doc, warnings);
  const ops = collectOperations(doc, resolver);
  const groups = groupByTag(doc, ops);
  return {
    info: doc.info ?? {},
    servers: doc.servers ?? [],
    security: describeSecurity(doc, resolver),
    groups,
    ops,
    warnings,
  };
}

// ---------------------------------------------------------------- $ref

function makeResolver(doc, warnings = []) {
  // 캐시에는 "순수한 해소 결과"만 담는다. 호출부의 형제 키(description 등)를 섞어서 캐시하면
  // 같은 $ref 를 다른 설명으로 두 번 쓸 때 첫 번째 설명이 전염된다.
  const cache = new Map();
  const missing = new Set();
  return function resolve(node, seen = new Set()) {
    if (!node || typeof node !== 'object') return node;
    if (!node.$ref) return node;
    const ref = node.$ref;
    if (!ref.startsWith('#/')) throw new Error(`외부 $ref 는 지원하지 않습니다: ${ref}`);
    if (seen.has(ref)) {
      return withSiblings({ type: 'object', description: `(순환 참조: ${refName(ref)})`, 'x-ref-name': refName(ref) }, node);
    }
    let resolved = cache.get(ref);
    if (resolved === undefined) {
      const target = ref.slice(2).split('/').reduce((acc, key) => {
        if (acc == null) return undefined;
        return acc[decodeURIComponent(key.replace(/~1/g, '/').replace(/~0/g, '~'))];
      }, doc);
      if (target === undefined) {
        // 정의를 못 찾아도 문서 전체를 죽이지 않고 자리표시자 + 경고로 넘어간다.
        if (!missing.has(ref)) {
          missing.add(ref);
          warnings.push(`$ref 대상을 찾을 수 없습니다: ${ref}`);
        }
        resolved = { type: 'object', description: `(정의를 찾을 수 없음: ${ref})` };
      } else {
        resolved = { ...resolve(target, new Set([...seen, ref])), 'x-ref-name': refName(ref) };
      }
      cache.set(ref, resolved);
    }
    return withSiblings(resolved, node);
  };
}

// $ref 옆에 붙은 description 등 형제 키는 3.0 에서 무시되지만, 있으면 살려 준다.
// 캐시된 원본을 건드리지 않도록 사본에 얹는다.
function withSiblings(resolved, node) {
  const siblings = Object.keys(node).filter((k) => k !== '$ref');
  if (!siblings.length) return resolved;
  const merged = { ...resolved };
  for (const k of siblings) if (merged[k] === undefined) merged[k] = node[k];
  return merged;
}

function refName(ref) {
  return ref.split('/').pop();
}

// ---------------------------------------------------------------- operations

function collectOperations(doc, resolve) {
  const ops = [];
  let index = 0;
  for (const [path, rawItem] of Object.entries(doc.paths ?? {})) {
    const item = resolve(rawItem);
    const sharedParams = (item.parameters ?? []).map(resolve);
    for (const method of METHODS) {
      if (!item[method]) continue;
      const op = item[method];
      index += 1;
      const params = mergeParams(sharedParams, (op.parameters ?? []).map(resolve));
      ops.push({
        id: `op-${index}`,
        method: method.toUpperCase(),
        path,
        operationId: op.operationId ?? '',
        summary: op.summary ?? '',
        description: op.description ?? '',
        deprecated: !!op.deprecated,
        tags: op.tags?.length ? op.tags : ['default'],
        extensions: pickExtensions(op),
        parameters: groupParams(params, resolve),
        requestBody: describeRequestBody(op.requestBody, resolve),
        responses: describeResponses(op.responses, resolve),
      });
    }
  }
  return ops;
}

function mergeParams(shared, own) {
  const key = (p) => `${p.in}:${p.name}`;
  const map = new Map(shared.map((p) => [key(p), p]));
  for (const p of own) map.set(key(p), p);
  return [...map.values()];
}

function groupParams(params, resolve) {
  const groups = { path: [], query: [], header: [], cookie: [] };
  for (const p of params) {
    const schema = resolve(p.schema ?? {});
    const row = {
      name: p.name,
      path: p.name,
      depth: 0,
      type: typeLabel(schema, resolve),
      required: !!p.required,
      constraints: constraintsOf(schema),
      description: p.description ?? schema.description ?? '',
      example: exampleOf(p) ?? exampleOf(schema),
      hasChildren: false,
    };
    (groups[p.in] ?? (groups[p.in] = [])).push(row);
  }
  return Object.entries(groups)
    .filter(([, rows]) => rows.length)
    .map(([location, rows]) => ({ location, rows }));
}

function pickExtensions(op) {
  const out = {};
  for (const [k, v] of Object.entries(op)) if (k.startsWith('x-')) out[k] = v;
  return out;
}

function describeRequestBody(body, resolve) {
  if (!body) return null;
  body = resolve(body);
  const media = pickMedia(body.content ?? {}, resolve);
  return {
    required: !!body.required,
    description: body.description ?? '',
    ...media,
  };
}

function describeResponses(responses, resolve) {
  const out = [];
  for (const [status, raw] of Object.entries(responses ?? {})) {
    const res = resolve(raw);
    const media = pickMedia(res.content ?? {}, resolve);
    out.push({
      status,
      description: res.description ?? '',
      headers: Object.entries(res.headers ?? {}).map(([name, h]) => {
        h = resolve(h);
        const schema = resolve(h.schema ?? {});
        return { name, type: typeLabel(schema, resolve), required: !!h.required, description: h.description ?? '' };
      }),
      ...media,
    });
  }
  return out;
}

// 대표 media type 선택 우선순위. application/xml 이 먼저 적혀 있어도 JSON 본문 표를 보여 준다.
const MEDIA_PRIORITY = [
  (ct) => ct === 'application/json',
  (ct) => ct.endsWith('+json'),
  (ct) => ct === 'application/x-www-form-urlencoded',
  (ct) => ct === 'multipart/form-data',
];

function pickPrimaryIndex(entries) {
  const norm = entries.map(([ct]) => String(ct).split(';')[0].trim().toLowerCase());
  for (const match of MEDIA_PRIORITY) {
    const i = norm.findIndex(match);
    if (i >= 0) return i;
  }
  return 0;
}

// 대표 media type 하나만 표로 펼치고 나머지는 이름만 기록한다.
function pickMedia(content, resolve) {
  const entries = Object.entries(content);
  if (!entries.length) return { contentType: null, rows: [], example: undefined, namedExamples: [], otherContentTypes: [] };
  const primary = pickPrimaryIndex(entries);
  const [contentType, media] = entries[primary];
  const schema = resolve(media.schema ?? {});
  const rows = schema && Object.keys(schema).length ? flattenSchema(schema, resolve) : [];
  const namedExamples = Object.entries(media.examples ?? {}).map(([name, ex]) => {
    ex = resolve(ex);
    return { name, summary: ex.summary ?? '', description: ex.description ?? '', value: ex.value };
  });
  let example = media.example;
  if (example === undefined && namedExamples.length === 1) example = namedExamples[0].value;
  if (example === undefined && rows.length) example = buildExample(schema, resolve);
  return {
    contentType,
    schemaName: schema['x-ref-name'] ?? null,
    schemaType: typeLabel(schema, resolve),
    schemaDescription: schema.description ?? '',
    rows,
    example,
    namedExamples,
    otherContentTypes: entries.filter((_, i) => i !== primary).map(([ct]) => ct),
  };
}

// ---------------------------------------------------------------- schema → rows

export function flattenSchema(schema, resolve, opts = {}) {
  const rows = [];
  const maxDepth = opts.maxDepth ?? 12;
  const root = normalize(resolve(schema), resolve);
  // 루트가 객체면 프로퍼티부터, 배열이면 items 부터, 그 외에는 단일 행
  if (root.kind === 'object') {
    for (const child of root.children) walk(child, 0, '');
  } else if (root.kind === 'array') {
    walk({ ...root, name: '(배열 항목)' }, 0, '', true);
  } else {
    walk({ ...root, name: '(값)' }, 0, '');
  }
  return rows;

  function walk(node, depth, parentPath, isArrayItemRoot = false) {
    const path = parentPath ? `${parentPath}.${node.name}` : node.name;
    const hasChildren = node.children.length > 0 && depth < maxDepth;
    rows.push({
      name: node.name,
      path,
      depth,
      type: node.typeLabel,
      required: node.required,
      constraints: node.constraints,
      description: node.description,
      example: node.example,
      hasChildren,
      variant: node.variant ?? null,
      nullable: node.nullable,
      deprecated: node.deprecated,
      refName: node.refName,
    });
    if (hasChildren) for (const child of node.children) walk(child, depth + 1, path);
  }
}

// normalize 재귀 안전장치. 자기 참조 스키마에서 스택이 터지지 않도록 한다.
const MAX_NORMALIZE_DEPTH = 24;

// 스키마 노드를 {kind, typeLabel, children, ...} 로 정규화한다.
// depth/seenRefs 로 자기 참조(Node → children → Node)를 잎 행으로 끊는다.
function normalize(schema, resolve, name = '', required = false, depth = 0, seenRefs = new Set()) {
  schema = resolve(schema) ?? {};
  if (Array.isArray(schema.allOf)) schema = mergeAllOf(schema, resolve);

  const base = {
    name,
    required,
    description: schema.description ?? '',
    example: exampleOf(schema),
    constraints: constraintsOf(schema),
    nullable: !!schema.nullable,
    deprecated: !!schema.deprecated,
    refName: schema['x-ref-name'] ?? null,
    children: [],
  };

  // 이미 거쳐 온 명명 스키마를 또 만나면 순환이므로 자식 없이 끝낸다.
  if (base.refName && seenRefs.has(base.refName)) {
    const mark = `(순환 참조: ${base.refName})`;
    return { ...base, kind: 'primitive', typeLabel: typeLabel(schema, resolve), description: base.description ? `${base.description} ${mark}` : mark };
  }
  if (depth >= MAX_NORMALIZE_DEPTH) return { ...base, kind: 'primitive', typeLabel: typeLabel(schema, resolve) };
  const nextSeen = base.refName ? new Set([...seenRefs, base.refName]) : seenRefs;

  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants)) {
    const keyword = schema.oneOf ? 'oneOf' : 'anyOf';
    const children = variants.map((v, i) => {
      const n = normalize(v, resolve, `옵션 ${i + 1}`, false, depth + 1, nextSeen);
      n.variant = keyword;
      if (n.refName && !n.description) n.description = n.refName;
      return n;
    });
    return { ...base, kind: 'variant', typeLabel: keyword === 'oneOf' ? '다음 중 하나' : '다음 중 하나 이상', children };
  }

  const type = effectiveType(schema);
  if (type === 'object') {
    const req = new Set(schema.required ?? []);
    const children = Object.entries(schema.properties ?? {}).map(([k, v]) => normalize(v, resolve, k, req.has(k), depth + 1, nextSeen));
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      children.push(normalize(schema.additionalProperties, resolve, '{key}', false, depth + 1, nextSeen));
    }
    return { ...base, kind: 'object', typeLabel: typeLabel(schema, resolve), children };
  }
  if (type === 'array') {
    const items = normalize(schema.items ?? {}, resolve, '[]', false, depth + 1, nextSeen);
    // 배열의 항목이 객체/변형이면 그 자식들을 배열 바로 아래에 붙인다. (items 라는 가짜 단계 생략)
    const children = items.kind === 'object' || items.kind === 'variant' ? items.children : [];
    const label = typeLabel(schema, resolve);
    const merged = { ...base, kind: 'array', typeLabel: label, children };
    if (!merged.description && items.description) merged.description = items.description;
    if (merged.example === undefined && items.example !== undefined) merged.example = [items.example];
    if (!merged.constraints.length) merged.constraints = items.constraints;
    return merged;
  }
  return { ...base, kind: 'primitive', typeLabel: typeLabel(schema, resolve) };
}

// seen: 지금 병합 중인 명명 스키마 이름. B: allOf[$ref B] 처럼 자기 자신을 조각으로 품으면
// 무한 재귀가 되므로 이미 병합 중인 조각은 건너뛴다.
// 조각 객체는 절대 수정하지 않는다. resolve 는 인라인 스키마의 경우 원본 객체를 그대로 돌려주므로
// Object.assign 으로 덮으면 사용자의 입력 문서와 resolver 캐시가 오염된다.
function mergeAllOf(schema, resolve, seen = new Set()) {
  const self = schema['x-ref-name'];
  const nextSeen = self ? new Set([...seen, self]) : seen;
  const merged = { type: 'object', properties: {}, required: [] };
  const refParts = schema.allOf
    .map((s) => resolve(s))
    .filter((p) => p && !(p['x-ref-name'] && nextSeen.has(p['x-ref-name'])));
  for (let part of [...refParts, { ...schema, allOf: undefined }]) {
    if (!part) continue;
    if (Array.isArray(part.allOf)) part = mergeAllOf(part, resolve, nextSeen);
    for (const [k, v] of Object.entries(part)) {
      if (k === 'properties') Object.assign(merged.properties, v);
      else if (k === 'required') merged.required.push(...v);
      else if (k === 'allOf') continue;
      else if (v !== undefined) merged[k] = v;
    }
  }
  return merged;
}

function effectiveType(schema) {
  if (schema.type) return Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (schema.properties || schema.additionalProperties) return 'object';
  if (schema.items) return 'array';
  return 'any';
}

// seen: 이미 라벨을 만드는 중인 명명 스키마 이름. A = array<A> 나 C↔D 상호 참조에서
// 무한 재귀에 빠지지 않도록, 다시 만난 이름은 풀지 않고 이름만 적는다.
export function typeLabel(schema, resolve, seen = new Set()) {
  schema = resolve(schema) ?? {};
  if (Array.isArray(schema.allOf)) return 'object';
  if (schema.oneOf) return 'oneOf';
  if (schema.anyOf) return 'anyOf';
  const type = effectiveType(schema);
  if (type === 'array') {
    const items = resolve(schema.items ?? {}) ?? {};
    const self = schema['x-ref-name'];
    const nextSeen = self ? new Set([...seen, self]) : seen;
    const itemName = items['x-ref-name'];
    if (itemName && nextSeen.has(itemName)) return `array<${itemName}>`;
    return `array<${typeLabel(items, resolve, nextSeen)}>`;
  }
  if (type === 'object') return schema['x-ref-name'] ? `object (${schema['x-ref-name']})` : 'object';
  if (type === 'any') return 'any';
  if (schema.format) return `${type} (${schema.format})`;
  return type;
}

export function constraintsOf(schema) {
  const out = [];
  if (!schema || typeof schema !== 'object') return out;
  if (schema.enum) out.push(`enum: ${schema.enum.map((v) => JSON.stringify(v)).join(' | ')}`);
  if (schema.const !== undefined) out.push(`const: ${JSON.stringify(schema.const)}`);
  if (schema.default !== undefined) out.push(`기본값: ${JSON.stringify(schema.default)}`);
  if (schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength === schema.maxLength) {
    out.push(`길이 ${schema.maxLength}`);
  } else {
    if (schema.minLength !== undefined) out.push(`최소길이 ${schema.minLength}`);
    if (schema.maxLength !== undefined) out.push(`최대길이 ${schema.maxLength}`);
  }
  if (schema.minimum !== undefined) out.push(`최소 ${schema.exclusiveMinimum === true ? '>' : '>='} ${schema.minimum}`);
  if (schema.maximum !== undefined) out.push(`최대 ${schema.exclusiveMaximum === true ? '<' : '<='} ${schema.maximum}`);
  if (typeof schema.exclusiveMinimum === 'number') out.push(`> ${schema.exclusiveMinimum}`);
  if (typeof schema.exclusiveMaximum === 'number') out.push(`< ${schema.exclusiveMaximum}`);
  if (schema.multipleOf !== undefined) out.push(`배수 ${schema.multipleOf}`);
  if (schema.pattern) out.push(`패턴 ${schema.pattern}`);
  if (schema.minItems !== undefined) out.push(`최소 ${schema.minItems}개`);
  if (schema.maxItems !== undefined) out.push(`최대 ${schema.maxItems}개`);
  if (schema.uniqueItems) out.push('중복 불가');
  if (schema.readOnly) out.push('읽기 전용');
  if (schema.writeOnly) out.push('쓰기 전용');
  return out;
}

function exampleOf(node) {
  if (!node || typeof node !== 'object') return undefined;
  if (node.example !== undefined) return node.example;
  if (Array.isArray(node.examples) && node.examples.length) return node.examples[0];
  return undefined;
}

// ---------------------------------------------------------------- example JSON

export function buildExample(schema, resolve, depth = 0) {
  schema = resolve(schema) ?? {};
  if (depth > 20) return null;
  if (Array.isArray(schema.allOf)) schema = mergeAllOf(schema, resolve);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants) && variants.length) return buildExample(variants[0], resolve, depth + 1);
  const type = effectiveType(schema);
  if (type === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = buildExample(v, resolve, depth + 1);
    return out;
  }
  if (type === 'array') return [buildExample(schema.items ?? {}, resolve, depth + 1)];
  if (schema.enum?.length) return schema.enum[0];
  switch (type) {
    case 'integer': return 0;
    case 'number': return 0;
    case 'boolean': return true;
    case 'string':
      if (schema.format === 'date') return '2026-01-01';
      if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
      return 'string';
    default: return null;
  }
}

// ---------------------------------------------------------------- tags / security

function groupByTag(doc, ops) {
  const declared = (doc.tags ?? []).map((t) => t.name);
  const order = [...declared];
  for (const op of ops) for (const t of op.tags) if (!order.includes(t)) order.push(t);
  const descs = Object.fromEntries((doc.tags ?? []).map((t) => [t.name, t.description ?? '']));
  return order
    .map((tag) => ({ tag, description: descs[tag] ?? '', ops: ops.filter((op) => op.tags.includes(tag)) }))
    .filter((g) => g.ops.length);
}

function describeSecurity(doc, resolve) {
  const schemes = doc.components?.securitySchemes ?? {};
  const out = [];
  for (const [name, raw] of Object.entries(schemes)) {
    const s = resolve(raw);
    let how = s.type;
    if (s.type === 'apiKey') how = `API Key · ${s.in} "${s.name}"`;
    else if (s.type === 'http') how = `HTTP ${s.scheme}${s.bearerFormat ? ` (${s.bearerFormat})` : ''}`;
    else if (s.type === 'oauth2') how = `OAuth2 (${Object.keys(s.flows ?? {}).join(', ')})`;
    else if (s.type === 'openIdConnect') how = `OpenID Connect · ${s.openIdConnectUrl}`;
    out.push({ name, how, description: s.description ?? '', global: (doc.security ?? []).some((req) => name in req) });
  }
  return out;
}
