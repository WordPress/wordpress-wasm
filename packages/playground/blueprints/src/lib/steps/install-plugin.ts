import { StepHandler } from '.';
import { installAsset } from './install-asset';
import { activatePlugin } from './activate-plugin';
import { applyGutenbergPatchOnce } from './apply-wordpress-patches';
import { zipNameToHumanName } from '../utils/zip-name-to-human-name';

/**
 * @inheritDoc installPlugin
 * @hasRunnableExample
 * @needsLogin
 * @landingPage /wp-admin/plugins.php
 * @example
 *
 * <code>
 * {
 * 	    "step": "installPlugin",
 * 		"pluginZipFile": {
 * 			"resource": "wordpress.org/plugins",
 * 			"slug": "gutenberg"
 * 		},
 * 		"options": {
 * 			"activate": true
 * 		}
 * }
 * </code>
 */
export interface InstallPluginStep<ResourceType> {
	/**
	 * The step identifier.
	 */
	step: 'installPlugin';
	/**
	 * The plugin zip file to install.
	 */
	pluginZipFile: ResourceType;
	/**
	 * Optional installation options.
	 */
	options?: InstallPluginOptions;
}

export interface InstallPluginOptions {
	/**
	 * Whether to activate the plugin after installing it.
	 */
	activate?: boolean;
}

/**
 * Installs a WordPress plugin in the Playground.
 *
 * @param playground The playground client.
 * @param pluginZipFile The plugin zip file.
 * @param options Optional. Set `activate` to false if you don't want to activate the plugin.
 */
export const installPlugin: StepHandler<InstallPluginStep<File>> = async (
	playground,
	{ pluginZipFile, options = {} },
	progress?
) => {
	const zipFileName = pluginZipFile.name.split('/').pop() || 'plugin.zip';
	const zipNiceName = zipNameToHumanName(zipFileName);

	progress?.tracker.setCaption(`Installing the ${zipNiceName} plugin`);
	try {
		const { assetFolderPath } = await installAsset(playground, {
			zipFile: pluginZipFile,
			targetPath: `${await playground.documentRoot}/wp-content/plugins`,
		});

		// Activate

		const activate = 'activate' in options ? options.activate : true;

		if (activate) {
			await activatePlugin(
				playground,
				{
					pluginPath: assetFolderPath,
					pluginName: zipNiceName,
				},
				progress
			);
		}

		await applyGutenbergPatchOnce(playground);
	} catch (error) {
		console.error(
			`Proceeding without the ${zipNiceName} plugin. Could not install it in wp-admin. ` +
				`The original error was: ${error}`
		);
		console.error(error);
	}
};
