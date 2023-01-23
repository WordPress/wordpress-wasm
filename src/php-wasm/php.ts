const STR = 'string';
const NUM = 'number';

export type JavascriptRuntime = 'NODE' | 'WEB' | 'WEBWORKER';

type PHPHeaders = Record<string, string>;
export interface FileInfo {
	key: string;
	name: string;
	type: string;
	data: Uint8Array;
}
export interface PHPRequest {
	/**
	 * Request path following the domain:port part.
	 */
	relativeUri?: string;

	/**
	 * Path of the .php file to execute.
	 */
	scriptPath?: string;

	/**
	 * Request method. Default: `GET`.
	 */
	method?: 'GET' | 'POST' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'PUT' | 'DELETE';

	/**
	 * Request headers.
	 */
	headers?: PHPHeaders;

	/**
	 * Request body without the files.
	 */
	body?: string;

	/**
	 * Uploaded files.
	 */
	fileInfos?: FileInfo[];

	/**
	 * The code snippet to eval instead of a php file.
	 */
	code?: string;
}

export interface PHPResponse {
	/**
	 * The exit code of the script. `0` is a success, while
	 * `1` and `2` indicate an error.
	 */
	exitCode: number;
	/**
	 * Response body. Contains the output from `echo`,
	 * `print`, inline HTML etc.
	 */
	body: ArrayBuffer;
	/**
	 * PHP errors.
	 */
	errors: string;
	/**
	 * Response headers.
	 */
	headers: PHPHeaders;
	/**
	 * Response HTTP status code, e.g. 200.
	 */
	httpStatusCode: number;
}

/**
 * Initializes the PHP runtime with the given arguments and data dependencies.
 *
 * This function handles the entire PHP initialization pipeline. In particular, it:
 *
 * * Instantiates the Emscripten PHP module
 * * Wires it together with the data dependencies and loads them
 * * Ensures is all happens in a correct order
 * * Waits until the entire loading sequence is finished
 *
 * Basic usage:
 *
 * ```js
 *  const phpLoaderModule = await import("/php.js");
 *  const php = await startPHP(phpLoaderModule, "web");
 *  console.log(php.run(`<?php echo "Hello, world!"; `));
 *  // { stdout: ArrayBuffer containing the string "Hello, world!", stderr: [''], exitCode: 0 }
 * ```
 *
 * **The `/php.js` module:**
 *
 * In the basic usage example, `php.js` is **not** a vanilla Emscripten module. Instead,
 * it's an ESM module that wraps the regular Emscripten output and adds some
 * extra functionality. It's generated by the Dockerfile shipped with this repo.
 * Here's the API it provides:
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
 * await certain unintuitive parts of low-level FS interactions.
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
 * Data dependencies consist of a `dependency.data` file and a `dependency.js` loader and
 * can be packaged with the [file_packager.py tool]( https://emscripten.org/docs/porting/files/packaging_files.html#packaging-using-the-file-packager-tool).
 * This project requires wrapping the Emscripten-generated `dependency.js` file in an ES
 * module as follows:
 *
 * 1. Prepend `export default function(emscriptenPHPModule) {'; `
 * 2. Prepend `export const dependencyFilename = '<DATA FILE NAME>'; `
 * 3. Prepend `export const dependenciesTotalSize = <DATA FILE SIZE>;`
 * 4. Append `}`
 *
 * Be sure to use the `--export-name="emscriptenPHPModule"` file_packager.py option.
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
 * Such a constructions enables loading the `dependency.js` as an ES Module using
 * `import("/dependency.js")`.
 *
 * Once it's ready, you can load PHP and your data dependencies as follows:
 *
 * ```js
 *  const [phpLoaderModule, wordPressLoaderModule] = await Promise.all([
 *    import("/php.js"),
 *    import("/wp.js")
 *  ]);
 *  const php = await startPHP(phpLoaderModule, "web", {}, [wordPressLoaderModule]);
 * ```
 *
 * @public
 * @param  phpLoaderModule         - The ESM-wrapped Emscripten module. Consult the Dockerfile for the build process.
 * @param  runtime                 - The current JavaScript environment. One of: NODE, WEB, or WEBWORKER.
 * @param  phpModuleArgs           - The Emscripten module arguments, see https://emscripten.org/docs/api_reference/module.html#affecting-execution.
 * @param  dataDependenciesModules - A list of the ESM-wrapped Emscripten data dependency modules.
 * @returns PHP instance.
 */
