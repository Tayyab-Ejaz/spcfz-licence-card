# Cloudflare for a self-hosted origin

Since 15 October 2026 Cloudflare is only the edge for licensed.spcfz.ae, on
the existing spcfz.ae Pro zone. No Workers, no API token, nothing billed
beyond the current plan. Each step is done by the account owner in the
dashboard, or requested separately.

| # | Step | Where | When |
|---|---|---|---|
| 1 | DNS record `A licensed 13.206.34.102`, **Proxied** | DNS | after the Apache site is installed, so the name never reaches Apache's default site |
| 2 | Confirm SSL/TLS mode is **Full (strict)** for the zone | SSL/TLS, Overview | the other subdomains on that server already rely on it with origin certificates |
| 3 | Cloudflare Access application for `licensed.spcfz.ae/admin*`, allow policy for chosen staff emails; copy the team domain and the application audience tag into the env file | Zero Trust, Access, Applications | before staff need the admin |
| 4 | WAF custom rule: block `/v1/*` unless the source is one of the ERP's addresses | Security, WAF | when the ERP team sends their addresses |
| 5 | Optional: a Cloudflare rate-limiting rule on `/c/*`. The app already limits per visitor (300 page requests and 60 counter posts per minute); a Cloudflare rule stops floods before they reach the server | Security, WAF, Rate limiting | if traffic ever warrants it |

The origin itself admits only Cloudflare's ranges, so these rules cannot be
bypassed by calling the server directly.
