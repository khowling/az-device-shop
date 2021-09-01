param name string
var location = resourceGroup().location

resource fnstore 'Microsoft.Storage/storageAccounts@2021-01-01' = {
  name: name
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2021-06-15' = {
  name: name
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
      serverVersion: '4.0'
    }
  }
}

resource mongoDB 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases@2021-06-15' = {
  parent: cosmosAccount
  name: 'az-shop'
  properties: {
    resource: {
      id: 'az-shop'
    }
  }
}

var azShopCollections = [
  'products'
  'business'
  'inventory'
  'inventory_complete'
  'factory_events'
  'order_events'
  'orders'
]

resource mongoColl 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases/collections@2021-06-15' = [for collName in azShopCollections: {
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
