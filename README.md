# spcfz-licence-card

A shareable "We're officially licensed at SPC Free Zone" social creative,
generated for every customer the moment the ERP issues a business licence,
and delivered through a personal page at **https://licensed.spcfz.ae/c/{token}**.

**Status, 15 October 2026: Phase 1 code complete, typecheck clean, 152 tests
passing locally, Wrangler dry-run bundling cleanly.** Not deployed. The
GitHub repository and all Cloudflare resources still have to be created
(docs/CLOUDFLARE-SETUP.md).

## Documents

| File | Audience | Purpose |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | whoever builds or changes the service | The contract every piece is built against. Read it before touching anything. |
| [docs/ERP-WEBHOOK.md](docs/ERP-WEBHOOK.md) | the ERP team | What to send us, how to authenticate, what comes back, and what to do with it. Safe to forward as is. |
| [docs/DESIGN-HANDOFF.md](docs/DESIGN-HANDOFF.md) | the designer | What the card design must contain so it can be turned into a template. |
| [docs/CLOUDFLARE-SETUP.md](docs/CLOUDFLARE-SETUP.md) | the account owner | Every account-level step, in order. Each one is asked for separately. |
| [docs/DEV.md](docs/DEV.md) | developers | Toolchain, layout, conventions, how tests and deploys run. |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | SPC staff operating the service | Secret rotation, allowlist changes, stuck cards, design updates, deletion. |
| [docs/ARABIC-STRINGS.md](docs/ARABIC-STRINGS.md) | the Arabic reviewer | Every Arabic string in the card, caption and page, with its English, for sign-off. |

## Decisions already taken (15 October 2026)

- Social creative, not a licence card or certificate.
- Four sizes, two languages, eight images per licence.
- Personal page is the hub. The ERP's own licence-issued email carries the link.
- Both languages for everyone, the page toggles. A missing Arabic company name
  is shown as the English name inside the Arabic layout.
- The licence number appears on the creative.
- The ERP team fires a webhook with a static secret header. We maintain an IP
  allowlist. We do not rely on ERP retries or on a test flag in the payload.
- Hosting on Cloudflare. Subdomain licensed.spcfz.ae. About 1,000 licences a month.
- The design is supplied by SPC, not drafted here.

## Not in version one

Our own email or WhatsApp notifications, QR referral codes, Zoho CRM
write-back, print-ready files, and any change to www.spcfz.ae.

## Next steps

1. Create the GitHub repository and push; CI runs the same checks.
2. Preview deploy once the Cloudflare account steps are done.
3. Work through docs/CLOUDFLARE-SETUP.md, one approval at a time.
4. Forward docs/ERP-WEBHOOK.md to the ERP team; collect their IP addresses.
5. Hand docs/DESIGN-HANDOFF.md to the designer; swap the placeholder template when it lands.
6. Review docs/ARABIC-STRINGS.md.
