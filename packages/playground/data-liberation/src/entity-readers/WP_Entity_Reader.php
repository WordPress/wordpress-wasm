<?php

/**
 * The Entity Reader ingests content from a source and breaks it down into
 * individual "entities" that WordPress understands - posts, comments, metadata, etc.
 *
 * The reader implements Iterator so you can easily loop through entities:
 * foreach ($reader as $entity) { ... }
 */
abstract class WP_Entity_Reader {

	/**
	 * Gets the current entity being processed.
	 *
	 * @return WP_Imported_Entity|false The current entity, or false if none available
	 */
	abstract public function get_entity();

	/**
	 * Advances to the next entity in the source content.
	 *
	 * This is where each data source implements its own logic for parsing the bytes
	 * and extracting the next meaningful piece of content.
	 *
	 * @return bool Whether we successfully moved to the next entity
	 */
	abstract public function next_entity();

	/**
	 * Checks if we've processed everything from the source.
	 *
	 * @return bool Whether we've processed everything from the source
	 */
	abstract public function is_finished(): bool;

	/**
	 * Gets any error that occurred during processing.
	 *
	 * Readers should use this to report issues like invalid source content
	 * or parsing failures.
	 *
	 * @since WP_VERSION
	 * @return string|null Error message if something went wrong, null otherwise
	 */
	abstract public function get_last_error(): ?string;

	/**
	 * Returns a cursor position that can be used to resume processing later.
	 *
	 * This allows for processing large imports in chunks without losing your place.
	 * Not all readers support this yet.
	 *
	 * @TODO: Define a general interface for entity readers.
	 * @return string Position marker for resuming later
	 */
	public function get_reentrancy_cursor() {
		return '';
	}

}
