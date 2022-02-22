#!/bin/sh
#set -x
#
[ "$#" -eq 1 ] || {
    echo "application name required"
    exit 1
}

export AZ_APPNAME=$1
az group create -n ${AZ_APPNAME}-rg -l westeurope >/dev/null

DEPLOY_OUTPUT=$(az deployment group create -g ${AZ_APPNAME}-rg  --template-file ./workflows/az-device.bicep  --parameters name=${AZ_APPNAME} --query [properties.outputs.cosmosConnectionURL.value,properties.outputs.storageKey.value,properties.outputs.storagedownloadSAS.value,properties.outputs.storageAccountName.value] -o tsv)

export AZ_MONGO_DB=$(echo $DEPLOY_OUTPUT | cut -f 1 -d ' ')
export AZ_STORAGE_MASTER_KEY=$(echo $DEPLOY_OUTPUT | cut -f 2 -d ' ')
export AZ_STORAGE_DOWNLOAD_SAS=$(echo $DEPLOY_OUTPUT | cut -f 3 -d ' ')
export AZ_STORAGE_ACCOUNT=$(echo $DEPLOY_OUTPUT | cut -f 4 -d ' ')
export AZ_STORAGE_CONTAINER=az-shop-images
export AZ_USE_COSMOS=true


printenv | grep AZ_.*= | sed 's/AZ_\([^=]*=\)\(.*\)/\1\2/' 
