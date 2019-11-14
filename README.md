New Project

### /infra

https://docs.microsoft.com/en-us/azure/cosmos-db/manage-mongodb-with-resource-manager

resourceGroupName=kh-ecomm-dev
location=westeurope
databaseName=dbdev
collection1Name=collection1

az group create --name $resourceGroupName --location $location
az group deployment create --resource-group $resourceGroupName \
  --template-file cloud/services.json \
  --parameters databaseName=$databaseName collection1Name=$collection1Name 