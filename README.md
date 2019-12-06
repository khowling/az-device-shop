

## Cloud Native - Azure Reference Application 

 _Work in progress_

Ecommerce - Azure Example application highlighting the following architectural patterns

:heavy_check_mark:  Open-source, Open-protocols, cross-cloud compatible (Mongodb API, Nodejs, Open ID Connect, Kubernetes)
:heavy_check_mark:  Server-side rendering for site performance and SEO
:heavy_check_mark:  Stateless Microservices, with all state managed by Cloud provider SLA backed services
:heavy_check_mark: Complete with DevOps Toolchain & real-time Monitoring 


## Target Architecture

![portal-image](docs/arch.png)


## Detailed Deployment Instructions

_To be completed_


### Provision Cloud Infra & Services

https://docs.microsoft.com/en-us/azure/cosmos-db/manage-mongodb-with-resource-manager

resourceGroupName=kh-ecomm-dev
location=westeurope
databaseName=dbdev
collection1Name=collection1

az group create --name $resourceGroupName --location $location
az group deployment create --resource-group $resourceGroupName --template-file infra/services.json  --parameters databaseName=$databaseName collection1Name=$collection1Name 

