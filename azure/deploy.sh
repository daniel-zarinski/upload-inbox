#!/usr/bin/env bash
# Provisions the Blob storage the iOS app uploads to. One account per region, all in one resource
# group. LOC=eastasia (Hong Kong, default) or LOC=japaneast (Tokyo). Idempotent: re-run freely.
set -euo pipefail
cd "$(dirname "$0")"

RG=upload-inbox
LOC=${LOC:-eastasia}
# The app's SAS is issued against this stored access policy. To revoke a leaked SAS, delete the
# policy, change this name, re-run, and re-issue: a SAS whose policy no longer exists is rejected.
POLICY=phone-write

# Storage account names are global; pick once per region, remember as SA_<loc> in .env (gitignored).
[ -f .env ] && source .env
VAR=SA_$LOC
SA=${!VAR:-uploadinbox$(od -An -N4 -tx4 /dev/urandom | tr -d " ")}
grep -q "^$VAR=" .env 2>/dev/null || echo "$VAR=$SA" >> .env

az group show -n $RG -o none 2>/dev/null || az group create -n $RG -l $LOC -o none   # RG location is fixed at creation; accounts pick their own
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false -o none
KEY=$(az storage account keys list -n $SA -g $RG --query '[0].value' -o tsv)

for C in inbox inbox-dev; do
  az storage container create -n $C --account-name $SA --account-key "$KEY" -o none
  az storage container policy show -c $C -n $POLICY --account-name $SA --account-key "$KEY" -o none 2>/dev/null ||
    az storage container policy create -c $C -n $POLICY --permissions cw --expiry 2030-01-01T00:00:00Z \
      --account-name $SA --account-key "$KEY" -o none
done

# Auto-delete. inbox-dev is simulator noise. inbox is a safety net if the Unraid pull is down for
# two weeks; the pull normally empties it within minutes. Lifecycle runs daily, so "1" means 24-48 h.
# Soft delete keeps anything deleted (by rclone or these rules) recoverable for 7 days.
az storage account management-policy create --account-name $SA -g $RG -o none --policy '{"rules":[
  {"name":"expire-dev","type":"Lifecycle","definition":{"filters":{"blobTypes":["blockBlob"],"prefixMatch":["inbox-dev/"]},"actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":1}}}}},
  {"name":"expire-inbox","type":"Lifecycle","definition":{"filters":{"blobTypes":["blockBlob"],"prefixMatch":["inbox/"]},"actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":14}}}}}]}'
az storage account blob-service-properties update --account-name $SA -g $RG --enable-delete-retention true --delete-retention-days 7 -o none

SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
P="https://portal.azure.com/#@$TENANT/resource/subscriptions/$SUB/resourceGroups/$RG"
sas() { az storage container generate-sas -n $1 --policy-name $POLICY --account-name $SA --account-key "$KEY" -o tsv --only-show-errors; }
SAS_INBOX=$(sas inbox)
SAS_DEV=$(sas inbox-dev)

# Stack .env at the repo root (gitignored) for Unraid Compose Manager: eastasia fills the first rclone
# slot, any other region the _2 slot. ponytail: two slots; a third region needs a slot map.
ENV=../.env; [ -f $ENV ] || cp ../.env.example $ENV
S=$([ $LOC = eastasia ] || echo _2)
for kv in AZURE_STORAGE_ACCOUNT$S=$SA AZURE_STORAGE_KEY$S=$KEY; do
  k=${kv%%=*}; grep -q "^$k=" $ENV && sed -i '' "s|^$k=.*|$kv|" $ENV || echo "$kv" >> $ENV
done

# LINKS.<loc>.md is gitignored: it holds the storage key for the Unraid rclone step.
cat > LINKS.$LOC.md <<OUT
# upload-inbox on Azure ($LOC)

- [Browse uploaded blobs]($P/providers/Microsoft.Storage/storageAccounts/$SA/containersList)
- [Storage account]($P/providers/Microsoft.Storage/storageAccounts/$SA)
- [Resource group]($P/overview)
- [Cost]($P/costanalysis)

Unraid Compose Manager stack .env (already written to ../.env; paste that file, then Compose Down / Up):

    AZURE_STORAGE_ACCOUNT=$SA
    AZURE_STORAGE_KEY=$KEY

Storage Explorer on the Mac (plug icon → Storage account → Connection string):

    $(az storage account show-connection-string -n $SA -g $RG --query connectionString -o tsv)

Container SAS for upload-app/app.json (accountUrl https://$SA.blob.core.windows.net):

    inbox:     $SAS_INBOX
    inbox-dev: $SAS_DEV
OUT
cat LINKS.$LOC.md
