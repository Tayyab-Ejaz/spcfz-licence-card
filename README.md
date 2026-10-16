# spcfz-licence-card

A shareable "We're officially licensed at SPC Free Zone" social creative,
generated for every customer the moment the ERP issues a business licence,
and delivered through a personal page at **https://licensed.spcfz.ae/c/{token}**.

**Status, 16 October 2026: live at https://licensed.spcfz.ae** as the Docker
container `spcfz-licence-card` on 13.206.34.102, behind Apache and Cloudflare.
The personal page is the customer studio from SPC's design
(docs/ARCHITECTURE.md section 7), live since 16 October 2026. Webhooks are
rejected until the ERP's IP addresses are added (ERP work on hold); the admin
answers 503 until Cloudflare Access is set up.

Work now happens on the local copy first: `npm run local` runs the whole
product at http://localhost:8787, admin included (docs/DEV.md "Local copy").
Production changes wait until SPC says the product is ready.

## Documents

| File | Audience | Purpose |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | whoever builds or changes the service | The contract every piece is built against. Read it before touching anything. |
| [docs/ERP-WEBHOOK.md](docs/ERP-WEBHOOK.md) | the ERP team | What to send us, how to authenticate, what comes back, and what to do with it. Safe to forward as is. |
| [docs/DESIGN-HANDOFF.md](docs/DESIGN-HANDOFF.md) | the designer | What the card design must contain so it can be turned into a template. |
| [docs/CLOUDFLARE-SETUP.md](docs/CLOUDFLARE-SETUP.md) | the account owner | DNS, Access and WAF on the existing zone. |
| [docs/PORT-TO-NODE.md](docs/PORT-TO-NODE.md) | developers | Why and how the service moved from Workers to Docker on SPC's server. |
| [docs/DEV.md](docs/DEV.md) | developers | Toolchain, layout, conventions, how tests and deploys run. |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | SPC staff operating the service | Secret rotation, allowlist changes, test cards, design updates, deletion. |
| [docs/ARABIC-STRINGS.md](docs/ARABIC-STRINGS.md) | the Arabic reviewer | Every Arabic string in the card, caption and page, with its English, for sign-off. |

## Decisions already taken (15 October 2026)

- Social creative, not a licence card or certificate.
- The ERP sends the founder's name, which the studio pre-fills (16 October 2026).
- The customer builds the card in the browser (the studio): three styles, three formats, two languages. The server stores no images. (Until 16 October 2026: four sizes rendered on the server.)
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

1. Cloudflare Access for `/admin*`, then put the team domain and audience tag in the env file (docs/CLOUDFLARE-SETUP.md step 3).
2. ERP team: their outbound IP addresses into `ERP_IP_ALLOWLIST` and the WAF rule; hand them the test secret; first test posts.
3. Rate-limit rule on `/c/*` before launch.
4. Review docs/ARABIC-STRINGS.md.
