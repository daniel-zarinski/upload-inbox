#!/usr/bin/env bash
# Deletes everything deploy.sh created: the whole resource group, including uploads still on the share.
set -euo pipefail
cd "$(dirname "$0")"
RG=upload-inbox
az group delete -n $RG --yes
rm -f .env
echo "deleted resource group $RG"