export async function startPHP(
	phpLoaderModule: any,
	runtime: JavascriptRuntime,
	phpModuleArgs: any = {},
	dataDependenciesModules: any[] = []
): Promise<PHP> {
	let resolvePhpReady, resolveDepsReady;
	const depsReady = new Promise((resolve) => {
		resolveDepsReady = resolve;
	});
	const phpReady = new Promise((resolve) => {
		resolvePhpReady = resolve;
	});

	const loadPHPRuntime = phpLoaderModule.default;
	console.time('1');
	const PHPRuntime = loadPHPRuntime(runtime, {
		onAbort(reason) {
			console.error('WASM aborted: ');
			console.error(reason);
		},
		ENV: {},
		...phpModuleArgs,
		noInitialRun: true,
		onRuntimeInitialized() {
			if (phpModuleArgs.onRuntimeInitialized) {
				phpModuleArgs.onRuntimeInitialized();
			}
			resolvePhpReady();
		},
		monitorRunDependencies(nbLeft) {
			if (nbLeft === 0) {
				delete PHPRuntime.monitorRunDependencies;
				resolveDepsReady();
			}
		},
	});
	for (const { default: loadDataModule } of dataDependenciesModules) {
		loadDataModule(PHPRuntime);
	}
	if (!dataDependenciesModules.length) {
		resolveDepsReady();
	}

	console.timeEnd('1');
	console.time('2');
	await depsReady;
	console.timeEnd('2');
	console.time('3');
	await phpReady;
	console.timeEnd('3');
	return new PHP(PHPRuntime);
}

/**
 * An environment-agnostic wrapper around the Emscripten PHP runtime
 * that abstracts the super low-level API and provides a more convenient
 * higher-level API.
 *
 * It exposes a minimal set of methods to run PHP scripts and to
 * interact with the PHP filesystem.
 *
 * @public
 * @see {startPHP} This class is not meant to be used directly. Use `startPHP` instead.
 */
export class PHP {
	#Runtime;
	#webSapiInitialized = false;

