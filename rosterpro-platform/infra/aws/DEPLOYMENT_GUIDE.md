# Deploying RosterPro to AWS

This is a from-scratch walkthrough for a single-station (or small
multi-station) deployment using EC2 + RDS — the simplest AWS architecture
that's still genuinely production-appropriate. It intentionally does not
reach for ECS/EKS/Lambda; those are reasonable upgrades once you have
real scale or multiple environments to manage, but they're more moving
parts than a single airline's line-maintenance station needs on day one.

## Architecture

```
                          ┌─────────────────┐
  Users ──────────────────▶   CloudFront    │  (CDN + HTTPS for the frontend)
                          └────────┬─────────┘
                                   │ origin
                          ┌────────▼─────────┐
                          │   S3 bucket      │  (built frontend static files)
                          └──────────────────┘

  Users (API calls) ──────▶  EC2 instance (backend, Docker)
                                   │
                          ┌────────▼─────────┐
                          │  RDS PostgreSQL  │
                          └──────────────────┘
                                   │
                          ┌────────▼─────────┐
                          │   S3 bucket      │  (attachments: quals, certs, PDFs)
                          └──────────────────┘

  Backend ──▶ SES (email)      Backend ──▶ CloudWatch (logs/metrics)
```

Frontend and backend are deployed **separately** — the frontend is static
files on S3+CloudFront (fast, cheap, no server to manage), the backend is
a real running process on EC2 (it needs to run the notification scheduler,
hold a DB connection pool, etc). This is different from
`docker-compose.prod.yml`, which puts the frontend in an nginx container —
that's the simpler "one server does everything" option; this guide is the
more scalable one. Pick one, don't mix them.

## 1. RDS PostgreSQL

1. RDS Console → Create database → PostgreSQL 16.
2. Templates: **Production** (Multi-AZ) for a real deployment, or Dev/Test
   to save cost while validating this guide.
3. Instance class: `db.t4g.micro` is enough for one station's traffic;
   size up once you have real usage data, not before.
4. Storage: 20 GB gp3, enable storage autoscaling.
5. **Do not** make it publicly accessible. Put it in a private subnet;
   only the backend's EC2 security group should be allowed to reach port
   5432.
6. Note the endpoint hostname — this becomes `DATABASE_URL`'s host.
7. Enable automated backups (see §6 below) — RDS does this natively, which
   is simpler than the self-managed `pg_dump` approach in
   `infra/aws/backup.sh` if you're using RDS. Use one or the other, not
   both, to avoid confusing yourself about which backup is authoritative.

## 2. S3 buckets

Create two buckets (or one with two prefixes, if you prefer fewer
buckets to manage):

- `rosterpro-attachments-<your-suffix>` — qualification/license/training
  certificates, calibration certificates. Private by default; the backend
  should generate presigned URLs for upload/download rather than making
  objects public. (Module 3b's `Attachment` model already stores an
  `s3Key` — wiring actual S3 upload/download through the `aws-sdk`
  dependency already in `backend/package.json` is the remaining piece;
  this guide covers the bucket/IAM side.)
- `rosterpro-frontend-<your-suffix>` — the built frontend
  (`frontend/dist` after `npm run build`), served through CloudFront, not
  directly.

For the frontend bucket: block all public access, and instead grant
CloudFront read access via an Origin Access Control (OAC) — this keeps the
bucket itself private while CloudFront serves it publicly.

## 3. CloudFront

1. Create a distribution with the frontend S3 bucket as origin, OAC
   enabled (CloudFront will offer to update the bucket policy for you —
   accept it).
2. **Default root object**: `index.html`.
3. **Error pages**: map both 403 and 404 to `/index.html` with a 200
   response — this is the CloudFront equivalent of nginx's SPA fallback
   (`try_files ... /index.html` in `frontend/nginx.conf`); without it,
   refreshing on `/roster` returns a raw S3 404 instead of loading the app.
