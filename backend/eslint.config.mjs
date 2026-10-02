// T005 — 백엔드 린트(타입 오류는 tsc 가, 규칙 위반은 eslint 가)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'storage/**', 'logs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // DB 행·외부 응답은 any 로 받고 DTO 에서 좁힌다
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'no-restricted-syntax': [
        'error',
        // CLAUDE.md — 트리거 SIGNAL 사상은 sqlErrorMap.ts 한 곳에서만
        { selector: "Literal[value=/^(G1|G2|G6|G10|UC3 E4): /]", message: '트리거 메시지 사상은 gates/sqlErrorMap.ts 에서만 하세요' },
      ],
    },
  },
  { files: ['src/gates/sqlErrorMap.ts', 'tests/**'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly' } } },
);
