# Deploying Lead Engine

From nothing to a live URL. Budget about an hour, most of it waiting on Oracle.

**What you get at the end:** `https://leads.yourdomain.com` (or plain HTTP on the
VM's IP if you skip the domain — see [Without a domain](#without-a-domain)).

---

## Before you start

You need three things this repository cannot provide:

| | Why | Cost |
| --- | --- | --- |
| An Oracle Cloud account | The VM | Free (card required for identity check) |
| A domain name | HTTPS, which login requires | ~₹800/year |
| A Resend account *(optional)* | Sending real email | Free to 3,000/month |

---

## 1. Create the Oracle tenancy — **region matters permanently**

At signup, choose a home region of **India South (Hyderabad)** or
**India West (Mumbai)**.

> **This cannot be changed later.** The scraper reads IndiaMART, which redirects
> non-Indian traffic to a host that returns 403. A tenancy created in a US
> region means creating a whole new tenancy, with a different email address.

## 2. Create the VM

- Shape **VM.Standard.A1.Flex** — ARM, Always Free up to 4 OCPU / 24 GB. Take
  all four OCPUs and 24 GB; it costs nothing.
- Image **Ubuntu 22.04 (aarch64)**.
- Save the SSH private key it offers. There is no second chance.

If you get "Out of host capacity", try the other Indian region, or retry over a
few hours — A1 capacity comes and goes.

### Firewall

In the VM's subnet security list, add ingress rules for **80** and **443** only.

Do **not** open 4000 or 5432. Nothing needs them: Compose publishes only Caddy's
ports, Postgres and Redis bind to `127.0.0.1`, and the API is not published at
all.

Ubuntu also ships iptables rules that block everything but SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Point your domain at it

Create an **A record** for `leads.yourdomain.com` → the VM's public IP. Check it
has propagated before continuing, or Caddy's certificate request will fail and
you will be rate-limited by Let's Encrypt for an hour:

```bash
dig +short leads.yourdomain.com     # must print your VM's IP
```

## 4. Install Docker

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
exit                                # log out and back in for the group to apply
```

## 5. Clone and configure

```bash
git clone https://github.com/SHUBHAMKUMAR2001/makhanaStore.git
cd makhanaStore
cp .env.example .env
nano .env
```

Set these. **Generate the secrets, do not invent them:**

```bash
openssl rand -hex 32      # run twice, once for each secret below
```

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | `https://leads.yourdomain.com` — **drives the cookie Secure flag** |
| `CADDY_SITE_ADDRESS` | `leads.yourdomain.com` (no scheme) |
| `POSTGRES_PASSWORD` | A long random string |
| `DATABASE_URL` | Same password, host `localhost` (host-side tooling only) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `INTERNAL_API_TOKEN` | `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Your login |
| `ADMIN_PASSWORD` | 12+ characters |
| `NODE_ENV` | `production` |

> `PUBLIC_URL` and `CADDY_SITE_ADDRESS` must agree. Session cookies are `Secure`
> only when `PUBLIC_URL` is `https://`, and a `Secure` cookie over plain HTTP is
> silently discarded by the browser — login appears to work, then every request
> returns 401.

## 6. Start it

```bash
docker compose up -d
docker compose logs -f caddy      # watch the certificate being issued
```

The first run builds six images and pulls Chromium. **On ARM this takes 10–20
minutes.** Subsequent starts are seconds.

Once Caddy logs `certificate obtained successfully`:

```bash
docker compose run --rm migrate pnpm --filter @lead/db seed
```

**Open `https://leads.yourdomain.com` and sign in.**

## 7. Verify the scraper can actually reach IndiaMART

Run this **on the VM**, not your laptop. A VPN on your machine is irrelevant —
the only IP that matters is the one the scraper egresses from:

```bash
docker compose exec scraper pnpm --filter @lead/scraper check-geo
```

Expected: `This host geolocates to IN. IndiaMART scraping should work.`

Anything else means the region is wrong and scraping will not work from this VM.

## 8. Turn on backups

The leads table is the entire asset of this system — months of scraping and
calling. Set this up on day one, not after the first scare.

```bash
sudo crontab -e
```

```cron
0 2 * * * /home/ubuntu/makhanaStore/deploy/backup.sh >> /var/log/lead-backup.log 2>&1
```

Then prove it works, immediately:

```bash
./deploy/backup.sh
ls -lh /var/backups/lead-engine/
```

A backup on the same VM does not survive losing the VM. For an offsite copy,
create an Object Storage bucket (20 GB free), configure the `oci` CLI, and set
`BACKUP_BUCKET` in `.env`.

To restore: `./deploy/restore.sh /var/backups/lead-engine/db-YYYYMMDD-HHMMSS.sql.gz`

## 9. Replace the placeholder business data

**Before any quotation reaches a real buyer.** Out of the box it says
`Your Legal Entity Name Pvt Ltd`, FSSAI `00000000000000`, with invented rates.

In the CRM: **Catalogue** → edit each product's price ladder. Business identity
is at `PATCH /config/business`, or edit `packages/db/src/seed.ts` before seeding.

---

## Without a domain

You can run on the VM's bare IP, but without HTTPS:

```bash
CADDY_SITE_ADDRESS=:80
PUBLIC_URL=http://<your-vm-ip>
```

Both must be set this way. `PUBLIC_URL` being `http://` takes the `Secure` flag
off the session cookie so login works.

**Understand the trade-off:** your session cookie and every lead crosses the
internet in the clear. Acceptable for a day or two of testing; not for real
customer data. A domain costs about ₹800/year.

---

## Updating

```bash
cd makhanaStore
git pull
docker compose build
docker compose up -d
docker compose run --rm migrate            # applies any new migrations
```

Migrations run automatically on startup too — every service waits for the
`migrate` container to finish, so nothing starts against an un-migrated schema.

## Turning on the scraper schedule

Off by default so you can watch the first runs. Once you trust the output:

```bash
SCRAPER_SCHEDULE_ENABLED=true
SCRAPER_SCHEDULE_CRON=0 3 1 * *     # 03:00 UTC on the 1st of each month
```

Then `docker compose up -d api`.

## Turning on real email

1. Sign up at <https://resend.com>, add your domain.
2. Add the DNS records it shows — SPF, DKIM, DMARC. **Skip this and cold
   outreach lands in spam.**
3. In `.env`: `OUTREACH_PROVIDER=resend`, `RESEND_API_KEY=...`,
   `OUTREACH_FROM_EMAIL=sales@yourdomain.com`.
4. `docker compose up -d outreach`

Until then the default `log` provider records messages without sending, and the
timeline marks them `[not delivered: ...]` so nothing looks sent when it wasn't.

---

## Troubleshooting

**Login succeeds, then everything is 401.**
`PUBLIC_URL` is `https://` but you are browsing over plain HTTP, or vice versa.
The browser is discarding a `Secure` cookie. Make `PUBLIC_URL` and
`CADDY_SITE_ADDRESS` agree, then `docker compose up -d api`.

**Caddy cannot get a certificate.**
Check `dig +short leads.yourdomain.com` returns the VM IP, and that ports 80 and
443 are open in *both* the OCI security list and iptables. Let's Encrypt rate
limits failures — fix DNS before retrying.

**The scraper finds nothing.**
Run `check-geo` on the VM. Then look at **Campaigns → Scrape runs**: every run
records its outcome, and `Geo-blocked` means the wrong region while
`Stopped at cap` means it worked and hit the request limit.

**Chromium crashes in the scraper.**
It needs shared memory. `shm_size: 1gb` is already set in `docker-compose.yml`;
if you run the worker outside Compose, pass `--shm-size=1g`.

**Out of disk.**
`docker system prune -a` reclaims old build layers. Do **not** prune volumes —
`caddy-data` holds your certificates and `postgres-data` holds everything.
