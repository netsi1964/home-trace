/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-netlify';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// Local development only: expose .env to server code (process.env). Never to the client bundle.
	if (mode === 'development') Object.assign(process.env, { ...loadEnv(mode, process.cwd(), ''), ...process.env });
	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Netlify: static client plus a Node function for server routes, later the private provider proxy (PRD-SEC-004).
				adapter: adapter()
			})
		],
		test: {
			include: ['src/**/*.test.ts', 'scripts/**/*.test.ts']
		}
	};
});
