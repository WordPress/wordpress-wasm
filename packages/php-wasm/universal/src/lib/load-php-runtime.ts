import { logger } from '@php-wasm/logger';
import { IncomingMessage, Server, ServerResponse } from 'http';

const RuntimeId = Symbol('RuntimeId');
const loadedRuntimes: Map<number, PHPRuntime> = new Map();
let lastRuntimeId = 0;

/**
 * Loads the PHP runtime with the given arguments and data dependencies.
 *
 * This function handles the entire PHP initialization pipeline. In particular,
 * it:
 *
 * * Instantiates the Emscripten PHP module
 * * Wires it together with the data dependencies and loads them
 * * Ensures is all happens in a correct order
 * * Waits until the entire loading sequence is finished
 *
 * Basic usage:
 *
 * ```js
 *  const phpLoaderModule = await getPHPLoaderModule("7.4");
 *  const php = await loadPHPRuntime( phpLoaderModule );
 *  console.log(php.run(`<?php echo "Hello, world!"; `));
 *  // { stdout: ArrayBuffer containing the string "Hello, world!", stderr: [''], exitCode: 0 }
 * ```
 *
 * **The PHP loader module:**
 *
 * In the basic usage example, `phpLoaderModule` is **not** a vanilla
 * Emscripten module. Instead, it's an ESM module that wraps the regular
 * Emscripten output and adds some extra functionality. It's generated by the
 * Dockerfile shipped with this repo. Here's the API it provides:
 *
 * ```js
 * // php.wasm size in bytes:
 * export const dependenciesTotalSize = 5644199;
 *
 * // php.wasm filename:
 * export const dependencyFilename = 'php.wasm';
 *
 * // Run Emscripten's generated module:
 * export default function(jsEnv, emscriptenModuleArgs) {}
 * ```
 *
 * **PHP Filesystem:**
 *
 * Once initialized, the PHP has its own filesystem separate from the project
 * files. It's provided by [Emscripten and uses its FS library](https://emscripten.org/docs/api_reference/Filesystem-API.html).
 *
 * The API exposed to you via the PHP class is succinct and abstracts
 * certain unintuitive parts of low-level filesystem interactions.
 *
 * Here's how to use it:
 *
 * ```js
 * // Recursively create a /var/www directory
 * php.mkdirTree('/var/www');
 *
 * console.log(php.fileExists('/var/www/file.txt'));
 * // false
 *
 * php.writeFile('/var/www/file.txt', 'Hello from the filesystem!');
 *
 * console.log(php.fileExists('/var/www/file.txt'));
 * // true
 *
 * console.log(php.readFile('/var/www/file.txt'));
 * // "Hello from the filesystem!
 *
 * // Delete the file:
 * php.unlink('/var/www/file.txt');
 * ```
 *
 * For more details consult the PHP class directly.
 *
 * **Data dependencies:**
 *
 * Using existing PHP packages by manually recreating them file-by-file would
 * be quite inconvenient. Fortunately, Emscripten provides a "data dependencies"
 * feature.
 *
 * Data dependencies consist of a `dependency.data` file and a `dependency.js`
 * loader and can be packaged with the [file_packager.py tool](
 * https://emscripten.org/docs/porting/files/packaging_files.html#packaging-using-the-file-packager-tool).
 * This project requires wrapping the Emscripten-generated `dependency.js` file
 * in an ES module as follows:
 *
 * 1. Prepend `export default function(emscriptenPHPModule) {'; `
 * 2. Prepend `export const dependencyFilename = '<DATA FILE NAME>'; `
 * 3. Prepend `export const dependenciesTotalSize = <DATA FILE SIZE>;`
 * 4. Append `}`
 *
 * Be sure to use the `--export-name="emscriptenPHPModule"` file_packager.py
 * option.
 *
 * You want the final output to look as follows:
 *
 * ```js
 * export const dependenciesTotalSize = 5644199;
 * export const dependencyFilename = 'dependency.data';
 * export default function(emscriptenPHPModule) {
 *    // Emscripten-generated code:
 *    var Module = typeof emscriptenPHPModule !== 'undefined' ? emscriptenPHPModule : {};
 *    // ... the rest of it ...
 * }
 * ```
 *
 * Such a constructions enables loading the `dependency.js` as an ES Module
 * using `import("/dependency.js")`.
 *
 * Once it's ready, you can load PHP and your data dependencies as follows:
 *
 * ```js
 *  const [phpLoaderModule, wordPressLoaderModule] = await Promise.all([
 *    getPHPLoaderModule("7.4"),
 *    import("/wp.js")
 *  ]);
 *  const php = await loadPHPRuntime(phpLoaderModule, {}, [wordPressLoaderModule]);
 * ```
 *
 * @public
 * @param  phpLoaderModule         - The ESM-wrapped Emscripten module. Consult the Dockerfile for the build process.
 * @param  phpModuleArgs           - The Emscripten module arguments, see https://emscripten.org/docs/api_reference/module.html#affecting-execution.
 * @returns Loaded runtime id.
 */

