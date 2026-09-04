import SwaggerUIBundle from 'swagger-ui-dist/swagger-ui-bundle.js';
import 'swagger-ui-dist/swagger-ui.css';

// 우측 뷰어: [Swagger UI] / [문서(HTML)] 탭 전환.
export function createViewer(bodyEl) {
  const swaggerPane = document.createElement('div');
  swaggerPane.className = 'viewer-pane hidden';
  const swaggerMount = document.createElement('div');
  swaggerMount.id = 'swagger-container';
  swaggerPane.appendChild(swaggerMount);

  const docPane = document.createElement('div');
  docPane.className = 'viewer-pane';
  const iframe = document.createElement('iframe');
  // allow-same-origin 은 srcdoc 과 함께 쓰면 샌드박스가 무력화되므로 제외한다.
  // (문서 내 스크립트는 앱 DOM/스토리지에 접근할 이유가 없다)
  iframe.setAttribute('sandbox', 'allow-popups allow-scripts');
  iframe.setAttribute('allow', 'clipboard-write'); // 문서의 '복사' 버튼용 권한 위임
  iframe.title = '문서 미리보기';
  docPane.appendChild(iframe);

  bodyEl.append(swaggerPane, docPane);

  let activeTab = 'doc';       // 'doc' | 'swagger'
  let lastSpec = null;
  let swaggerDirty = true;     // 활성화 시 재렌더 필요 여부

  function renderSwagger() {
    if (!lastSpec) return;
    swaggerMount.innerHTML = '';
    SwaggerUIBundle({
      domNode: swaggerMount,
      spec: lastSpec,
      deepLinking: false,
      docExpansion: 'list',
      defaultModelsExpandDepth: 0,
      tryItOutEnabled: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
    });
    swaggerDirty = false;
  }

  return {
    showTab(tab) {
      activeTab = tab;
      docPane.classList.toggle('hidden', tab !== 'doc');
      swaggerPane.classList.toggle('hidden', tab !== 'swagger');
      if (tab === 'swagger' && swaggerDirty) renderSwagger();
    },
    // 유효한 파싱 결과가 있을 때: html(문서 렌더), spec(원본 문서 객체)
    setContent({ html, spec }) {
      if (html != null) iframe.srcdoc = html;
      lastSpec = spec || null;
      swaggerDirty = true;
      if (activeTab === 'swagger') renderSwagger();
    },
    clear() {
      iframe.srcdoc = '';
      swaggerMount.innerHTML = '';
      lastSpec = null;
    },
  };
}
