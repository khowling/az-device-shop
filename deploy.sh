

NAME=azdevshop001
az group create -n ${NAME}-rg -l westeurope

export STORAGE_MASTER_KEY=$(az deployment group create -g ${NAME}-rg  --template-file ./deploy/az-device.bicep  --parameters name=${NAME} --query properties.outputs.storageKey.value -o tsv)
export MONGO_DB="mongodb://${NAME}:$(az cosmosdb keys list -g ${NAME}-rg -n ${NAME} --query primaryMasterKey -o tsv)@${NAME}.mongo.cosmos.azure.com:10255/az-shop?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@${NAME}@"
export REACT_APP_FACTORY_PORT=9091
export REACT_APP_ORDERING_PORT=9090
export STORAGE_ACCOUNT=$NAME
export STORAGE_CONTAINER=az-shop-images

## Get local B2C values from local file (not in repo)
source ./web/.env


export ACRNAME=khcommon
az acr login -n $ACRNAME
cd ../web
az acr build --registry $ACRNAME --image az-device-shop/web:0.1.0 -f Dockerfile.root ../

cd ../ordering
az acr build --registry $ACRNAME --image az-device-shop/ordering:0.1.0 -f Dockerfile.root ../

cd ../factory
az acr build --registry $ACRNAME --image az-device-shop/factory:0.1.0 -f Dockerfile.root ../


### or
cd ../web && docker build -t ${ACRNAME}.azurecr.io/az-device-shop/web:0.1.0 -f Dockerfile.root ../
cd ../ordering && docker build -t ${ACRNAME}.azurecr.io/az-device-shop/ordering:0.1.0 -f Dockerfile.root ../
cd ../factory && docker build -t ${ACRNAME}.azurecr.io/az-device-shop/factory:0.1.0 -f Dockerfile.root ../
docker push ${ACRNAME}.azurecr.io/az-device-shop/web:0.1.0
docker push ${ACRNAME}.azurecr.io/az-device-shop/ordering:0.1.0
docker push ${ACRNAME}.azurecr.io/az-device-shop/factory:0.1.0

export APP_NAME="az-shop"
export APP_DOMAIN="labhome.biz"
export AZSHOP_NS=$APP_NAME
export APP_HOST_URL="https://${APP_NAME}.${APP_DOMAIN}"

kubectl create ns $AZSHOP_NS

# upgrade
# uninstall
# install
helm install ${APP_NAME} ./helm/az-device-shop --namespace  ${AZSHOP_NS} \
  --set global.registryHost="${ACRNAME}.azurecr.io/" \
  --set global.env.MONGO_DB="${MONGO_DB}" \
  --set global.env.STORAGE_ACCOUNT="${STORAGE_ACCOUNT}" \
  --set global.env.STORAGE_CONTAINER="${STORAGE_CONTAINER}" \
  --set global.env.STORAGE_MASTER_KEY="${STORAGE_MASTER_KEY}" \
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



or local

node

docker build  -t $ACRNAME.azurecr.io/az-device-shop/web:0.1.0 -f Dockerfile.root ../