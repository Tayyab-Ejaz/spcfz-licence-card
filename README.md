# spcfz-licence-card

A shareable "We're officially licensed at SPC Free Zone" social creative,
generated for every customer the moment the ERP issues a business licence,
and delivered through a personal page at **https://licensed.spcfz.ae/c/{token}**.

**Status, 16 October 2026: ported to a Node service in Docker for SPC's own
server (13.206.34.102). Typecheck clean, all tests passing, a local run
rendered all eight images.** Not deployed; the server steps are in
docs/RUNBOOK.md and each needs approval.

## Documents

| File | Audience | Purpose |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | whoever builds or changes the service | The contract every piece is built against. Read it before touching anything. |
| [docs/ERP-WEBHOOK.md](docs/ERP-WEBHOOK.md) | the ERP team | What to send us, how to authenticate, what comes back, and what to do with it. Safe to forward as is. |
| [docs/DESIGN-HANDOFF.md](docs/DESIGN-HANDOFF.md) | the designer | What the card design must contain so it can be turned into a template. |
| [docs/CLOUDFLARE-SETUP.md](docs/CLOUDFLARE-SETUP.md) | the account owner | DNS, Access and WAF on the existing zone. |
| [docs/PORT-TO-NODE.md](docs/PORT-TO-NODE.md) | developers | Why and how the service moved from Workers to Docker on SPC's server. |
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
- Hosting on SPC's own server in Docker, behind Cloudflare (changed 15 October 2026 from Cloudflare Workers). Subdomain licensed.spcfz.ae. About 1,000 licences a month.
- The design is supplied by SPC, not drafted here.

## Not in version one

Our own email or WhatsApp notifications, QR referral codes, Zoho CRM
write-back, print-ready files, and any change to www.spcfz.ae.

## Next steps

1. Deploy to 13.206.34.102 step by step (docs/RUNBOOK.md, first-time setup), each step approved.
2. DNS, Access and WAF in Cloudflare (docs/CLOUDFLARE-SETUP.md).
3. Forward docs/ERP-WEBHOOK.md to the ERP team; collect their IP addresses.
4. Hand docs/DESIGN-HANDOFF.md to the designer; swap the placeholder template when it lands.
5. Review docs/ARABIC-STRINGS.md.
