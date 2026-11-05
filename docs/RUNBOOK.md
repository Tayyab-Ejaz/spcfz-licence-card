# Runbook

licensed.spcfz.ae runs as the Docker container `spcfz-licence-card` on
13.206.34.102, the server that also hosts the marketing dashboard,
announcements, coworking, quality and the reviews dashboard. **Every change
on that server needs the user's approval for that specific change.** Reading
is free.

| What | Where |
|---|---|
| Container | `spcfz-licence-card`, image `spcfz-licence-card:<git sha>` |
| State | `/opt/spcfz-licence-card/data` (SQLite and its daily backups) |
| Settings and secrets | `/opt/spcfz-licence-card/licence-card.env`, mode 600 |
| Releases | `/opt/spcfz-licence-card/releases/<sha>/` |
| Apache site | `/www/server/panel/vhost/apache/licensed.spcfz.ae.conf` |
| Certificate | `/www/server/panel/vhost/cert/licensed.spcfz.ae/` |
| Apache logs | `/www/wwwlogs/licensed.spcfz.ae-*_log` |

## Deploy a new version

From this Mac, on a clean committed tree, each step approved separately:

```
tools/deploy.sh --dry-run release      # shows what will run
tools/deploy.sh release                # upload the commit, build the image
tools/deploy.sh start                  # swap containers; restores the old one if unhealthy
tools/deploy.sh status
```

A start stops the old container before the new one opens the database, so
there are roughly ten seconds of 502s from Apache.

## First-time setup (done 16 October 2026)

1. `tools/deploy.sh release`
2. `tools/deploy.sh env-init` creates the env file with two random secrets.
   They are generated on the server and never printed.
3. `tools/deploy.sh start`
4. `tools/deploy.sh cert`
5. `tools/deploy.sh vhost` runs Apache's config test, installs the site,
   tests again and reloads gracefully. If the test fails, the file is
   removed and Apache is not reloaded.
6. In Cloudflare, add DNS `A licensed 13.206.34.102`, proxied.

Install the vhost **before** the DNS record. This server has no catch-all
HTTPS site: Apache answers an unknown HTTPS hostname with the first SSL site
alphabetically, which is announcements. On 16 October the DNS record went in
first and licensed.spcfz.ae briefly showed the announcements page until the
vhost was installed.

## Make a test card to look at

```
ssh root@13.206.34.102 "docker exec -i -w /app spcfz-licence-card node --input-type=module" < tools/test-card.mjs
```

Creates one test card for "Preview Publishing FZE" (founder Mariam Fawzy) and
prints its page link. Running it again updates the same card. Test cards
look exactly like live ones (no watermark) and are kept; nothing is deleted
automatically. `TEST_LANG=ar` makes the page open with the Arabic card.

## Load the sample ERP licences

```
ssh root@13.206.34.102 "docker exec -i -w /app spcfz-licence-card node --input-type=module" < tools/erp-samples.mjs
```

Creates or refreshes five fictional TEST licences that look like ERP data and
prints their page links (docs/DEV.md, "Test data").

## Logs, restart, status

```
ssh root@13.206.34.102 docker logs --tail 100 spcfz-licence-card
ssh root@13.206.34.102 docker restart spcfz-licence-card
tools/deploy.sh status
```

Docker keeps at most 5 log files of 10 MB.

## Roll back

`tools/deploy.sh start <previous sha>`. Images and release folders stay on
the server until removed. `docker images spcfz-licence-card` lists them.

## Remove completely

Puts the server back as it was before this service existed:

```
docker rm -f spcfz-licence-card
docker rmi $(docker images -q spcfz-licence-card)
rm /www/server/panel/vhost/apache/licensed.spcfz.ae.conf && /usr/bin/httpd -t && /etc/init.d/httpd reload
rm -r /www/server/panel/vhost/cert/licensed.spcfz.ae
rm -r /opt/spcfz-licence-card        # deletes every card; copy data/ off first if needed
```

Then delete the DNS record in Cloudflare.

## Admin sign-in

The admin lives at `https://licensed.spcfz.ae/admin`, but its sign-in page
opens only with the key from the env file:

```
ssh root@13.206.34.102 grep '^ADMIN_LOGIN_KEY=' /opt/spcfz-licence-card/licence-card.env
```

