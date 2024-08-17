import { defineConfig } from 'tsup';

export default defineConfig({
	name: 'java.io',
	entry: ['src/index.ts'],
	sourcemap: true,
	treeshake: true,
	clean: true,
	minify: true
});