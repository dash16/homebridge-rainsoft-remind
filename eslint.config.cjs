// eslint.config.cjs
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = [
	// 1) ignore build + UI stuff
	{
		ignores: [
			'dist/**',
			'lib/**',
			'homebridge-ui/**',
			'**/*.d.ts',
		],
	},

	// 2) TypeScript source
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		rules: {
			// your preferences
			indent: ['error', 'tab', { SwitchCase: 1 }],
			quotes: ['error', 'single'],

			// you’ve got some anys and require()s in the codebase,
			// let’s not make them fatal right now
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-require-imports': 'off',
		},
	},

	// 3) plain JS (if you have any at the root)
	{
		files: ['*.js'],
		...js.configs.recommended,
	},
];
