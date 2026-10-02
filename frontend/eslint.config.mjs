// T005 — 프런트 린트 + 스타일가이드 규칙(hex·500 굵기 등은 scripts/check-style.mjs)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', indexedDB: 'readonly', crypto: 'readonly', URL: 'readonly' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off', // 타입 검사는 vue-tsc 가 한다
      // 포맷은 prettier 가 맡는다
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/attributes-order': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/multi-word-component-names': 'off',
      // 게이트는 C2 블록으로만 — 토스트·모달 대체 금지(FR-004)
      'no-alert': 'error',
      'no-restricted-globals': ['error', { name: 'confirm', message: '확인은 인라인으로(모달 금지)' }, { name: 'alert', message: 'C2GateBlock 또는 AlertBox 를 쓰세요' }],
    },
  },
);