export async function loadPHPRuntime(
	phpLoaderModule: PHPLoaderModule,
	phpModuleArgs: EmscriptenOptions = {}
): Promise<number> {
	const [phpReady, resolvePHP, rejectPHP] = makePromise();

	const PHPRuntime = phpLoaderModule.init(currentJsRuntime, {
		onAbort(reason) {
			rejectPHP(reason);
			// This can happen after PHP has been initialized so
			// let's just log it.
			logger.error(reason);
		},
		ENV: {},
		// Emscripten sometimes prepends a '/' to the path, which
		// breaks vite dev mode. An identity `locateFile` function
		// fixes it.
		locateFile: (path) => path,
		...phpModuleArgs,
		noInitialRun: true,
		onRuntimeInitialized() {
			if (phpModuleArgs.onRuntimeInitialized) {
				phpModuleArgs.onRuntimeInitialized();
			}
			resolvePHP();
		},
	});

	await phpReady;

	const id = ++lastRuntimeId;

	PHPRuntime.id = id;
	PHPRuntime.originalExit = PHPRuntime._exit;

	PHPRuntime._exit = function (code: number) {
		if (PHPRuntime?.webServer) {
			PHPRuntime?.webServer?.closeAllConnections();
		}
		loadedRuntimes.delete(id);
		return PHPRuntime.originalExit(code);
	};

	PHPRuntime[RuntimeId] = id;
	loadedRuntimes.set(id, PHPRuntime);
	return id;
}

export type RuntimeType = 'NODE' | 'WEB' | 'WORKER';

declare const self: WindowOrWorkerGlobalScope;
declare const WorkerGlobalScope: object | undefined;

export type PHPRuntimeId = number;

export function getLoadedRuntime(id: PHPRuntimeId): PHPRuntime {
	return loadedRuntimes.get(id);
}

export const currentJsRuntime = (function () {
	if (typeof process !== 'undefined' && process.release?.name === 'node') {
		return 'NODE';
	} else if (typeof window !== 'undefined') {
		return 'WEB';
	} else if (
		typeof WorkerGlobalScope !== 'undefined' &&
		self instanceof (WorkerGlobalScope as any)
	) {
		return 'WORKER';
	} else {
		return 'NODE';
	}
})();

/**
 * Creates and exposes Promise resolve/reject methods for later use.
 */
const makePromise = () => {
	const methods: any = [];

	const promise = new Promise((resolve, reject) => {
		methods.push(resolve, reject);
	});
	methods.unshift(promise);

	return methods as [Promise<any>, (v?: any) => void, (e?: any) => void];
};

export type PHPRuntime = any;

export type PHPLoaderModule = {
	dependencyFilename: string;
	dependenciesTotalSize: number;
	init: (jsRuntime: string, options: EmscriptenOptions) => PHPRuntime;
};

export type DataModule = {
	dependencyFilename: string;
	dependenciesTotalSize: number;
	default: (phpRuntime: PHPRuntime) => void;
};

export type EmscriptenOptions = {
	onAbort?: (message: string) => void;
	/**
	 * Set to true for debugging tricky WebAssembly errors.
	 */
	debug?: boolean;
	ENV?: Record<string, string>;
	locateFile?: (path: string) => string;
	noInitialRun?: boolean;
	print?: (message: string) => void;
	printErr?: (message: string) => void;
	quit?: (status: number, toThrow: any) => void;
	onRuntimeInitialized?: () => void;
	monitorRunDependencies?: (left: number) => void;
	onMessage?: (listener: EmscriptenMessageListener) => void;
	webServer?: Server<typeof IncomingMessage, typeof ServerResponse>;
	instantiateWasm?: (
		info: WebAssembly.Imports,
		receiveInstance: (
			instance: WebAssembly.Instance,
			module: WebAssembly.Module
		) => void
	) => void;
} & Record<string, any>;

export type EmscriptenMessageListener = (type: string, data: string) => void;