4. Attach an ACM certificate (in `us-east-1`, regardless of where
   everything else lives — that's a CloudFront requirement) for your
   domain, and point your domain's DNS at the CloudFront distribution.
5. Cache behavior: default TTL is fine for hashed asset files
   (`/assets/*`); set a short/no-cache TTL specifically for `/index.html`
   so a new deploy is visible immediately instead of waiting out a cache.

## 4. EC2 (backend)

1. Launch a `t4g.small` (arm64, cheaper) or `t3.small` instance, Ubuntu
   24.04, in a public subnet (or private + behind an ALB if you want
   proper zero-downtime deploys — a plain public EC2 instance is the
   simpler starting point).
2. Security group: allow 443 (and 80, redirecting to 443) from the
   internet; allow 22 (SSH) only from your own IP/VPN, never `0.0.0.0/0`.
3. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```
4. Put a reverse proxy (Caddy is the least fuss — automatic HTTPS via
   Let's Encrypt with zero config) in front of the backend container:
   ```bash
   sudo apt install -y caddy
   ```
   `/etc/caddy/Caddyfile`:
   ```
   api.your-domain.example {
       reverse_proxy localhost:4000
   }
   ```
5. Pull and run the backend image built by `.github/workflows/deploy.yml`:
   ```bash
   docker login ghcr.io -u <github-username>   # once, with a PAT that has read:packages
   docker pull ghcr.io/<org>/<repo>/backend:latest
   docker run -d --name rosterpro-backend --restart always \
     --env-file /opt/rosterpro/backend.env \
     -p 4000:4000 \
     ghcr.io/<org>/<repo>/backend:latest
   ```
6. `/opt/rosterpro/backend.env` on the instance holds the real production
   values for everything in `backend/.env.example` — `DATABASE_URL`
   pointing at the RDS endpoint from §1, real JWT secrets, SES SMTP
   credentials (below), Twilio credentials. Keep this file readable only
   by root (`chmod 600`); it's the single most sensitive file on the box.
7. Run migrations once, after the container is up:
   ```bash
   docker exec rosterpro-backend npx prisma migrate deploy
   docker exec rosterpro-backend node prisma/seed.js
   ```

For the GitHub Actions auto-deploy step (commented out in
`deploy.yml`), add `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` as repo secrets
and uncomment the SSH deploy step — it re-pulls and restarts the container
on every push to `main`.

## 5. SES (email)

1. SES Console → Verify a domain (better deliverability than a single
   verified email address) — add the DKIM/SPF DNS records it gives you.
2. SES starts in **sandbox mode** (can only send to verified addresses) —
   request production access (Account dashboard → Request production
   access) before relying on this for real users; approval usually takes
   under 24 hours.
3. SES Console → SMTP Settings → Create SMTP credentials. These are
   **different** from your AWS IAM credentials — SES issues its own
   SMTP username/password pair specifically for this.
4. Set in `backend.env`:
   ```
   SMTP_HOST=email-smtp.<your-region>.amazonaws.com
   SMTP_PORT=587
   SMTP_USER=<the SES SMTP username>
   SMTP_PASS=<the SES SMTP password>
   EMAIL_FROM="RosterPro <noreply@your-verified-domain.example>"
   ```
   No other code changes needed — `backend/src/services/emailService.js`
   already talks generic SMTP; SES is just another SMTP provider to it.

## 6. CloudWatch

The backend's `winston` logger (`backend/src/config/logger.js`) already
emits structured JSON in production — CloudWatch just needs the log lines
handed to it. Simplest approach: install the CloudWatch agent on the EC2
instance and point it at the Docker container's log output
(`docker logs` / `/var/lib/docker/containers/*/*.json.log`), or run the
container with `--log-driver=awslogs` directly:
```bash
docker run -d --name rosterpro-backend --restart always \
  --log-driver=awslogs \
  --log-opt awslogs-region=<your-region> \
  --log-opt awslogs-group=rosterpro-backend \
  --env-file /opt/rosterpro/backend.env \
  -p 4000:4000 \
  ghcr.io/<org>/<repo>/backend:latest
```
(Requires the EC2 instance's IAM role to include
`logs:CreateLogStream`/`logs:PutLogEvents` on that log group.)

Set a CloudWatch alarm on the backend's `/api/health` endpoint failing
(via a CloudWatch Synthetics canary, or a simple Lambda + EventBridge
schedule hitting it) so you find out about downtime before a user reports
it.

## 7. Backup & disaster recovery

See `infra/aws/backup.sh` and the restore steps below. If you're using
RDS (recommended, §1), prefer RDS's own automated backups and point-in-time
recovery over the self-managed script — it's one less thing to maintain
and RDS's restore process is simpler (a few clicks to spin up a new
instance from a snapshot). The `backup.sh` script is for a self-managed
Postgres (e.g. the `docker-compose.prod.yml` path, which runs Postgres in
a container rather than RDS) where there's no managed backup underneath
you.

### Restore process (self-managed Postgres, i.e. `backup.sh` path)

```bash
# 1. Stop the backend so nothing writes during restore
docker stop rosterpro-backend

# 2. Download the backup you want from S3
aws s3 cp s3://rosterpro-backups-<suffix>/rosterpro-2026-09-15.sql.gz .
gunzip rosterpro-2026-09-15.sql.gz

# 3. Restore into a fresh database (never restore directly over a live one —
#    always into a new DB name, verify it looks right, then swap)
docker exec -i rosterpro-db createdb -U rosterpro rosterpro_restored
docker exec -i rosterpro-db psql -U rosterpro rosterpro_restored < rosterpro-2026-09-15.sql

# 4. Point DATABASE_URL at rosterpro_restored, verify the app works
#    against it, THEN rename the databases to swap it into place.
```

### Restore process (RDS)

RDS Console → Snapshots → select the automated snapshot for the target
point in time → Restore. This creates a **new** RDS instance from that
snapshot (RDS never restores in-place) — update `DATABASE_URL` on the
backend to point at the new instance's endpoint once you've verified it,
then decommission the old one.

### What backup does NOT cover

Database backups don't include S3 attachment files — those need S3
versioning enabled (Bucket → Properties → Versioning) and, ideally,
cross-region replication for the attachments bucket if losing certificates
permanently would be a real compliance problem for your operation (it
likely is, for DGCA records) — that's a bucket setting, not something this
guide's script handles.