The sign-in link is `https://licensed.spcfz.ae/admin/login?key=<that value>`.
Bookmark it; share it only with staff. Without the key, every admin address
answers "Not found".

Staff accounts (type the password when asked; it is never shown):

```
ssh -t root@13.206.34.102 docker exec -it spcfz-licence-card node dist/cli/admin-user.js add name@spcfz.ae
ssh -t root@13.206.34.102 docker exec -it spcfz-licence-card node dist/cli/admin-user.js passwd name@spcfz.ae
ssh -t root@13.206.34.102 docker exec -it spcfz-licence-card node dist/cli/admin-user.js unlock name@spcfz.ae
ssh -t root@13.206.34.102 docker exec -it spcfz-licence-card node dist/cli/admin-user.js remove name@spcfz.ae
ssh root@13.206.34.102 docker exec spcfz-licence-card node dist/cli/admin-user.js list
```

`passwd` signs that person out everywhere. After 5 wrong passwords an
account locks for 15 minutes; `unlock` clears it at once.

Rotate the key (old links stop working; signed-in sessions continue): put a
new 48-character value in `ADMIN_LOGIN_KEY` and apply it (see "Applying an
env-file change" below).

## Secrets

Read a secret to hand to the ERP team:

```
ssh root@13.206.34.102 grep '^TEST_SECRET_CURRENT=' /opt/spcfz-licence-card/licence-card.env
```

Rotate: copy the current value to `WEBHOOK_SECRET_PREVIOUS`, put a new
48-character value in `WEBHOOK_SECRET_CURRENT`, apply it (below), tell the
ERP team, clear `_PREVIOUS` once they confirm. Same for the `TEST_` pair.

**Applying an env-file change.** The container reads
`/opt/spcfz-licence-card/licence-card.env` only when it is created, so
`docker restart` keeps the old values. Recreate it with the running image
from the Mac instead: `tools/deploy.sh start <running sha>` (the sha is the
image tag `tools/deploy.sh status` shows). It health-checks and rolls back
like a deploy.

## ERP IP allowlist

Set `ERP_IP_ALLOWLIST` in the env file, comma separated, then apply it
(below). Mirror it in the Cloudflare WAF rule on `/v1/*`. Until it is set,
every webhook is rejected with 403, which is visible in Admin, Events.

## Cloudflare ranges

`deploy/cloudflare-ips.txt` feeds the Apache `Require ip` block. If
Cloudflare publishes new ranges, update the file, regenerate the Apache site
from it, and reinstall that file with an approved change.

## Test everything before the ERP is connected

Admin, **Test flow**. Pick a scenario (or paste a payload the ERP team sent) and press Send as the ERP. The run
page shows each step: the ERP's answer, how its fields were read (and which it ignores), the card with a QR code
for your phone, the welcome email, Post to LinkedIn, and buttons for what the ERP does next (same licence again,
renewal, correction, expired), each checked against what should happen. The test email goes to your own
address, so sign in with your @spcfz.ae account. Test cards are kept; delete them by hand if you like.

## Welcome email: turn it on

Until `MAIL_TRANSPORT=smtp` is set, welcome emails are queued in the admin but
not sent (Settings shows "off").

1. The sender (since 2 November 2026): Amazon SES in Mumbai (`ap-south-1`,
   account 275472740409, production access), from `more@spcfz.ae`. Replies
   land in that mailbox's inbox, but SES keeps no copy in its Sent Items:
   set `MAIL_BCC` if SPC wants one. AWS suspended SES in Mumbai in 2023 over
   bounces and reinstated it on 4 November 2026 after a clean-up; it expects
   only email people asked for, bounces and complaints removed (the feed
   below does that) and keys rotated. Send nothing else through these
   credentials.
2. DNS, done, in Cloudflare (DNS only, not proxied):
   - the `spcfz.ae` domain identity with Easy DKIM: three
     `…._domainkey.spcfz.ae` CNAMEs pointing to `…dkim.amazonses.com`;
   - custom MAIL FROM `bounce.spcfz.ae`: MX
     `10 feedback-smtp.ap-south-1.amazonses.com` and TXT
     `v=spf1 include:amazonses.com ~all`.

   spcfz.ae's DMARC is `p=reject`; SES email passes it through DKIM. The
   MAIL FROM is set on the domain and on the `more@spcfz.ae` address
   identity, because an address identity's own setting wins over its
   domain's (until 5 November the address had none, and bounces came back
   through amazonses.com). Check it in CloudShell:

   ```
   aws sesv2 get-email-identity --region ap-south-1 --email-identity more@spcfz.ae --query "MailFromAttributes"
   ```

   It shows `bounce.spcfz.ae` and `SUCCESS`.
