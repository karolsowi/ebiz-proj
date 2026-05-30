/** Demo user created by db:seed — default owner for background jobs. */
export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export function getApiKeysOwnerUserId(): string {
  return process.env.API_KEYS_OWNER_USER_ID?.trim() || DEMO_USER_ID;
}
