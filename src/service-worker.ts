/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

/**
 * Offline application shell (PRD-SEC-008 Phase 3, PRD-FEAT-008). Caches the built app only, so
 * local review works without a connection once loaded. Never caches API calls or any image or
 * data: household data lives in IndexedDB, and AI analysis always needs the network.
 */

const SHELL = '/';
const files = [...immutable.map((f) => f.path), ...assets.map((f) => f.path)];
const CACHE = `hometrace-shell-${files.length}-${files[0] ?? 'dev'}`;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([...files, SHELL]))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith('hometrace-shell-') && k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

	if (req.mode === 'navigate') {
		// Every screen is the same client-rendered shell; serve it from cache when offline.
		event.respondWith(fetch(req).catch(async () => (await caches.match(SHELL)) ?? Response.error()));
		return;
	}
	if (files.includes(url.pathname)) {
		event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
	}
});