3. SMTP credentials: the IAM user `ses-smtp-user.20261102-104617` (in a
   group with `AmazonSesSendingAccess`), for this service only; another
   system that needs to send gets its own IAM user. Use **IAM SMTP
   credentials**, not the console's default "Mail Manager SMTP" (an ingress
   endpoint with its own charges). The SMTP password the console generated
   for this user worked only in us-east-1, so the Mumbai password is derived
   from a regular access key of the user with AWS's documented algorithm
   ("Obtaining Amazon SES SMTP credentials by converting existing AWS
   credentials"), on the server so it is never shown. The server keeps only
   the derived password, never the secret key.
4. Add these lines to `/opt/spcfz-licence-card/licence-card.env`:

   ```
   MAIL_TRANSPORT=smtp
   MAIL_SMTP_URL=smtps://<access key id>:<SMTP password>@email-smtp.ap-south-1.amazonaws.com:465
   MAIL_FROM=SPC Free Zone <more@spcfz.ae>
   ```

   Port 465 is TLS from the start, so the URL starts `smtps://`. SMTP
   passwords can contain `/`, `+` and `=`: percent-encode them (`%2F`,
   `%2B`, `%3D`), as any `@` or `:` in the user or password (`@` is `%40`).
   Type secrets yourself with
   `ssh -t root@13.206.34.102 nano /opt/spcfz-licence-card/licence-card.env`.
   `MAIL_REPLY_TO` sends replies somewhere other than the sender (optional).
   `MAIL_BCC` keeps a copy of every email (optional). `MAIL_TEST_ALLOWLIST`
   lists who test cards may email (default `spcfz.ae`). The service sends 10
   at a time and retries anything SES throttles.
5. Apply the env-file change (see Secrets).
6. Check: in the admin, open a TEST card, set its customer email to your own
   @spcfz.ae address and press Send again. The card's Welcome email table
   shows sent, or the provider's error. In the received email's headers,
   look for `dkim=pass header.i=@spcfz.ae`, `dmarc=pass` and
   `smtp.mailfrom=bounce.spcfz.ae`. Microsoft 365 marks it "originated from
   outside" for SPC staff; customers do not see that.

Before 2 November the service sent through SPC's Microsoft 365
(`smtp://more%40spcfz.ae:<app password>@smtp.office365.com:587`, STARTTLS).
That works as a fallback only until Microsoft turns password SMTP off by
default in December 2026 (Message Center MC786329).

The admin's card page has Preview links that show the email in both
languages without sending anything. If a customer unsubscribed, the card page
says so and Send again sends nothing; undoing an unsubscribe is only on the
customer's request, by deleting their row from `email_suppressions`.

## Bounces, complaints and the domain check (4 November 2026)

Set up for Amazon SES's sending review; both run without anyone's help.

- **Domain check.** Before each email goes out through SMTP, the service
  checks that the recipient's domain can receive email. If the domain does
  not exist or takes no email, the email is not sent and the card's Welcome
  email table says why ("not sent: … Check the address."). Fix the address on
  the card and press Send again. A DNS lookup that fails for another reason
  is retried like a temporary SMTP error.
- **Bounce and complaint feed.** SES reports bounces and complaints for
  spcfz.ae and more@spcfz.ae to the SNS topic `ses-bounces-complaints`
  (Mumbai), which emails tayyab@spcfz.ae and it@spcfz.ae and POSTs to
  `https://licensed.spcfz.ae/aws/ses-feedback`. A permanent bounce or a
  complaint adds the address to `email_suppressions` (source `bounce` or
  `complaint`): the card page says so and no more emails go to it. Only
  messages signed by Amazon SNS for that topic are accepted.
  `SES_FEEDBACK_TOPIC` names another topic, or `off`.

  Subscribe the address once, after the version with it is running, in
  CloudShell (Mumbai):

  ```
  aws sns subscribe --region ap-south-1 --topic-arn arn:aws:sns:ap-south-1:275472740409:ses-bounces-complaints --protocol https --notification-endpoint https://licensed.spcfz.ae/aws/ses-feedback
  aws sns list-subscriptions-by-topic --region ap-south-1 --topic-arn arn:aws:sns:ap-south-1:275472740409:ses-bounces-complaints --query "Subscriptions[].[Endpoint,SubscriptionArn]" --output table
  ```

  The service confirms the subscription itself (the log shows
  `ses feedback … subscribed`); the second command then shows an ARN, not
  `PendingConfirmation`, for the https endpoint. If it stays pending, check
  Cloudflare's security events for a blocked POST to `/aws/ses-feedback`.
- **Alerts to people.** The same topic emails every bounce, complaint and
  CloudWatch alarm (bounce rate 2%, complaint rate 0.05%). On a bounce, open
  the card and fix or clear the address. On an alarm, set
  `MAIL_TRANSPORT=off` (emails wait in the queue) and find the cause first.
  With few emails, one bounce can trip the 2% alarm.

## Post to LinkedIn: turn it on

Until `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are set, the button
is hidden in the studio. (The email has no LinkedIn button: a post should carry
the customer's own photo and edits, so it starts from the studio.)

1. At https://www.linkedin.com/developers/apps create an app: name "SPC Free
   Zone", the SPC Free Zone company page, the SPC logo. A page admin of
   SPC's LinkedIn page approves the link to the page.
2. Products: add **Sign In with LinkedIn using OpenID Connect** and **Share on
   LinkedIn** (both instant).
3. Auth: add the redirect URL `https://licensed.spcfz.ae/linkedin/callback`.
4. Put the Client ID and Client Secret in the env file, typing the secret
   yourself:

   ```
   LINKEDIN_CLIENT_ID=<client id>
   LINKEDIN_CLIENT_SECRET=<client secret>
   LINKEDIN_ORG_URN=urn:li:organization:30196206
   ```

   30196206 is SPC's page ("Sharjah Publishing City - SPC Free Zone",
   linkedin.com/company/spcfreezone). With `LINKEDIN_ORG_URN`, "@SPC Free
   Zone" in the caption becomes a real mention of the page. `LINKEDIN_API_VERSION` (YYYYMM) is optional; the
   built-in one is 202606, and LinkedIn retires a version after about a year,
   so set a newer one by mid-2027.
