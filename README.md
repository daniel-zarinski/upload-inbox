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
2. Docker tab → Compose → Add New Stack → name `upload-inbox` → paste `docker-compose.yml`; in its `.env` paste `.env.example` and fill in the values.
3. Compose Up.

Updating: push to `main`, wait for the action, then Compose Down / Compose Up (pulls the new image).

### 4. Test

- LAN: `http://<unraid-ip>:8085`
- Public: `https://upload.yourdomain.tld` from a phone on cellular.

Upload a video, then check `/mnt/user/upload-inbox/<today>/`.

## Azure (for uploaders in China)

Cloudflare Tunnel is throttled from mainland China. Azure East Asia (Hong Kong) isn't. The iOS app in `upload-app` uploads straight to Blob container `inbox` on a storage account there, with no server in between, and Unraid pulls finished files down every few minutes. Everything lives in one resource group, `upload-inbox`.

```
./azure/deploy.sh
```

Re-run anytime; it creates the account, the `inbox` and `inbox-dev` containers, and the `phone-write` SAS policy on each, then prints portal links, the rclone lines for the next step, and the container SAS to paste into `upload-app/app.json`. `./azure/destroy.sh` removes the whole resource group, uploads included, so pull them first.

### Phone notification from Azure

Instant "new upload" ping, sent by Event Grid the moment a blob lands (free at this volume). Create the HA automation below first, then:

```
./azure/notify.sh https://<ha>/api/webhook/upload-inbox-azure
```

The URL is kept in `azure/.env` (gitignored, next to `SA`), so a bare `./azure/notify.sh` re-applies it. Live setup: Event Grid subscription `ha-upload` on the storage account, HA automation "Upload inbox: new upload in Azure" with webhook id `upload-inbox-azure`, notifying `mobile_app_daniels_iphone`. With Nabu Casa remote UI the webhook URL is `https://<id>.ui.nabu.casa/api/webhook/upload-inbox-azure`.

Event Grid validates a new webhook with a handshake HA can't answer, so the automation turns it into a notification. Tap it within 5 minutes; that opens the validation URL and activates the subscription. Every later event is a real upload.

Each file gets its own notification, tagged with the blob path. The Unraid pull (next section) re-sends the same tag once the file is home, so the phone shows one entry per file that flips from "in Azure" to "synced".

```yaml
triggers:
  - trigger: webhook
    webhook_id: upload-inbox-azure
    allowed_methods: [POST]
    local_only: false
actions:
  - if:
      - condition: template
        value_template: "{{ trigger.json[0].eventType == 'Microsoft.EventGrid.SubscriptionValidationEvent' }}"
    then:
      - action: notify.mobile_app_<phone>
        data:
          message: Tap to activate the Azure upload webhook
          data:
            url: "{{ trigger.json[0].data.validationUrl }}"
    else:
      - repeat:
          for_each: "{{ trigger.json | map(attribute='subject') | map('regex_replace', '^.*/blobs/', '') | list }}"
          sequence:
            - action: notify.mobile_app_<phone>
              data:
                title: In Azure
                message: "{{ repeat.item }}"
                data:
                  tag: "upload-{{ repeat.item }}"
                  group: upload-inbox
```

### Unraid pull

The `upload-inbox-pull` service in `docker-compose.yml` runs `rclone move` every 20 seconds. Blobs only become visible once fully committed, so no minimum age is needed; the list calls cost about $0.65 a month at Hot tier list pricing ($0.05 per 10k). Add the two lines `azure/LINKS.md` prints (`AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`) to the stack's `.env` next to `TZ`, then Compose Down / Compose Up.

`move` deletes from Azure after a verified copy. Blobs only appear once fully committed, so nothing half-written gets pulled. Check it with `docker logs upload-inbox-pull`.

The live automation is "Upload inbox: synced to Unraid" (webhook id `upload-inbox`). To set it up, set `HA_WEBHOOK_URL` in the stack `.env` to a Home Assistant webhook URL. After each pull that moved files the service POSTs `{"files":["<path>", ...]}` there, within about half a minute of the upload. The automation reuses the Azure one's tag, so the existing notification is replaced in place:

```yaml
triggers:
  - trigger: webhook
    webhook_id: upload-inbox
    allowed_methods: [POST]
    local_only: false
actions:
  - repeat:
      for_each: "{{ trigger.json.files }}"
      sequence:
        - action: notify.mobile_app_<phone>
          data:
            title: Synced to Unraid
            message: "{{ repeat.item }}"
            data:
              tag: "upload-{{ repeat.item }}"
              group: upload-inbox
```

### Notes

- Cost: storage is cents, egress to your house is about $0.10/GB.
- Revoking a leaked SAS: delete the `phone-write` policy on the container (`az storage container policy delete`), change `POLICY` in `deploy.sh`, re-run it, and paste the new SAS into `app.json`. Recreating the policy under the same name would make the old SAS valid again, and a later expiry does not invalidate it either. Rotating the account key also works but breaks the Unraid pull until its `.env` is updated.

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
