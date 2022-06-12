param name string
var location = resourceGroup().location

var uniqueSuffix = uniqueString(resourceGroup().id)

resource fnstore 'Microsoft.Storage/storageAccounts@2021-01-01' = {
  name: '${replace(name, '-', '')}${uniqueSuffix}'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
   // accessTier: 'Hot'
   // allowBlobPublicAccess: true
  }
}

resource fnstoreBlob 'Microsoft.Storage/storageAccounts/blobServices@2021-04-01' = {
  parent: fnstore
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedHeaders: [
            '*'
          ]
          allowedMethods: [
            'GET'
            'POST'
            'OPTIONS'
            'PUT'
            'DELETE'
          ]
          allowedOrigins: [
            '*'
          ]
          exposedHeaders: [
            '*'
          ]
          maxAgeInSeconds: 0
        }
      ]
    }
  }
}

resource fnstoreContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-04-01' = {
  parent: fnstoreBlob
  name: 'az-shop-images'
}

@description('Create Serverless Mongo DB database')
param cosmosServerless bool = true

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2022-02-15-preview' = {
  name: '${name}-${uniqueSuffix}'
  kind: 'MongoDB'
  location: location
  properties: {
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    databaseAccountOfferType: 'Standard'
    apiProperties: {
      serverVersion: '4.2'
    }
    capabilities: concat([
      {
        name: 'DisableRateLimitingResponses'
      }
    ], cosmosServerless ? [
      {
        name: 'EnableServerless'
      }
    ] : [])
  }
}

@description('The shared throughput for the Mongo DB database')
@minValue(400)
@maxValue(1000000)
param throughput int = 400
param dbname string = 'az-shop'

resource mongoDB 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases@2022-02-15-preview' = {
  parent: cosmosAccount
  name: dbname
  properties: {
    resource: {
      id: dbname
    }
    options: cosmosServerless ? json('null') :  {
      throughput: throughput
    }
  }
}

var azShopCollections = [
  'koa_sessions'
  'products'
  'business'
  'inventory_spec'
  'orders_spec'
  'inventory_complete'
  'factory_events'
  'order_events'
]

resource mongoColl 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases/collections@2022-02-15-preview' = [for collName in azShopCollections: {
  parent: mongoDB
  name: collName
  properties: {
    resource: {
      id: collName
      shardKey: {
        'partition_key': 'Hash'
      }
    }
  }
}]

output storageAccountName string = fnstore.name
param expireDate1Year string = dateTimeAdd(utcNow('u'), 'P1Y')
output storagedownloadSAS string = listAccountSAS(fnstore.name, '2021-04-01', {
  signedProtocol: 'https'
  signedResourceTypes: 'sco'
  signedPermission: 'rl'
  signedServices: 'b'
  signedExpiry: expireDate1Year //'2022-07-01T00:00:00Z'
}).accountSasToken

output storageKey string = first(fnstore.listKeys().keys).value

var connectionStrNoDB = split(first(listConnectionStrings(cosmosAccount.id, '2021-06-15').connectionStrings).connectionString, '/?')
output cosmosConnectionURL string = '${connectionStrNoDB[0]}/${dbname}?${connectionStrNoDB[1]}'
