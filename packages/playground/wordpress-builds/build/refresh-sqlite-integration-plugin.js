import yargs from 'yargs';
import { promises as fs } from 'fs';
const parser = yargs(process.argv.slice(2))
	.usage('Usage: $0 [options]')
	.options({
		['output-dir']: {
			type: 'string',
			description: 'output directory',
			required: true,
		},
	});

const args = parser.argv;

const outputZipPath = `${args.outputDir}/sqlite-database-integration.zip`;
const sqliteResponse = await fetch(
	'https://github.com/WordPress/sqlite-database-integration/archive/refs/heads/develop.zip'
);
const sqliteZip = Buffer.from(await sqliteResponse.arrayBuffer());
await fs.writeFile(outputZipPath, sqliteZip);

// Refresh get-sqlite-module.ts
const getWordPressModulePath = `${args.outputDir}/get-sqlite-database-plugin-details.ts`;
const getWordPressModuleContent = `
// @ts-ignore
import url from './sqlite-database-integration.zip?url';

/**
 * This file was auto generated by packages/playground/wordpress-builds/build/refresh-sqlite-integration-plugin.js
 * DO NOT CHANGE MANUALLY!
 * This file must statically exists in the project because of the way
 * vite resolves imports.
 */
export const size = ${JSON.stringify((await fs.stat(outputZipPath)).size)};
export { url };

`;
await fs.writeFile(getWordPressModulePath, getWordPressModuleContent);