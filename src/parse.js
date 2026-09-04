import yaml from 'js-yaml';

// 텍스트 → OpenAPI 문서 객체. 실패 시 위치 정보를 담은 error 반환.
// 반환: { doc, error }  (error = { message, line, col, pos } | null, 1-based line/col)
export function parseSpec(text, ext) {
  const isJson = ext === 'json';
  try {
    const doc = isJson ? JSON.parse(text) : yaml.load(text);
    if (doc == null || typeof doc !== 'object') {
      return { doc: null, error: { message: '내용이 비어 있거나 객체가 아닙니다.', line: 1, col: 1, pos: 0 } };
    }
    if (doc.swagger && !doc.openapi) {
      return { doc: null, error: { message: 'Swagger 2.0 은 지원하지 않습니다. OpenAPI 3.x 로 변환 후 사용하세요.', line: 1, col: 1, pos: 0 } };
    }
    if (!doc.openapi) {
      return { doc: null, error: { message: 'OpenAPI 문서가 아닙니다 (openapi 필드 없음).', line: 1, col: 1, pos: 0 } };
    }
    return { doc, error: null };
  } catch (e) {
    return { doc: null, error: isJson ? jsonError(e, text) : yamlError(e) };
  }
}

function yamlError(e) {
  const mark = e.mark || {};
  const line = (mark.line ?? 0) + 1;
  const col = (mark.column ?? 0) + 1;
  const reason = e.reason || e.message || 'YAML 구문 오류';
  return { message: reason, line, col, pos: mark.position ?? 0 };
}

function jsonError(e, text) {
  const msg = e.message || 'JSON 구문 오류';
  let m = /line (\d+) column (\d+)/i.exec(msg);
  if (m) return { message: msg, line: +m[1], col: +m[2], pos: 0 };
  m = /position (\d+)/i.exec(msg);
  if (m) {
    const pos = +m[1];
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return { message: msg, line, col, pos };
  }
  return { message: msg, line: 1, col: 1, pos: 0 };
}
