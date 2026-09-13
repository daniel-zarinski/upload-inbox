#!/usr/bin/env bash
# Deletes everything deploy.sh created: the whole resource group, including the storage account and any blobs not yet pulled.
set -euo pipefail
cd "$(dirname "$0")"
RG=upload-inbox
az group delete -n $RG --yes
rm -f .env
echo "deleted resource group $RG"
