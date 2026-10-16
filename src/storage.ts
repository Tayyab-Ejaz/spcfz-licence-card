// Card URLs. Cards are built in the customer's browser, so the service stores no images.
import type { Env } from './types.js';

export function pageUrl(env: Pick<Env, 'BASE_URL'>, token: string): string {
  return `${env.BASE_URL.replace(/\/+$/, '')}/c/${token}`;
}
