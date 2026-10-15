# Cloudflare and GitHub setup

Version 0.1, 15 October 2026. Every step below changes a live account. Each
one is requested separately, with the exact action shown, and nothing is done
before the answer. Reading the account is free.

## Order of work

| # | Step | Where | Who performs it |
|---|---|---|---|
| 1 | Confirm which Cloudflare account holds spcfz.ae and that it can be put on the Workers Paid plan | Cloudflare dashboard | account owner |
| 2 | Enable the Workers Paid plan | Cloudflare, Workers & Pages, Plans | account owner |
| 3 | Create a private GitHub repository `spcfz-licence-card` | GitHub | account owner, or Claude after approval |
| 4 | Create a Cloudflare API token for deployment, scoped to Workers Scripts, Workers Routes, D1, R2, Queues, Browser Rendering and the spcfz.ae zone | Cloudflare, My Profile, API Tokens | account owner |
| 5 | Store the token and the account id as repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub, repository settings | account owner, or Claude after approval |
| 6 | First deploy to the preview environment on workers.dev; this creates the preview D1, R2 bucket and queues | GitHub Actions | Claude, after approval of the workflow run |
| 7 | Create the production D1 database, R2 bucket and queues | GitHub Actions deploy | Claude, after approval |
| 8 | Attach the custom domain licensed.spcfz.ae to the Worker; Cloudflare creates the DNS record | wrangler, from the deploy | Claude, after approval |
| 9 | Set the Worker secrets: production and test webhook secrets, Access team domain and audience | wrangler secret, from CI | Claude generates them, sets them after approval, hands them to the ERP team through the channel the user chooses |
| 10 | Create a Cloudflare Access application for `licensed.spcfz.ae/admin*` with an allow policy for the SPC staff emails | Cloudflare Zero Trust | account owner |
| 11 | Create WAF rules: allow only the ERP IP addresses on `/v1/*`; rate limits on `/v1/*` and `/c/*` | Cloudflare, Security, WAF | account owner, or Claude after approval |
| 12 | Enable a Worker error-rate notification to the marketing inbox | Cloudflare, Notifications | account owner |

Steps 1, 2, 4 and 10 need the account owner's own login and are done by them.

## What the user decides before step 3

Which GitHub account owns the repository. The spcfz-forms repository lives on
a personal account. An SPC-owned organisation would keep the code with the
company. Either works for the deployment.

## Secrets

Claude generates each secret as 48 random characters from a cryptographic
source. Two slots per route allow rotation without downtime. Secrets are never
written to a file in this workspace or to chat; they go straight into Worker
secrets and are passed to the ERP team by the user through a channel of their
choosing.

## Cost at 1,000 licences a month

| Item | Expected |
|---|---|
| Workers Paid plan | 5 USD a month |
| Browser Rendering | 2 to 3 hours a month, inside the 10 included |
| R2 | a few gigabytes a year, under 1 USD a month |
| D1, Queues, Access | inside free allowances at this size |

## Rollback

Removing the custom domain from the Worker takes the service offline and
leaves the data in place. Deleting the Worker, the bucket and the database
removes everything. Neither affects www.spcfz.ae or any other record in the
zone. R2 versioning is turned on at bucket creation so a deleted card's images
can be restored.
