
#  Create Cluster - Community solutions, Simple Cluster no additional security
# Additiomal - No System Pool, ACR - Basic, Contor cert-mana & external-dns

# Create Resource Group 

export AKS_NAME=basic-dev-k8s
export AKS_RG=${AKS_NAME}-rg
export AZ_DNSZONE_ID=/subscriptions/95efa97a-9b5d-4f74-9f75-a3396e23344d/resourceGroups/kh-common/providers/Microsoft.Network/dnszones/labhome.biz

az group create -l WestEurope -n ${AKS_RG} 

# Deploy template with in-line parameters 
az deployment group create -g ${AKS_RG}  --template-uri https://github.com/Azure/Aks-Construction/releases/download/0.3.0-preview/main.json --parameters \
	resourceName=${AKS_NAME} \
	kubernetesVersion=1.20.9 \
	agentCount=2 \
	JustUseSystemPool=true \
	agentVMSize=Standard_DS3_v2 \
	registries_sku=Basic \
	acrPushRolePrincipalId=$(az ad signed-in-user show --query objectId --out tsv) \
	dnsZoneId=${AZ_DNSZONE_ID}


export APPNAME=azkhdevshop
az group create -n ${APPNAME}-rg -l westeurope

export DEPLOY_OUTPUT=$(az deployment group create -g ${APPNAME}-rg  --template-file ./az-device.bicep  --parameters name=${APPNAME} --query [properties.outputs.cosmosConnectionURL.value,properties.outputs.storageKey.value,properties.outputs.storagedownloadSAS.value] -o tsv)
export MONGO_DB=$(echo $DEPLOY_OUTPUT | cut -f 1 -d ' ')
export STORAGE_MASTER_KEY=$(echo $DEPLOY_OUTPUT | cut -f 2 -d ' ')
export STORAGE_DOWNLOAD_SAS=$(echo $DEPLOY_OUTPUT | cut -f 3 -d ' ')

#"mongodb://${APPNAME}:$(az cosmosdb keys list -g ${APPNAME}-rg -n ${APPNAME} --query primaryMasterKey -o tsv)@${APPNAME}.mongo.cosmos.azure.com:10255/az-shop?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@${APPNAME}@"
export REACT_APP_FACTORY_PORT=9091
export REACT_APP_ORDERING_PORT=9090
export STORAGE_ACCOUNT=$APPNAME
export STORAGE_CONTAINER=az-shop-images

## Get local B2C values from local file (not in repo)
source ./web/.env

export ACRNAME=$(az acr list -g ${AKS_RG} --query [0].name -o tsv)

az acr build -r $ACRNAME -t az-device-shop/web:0.1.0  -f ./web/Dockerfile .
az acr build -r $ACRNAME -t az-device-shop/factory:0.1.0  -f ./factory/Dockerfile .
az acr build -r $ACRNAME -t az-device-shop/ordering:0.1.0  -f ./ordering/Dockerfile .


export APP_NAME="az-shop"
export APP_DOMAIN="labhome.biz"
export AZSHOP_NS=$APP_NAME
export APP_HOST_URL="https://${APP_NAME}.${APP_DOMAIN}"

kubectl create ns $AZSHOP_NS

# upgrade
# uninstall
# install
helm upgrade --install ${APP_NAME} ./helm/az-device-shop --namespace  ${AZSHOP_NS} \
  --set global.registryHost="${ACRNAME}.azurecr.io/" \
  --set global.env.MONGO_DB="${MONGO_DB}" \
  --set global.env.STORAGE_ACCOUNT="${STORAGE_ACCOUNT}" \
  --set global.env.STORAGE_CONTAINER="${STORAGE_CONTAINER}" \
  --set global.env.STORAGE_MASTER_KEY="${STORAGE_MASTER_KEY}" \
  --set global.env.STORAGE_DOWNLOAD_SAS="${STORAGE_DOWNLOAD_SAS}" \
  --set global.env.APP_HOST_URL="${APP_HOST_URL}" \
  --set global.ingressDomain="${APP_DOMAIN}" \
  --set az-device-shop-web.env.B2C_RESETPWD_POLICY="${B2C_RESETPWD_POLICY}" \
  --set az-device-shop-web.env.B2C_TENANT="${B2C_TENANT}" \
  --set az-device-shop-web.env.B2C_CLIENT_SECRET="${B2C_CLIENT_SECRET}" \
  --set az-device-shop-web.env.B2C_SIGNIN_POLICY="${B2C_SIGNIN_POLICY}" \
  --set az-device-shop-web.env.B2C_CLIENT_ID="${B2C_CLIENT_ID}" \
  --set az-device-shop-web.image.tab="0.1.0" \
  --set az-device-shop-ordering.image.tab="0.1.0" \
  --set az-device-shop-factory.image.tab="0.1.0"


## Testing cert-manager
# Is the certificate ready
 kubectl describe certificate chart-example-tls -n ${AZSHOP_NS}
# If not look at events
 kubectl get events -n cert-manager