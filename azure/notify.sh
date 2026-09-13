#!/usr/bin/env bash
# Event Grid -> Home Assistant: POSTs a BlobCreated event to HA seconds after the app finishes an upload.
# Usage: ./notify.sh [https://<ha>/api/webhook/<id>]   URL is remembered in .env (gitignored); re-run with a new one to change it.
# Event Grid validates a new webhook with a handshake HA can't answer. The HA automation in the README
# turns that handshake into a phone notification; tap it within 5 minutes and the subscription goes active.
set -euo pipefail
cd "$(dirname "$0")"
RG=upload-inbox
[ -f .env ] && source .env
URL=${1:-${HA_WEBHOOK_URL:?usage: notify.sh HA_WEBHOOK_URL (or set it in azure/.env)}}
grep -q '^HA_WEBHOOK_URL=' .env 2>/dev/null && sed -i '' "s|^HA_WEBHOOK_URL=.*|HA_WEBHOOK_URL=$URL|" .env || echo "HA_WEBHOOK_URL=$URL" >> .env
SRC=$(az storage account list -g $RG --query '[0].id' -o tsv)

az eventgrid event-subscription create -n ha-upload --source-resource-id "$SRC" --endpoint "$URL" \
  --included-event-types Microsoft.Storage.BlobCreated \
  --subject-begins-with /blobServices/default/containers/inbox/blobs/ \
  --event-ttl 60 -o none || true   # fails while validation is pending; that's expected
echo "state: $(az eventgrid event-subscription show -n ha-upload --source-resource-id "$SRC" --query provisioningState -o tsv)"
echo "AwaitingManualAction = tap the HA notification within 5 minutes, then re-run this to confirm Succeeded."
