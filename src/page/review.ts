// The Google review request (SPC, 5 November 2026). Once a customer has their card (a download, a share, a post), the
// studio and the "posted" page ask once for a Google review of SPC Free Zone. The button goes through
// /c/:token/review, which counts the press (test cards excepted) and sends the customer on to the review link set in
// Admin → Settings. Everyone is asked, in the same neutral words: nobody is screened first (Google's review rules).

/**
 * Until SPC pastes the "Ask for reviews" link from its Google Business Profile into Admin → Settings: SPC Free Zone on
 * Google Maps (the link www.spcfz.ae uses), where "Write a review" is one tap away.
 */
export const DEFAULT_REVIEW_URL = 'https://maps.app.goo.gl/zqP4RBkX4HcptJkB6';

/** Where the review button leads, or null when the request is switched off. On unless review_enabled is '0'. */
export function reviewLink(settings: Record<string, string>): string | null {
  if ((settings['review_enabled'] ?? '1') !== '1') return null;
  const url = (settings['review_url'] ?? '').trim() || DEFAULT_REVIEW_URL;
  return isReviewUrl(url) ? url : null;
}

/** An https address, as the settings form requires. */
export function isReviewUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}