	/**
	 * Initializes a PHP runtime.
	 *
	 * @internal
	 * @param  PHPRuntime - PHP Runtime as initialized by startPHP.
	 */
	constructor(PHPRuntime: any) {
		this.#Runtime = PHPRuntime;
// 		console.log(this.run({
// 			code: `<?php

// $cert = <<<CERT
// -----BEGIN CERTIFICATE-----
// MIIGuDCCBaCgAwIBAgIQCYv1RMDGSd5gp0IMdOcFLjANBgkqhkiG9w0BAQsFADBP
// MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMSkwJwYDVQQDEyBE
// aWdpQ2VydCBUTFMgUlNBIFNIQTI1NiAyMDIwIENBMTAeFw0yMjExMTYwMDAwMDBa
// Fw0yMzA1MTQyMzU5NTlaMGcxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpDQUxJRk9S
// TklBMRYwFAYDVQQHEw1TQU4gRlJBTkNJU0NPMRQwEgYDVQQKEwtSZWRkaXQgSW5j
// LjEVMBMGA1UEAwwMKi5yZWRkaXQuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
// MIIBCgKCAQEAz+maVKOkGuIpLUWBcrOoi0zOK7ui1z2eaWzzMtForAMdGnBV+IZa
// QtyQ5++Gfv1TbOrAOKUntMp6luNeClruZSCzltfkOpk9eHJ9XWEUPrpFFCLbBVu9
// 1sl0EYvdWsplUlEgilO1zdDXr0UiyU0ptz14arWfA79ESEjl3EMIcCgfAumn5d9u
// OQEkbOWAogF0Ed53rsoVVQoW+HVFVqdUlQ0boiQBdec9lKKDB8DbAEfdCC45zVjG
// zA8Hhw4fmx1l4AlDqP2tLE2qNm2GhXjctrmexVjFG2t4nyihXllf92wvsEEGRZ8X
// 9pxVJTd/tfteIXPbe+u5DIE1ApPYcpfCBwIDAQABo4IDdjCCA3IwHwYDVR0jBBgw
// FoAUt2ui6qiqhIx56rTaD5iyxZV2ufQwHQYDVR0OBBYEFHHgUNHngFL7IxRlnUOn
// jTGqVmkmMCMGA1UdEQQcMBqCDCoucmVkZGl0LmNvbYIKcmVkZGl0LmNvbTAOBgNV
// HQ8BAf8EBAMCBaAwHQYDVR0lBBYwFAYIKwYBBQUHAwEGCCsGAQUFBwMCMIGPBgNV
// HR8EgYcwgYQwQKA+oDyGOmh0dHA6Ly9jcmwzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2Vy
// dFRMU1JTQVNIQTI1NjIwMjBDQTEtNC5jcmwwQKA+oDyGOmh0dHA6Ly9jcmw0LmRp
// Z2ljZXJ0LmNvbS9EaWdpQ2VydFRMU1JTQVNIQTI1NjIwMjBDQTEtNC5jcmwwPgYD
// VR0gBDcwNTAzBgZngQwBAgIwKTAnBggrBgEFBQcCARYbaHR0cDovL3d3dy5kaWdp
// Y2VydC5jb20vQ1BTMH8GCCsGAQUFBwEBBHMwcTAkBggrBgEFBQcwAYYYaHR0cDov
// L29jc3AuZGlnaWNlcnQuY29tMEkGCCsGAQUFBzAChj1odHRwOi8vY2FjZXJ0cy5k
// aWdpY2VydC5jb20vRGlnaUNlcnRUTFNSU0FTSEEyNTYyMDIwQ0ExLTEuY3J0MAkG
// A1UdEwQCMAAwggF8BgorBgEEAdZ5AgQCBIIBbASCAWgBZgB2AOg+0No+9QY1MudX
// KLyJa8kD08vREWvs62nhd31tBr1uAAABhH+qMZ4AAAQDAEcwRQIhAIm2Q1mGH2Q4
// m7gO3eoq+pdeGiP/z09H4urgX8kaHwiCAiAw1zu1F4gShIorNDxaae3y5mDL0+L8
// t/dX1ZEo94TR7QB1ALNzdwfhhFD4Y4bWBancEQlKeS2xZwwLh9zwAw55NqWaAAAB
// hH+qMisAAAQDAEYwRAIgVce6+2Brme1ZMKpy0ukpbT7bGF2FFrQsXP1LL/TMhlMC
// IEqu/+RHDknjjVWtFa0MoIBZjxoOSHBWs5zpSnsiIXR/AHUAtz77JN+cTbp18jnF
// ulj0bF38Qs96nzXEnh0JgSXttJkAAAGEf6oxzQAABAMARjBEAiAZLshvZSfiu1P4
// g3EI26S1j55//GaUS/fixuS9WnG9ogIgO+FMT+ftEaPfrmMJ22awj45/w2kTr7Tq
// Vquxlsgf4g4wDQYJKoZIhvcNAQELBQADggEBAGihtf2gcwD4OhRlW2Px2tPfdqc6
// 5T3cZgagbUrz+fvCvU/3fZJgIotBXF10CMjT9J9xZZ3PafuBcgtafMEAHbFqFbL1
// SRdUB73ifekIqgkKaS3vuosDwXBHDgHUETn3r9ynWTrNKzDG9izG2Bebkxg0Vltw
// iPjnMLrcDsgFG4ssz7esO/J3ygxqlWZREK94tD2RbNHgYMmVRD3biguWvLVNOQ0d
// lGEvSqqm3m46NwOqZEW9VsmVV9YSSWqAWeA0mMaQ4XwQZeGgyzEObpfpI0nK2Wqb
// pf70B2GsQ3zmClbCKvy7tQyMotjtvHVz8iuHSiNpr7HPcx/jJ2E7eudd4/E=
// -----END CERTIFICATE-----
// CERT;

// var_dump(openssl_x509_parse($cert));
// die();
// `,
// 		}));
	}

