#!/usr/bin/env bash
# Provisions the Blob storage the iOS app uploads to, in East Asia (Hong Kong).
# Everything lands in one resource group. Idempotent: re-run freely.
set -euo pipefail
cd "$(dirname "$0")"

RG=upload-inbox
LOC=eastasia
# The app's SAS is issued against this stored access policy. To revoke a leaked SAS, delete the
# policy, change this name, re-run, and re-issue: a SAS whose policy no longer exists is rejected.
POLICY=phone-write

# Storage account names are global; pick once, remember in .env (gitignored).
[ -f .env ] && source .env
SA=${SA:-uploadinbox$(od -An -N4 -tx4 /dev/urandom | tr -d " ")}
grep -q "^SA=" .env 2>/dev/null || echo "SA=$SA" >> .env

az group create -n $RG -l $LOC -o none
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false -o none
KEY=$(az storage account keys list -n $SA -g $RG --query '[0].value' -o tsv)

for C in inbox inbox-dev; do
  az storage container create -n $C --account-name $SA --account-key "$KEY" -o none
  az storage container policy show -c $C -n $POLICY --account-name $SA --account-key "$KEY" -o none 2>/dev/null ||
    az storage container policy create -c $C -n $POLICY --permissions cw --expiry 2030-01-01T00:00:00Z \
      --account-name $SA --account-key "$KEY" -o none
done

SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
P="https://portal.azure.com/#@$TENANT/resource/subscriptions/$SUB/resourceGroups/$RG"
sas() { az storage container generate-sas -n $1 --policy-name $POLICY --account-name $SA --account-key "$KEY" -o tsv --only-show-errors; }
SAS_INBOX=$(sas inbox)
SAS_DEV=$(sas inbox-dev)

# LINKS.md is gitignored: it holds the storage key for the Unraid rclone step.
cat > LINKS.md <<OUT
# upload-inbox on Azure

- [Browse uploaded blobs]($P/providers/Microsoft.Storage/storageAccounts/$SA/containersList)
- [Storage account]($P/providers/Microsoft.Storage/storageAccounts/$SA)
- [Resource group]($P/overview)
- [Cost]($P/costanalysis)

Unraid Compose Manager stack .env (then Compose Down / Up):

    AZURE_STORAGE_ACCOUNT=$SA
    AZURE_STORAGE_KEY=$KEY

Storage Explorer on the Mac (plug icon → Storage account → Connection string):

    $(az storage account show-connection-string -n $SA -g $RG --query connectionString -o tsv)

Container SAS for upload-app/app.json (accountUrl https://$SA.blob.core.windows.net):

    inbox:     $SAS_INBOX
    inbox-dev: $SAS_DEV
OUT
cat LINKS.md
