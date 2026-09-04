# 릴리스 가이드

`v*` 태그를 push 하면 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 이
macOS(Universal) + Windows 설치본을 빌드해 **GitHub Release 초안**에 첨부한다.
초안을 확인한 뒤 수동으로 공개(Publish)한다.

## 절차

1. 버전 올리기 — 아래 두 파일의 `version` 을 같은 값으로 맞춘다.
   - `package.json`
   - `src-tauri/tauri.conf.json`
2. 커밋 후 태그를 push 한다.

   ```bash
   git commit -am "chore: v0.2.1"
   git tag v0.2.1
   git push origin main v0.2.1
   ```

3. Actions 탭에서 빌드가 끝나면 Releases 에 초안이 생긴다. 릴리스 노트를 정리하고 Publish 한다.
   - 앱은 시작 시 최신 Release 의 `latest.json` 을 확인하므로, Publish 하는 순간 기존 사용자에게 업데이트가 안내된다.

## CI Secrets

저장소 **Settings → Secrets and variables → Actions** 에 등록한다. 값은 이 저장소 어디에도 적지 않는다.

### 자동 업데이트 서명 (필수)

| Secret | 설명 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `npx tauri signer generate` 로 만든 개인키 파일 내용 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 개인키 비밀번호 (없이 생성했으면 빈 값) |

- 대응하는 공개키는 `src-tauri/tauri.conf.json` 의 `plugins.updater.pubkey` 에 들어 있다 (공개 정보).
- 개인키를 분실하면 새 키를 만들고 pubkey 를 교체해야 하며, 기존 설치 사용자는 자동 업데이트가 끊긴다.

### macOS 코드 서명·공증 (mac 배포 시 필수)

| Secret | 설명 |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application 인증서(.p12)를 base64 인코딩한 값 |
| `APPLE_CERTIFICATE_PASSWORD` | 위 .p12 비밀번호 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <이름> (<TEAM_ID>)` 전체 문자열 |
| `KEYCHAIN_PASSWORD` | CI 임시 키체인용 임의 문자열 |
| `APPLE_ID` | 공증에 쓸 Apple 계정 이메일 |
| `APPLE_PASSWORD` | 위 계정의 앱 암호(app-specific password) |
| `APPLE_TEAM_ID` | Apple Developer 팀 ID |

- `.p12` base64: 키체인에서 인증서와 개인키를 함께 내보낸 뒤 `base64 -i cert.p12 | pbcopy`
- 서명 정보는 워크플로우의 환경변수로만 전달하며 `tauri.conf.json` 에는 적지 않는다.
- Secrets 가 없으면 mac 빌드는 서명 단계에서 실패하고, Windows 빌드는 정상 진행된다.
