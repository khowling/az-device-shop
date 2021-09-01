

# Cloud Native - Azure Reference Application 

 _Work in progress_

Ecommerce - Azure Example application highlighting the following architectural patterns

 :heavy_check_mark:  Cloud agnostic, open-source, open-protocols
 :heavy_check_mark:  Server-side rendering for site performance and SEO  
 :heavy_check_mark:  Microservices with CRUD and Event Sourcing patterns. 
 :heavy_check_mark:  Cloud provider SLA backed persistance services  
 :heavy_check_mark:  Complete with devops toolchain, real-time Monitoring and analytics  

![frontpage](docs/frontpage.png)

## Target Architecture

![portal-image](docs/arch.png)


## Design Rationals

### Serivces Coupling

Questions:

Can independent services share a collection definition?  This is an antipattern for shared dependencies?
Can services call other services syncronously?  This is a antipattern for building reliable systems?
Can differnet services 'master' specific fields on a collection?


### Data Persistance

The Design of the application is highly influenced by the choice of the features of the chosen data persistance service, in this case, CosmosDB/Mongodb.

### Resilience

Infrastructure is unreliable, kubernetes services may move around.  Our services need to:
 * Be able to be interrupted & restarted without introducing inconsistancies, this means all methods need to be itempotent
 
No-SQL operations are not transational, and any operations can potentially be throttled, or be effected by transient service outages, Our services need to:
 * Use single CosmosDB operations per user-interaction when possible, if more that one operation is needed that mutates data, ensure itempotency
 * Any complex processing that needs to take place based on a user-interaction needs to be decoupled from the user-interaction, and a async method up updating the user as to the outcome of that processing.


### Partition Rational

Items in a container are divided into distinct subsets called __logical partitions__ based on the value of a partition key, 1 logical partition per distinct partition key value.  __partition keys__ are immutable  
The high volume data in the sotution is transational or telemetry data, each is assosiated with a user, and potentally a device.  The partition key needs to be related to the hierarchy of the user, or the device for maxiumu data distribution



## Detailed Deployment Instructions

_To be completed_

```
mongoimport --uri=$MONGO_DB -c products --mode upsert --file=./testing/testdata.json
```

## Provision Cloud Infra & Services


### Provisioning a cluster