	/**
	 * Dispatches a PHP request.
	 * Cannot be used in conjunction with `cli()`.
	 *
	 * @example
	 * ```js
	 * const output = php.run('<?php echo "Hello world!";');
	 * console.log(output.stdout); // "Hello world!"
	 * ```
	 *
	 * @example
	 * ```js
	 * console.log(php.run(`<?php
	 *  $fp = fopen('php://stderr', 'w');
	 *  fwrite($fp, "Hello, world!");
	 * `));
	 * // {"exitCode":0,"stdout":"","stderr":["Hello, world!"]}
	 * ```
	 *
	 * @param  request - PHP Request data.
	 */
	run(request: PHPRequest = {}): PHPResponse {
		if (!this.#webSapiInitialized) {
			this.#Runtime.ccall('php_wasm_init', null, [], []);
			this.#webSapiInitialized = true;
		}
		this.#setScriptPath(request.scriptPath || '');
		this.#setRelativeRequestUri(request.relativeUri || '');
		this.#setRequestMethod(request.method || 'GET');
		const { host, ...headers } = {
			host: 'example.com:80',
			...normalizeHeaders(request.headers || {}),
		};
		this.#setRequestHost(host);
		this.#setRequestHeaders(headers);
		if (request.body) {
			this.#setRequestBody(request.body);
		}
		if (request.fileInfos) {
			for (const file of request.fileInfos) {
				this.#addUploadedFile(file);
			}
		}
		if (request.code) {
			this.#setPHPCode(' ?>' + request.code);
		}
		return this.#handleRequest();
	}

	/**
	 * Starts a PHP CLI session with given arguments.
	 *
	 * Can only be used when PHP was compiled with the CLI SAPI.
	 * Cannot be used in conjunction with `run()`.
	 *
	 * @param  argv - The arguments to pass to the CLI.
	 * @returns The exit code of the CLI session.
	 */
	cli(argv: string[]): number {
		for (const arg of argv) {
			this.#Runtime.ccall('wasm_add_cli_arg', null, [STR], [arg]);
		}
		return this.#Runtime.ccall('run_cli', null, [], [], {async: true});
	}

	#getResponseHeaders(): { headers: PHPHeaders; httpStatusCode: number } {
		const headersFilePath = '/tmp/headers.json';
		if (!this.fileExists(headersFilePath)) {
			throw new Error(
				'SAPI Error: Could not find response headers file.'
			);
		}

