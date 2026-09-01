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

### Finding the right shape — the shape list has a series selector

Create Instance → **Image and shape** → **Change shape**. The dialog opens on
the **AMD** series, which shows `VM.Standard.E2.1.Micro`, `E3.Flex`, `E2.x` and
the Intel `Standard2.x` shapes. **A1.Flex is not in that list.**

Click the **Ampere** button in the *Shape series* row, then pick
**VM.Standard.A1.Flex** and set it to **4 OCPU / 24 GB** — all of it is Always
Free and costs nothing.

- Image **Ubuntu 22.04 (aarch64)** — must be the ARM build to match the shape.
  The **Minimal** aarch64 variant is a good choice and is what these
  instructions assume: it is a smaller image with less preinstalled surface, and
  everything this deployment needs gets installed explicitly in step 4. The
  backup and restore scripts deliberately use only coreutils and Docker, so they
  work on it without pulling in python3 or jq. The standard (non-minimal) image
  is equally fine if you prefer having the usual diagnostic tools to hand.
- Save the SSH private key it offers. There is no second chance.

### The "Security" section of the create form

Leave **both toggles off**:

| Toggle | Set to | Why |
| --- | --- | --- |
| Shielded instance | **Off** | Secure Boot / Measured Boot / vTPM. Guards against a tampered boot chain — a threat model that does not apply to a single VM you control, and it constrains what kernel modules can load for no benefit here. May be unavailable on Ampere shapes; greyed out is fine. |
| Confidential computing | **Off** | AMD SEV memory encryption. Not applicable to Ampere at all, and it costs performance where it is available. |

Neither addresses what actually threatens this deployment. The real risks are an
exposed port, a weak admin password, and a leaked secret — all covered below.

> **Do not take `VM.Standard.E2.1.Micro`**, even though it is also labelled
> Always Free. It has **1 GB of RAM**. This stack runs Postgres, Redis, four
> Node services, nginx and Caddy, and the scraper launches Chromium, which alone
> wants around 1 GB while a scrape is running. The idle stack needs roughly
> 750 MB before Chromium starts, so a 1 GB box is out of memory before it is
> useful. Oracle's two free Micro instances do not help either — the workload
> does not split across them.

### Networking — build the VCN first, separately

**Do not let the Create Instance wizard create the VCN and subnet inline.** That
path is deliberately reduced — the form itself says so — and the
"Automatically assign public IPv4 address" toggle stays greyed out on it, with a
warning that blames the subnet even when you have selected *Create new public
subnet*. No amount of fiddling with the subnet options re-enables it.

Build the network first, then come back:

1. Menu → **Networking → Virtual Cloud Networks**
2. **Start VCN Wizard** → *Create VCN with Internet Connectivity*
3. Name it, accept the default CIDRs (VCN `10.0.0.0/16`, public subnet
   `10.0.0.0/24`), keep the compartment the same as the instance's
4. Create. You get a VCN, a **public** and a private subnet, an internet
   gateway, a NAT gateway and the matching route tables — all wired.

> **Start VCN Wizard, not Create VCN.** They sit side by side on that page and
> only one of them builds a usable network. *Create VCN* produces an empty VCN —
> no subnet, no gateway, no route rule — and the symptom appears later: back on
> the instance form, "Select existing subnet" offers an empty dropdown. The
> giveaway while you are in it is a repeating **IPv4 CIDR Blocks** field saying
> you may assign up to 16; the wizard instead shows three prefilled boxes for
> the VCN and the two subnets.

#### If you already made an empty VCN

Either delete it and re-run the wizard, or wire it by hand — three pieces, in
this order:

1. **Subnet** — VCN → Subnets → *Create Subnet*. Name it, CIDR `10.0.0.0/24`,
   and set **Subnet Access → Public Subnet**. This is the setting the whole
   public-IP problem hinges on.
2. **Internet gateway** — VCN → Internet Gateways → *Create Internet Gateway*.
   A public subnet with no gateway still has no route off the VCN.
3. **Route rule** — VCN → Route Tables → the default table → *Add Route Rules*:
   destination `0.0.0.0/0`, target type **Internet Gateway**, target the gateway
   from step 2. Without this rule the gateway exists but nothing points at it.

Deleting and re-running the wizard is fewer steps and harder to get subtly
wrong; an empty VCN deletes cleanly because nothing depends on it.

