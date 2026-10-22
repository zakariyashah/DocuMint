# DocuMint — Production Deployment Guide & Readiness Checklist

This document details the configuration, persistence architecture, environment variables, and production deployment procedures for **DocuMint: AI-Powered Document Intelligence Assistant**.

---

## 1. Architecture & Technology Footprint

DocuMint is designed to be **lightweight, self-contained, and performant** without unnecessary operational overhead:

- **Framework**: Django 6.1 (Python 3.11 - 3.13)
- **Database**: SQLite (`db.sqlite3` with Write-Ahead Logging `WAL` mode supported)
- **Vector Search**: FAISS (`IndexFlatIP`) normalized cosine semantic index
- **Embeddings**: Sentence-Transformers `all-MiniLM-L6-v2` (in-memory cached, pre-warmed on server startup)
- **Generative LLM**: Google Gemini 2.5/Flash via official `google-genai` SDK
- **Frontend**: Responsive HTML5, Vanilla CSS3 (custom tokens), Bootstrap 5.3, marked.js

DocuMint deliberately does **not** introduce external infrastructure dependencies like Redis, Celery, Docker daemons, or separate vector databases (e.g. Pinecone/Milvus), keeping maintenance simple and memory footprint minimal (~250MB RAM).

---

## 2. Environment Variables & Security

All sensitive credentials and environment-specific variables are read strictly via environment variables or `.env`.

> [!CAUTION]
> Never commit `.env` or hardcode API keys in templates or JavaScript files. Ensure `.env` is listed in `.gitignore`.

### Required & Optional Variables

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `SECRET_KEY` | **Yes** | — | Unique Django secret cryptographic key for production sessions and CSRF tokens. |
| `DEBUG` | **Yes** | `False` | Must be `False` in production to prevent leaking tracebacks. |
| `ALLOWED_HOSTS` | **Yes** | `127.0.0.1,localhost` | Comma-separated list of valid domain names/IPs (e.g. `documint.yourdomain.com`). |
| `GEMINI_API_KEY` | **Yes** | — | Google Gemini API key used for generation and executive synthesis. |
| `GEMINI_MODEL` | No | `gemini-flash-lite-latest` | Preferred Gemini model. DocuMint auto-cascades to fallback models if unavailable. |
| `RETRIEVAL_SCORE_THRESHOLD` | No | `0.20` | Minimum cosine similarity threshold for FAISS semantic retrieval grounding. |
| `TOP_K_CHUNKS` | No | `4` | Top semantic chunks retrieved per question. |
| `CHUNK_SIZE` | No | `500` | Target character length for document text chunking. |
| `CHUNK_OVERLAP` | No | `100` | Overlap character count between consecutive chunks. |

---

## 3. Persistent Storage Requirements

DocuMint requires persistent storage across web process restarts for three specific stateful directories:

1. **`db.sqlite3`** (SQLite Database):
   - Stores user documents, metadata, page numbers, character offsets, extracted text chunks, and chat history.
   - *Requirement*: Persistent disk with POSIX file-locking support.

2. **`/media/`** (Uploaded Document Files):
   - Stores the uploaded raw PDF and TXT files for auditing and re-processing.
   - *Requirement*: Persistent disk volume or S3/GCS bucket mount.

3. **`/vector_store/`** (FAISS Vector Indexes):
   - Stores serialized `.faiss` vector indexes and `.json` ID mappings for each document.
   - *Requirement*: Fast local SSD/volume storage for sub-millisecond index lookups.

### Hosting Limitations Notice (Ephemeral Cloud Platforms)

> [!WARNING]
> Ephemeral PaaS platforms (e.g., free tiers of Render, Heroku, Railway, or Google Cloud Run) wipe local container disks on redeploy or container sleep.
>
> If deploying to such hosts, you **must**:
> - Mount a **Persistent Disk / Volume** (e.g., Render Persistent Disk, Railway Volume, AWS EBS) mounted at the project root or symlinked to `media/`, `vector_store/`, and the folder holding `db.sqlite3`.
> - Alternatively, configure Django's `DATABASES` to point to a managed PostgreSQL instance and use `django-storages` for Cloud Storage.

---

## 4. Production WSGI Server Configuration

**Never run `python manage.py runserver` in production.** The development server is single-threaded, unbuffered, and not hardened against denial-of-service vectors.

Use **Gunicorn** with **Uvicorn** workers or standard synchronous workers:

```bash
# Install Gunicorn and Whitenoise (if serving static files directly)
pip install gunicorn whitenoise

# Run with 2-4 worker processes (suited for 1-2 vCPUs)
gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --threads 4 \
    --timeout 60 \
    --access-logfile - \
    --error-logfile -
```

---

## 5. Static Files Configuration

DocuMint is configured with Django's `staticfiles` app:

```bash
# 1. Collect all static assets (CSS, JS, icons) into staticfiles/
python manage.py collectstatic --noinput

# 2. Verify staticfiles directory is created and populated
ls staticfiles/assistant/
```

