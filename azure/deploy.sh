#!/usr/bin/env bash
# Deploys upload-inbox to Azure Container Apps in East Asia (Hong Kong).
# Everything lands in one resource group. Idempotent: re-run freely.
set -euo pipefail
cd "$(dirname "$0")"

RG=upload-inbox
LOC=eastasia
SHARE=upload-inbox
IMAGE=ghcr.io/daniel-zarinski/upload-inbox-server:latest

# Storage account names are global; pick once, remember in .env (gitignored).
[ -f .env ] && source .env
SA=${SA:-uploadinbox$(od -An -N4 -tx4 /dev/urandom | tr -d " ")}
echo "SA=$SA" > .env

az group create -n $RG -l $LOC -o none
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false -o none
az storage share-rm create -g $RG --storage-account $SA -n $SHARE --quota 100 -o none
KEY=$(az storage account keys list -n $SA -g $RG --query '[0].value' -o tsv)

# --logs-destination none: no Log Analytics workspace; `az containerapp logs show` still streams.
az containerapp env show -n $RG -g $RG -o none 2>/dev/null ||
  az containerapp env create -n $RG -g $RG -l $LOC --logs-destination none -o none
until [ "$(az containerapp env show -n $RG -g $RG --query properties.provisioningState -o tsv)" = Succeeded ]; do
  echo "waiting for environment..."; sleep 15
done
az containerapp env storage set -n $RG -g $RG --storage-name inbox \
  --azure-file-account-name $SA --azure-file-account-key "$KEY" \
  --azure-file-share-name $SHARE --access-mode ReadWrite -o none

# max-replicas 1: tusd locks are in-process. min-replicas 0: sleeps when idle.
az containerapp show -n $RG -g $RG -o none 2>/dev/null ||
  az containerapp create -n $RG -g $RG --environment $RG --image $IMAGE \
    --target-port 8080 --ingress external --min-replicas 0 --max-replicas 1 \
    --cpu 0.5 --memory 1Gi --env-vars TZ=America/Edmonton -o none
az containerapp update -n $RG -g $RG --yaml volume.yaml -o none

FQDN=$(az containerapp show -n $RG -g $RG --query properties.configuration.ingress.fqdn -o tsv)
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
P="https://portal.azure.com/#@$TENANT/resource/subscriptions/$SUB/resourceGroups/$RG"

# LINKS.md is gitignored: it holds the storage key for the Unraid rclone step.
cat > LINKS.md <<OUT
# upload-inbox on Azure

- [Upload page](https://$FQDN)
- [Browse uploaded files]($P/providers/Microsoft.Storage/storageAccounts/$SA/fileList) (File shares → $SHARE)
- [Container app]($P/providers/Microsoft.App/containerApps/$RG)
- [Container app logs]($P/providers/Microsoft.App/containerApps/$RG/logstream)
- [Storage account]($P/providers/Microsoft.Storage/storageAccounts/$SA)
- [Resource group]($P/overview)
- [Cost]($P/costanalysis)

Finder SMB mount does not work from home: the ISP blocks port 445. Use the browse link or Storage Explorer.

On Unraid, once, then Compose Up the stack (upload-inbox-pull service does the rest):

    docker run --rm --user 99:100 -v /mnt/user/appdata/rclone:/config/rclone rclone/rclone config create azfiles azurefiles account $SA key '$KEY' share_name $SHARE

Storage Explorer on the Mac (plug icon → Storage account → Connection string):

    $(az storage account show-connection-string -n $SA -g $RG --query connectionString -o tsv)
OUT
cat LINKS.md
