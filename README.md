# upload-inbox

A public, write-only drop box for photos and videos. Anyone with the link can upload. Nobody can list or download. Files land on your Unraid array as plain files:

```
/mnt/user/upload-inbox/
  2026-09-11/
    IMG_1234.mov
    clip.mp4          # same name twice in a day gets an HHMMSS- prefix
  .tusd-partial/        # uploads still in progress
```

- Backend: one Go binary embedding [tusd](https://github.com/tus/tusd) (resumable, chunked uploads). 500 MB max per file.
- Frontend: React + [Uppy](https://uppy.io). Mobile first, resumes after a dropped connection.
- Exposure: Cloudflare Tunnel. 90 MB chunks stay under the free tier's 100 MB request cap; files over 40 MB upload as 4 parallel parts (one per cloudflared HA connection).
- Language: follows the browser (all Uppy locale packs), or force one with `?lang=fr`.

## Unraid setup

### 1. Create the share

Shares → Add Share

| Setting | Value |
|---|---|
| Share name | `upload-inbox` |
| Primary storage | **Array** if your cache pool is a single SSD. Cache only if the pool is mirrored. |
| Secondary storage | Array (only when Primary is Cache) |
| Mover action | Cache → Array |
| Minimum free space | 20 GB |
| Export (SMB) | No, or Private with only your user |

Array-first means every upload is parity-protected the moment it finishes. The tunnel is the bottleneck, not the disks.

### 2. Cloudflare Tunnel

In your existing tunnel add a Public Hostname: subdomain `upload`, your domain, type `HTTP`, URL `http://<unraid-ip>:8085`.

On your cloudflared container set `TUNNEL_TRANSPORT_PROTOCOL=http2` (or pass `--protocol http2`). HTTP/2 beats the default QUIC for large uploads on a stable uplink. `docker logs <cloudflared> | grep "Registered tunnel connection"` should show `protocol=http2`.

### 3. Deploy

The image is built by GitHub Actions on every push to `main` and published to `ghcr.io/daniel-zarinski/upload-inbox-server:latest` (public).

1. Apps → install **Compose Manager**.
2. Docker tab → Compose → Add New Stack → name `upload-inbox` → paste `docker-compose.yml`; in its `.env` set `TZ=America/Edmonton`.
3. Compose Up.

Updating: push to `main`, wait for the action, then Compose Down / Compose Up (pulls the new image).

### 4. Test

- LAN: `http://<unraid-ip>:8085`
- Public: `https://upload.yourdomain.tld` from a phone on cellular.

Upload a video, then check `/mnt/user/upload-inbox/<today>/`.

## Day to day

- Browse uploads in the Unraid file manager or a private SMB export of the share.
- `.tusd-partial/` holds in-flight and abandoned uploads. Anything in there older than a couple of days is safe to delete.
- If a finished upload could not be moved (disk full, permissions), the server logs `KEEPING <id> in partial dir` and leaves the file and its `.info` sidecar there. Nothing is deleted until the destination is fully written and synced.
- The container runs as `nobody:users` (99:100), the same owner Unraid gives share files, so no permission fixes are needed.

## Local dev

```bash
cd web && npm install && npm run dev        # UI on :5173, proxies /files to :8080
cd server && go run .                       # needs INBOX_DIR=./inbox for a local folder
```

Build the image and run it against a local folder:

```bash
docker build -t upload-inbox-server .
docker run --rm -p 8085:8080 -v "$PWD/inbox:/upload-inbox" upload-inbox-server
```
