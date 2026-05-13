import * as path from 'path';

/**
 * Single source of truth for the saved Playwright storage state file.
 * Imported by both `playwright.config.ts` (to load it for test projects)
 * and `tests/auth.setup.ts` (to write it after authenticating).
 */
export const STORAGE_STATE = path.resolve(__dirname, '.auth/user.json');