Then in Create Instance → Networking:

| Field | Set to | Why |
| --- | --- | --- |
| Primary network | **Select existing virtual cloud network** → the one you just made | Selecting an existing VCN is what unlocks the public IP toggle. |
| Subnet | **Select existing subnet** → the one named **Public Subnet-…** | Take the public one. The wizard also created a private subnet, and picking that keeps the toggle disabled for a real reason. |
| **Automatically assign public IPv4 address** | **ON** | ⚠️ The setting this whole detour exists for. Without it the VM has no reachable address: no SSH, no site, no certificate validation. |
| IPv6 | Off | Nothing here needs it. Its warning is expected. |
| Network security groups | Leave unchecked | The subnet's security list is where the 80/443 rules go (step 3). Using both is a common way to end up with rules that silently contradict each other. |
| Hostname (Advanced) | lowercase, e.g. `makhana-store` | Internal DNS only, but DNS labels are conventionally lowercase. |

> **Consider reserving the public IP.** The auto-assigned address is
> *ephemeral*: it survives reboots and stops, but is released if you ever
> terminate and recreate the instance — which would silently break the DNS A
> record your site depends on. Networking → Reserved public IPs → reserve one
> and attach it. Free, and it means rebuilding the VM does not mean re-pointing
> your domain.

### Storage (boot volume)

| Field | Set to |
| --- | --- |
| Boot volume size | **100 GB** (the 50 GB default is workable but tight) |
| In-transit encryption | **On** (default) |
| Boot volume performance | **Balanced — VPU 10** (the default; do not raise it) |
| Boot volume backup policy | None — `deploy/backup.sh` is the real backup |

**On VPU:** leave it at the default **10 (Balanced)**. VPU is charged per GB per
month, so raising it on a 100 GB volume is a recurring cost for throughput this
workload never uses. Watch the cost estimate the console shows as you drag the
slider — if it stops reading zero, you have left the free tier.

At VPU 10 a 100 GB volume gets roughly 6,000 IOPS and ~48 MB/s. Nothing here
comes close: Postgres holds a few hundred megabytes that the 24 GB of RAM caches
almost entirely, document generation writes kilobytes, and the scraper is
network-bound by design — it deliberately waits 3.5-9 seconds between requests.
The only disk-hungry moment is the very first `docker compose build`, and that
is a one-off you wait out once.

Dropping to VPU 0 (Lower Cost) would also work but gives about 200 IOPS on this
size, which mainly makes that first build slower. Balanced is the default for a
reason; take it.

Always Free includes **200 GB of block storage in total**, so 100 GB leaves room
for a second free VM later. Rough steady-state usage:

| | |
| --- | --- |
| Ubuntu Minimal | ~2 GB |
| Docker images — five `node:22-slim` builds, postgres, redis, nginx, caddy, and the scraper image carrying Chromium | ~6–8 GB |
| Docker build cache (the reason 50 GB gets tight) | ~3–5 GB, prunable |
| Postgres data — leads are small; 10,000 with indexes | well under 1 GB |
| Generated documents — a quotation is ~10 KB, a deck ~150 KB | ~150 MB per 1,000 |
| Backups, 30-day retention on the same box | grows slowly |

The scraper image is the large one: Chromium plus its shared libraries is most
of a couple of gigabytes on its own. If disk does get tight,
`docker system prune -a` reclaims build layers safely — but never
`--volumes`, which would take `postgres-data` and `caddy-data` with it.

### If Ampere capacity is unavailable

"Out of host capacity" on A1 is common. In order of effort:

1. Retry — capacity is released continuously; different times of day differ.
2. Try a different **availability domain** in the same region.
3. Try the other Indian region (Hyderabad ↔ Mumbai). ⚠️ Only if your *home*
   region allows creating there; the home region choice from step 1 stands.
4. Pay for a small AMD instance. A `VM.Standard.E3.Flex` at 2 OCPU / 8 GB is
   roughly ₹1,500–2,500/month and runs this comfortably. That breaks the
   zero-cost goal, so treat it as a fallback rather than the plan.

**Minimum that actually works:** 2 OCPU / 8 GB. Below ~4 GB the scraper's
Chromium is the first thing to fail, and it fails as a container restart loop
rather than a clear error.

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

### Before you click Create — check the review page

The review screen is the last point where a mistake is cheap. Read these off it:

| Field | Must say |
| --- | --- |
| Image | `Canonical Ubuntu 22.04 Minimal aarch64` |
| Shape build | `4 core OCPU, 24 GB memory` |
| **Public IPv4 address** | **Yes** ← the one that cannot be fixed afterwards |
| Use network security groups | No |
| Secure Boot / Measured Boot / TPM | Disabled |
| Confidential computing | Disabled |
| Boot volume | `100`, VPU `10` |
| SSH keys | Your key is listed |

**`Public IPv4 address: No` is the failure worth catching here.** An instance
created without one has a private address only: no SSH, no site, and no
certificate validation.

Do not confuse it with the field directly below it. They are independent:

| Field | What it means |
| --- | --- |
| **Public IPv4 address** | A routable internet address. Off by default in some wizard paths. **This is the one you need.** |
| Private IPv4 address | `10.0.0.x` inside your VCN — "the next unused address in the chosen subnet". Auto is correct and has nothing to do with reachability from outside. |

If you do create the instance without a public IP, it is recoverable **provided
the subnet is public**: Instance → Attached VNICs → the VNIC → IPv4 Addresses →
Edit → assign an ephemeral or reserved public IP. Only a *private* subnet makes
it unrecoverable, and then the fix is a new subnet or VCN rather than a new
instance.

And confirm you actually have the **private** key. The review page shows the
public half, which proves nothing. If Oracle generated the pair in the browser,
the private key was downloaded once at that moment and cannot be retrieved
again.

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

On the Minimal image, add the two things the rest of this runbook uses that it
does not ship with:

```bash
sudo apt install -y iptables-persistent cron
```

`iptables-persistent` provides `netfilter-persistent` for the firewall step, and
`cron` runs the nightly backup. Everything else — `awk`, `find`, `gzip`, `tar`,
`openssl` — is already present.

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

> **This is the step I could not test.** The sandbox this was built in cannot
> pull Docker images, so the six Dockerfiles have been statically verified —
> every COPY path resolves, every build target exists, the context excludes
> node_modules so no host-architecture binaries leak into an ARM image — but
> never actually built. Expect this step to need a round of debugging; the
> errors will be concrete and fixable.

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

## 9. Security checklist

What the application already does, so you know what is and is not your job:

| | |
| --- | --- |
| Public ports | **Only 80 and 443**, both on Caddy. The API, docgen, outreach and scraper publish nothing; Postgres and Redis bind to `127.0.0.1`. |
| Transport | TLS terminated by Caddy with certificates renewed automatically. |
| Passwords | Argon2id hashed. Never stored or logged in the clear. |
| Sessions | Opaque id in an httpOnly, signed, SameSite=Lax cookie, `Secure` when `PUBLIC_URL` is https. Server-side, so revocable instantly. |
| Login | Rate limited to 10 attempts per 5 minutes. Wrong email and wrong password take the same time, so the response does not reveal which addresses are registered. |
| API | Rate limited globally; every route group behind an auth guard; every input validated with zod at the boundary. |
| Service-to-service | `x-internal-token`, compared in constant time. |
| Logs | Cookies, tokens and API keys are redacted by pino. |

What is yours:

**Secrets.** Generate them, never reuse them, never commit them. `.env` is
gitignored and excluded from every Docker build context — keep it that way. If
one leaks, rotate it and restart: changing `SESSION_SECRET` invalidates every
session, which is the point.

**SSH.** Key-only by default on Oracle images. Confirm password auth is off:

```bash
sudo grep -E '^(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config
# want: PasswordAuthentication no   /   PermitRootLogin no
```

Consider restricting port 22 in the OCI security list to your own IP rather than
`0.0.0.0/0`. If your address is dynamic, `fail2ban` is the pragmatic
alternative:

```bash
sudo apt install -y fail2ban && sudo systemctl enable --now fail2ban
```

**Updates.** The VM will not patch itself:

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Rebuild the app images periodically too — `docker compose build --pull` picks up
base-image security fixes.

**Admin password.** One account guards every lead you own. Make it long, store
it in a password manager, and change it from the seeded value after first login
(**`POST /auth/change-password`**, which invalidates all sessions).

**What is deliberately not here:** no 2FA, no audit log of who viewed what, no
per-user permissions. This is a single-operator internal tool and those were
scoped out. If someone else joins, revisit that decision before handing them a
login.

## 10. Replace the placeholder business data

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
