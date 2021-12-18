#set -x
#
export AZ_APPNAME=kh-dev-az-shop-01
az group create -n ${AZ_APPNAME}-rg -l westeurope >/dev/null

DEPLOY_OUTPUT=$(az deployment group create -g ${AZ_APPNAME}-rg  --template-file ./deploy/az-device.bicep  --parameters name=${AZ_APPNAME} --query [properties.outputs.cosmosConnectionURL.value,properties.outputs.storageKey.value,properties.outputs.storagedownloadSAS.value,properties.outputs.storageAccountName.value] -o tsv)

export AZ_MONGO_DB=$(echo $DEPLOY_OUTPUT | cut -f 1 -d ' ')
export AZ_STORAGE_MASTER_KEY=$(echo $DEPLOY_OUTPUT | cut -f 2 -d ' ')
export AZ_STORAGE_DOWNLOAD_SAS=$(echo $DEPLOY_OUTPUT | cut -f 3 -d ' ')
export AZ_STORAGE_ACCOUNT=$(echo $DEPLOY_OUTPUT | cut -f 4 -d ' ')
export AZ_STORAGE_CONTAINER=az-shop-images
export AZ_USE_COSMOS=true

#"mongodb://${APPNAME}:$(az cosmosdb keys list -g ${APPNAME}-rg -n ${APPNAME} --query primaryMasterKey -o tsv)@${APPNAME}.mongo.cosmos.azure.com:10255/az-shop?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@${APPNAME}@"


FILE=".env_azure"
printenv | grep AZ_.*= | sed 's/AZ_\([^=]*=\)\(.*\)/\1"\2"/' # > $FILE
cat ./.env_azure_prereqs #>> $FILE