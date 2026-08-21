import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // SPEC: избегать явного и неявного any, небезопасных утверждений типа
      // и непроверенного unknown в логике приложения.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Читаемость и предсказуемость
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Контракт Fastify для плагинов и обработчиков — «вернуть Promise».
      // Пометка async там, где внутри нет await, — это соответствие контракту,
      // а не забытый вызов. Настоящие ошибки с промисами ловят оставшиеся
      // включёнными no-floating-promises, no-misused-promises и await-thenable.
      '@typescript-eslint/require-await': 'off',

      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // Скрипты запускаются вручную — им можно писать в stdout.
  {
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Конфиги без типовой информации.
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
