import {
	SupportedWordPressVersions,
	getSqliteDatabaseModule,
	getWordPressModule,
} from '@wp-playground/wordpress-builds';
import { RecommendedPHPVersion } from '@wp-playground/common';
import { loadNodeRuntime } from '@php-wasm/node';
import { bootWordPress } from '../boot';
import { getLoadedWordPressVersion } from '../version-detect';

describe('Test WP version detection', async () => {
	for (const expectedWordPressVersion of Object.keys(
		SupportedWordPressVersions
	)) {
		it(`detects WP ${expectedWordPressVersion}`, async () => {
			const handler = await bootWordPress({
				createPhpRuntime: async () =>
					await loadNodeRuntime(RecommendedPHPVersion),
				siteUrl: 'http://playground-domain/',

				wordPressZip: await getWordPressModule(
					expectedWordPressVersion
				),
				sqliteIntegrationPluginZip: await getSqliteDatabaseModule(),
			});
			const loadedWordPressVersion = await getLoadedWordPressVersion(
				handler
			);
			expect(loadedWordPressVersion).to.equal(expectedWordPressVersion);
		});
	}

	it('errors on failure to detect version', async () => {
		const handler = await bootWordPress({
			createPhpRuntime: async () =>
				await loadNodeRuntime(RecommendedPHPVersion),
			siteUrl: 'http://playground-domain/',

			wordPressZip: await getWordPressModule(),
			sqliteIntegrationPluginZip: await getSqliteDatabaseModule(),
		});
		const php = await handler.getPrimaryPhp();

		php.writeFile(
			`${handler.documentRoot}/wp-includes/version.php`,
			'<?php $wp_version = "invalid-version";'
		);

		const detectionResult = await getLoadedWordPressVersion(handler).then(
			() => 'no-error',
			() => 'error'
		);
		expect(detectionResult).to.equal('error');
	});
});
