#!/bin/sh
#set -x
#
[ "$#" -eq 1 ] || {
    echo "aks-name parameter required"
    exit 1
}


aks=$1
export AKS_RG=${aks}-rg

## Load in settings from dependencies for helm chart
FILE=".env_azure"
source $FILE

export ACRNAME=$(az acr list -g ${AKS_RG}-rg --query [0].name -o tsv)

az acr build -r $ACRNAME -t az-device-shop/web:0.1.0  -f ./web/Dockerfile .
az acr build -r $ACRNAME -t az-device-shop/factory:0.1.0  -f ./factory/Dockerfile .
az acr build -r $ACRNAME -t az-device-shop/ordering:0.1.0  -f ./ordering/Dockerfile .


export APP_DOMAIN="labhome.biz"

export AZSHOP_NS=$APPNAME
kubectl create ns $AZSHOP_NS

# upgrade
# uninstall
# install
helm upgrade --install ${APPNAME} ./helm/az-device-shop --namespace  ${AZSHOP_NS} \
  --set global.registryHost="${ACRNAME}.azurecr.io/" \
  --set global.env.MONGO_DB="${MONGO_DB}" \
  --set global.env.STORAGE_ACCOUNT="${STORAGE_ACCOUNT}" \
  --set global.env.STORAGE_CONTAINER="${STORAGE_CONTAINER}" \
  --set global.env.STORAGE_MASTER_KEY="${STORAGE_MASTER_KEY}" \
  --set global.env.STORAGE_DOWNLOAD_SAS="${STORAGE_DOWNLOAD_SAS}" \
  --set az-device-shop-web.ingressHost="${APPNAME}" \
  --set az-device-shop-web.ingressDomain="${APP_DOMAIN}" \
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
# kubectl describe certificate chart-example-tls -n ${AZSHOP_NS}
# If not look at events
# kubectl get events -n cert-manager