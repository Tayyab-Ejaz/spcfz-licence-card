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

## Rate limits

The app limits each visitor per minute, counting an IPv4 address or an IPv6 /64 block as one visitor: 300 page, status and image
requests, 60 counter posts, and 20 webhook calls from addresses not on the
ERP allowlist. Visitors over a limit get 429 with Retry-After. The numbers
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
