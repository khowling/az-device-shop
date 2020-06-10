

## Cloud Native - Azure Reference Application 

 _Work in progress_

Ecommerce - Azure Example application highlighting the following architectural patterns

 :heavy_check_mark:  Open-source, Open-protocols, cross-cloud compatible (Mongodb API, Nodejs, Open ID Connect, Kubernetes)  
 :heavy_check_mark:  Server-side rendering for site performance and SEO  
 :heavy_check_mark:  Stateless Microservices, with all state managed by Cloud provider SLA backed services  
 :heavy_check_mark: Complete with DevOps Toolchain & real-time Monitoring  


## Target Architecture

![portal-image](docs/arch.png)


## Design Rationals

### Data Persistance

The Design of the application is highly influenced by the choice of the features of the chosen data persistance service, in this case, CosmosDB.

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

### Provision Cloud Infra & Services

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
docker run  -v mongodata:/data/db -d -p 27017:27017 mongo --replSet rs0

in mongo cli, run:  >  rs.initiate({ _id: "rs0", members: [ { _id: 0, host : "localhost:27017" } ] } ))
```

```
mongoimport --db dbdev --collection products --jsonArray --file ./testing/testdata_products.json
```
