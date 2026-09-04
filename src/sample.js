// 앱을 처음 열었을 때 보여줄 기본 예시 스펙 (파일을 열기 전 미리보기 확인용).
export const SAMPLE_NAME = 'example.yaml';
export const SAMPLE_YAML = `openapi: 3.0.3
info:
  title: 예시 안전관리 API
  version: 0.6.0
  description: |
    안전관리자 등록·조회 서비스입니다.
servers:
  - url: https://api.example.com
paths:
  /api/v1/managers:
    get:
      summary: 안전관리자 목록 조회
      tags: [관리자]
      parameters:
        - name: page
          in: query
          description: 페이지 번호
          schema:
            type: integer
            default: 1
        - name: size
          in: query
          description: 페이지 크기
          schema:
            type: integer
            default: 20
      responses:
        '200':
          description: 성공
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagerList'
    post:
      summary: 안전관리자 등록
      tags: [관리자]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ManagerInput'
      responses:
        '201':
          description: 등록됨
  /api/v1/managers/{id}:
    delete:
      summary: 안전관리자 삭제
      tags: [관리자]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '204':
          description: 삭제됨
components:
  schemas:
    Manager:
      type: object
      properties:
        id:
          type: string
          description: 관리자 식별자
        name:
          type: string
          description: 이름
        phone:
          type: string
          description: 연락처
    ManagerInput:
      type: object
      required: [name, phone]
      properties:
        name:
          type: string
        phone:
          type: string
    ManagerList:
      type: object
      properties:
        total:
          type: integer
        items:
          type: array
          items:
            $ref: '#/components/schemas/Manager'
`;