Use the [AKS helper](https://azure.github.io/Aks-Construction) to provision your cluster, and configure the helper as follows:

Select you preferences for:
  * __Operations Principles__
  * __Security Principles__

Now, to configure the TLS Ingress, go into the __Addon Details__ tab

  In the section __Securely Expose your applications via Layer 7 HTTP(S) proxies__, select the following options, providing all the require information

  * __Create FQDN URLs for your applications using external-dns__
  * __Automatically Issue Certificates for HTTPS using cert-manager__


  __NOTE:__ In the section __CSI Secrets : Store Kubernetes Secrets in Azure Keyvault, using AKS Managed Identity__,  ensure the following option is selected: __Yes, provision a new Azure KeyVault & enable Secrets Store CSI Driver__.  Also, __Enable KeyVault Integration for TLS Certificates__ is selected, this will integrate Application Gateway access to KeyVault,  and 


Now, under the __Deploy__ tab, execute the commands to provision your complete environment. __NOTE__: Once complete, please relember to run the script on the __Post Configuration__ tab to complete the deployment.


###  Provision the Application dependencies

APPGROUP=az-shop-001
az group create -l westeurope -n $APPGROUP
az deployment group create -g az-k8s-hedw-rg  --template-file ./deploy/az-device.bicep  --parameters name=azdevshop001

##  Create Storage Account - for eventhub checkpointing, and ecommerce media
create 'Private' container for 'checkpointing'
create 'Blob' container (Read annonoumous)  for media
add POST&PUT CORS rules for : http://localhost:8000, with headers = *



https://docs.microsoft.com/en-us/azure/cosmos-db/manage-mongodb-with-resource-manager

resourceGroupName=kh-ecomm-dev
location=westeurope
databaseName=dbdev

az group create --name $resourceGroupName --location $location
ARM_OUTPUT=$(az group deployment create --resource-group $resourceGroupName \
    --template-file infra/services.json  \
    --parameters databaseName=$databaseName \
    --query "[properties.outputs.accountName.value,properties.outputs.documentDbPrimaryMasterKey.value]" \
    --output tsv)

if [ $? -eq 0 ] ; then
    out_array=($(echo $ARM_OUTPUT | tr " " "\n"))
    accountName=${out_array[0]}
    documentDbPrimaryMasterKey=${out_array[1]}
else
    echo "Create Infra failed"
    exit 1
fi

## local loop, setting up Mongo


A _replica set_ in MongoDB is a group of mongod processes that maintain a syncronised copy of the same data set to provide redundancy and high availability. 

Replicasets are required to allow the programmer to use the _Change Streams_ feature.

One member is deemed the _primary node_, receiving all write operations, while the other nodes are deemed secondary nodes.  The secondaries replicate the primary’s oplog and apply the operations to their data sets such that the secondaries’ data sets reflect the primary’s data set.

When a primary does not communicate with the other members for 10seconds, an eligible secondary calls for an election to nominate itself as the new primary


```
docker volume create --name=mongodata
## its not a sharded cluster, its a Replica Set single instance, 
docker run --restart always --name mongo_dev -v mongodata:/data/db -d -p 27017:27017 mongo --replSet rs0 

in mongo cli, run:  >  rs.initiate({ _id: "rs0", members: [ { _id: 0, host : "localhost:27017" } ] } ))
```

```
mongoimport --db dbdev --collection products --jsonArray --file ./testing/testdata_products.json
```

## Deploy App to Azure



```
APP_NAME=az-shop
APP_HOST_URL="https://${APP_NAME}.labhome.biz"
```

### Deploy Mongo

NOTE: At the moment we are using mongo 4 API for the oplog, so installing the mongo chat, will modify to use Cosmos Mongo API once version4 is available.

```
AZSHOP_NS=${APP_NAME}
AZSHOP_DBUSERNAME=az-shop
AZSHOP_DBNAME=az-shop

# Get mongo chart
helm repo add bitnami https://charts.bitnami.com/bitnami

kubectl create ns $AZSHOP_NS

helm install mongo-demo bitnami/mongodb --namespace  $AZSHOP_NS \
 --set architecture="replicaset" \
 --set persistence.storageClass="managed-premium" \
 --set auth.username=${AZSHOP_DBUSERNAME},auth.database=${AZSHOP_DBNAME}

AZSHOP_DBPASSWD=$(kubectl get secret --namespace $AZSHOP_NS mongo-demo-mongodb -o jsonpath="{.data.mongodb-password}" | base64 --decode)

##  Need to escape the comma for the helm set cli :(
export MONGO_URL="mongodb://${AZSHOP_DBUSERNAME}:${AZSHOP_DBPASSWD}@mongo-demo-mongodb-0.mongo-demo-mongodb-headless.${AZSHOP_NS}.svc.cluster.local:27017\,mongo-demo-mongodb-1.mongo-demo-mongodb-headless.${AZSHOP_NS}.svc.cluster.local:27017/${AZSHOP_DBUSERNAME}?replicaSet=rs0"

```

### Deploy Storage Account

Used for catalog images

```
# Create Storage Account
AZSHOP_RG=${AZSHOP_NS}-rg
STORAGE_ACCOUNT="azshopstorage"
STORAGE_CONTAINER="images"

az group create -n $AZSHOP_RG -l westeurope
az storage account create -n $STORAGE_ACCOUNT -g $AZSHOP_RG -l westeurope --sku Standard_LRS

STORAGE_MASTER_KEY=$(az storage account keys list -n $STORAGE_ACCOUNT -g $AZSHOP_RG --query "[0].value" -o tsv)
az storage container create --public-access blob -n $STORAGE_CONTAINER --account-name $STORAGE_ACCOUNT --account-key $STORAGE_MASTER_KEY


az storage cors add --methods GET HEAD MERGE OPTIONS POST PUT --allowed-headers 'x-ms-*,Access-Control*' --exposed-headers '*' --origins ${APP_HOST_URL} --services b --account-name ${STORAGE_ACCOUNT} --account-key ${STORAGE_MASTER_KEY}

```

# Link to B2C

Unfortunatly, Azure AD B2C cannot be provisioned using automation, so follow these manual steps:

1. Create a B2C Tenent (using portal at https://portal.azure.com)

```
B2C_TENANT="<my_b2c_name_exclude_domain>"
```

2. Register a B2C App, select
 * Account Type: Accounts in any identity provider or organizational directory
 * Redirect URI : <Web> ${APP_HOST_URL}/connect/microsoft/callback
 
```
B2C_CLIENT_ID="<value>"
```

3. In the App 'Certificates & Secrets', create a new Client secret
```
B2C_CLIENT_SECRET="<value>"
```

4. Create the login and signup flow
 * Add Identity Providers as required ('Google' and 'Facebook')
 * Create a new Sign up and Signin Flow

```
B2C_SIGNIN_POLICY="<value>"
B2C_RESETPWD_POLICY="<value>"
```

NOTE: if developing locally, place values in local .env file
```

```

## Deploy app

```
ACR_NAME=<>

## Get local B2C values from local file (not in repo)
source ./web/.env

helm install ${APP_NAME} ./helm/az-device-shop --namespace  ${AZSHOP_NS} \
  --set global.registryHost="${ACR_NAME}.azurecr.io/" \
  --set global.env.MONGO_DB="${MONGO_URL}" \
  --set global.env.STORAGE_ACCOUNT="${STORAGE_ACCOUNT}" \
  --set global.env.STORAGE_CONTAINER="${STORAGE_CONTAINER}" \
  --set global.env.STORAGE_MASTER_KEY="${STORAGE_MASTER_KEY}" \
  --set global.env.APP_HOST_URL="${APP_HOST_URL}" \
  --set az-device-shop-web.env.B2C_RESETPWD_POLICY="${B2C_RESETPWD_POLICY}" \
  --set az-device-shop-web.env.B2C_TENANT="${B2C_TENANT}" \
  --set az-device-shop-web.env.B2C_CLIENT_SECRET="${B2C_CLIENT_SECRET}" \
  --set az-device-shop-web.env.B2C_SIGNIN_POLICY="${B2C_SIGNIN_POLICY}" \
  --set az-device-shop-web.env.B2C_CLIENT_ID="${B2C_CLIENT_ID}"

```

## Teardown

```
helm uninstall mongo-demo --namespace  $AZSHOP_NS
helm uninstall ${APP_NAME} --namespace  $AZSHOP_NS
```
