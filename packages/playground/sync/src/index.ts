import { PlaygroundClient } from '@wp-playground/remote';
import { installSqlSyncMuPlugin, overrideAutoincrementSequences } from './sql';
import { recordFSOperations, replayFSOperations } from './fs';
import { SQLQueryMetadata, recordSQLQueries, replaySQLQueries } from './sql';
import { PlaygroundSyncTransport, TransportMessage } from './transports';
import { debounce } from './utils';
import { FilesystemOperation } from '@php-wasm/universal';

export interface Logger {
	log(...args: any[]): void;
}

export interface SyncOptions {
	autoincrementOffset: number;
	transport: PlaygroundSyncTransport;
	logger?: Logger;
}

export async function setupPlaygroundSync(
	playground: PlaygroundClient,
	{ autoincrementOffset, transport, logger }: SyncOptions
) {
	await installSqlSyncMuPlugin(playground);
	await overrideAutoincrementSequences(playground, autoincrementOffset);

	transport.onChangesReceived(async (changes) => {
		logger?.log(`Received changes`, changes);
		for (const { scope, details } of changes) {
			if (scope === 'fs') {
				await replayFSOperations(playground, details);
			} else if (scope === 'sql') {
				await replaySQLQueries(playground, details);
			}
		}
	});

	let localChanges: TransportMessage[] = [];
	const debouncedFlush = debounce(() => {
		logger?.log(`Sending changes`, localChanges);
		transport.sendChanges(localChanges);
		localChanges = [];
	}, 3000);

	recordSQLQueries(playground, (queries: SQLQueryMetadata[]) => {
		localChanges.push({ scope: 'sql', details: queries });
		debouncedFlush();

		// Track autoincrement values like this:
		// for (const query of queries) {
		// 	if (query.subtype === 'reconstruct-insert') {
		// 		storedIds[query.table_name] = query.last_insert_id;
		// 	}
		// }
	});
	await recordFSOperations(playground, (ops: FilesystemOperation[]) => {
		localChanges.push({ scope: 'fs', details: ops });
		debouncedFlush();
	});
}