		const headersData = JSON.parse(this.readFileAsText(headersFilePath));
		const headers = {};
		for (const line of headersData.headers) {
			if (!line.includes(': ')) {
				continue;
			}
			const colonIndex = line.indexOf(': ');
			const headerName = line.substring(0, colonIndex).toLowerCase();
			const headerValue = line.substring(colonIndex + 2);
			if (!(headerName in headers)) {
				headers[headerName] = [];
			}
			headers[headerName].push(headerValue);
		}
		return {
			headers,
			httpStatusCode: headersData.status,
		};
	}

	#setRelativeRequestUri(uri: string) {
		this.#Runtime.ccall('wasm_set_request_uri', null, [STR], [uri]);
		if (uri.includes('?')) {
			const queryString = uri.substring(uri.indexOf('?') + 1);
			this.#Runtime.ccall(
				'wasm_set_query_string',
				null,
				[STR],
				[queryString]
			);
		}
	}

	#setRequestHost(host: string) {
		this.#Runtime.ccall('wasm_set_request_host', null, [STR], [host]);
		let port;
		try {
			port = parseInt(new URL(host).port, 10);
		} catch (e) {}
		if (!port || isNaN(port)) {
			port = 80;
		}
		this.#Runtime.ccall('wasm_set_request_port', null, [NUM], [port]);
	}

	#setRequestMethod(method: string) {
		this.#Runtime.ccall('wasm_set_request_method', null, [STR], [method]);
	}

	setSkipShebang(shouldSkip: boolean) {
		this.#Runtime.ccall(
			'wasm_set_skip_shebang',
			null,
			[NUM],
			[shouldSkip ? 1 : 0]
		);
	}

	#setRequestHeaders(headers: PHPHeaders) {
		if (headers.cookie) {
			this.#Runtime.ccall(
				'wasm_set_cookies',
				null,
				[STR],
				[headers.cookie]
			);
		}
		if (headers['content-type']) {
			this.#Runtime.ccall(
				'wasm_set_content_type',
				null,
				[STR],
				[headers['content-type']]
			);
		}
		if (headers['content-length']) {
			this.#Runtime.ccall(
				'wasm_set_content_length',
				null,
				[NUM],
				[parseInt(headers['content-length'], 10)]
			);
		}
		for (const name in headers) {
			this.addServerGlobalEntry(
				`HTTP_${name.toUpperCase().replace(/-/g, '_')}`,
				headers[name]
			);
		}
	}

	#setRequestBody(body: string) {
		this.#Runtime.ccall('wasm_set_request_body', null, [STR], [body]);
		this.#Runtime.ccall(
			'wasm_set_content_length',
			null,
			[NUM],
			[body.length]
		);
	}

	#setScriptPath(path: string) {
		this.#Runtime.ccall('wasm_set_path_translated', null, [STR], [path]);
	}

	addServerGlobalEntry(key: string, value: string) {
		this.#Runtime.ccall(
			'wasm_add_SERVER_entry',
			null,
			[STR, STR],
			[key, value]
		);
	}

	/**
	 * Adds file information to $_FILES superglobal in PHP.
	 *
	 * In particular:
	 * * Creates the file data in the filesystem
	 * * Registers the file details in PHP
	 *
	 * @param  fileInfo - File details
	 */
	#addUploadedFile(fileInfo: FileInfo) {
		const { key, name, type, data } = fileInfo;

		const tmpPath = `/tmp/${Math.random().toFixed(20)}`;
		this.writeFile(tmpPath, data);

		const error = 0;
		this.#Runtime.ccall(
			'wasm_add_uploaded_file',
			null,
			[STR, STR, STR, STR, NUM, NUM],
			[key, name, type, tmpPath, error, data.byteLength]
		);
	}

	#setPHPCode(code: string) {
		this.#Runtime.ccall('wasm_set_php_code', null, [STR], [code]);
	}

	#handleRequest(): PHPResponse {
		const exitCode = this.#Runtime.ccall(
			'wasm_sapi_handle_request',
			NUM,
			[],
			[]
		);

		return {
			exitCode,
			body: this.readFileAsBuffer('/tmp/stdout'),
			errors: this.readFileAsText('/tmp/stderr'),
			...this.#getResponseHeaders(),
		};
	}

	/**
	 * Recursively creates a directory with the given path in the PHP filesystem.
	 * For example, if the path is `/root/php/data`, and `/root` already exists,
	 * it will create the directories `/root/php` and `/root/php/data`.
	 *
	 * @param  path - The directory path to create.
	 */
	mkdirTree(path: string) {
		this.#Runtime.FS.mkdirTree(path);
	}

	/**
	 * Mounts a Node.js filesystem to a given path in the PHP filesystem.
	 *
	 * @param  settings - The Node.js filesystem settings.
	 * @param  path     - The path to mount the filesystem to.
	 * @see {@link https://emscripten.org/docs/api_reference/Filesystem-API.html#FS.mount}
	 */
	mount(settings: any, path: string) {
		this.#Runtime.FS.mount(
			this.#Runtime.FS.filesystems.NODEFS,
			settings,
			path
		);
	}

	/**
	 * Reads a file from the PHP filesystem and returns it as a string.
	 *
	 * @throws {@link ErrnoError} – If the file doesn't exist.
	 * @param  path - The file path to read.
	 * @returns The file contents.
	 */
	readFileAsText(path: string): string {
		return new TextDecoder().decode(this.readFileAsBuffer(path));
	}

	/**
	 * Reads a file from the PHP filesystem and returns it as an array buffer.
	 *
	 * @throws {@link ErrnoError} – If the file doesn't exist.
	 * @param  path - The file path to read.
	 * @returns The file contents.
	 */
	readFileAsBuffer(path: string): Uint8Array {
		return this.#Runtime.FS.readFile(path);
	}

	/**
	 * Overwrites data in a file in the PHP filesystem.
	 * Creates a new file if one doesn't exist yet.
	 *
	 * @param  path - The file path to write to.
	 * @param  data - The data to write to the file.
	 */
	writeFile(path: string, data: string | Uint8Array) {
		this.#Runtime.FS.writeFile(path, data);
	}

	/**
	 * Removes a file from the PHP filesystem.
	 *
	 * @throws {@link ErrnoError} – If the file doesn't exist.
	 * @param  path - The file path to remove.
	 */
	unlink(path: string) {
		this.#Runtime.FS.unlink(path);
	}

	/**
	 * Lists the files and directories in the given directory.
	 *
	 * @param  path - The directory path to list.
	 * @returns The list of files and directories in the given directory.
	 */
	listFiles(path: string): string[] {
		if (!this.fileExists(path)) {
			return [];
		}
		try {
			return this.#Runtime.FS.readdir(path).filter(
				(name) => name !== '.' && name !== '..'
			);
		} catch (e) {
			console.error(e, { path });
			return [];
		}
	}

	/**
	 * Checks if a directory exists in the PHP filesystem.
	 *
	 * @param  path – The path to check.
	 * @returns True if the path is a directory, false otherwise.
	 */
	isDir(path: string): boolean {
		if (!this.fileExists(path)) {
			return false;
		}
		return this.#Runtime.FS.isDir(
			this.#Runtime.FS.lookupPath(path).node.mode
		);
	}

	/**
	 * Checks if a file (or a directory) exists in the PHP filesystem.
	 *
	 * @param  path - The file path to check.
	 * @returns True if the file exists, false otherwise.
	 */
	fileExists(path: string): boolean {
		try {
			this.#Runtime.FS.lookupPath(path);
			return true;
		} catch (e) {
			return false;
		}
	}
}

function normalizeHeaders(headers: PHPHeaders): PHPHeaders {
	const normalized = {};
	for (const key in headers) {
		normalized[key.toLowerCase()] = headers[key];
	}
	return normalized;
}

/**
 * Output of the PHP.wasm runtime.
 */
export interface PHPOutput {
	/** Exit code of the PHP process. 0 means success, 1 and 2 mean error. */
	exitCode: number;

	/** Stdout data */
	stdout: ArrayBuffer;

	/** Stderr lines */
	stderr: string[];
}

/**
 * Emscripten's filesystem-related Exception.
 *
 * @see https://emscripten.org/docs/api_reference/Filesystem-API.html
 * @see https://github.com/emscripten-core/emscripten/blob/main/system/lib/libc/musl/arch/emscripten/bits/errno.h
 */
export interface ErrnoError extends Error {}
