<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { i18n, initLocale, isLocale, LOCALES, setLocale, t } from '#lib/i18n/index.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(initLocale);
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>{t('app.name')}</title>
</svelte:head>

<a class="skip visually-hidden" href="#main">{t('app.skip')}</a>

<header>
	<a class="brand" href="/">
		<img src={favicon} alt="" width="32" height="32" />
		<span>{t('app.name')}</span>
	</a>
	<label class="lang">
		<span class="visually-hidden">{t('app.language')}</span>
		<select
			value={i18n.locale}
			onchange={(e) => {
				const v = e.currentTarget.value;
				if (isLocale(v)) setLocale(v);
			}}
		>
			{#each Object.entries(LOCALES) as [code, name] (code)}
				<option value={code}>{name}</option>
			{/each}
		</select>
	</label>
</header>

<main id="main">
	{@render children()}
</main>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px var(--gutter);
		border-bottom: 1px solid var(--line);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--tap);
		text-decoration: none;
		font-size: 1.15rem;
	}

	.lang select {
		width: auto;
	}

	.skip:focus {
		position: static;
		width: auto;
		height: auto;
		clip-path: none;
		padding: 8px var(--gutter);
	}

	main {
		padding: var(--gutter);
		max-width: 1200px;
		margin: 0 auto;
	}
</style>
