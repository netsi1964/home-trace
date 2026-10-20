<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
</script>

<!-- Session URLs are same-device references, not copies (PRD-SEC-004). -->
<section class="card stack" role="status">
	<h1>{t('session.notOnDevice')}</h1>
	<p>{t('session.notOnDeviceText')}</p>
	<div class="row">
		<a class="button primary" href="/data#import">{t('data.import')}</a>
		<a class="button" href="/">{t('nav.home')}</a>
	</div>
</section>