If deploying behind Nginx or Caddy, configure the web server to directly serve `/static/` from `c:/.../staticfiles/`.

---

## 6. Pre-Flight Deployment Checklist

Before submitting or launching the production application:

- [x] **Secrets**: `GEMINI_API_KEY` and `SECRET_KEY` configured via environment variables.
- [x] **Debug Disabled**: `DEBUG=False` set in `.env` or container environment.
- [x] **Allowed Hosts**: `ALLOWED_HOSTS` matches production domain / IP.
- [x] **Git Hygiene**: `.env`, `db.sqlite3`, `media/`, `vector_store/`, and `staticfiles/` ignored in `.gitignore`.
- [x] **Static Assets**: `python manage.py collectstatic --noinput` executed successfully.
- [x] **Embedding Model Pre-warming**: Model loads on startup in background daemon thread (`apps.py`) to eliminate first-query latency.
- [x] **Security**: No API keys or passwords exposed in client-side HTML, CSS, or JavaScript.
- [x] **Database Migrations**: `python manage.py migrate` executed cleanly.
- [x] **Test Suite**: `python manage.py test` passes 100% of unit and integration test suites.

---

## 7. Hosting Live with Cloudflare

Because DocuMint is a full-stack Python AI application (utilizing Django, PyTorch, FAISS vector indexes, and SQLite file locking), it cannot run directly inside **Cloudflare Pages** (which only runs static JavaScript/HTML on edge V8 isolates). 

However, Cloudflare provides two proven ways to host DocuMint live with enterprise-grade SSL, DDoS protection, and global CDN acceleration:

### Method A: Cloudflare Tunnel (`cloudflared`) — 100% Free & Live in 2 Minutes (Recommended)

Cloudflare Tunnel creates an encrypted outbound-only tunnel between your running DocuMint server and Cloudflare’s global edge network. No router port forwarding, static IP, or public firewall openings are required.

#### Step 1: Install `cloudflared`
- **Windows (PowerShell)**:
  ```powershell
  winget install --id Cloudflare.cloudflared
  # Or download direct binary from: https://github.com/cloudflare/cloudflared/releases/latest
  ```
- **macOS**:
  ```bash
  brew install cloudflared
  ```
- **Linux (Ubuntu/Debian)**:
  ```bash
  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i cloudflared.deb
  ```

#### Step 2: Start DocuMint Locally or on your Server
Ensure DocuMint is running on port 8000:
```powershell
python manage.py runserver 127.0.0.1:8000
```

#### Step 3: Launch Instant Free Cloudflare Tunnel
In a new terminal window, run:
```powershell
cloudflared tunnel --url http://127.0.0.1:8000
```
Cloudflare will output a public HTTPS URL:
```text
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://random-assigned-name.trycloudflare.com                                            |
+--------------------------------------------------------------------------------------------+
```
DocuMint is pre-configured with `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` for `*.trycloudflare.com`, so document uploads, chat queries, and authentication work immediately!

#### Step 4 (Optional): Bind to Your Own Custom Domain
If you have a domain managed in Cloudflare (e.g. `documint.yourdomain.com`):
1. Go to **Cloudflare Zero Trust Dashboard** > **Networks** > **Tunnels**.
2. Click **Create a Tunnel** > Choose **Cloudflared**.
3. Follow the one-line install command for your OS.
4. Under **Public Hostname**, configure:
   - Subdomain: `documint` (or domain of your choice)
   - Service: `HTTP`
   - URL: `localhost:8000`
5. Save. Your custom domain is now live worldwide with Cloudflare SSL and WAF protection.

---

### Method B: 24/7 Cloud Host (Render/Railway/Fly.io/VPS) + Cloudflare Proxy

If you want DocuMint online 24/7 without keeping your personal computer running:

1. **Deploy DocuMint to a Python/Docker Host**:
   - Free/cheap hosts supporting persistent storage: **Render**, **Railway**, **Fly.io**, or a **Hetzner / DigitalOcean VPS**.
   - Make sure to mount persistent volumes for `db.sqlite3`, `media/`, and `vector_store/`.
2. **Point Your Domain to Cloudflare**:
   - Change your domain's nameservers to Cloudflare.
3. **Configure Cloudflare DNS with Proxy Enabled**:
   - Add a `CNAME` or `A` record pointing to your cloud host URL/IP.
   - Ensure the orange cloud icon (**Proxied**) is **ON**.
4. **Configure Cloudflare SSL/TLS**:
   - In Cloudflare Dashboard, set SSL/TLS encryption mode to **Full** or **Full (Strict)**.
5. **Update `.env` on your Cloud Host**:
   ```env
   DEBUG=False
   ALLOWED_HOSTS=documint.yourdomain.com
   CSRF_TRUSTED_ORIGINS=https://documint.yourdomain.com
   ```

