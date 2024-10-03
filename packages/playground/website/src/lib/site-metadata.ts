/**
 * Manages site metadata, which is stored in a file called `site-info.json`
 *
 * Today, it's specific to Playground website. Tomorrow, it's meant to be
 * a standardized format for describing a Playground (or even WordPress?)
 * site's configuration, independent of the runtime, e.g. Playground website,
 * Playground CLI, Studio, WP-ENV, hosted environment etc.
 */

import { Blueprint, compileBlueprint } from '@wp-playground/blueprints';
import { resolveBlueprintFromURL } from './state/url/resolve-blueprint-from-url';

/**
 * The supported site storage types.
 *
 * Is it possible to restrict this to those three values for all Playground runtimes?
 * Or should the runtime be allowed to use custom storage types?
 */
export const SiteStorageTypes = ['opfs-temporary', 'opfs', 'local-fs'] as const;
export type SiteStorageType = (typeof SiteStorageTypes)[number];

/**
 * The site logo data.
 */
export type SiteLogo = {
	mime: string;
	data: string;
};

// TODO: Create a schema for this as the design matures
/**
 * The Site metadata that is persisted.
 */
export interface SiteMetadata {
	storage: SiteStorageType;
	id: string;
	name: string;
	logo?: SiteLogo;

	whenCreated?: number;
	whenLastLoaded?: number;
	isArchived?: boolean;

	// TODO: The designs show keeping admin username and password. Why do we want that?

	// @TODO: Accept any string as a php version?
	runtimeConfiguration: Pick<
		Required<Blueprint>,
		| 'features'
		| 'extraLibraries'
		| 'phpExtensionBundles'
		| 'preferredVersions'
	>;
	originalBlueprint: Blueprint;
}

export async function createSiteMetadata(
	initialMetadata: { name: string } & Partial<
		Omit<SiteMetadata, 'runtimeConfiguration'>
	>
): Promise<SiteMetadata> {
	const { name, originalBlueprint, ...remainingMetadata } = initialMetadata;

	const blueprint: Blueprint =
		originalBlueprint ??
		// TODO: This is a hack because we are just abusing a URL-oriented
		// function to create a completely default Blueprint. Let's fix this by
		// making default creation first-class.
		(await resolveBlueprintFromURL(new URL('https://w.org')));

	const compiledBlueprint = compileBlueprint(blueprint);

	return {
		name,
		id: crypto.randomUUID(),
		whenCreated: Date.now(),
		storage: 'opfs-temporary',
		originalBlueprint: blueprint,
		isArchived: false,

		...remainingMetadata,

		runtimeConfiguration: {
			preferredVersions: {
				wp: compiledBlueprint.versions.wp,
				php: compiledBlueprint.versions.php,
			},
			phpExtensionBundles: blueprint.phpExtensionBundles || [
				'kitchen-sink',
			],
			features: compiledBlueprint.features,
			extraLibraries: compiledBlueprint.extraLibraries,
		},
	};
}
