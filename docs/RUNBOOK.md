# Runbook

licensed.spcfz.ae runs as the Docker container `spcfz-licence-card` on
13.206.34.102, the server that also hosts the marketing dashboard,
announcements, coworking, quality and the reviews dashboard. **Every change
on that server needs the user's approval for that specific change.** Reading
is free.

| What | Where |
|---|---|
| Container | `spcfz-licence-card`, image `spcfz-licence-card:<git sha>` |
| State | `/opt/spcfz-licence-card/data` (SQLite, images, daily backups) |
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

## Secrets

Read a secret to hand to the ERP team:

```
ssh root@13.206.34.102 grep '^TEST_SECRET_CURRENT=' /opt/spcfz-licence-card/licence-card.env
```

Rotate: copy the current value to `WEBHOOK_SECRET_PREVIOUS`, put a new
48-character value in `WEBHOOK_SECRET_CURRENT`, `docker restart`, tell the
ERP team, clear `_PREVIOUS` once they confirm. Same for the `TEST_` pair.

## ERP IP allowlist

Set `ERP_IP_ALLOWLIST` in the env file, comma separated, then `docker
restart`. Mirror it in the Cloudflare WAF rule on `/v1/*`. Until it is set,
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
Images can be regenerated from the database with Admin, Re-render.

## A licence never got a card

1. Admin, Events: filter route production, outcome rejected. The errors say why.
2. If the payload was rejected, fix `FIELD_MAP` in the env file, restart, and Replay the event.
3. If no event exists, the ERP never reached us. Create the card in Admin, Create, or import a CSV.

## A card is stuck on "preparing"

1. Admin, Cards, status pending or failed. Open the card, Regenerate.
2. `docker logs` for the card id. Usual causes: Chromium crashed, or the container hit its memory cap.

## Update the design

New template under `templates/`, bump `TEMPLATE_VERSION` in the env file,
deploy, then Admin, Re-render filtered by the old version.
