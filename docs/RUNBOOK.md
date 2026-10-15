# Runbook

Operational procedures for licensed.spcfz.ae. Every step that changes the
account or the Worker is requested from the account owner one at a time.

## Rotate an ERP webhook secret

1. Generate a new 48-character secret (`randomSecret()` in src/util/crypto.ts, or any CSPRNG).
2. `wrangler secret put WEBHOOK_SECRET_PREVIOUS` with the **current** value.
3. `wrangler secret put WEBHOOK_SECRET_CURRENT` with the **new** value.
4. Hand the new value to the ERP team through the channel the user chooses. Both values work meanwhile.
5. When the ERP team confirms the switch, `wrangler secret put WEBHOOK_SECRET_PREVIOUS` with an empty value.
The test route uses `TEST_SECRET_CURRENT` / `TEST_SECRET_PREVIOUS` the same way.

## Change the ERP IP allowlist

1. Edit `ERP_IP_ALLOWLIST` in `wrangler.toml` (comma-separated IPs or IPv4 CIDRs) and deploy.
2. Update the WAF custom rule on `/v1/*` to the same list.
Both must match; the Worker check is the one that writes a 403 event you can see in the admin.

## A licence never got a card

1. Admin, Events: filter route production, outcome rejected. The errors column says why.
2. If the payload was rejected, fix the mapping (`FIELD_MAP` var) or ask the ERP team to correct the field, then Replay from the event.
3. If no event exists, the ERP never reached us. Create the card by hand in Admin, Create, or import a CSV.

## A card is stuck on "preparing"

1. Admin, Cards, filter status pending older than ten minutes, or status failed.
2. Open the card and press Regenerate. Watch the status.
3. If it fails again, read the Worker logs (Cloudflare dashboard, Workers, Logs) for the card id. The usual causes are a Browser Rendering limit or a template error.
4. Dead-letter depth is shown on the admin dashboard; a non-zero count means renders are failing in bulk. Stop and investigate before regenerating many.

## Update the design (new template version)

1. Add the new template under `templates/spc/<version>/`, point `src/render/template.ts` at it, bump `TEMPLATE_VERSION` in `wrangler.toml`.
2. Deploy to preview, render a few test cards, compare against the designer's PNGs.
3. Deploy to production. New cards use the new design immediately.
4. Admin, Re-render: filter by the old template version, confirm the count, run. Cards are re-rendered in place behind the same URLs. Cap is 500 per run; repeat as needed.

## Delete a card on request

Admin, Cards, open the card, Delete, confirm. The row, its metrics and its eight images are removed and the edge cache is purged. The page then returns the generic "not valid" screen. R2 versioning keeps the images recoverable for the bucket's retention window.

## Expire or restore a card

Mark expired removes the images and shows the "no longer available" page. Un-expire renders again and sets a new two-year expiry.

## Change retention or captions

Admin, Settings. Retention changes apply to cards created from then on and to the daily housekeeping run at 05:15 Dubai time. Caption changes apply immediately to every page.

## Something is wrong with the whole service

- Take it offline without losing data: remove the custom domain from the Worker in the dashboard. The ERP will get connection errors; cards can be recreated from the admin once it is back.
- Roll back a deploy: Cloudflare dashboard, Workers, Deployments, roll back to the previous version.
- Database migrations are forward-only. A bad migration is fixed with a new migration, not by rolling back.