5. Apply the env-file change (see Secrets) and post from a TEST card to your
   own LinkedIn. The admin card page lists the post with a link.

**Post alert (3 November 2026).** After each post, the service emails
`tayyab@spcfz.ae` with a link to it, so SPC's page can like, comment on and
repost it while it is new. It goes through the same email sending as the
welcome email (so it needs that on), retries the same way, and is listed under
LinkedIn posts on the admin card page. Test cards send it too, marked [TEST].
To change who gets it, set `LINKEDIN_ALERT_TO` (comma separated, or `off`) and
apply the env-file change.

## Rate limits

The app limits each visitor per minute, counting an IPv4 address or an IPv6 /64 block as one visitor: 300 page, status and image
requests, 60 counter posts, and 20 webhook calls from addresses not on the
ERP allowlist; and 60 "Post to LinkedIn" requests per 10 minutes. Visitors over a limit get 429 with Retry-After. The numbers
are `DEFAULT_RATE_LIMITS` in src/index.ts; changing them is a code change and
a deploy. Counters live in memory and reset on restart.

## Backups

The host has no backup, by decision. The daily housekeeping at 05:15 Dubai
time writes `data/backups/licence-card-YYYY-MM-DD.sqlite` and keeps seven.
The service stores no images: customers build their cards in the browser.

## A licence never got a card

1. Admin, Events: filter route production, outcome rejected. The errors say why.
2. If the payload was rejected, fix `FIELD_MAP` in the env file, restart, and Replay the event.
3. If no event exists, the ERP never reached us. Create the card in Admin, Create, or import a CSV.

## Update the design

The studio is built from SPC's Claude Design exports. Follow docs/DEV.md,
"Updating the design": re-export, run tools/extract-design.mjs, build, run
the pixel comparison, commit, then deploy as above. Cards already issued pick
up the new design the next time the customer opens the page.
