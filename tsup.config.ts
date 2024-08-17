import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	sourcemap: true,
	treeshake: true,
	clean: true,
	minify: true,
	dts: true,
	esbuildOptions(options) {
		options.keepNames = true; // * Don't mangle class names
	}
});