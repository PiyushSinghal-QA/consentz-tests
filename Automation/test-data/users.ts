/**
 * test-data/users.ts
 *
 * Central store for test credentials.  All values are read from environment
 * variables so that:
 *  - No real credentials are ever hard-coded in source control.
 *  - Different environments (staging, production) can be targeted without
 *    changing test code — just swap the .env file or CI secrets.
 */

export interface UserCredentials {
  username: string;
  password: string;
}

/** Default demo user used for smoke / authentication tests. */
export const DEMO_USER: UserCredentials = {
  username: process.env.CONSENTZ_USERNAME ?? 'demo',
  password: process.env.CONSENTZ_PASSWORD ?? 'password',
};

/** An intentionally invalid credential set used for negative test cases. */
export const INVALID_USER: UserCredentials = {
  username: 'invalid_user@example.com',
  password: 'WrongPassword123!',
};
