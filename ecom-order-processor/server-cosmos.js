/*
Partition
---------
items in a container are divided into distinct subsets called logical partitions based on the value of a partition key
If 'City' has 1000 distinct values, 1,000 logical partitions are created for the container
CosmosDB transparently manages the placement of logical partitions on physical partitions
Throughput provisioned for a container is divided evenly among physical partitions
A single logical partition has an upper limit of 10 GB of storage.
Requests to the same partition key can't exceed the throughput that's allocated to a partition


Change Feed
-----------
Change feed is available for each __logical partition key__ within the container
Change feed items come in the order of their modification time. This sort order is guaranteed per logical partition key, no guaranteed order across the partition key values.
 
https://docs.microsoft.com/en-us/azure/cosmos-db/change-feed-processor
The change feed processor acts as a pointer that moves forward across your change feed and delivers the changes to a delegate implementation
It automatically divide the load among the different clients, by setting ChangeFeedOptions.PartitionKeyRangeId Property on each host instance
your processing function is called by the library


monitored container (partitioned) - partition key 'City', 
lease container acts as a state storage and coordinates processing the change feed across multiple workers
    One lease can only be owned by one instance at a given time,
    as hosts come online, the change feed processor will dynamically adjust the load by redistributing accordingly
    
Host instances (consumers) - the change feed processor is assigning different ranges of partition key values to each instance to maximize compute distribution
    Read the change feed.
    If there are no changes, sleep (poll loop)
    When you finish processing, update the lease store with the latest processed point
*/

// https://github.com/Azure/azure-cosmos-js
const { CosmosClient } = require("@azure/cosmos");

const endpoint = ; // Add your endpoint
const key = ; // Add the masterkey of the endpoint
const client = new CosmosClient({ endpoint, key })

async function run () {
    const { database } = await client.databases.createIfNotExists({ id: 'dbdev' });
    const { container } = await database.containers.createIfNotExists({
    id: 'orders',
    partitionKey: { paths: ["/partition_key"] }
    });
    const specificContinuationIterator = container.items.readChangeFeed('test', { startFromBeginning: true })
    const specificContinuationResult  = await specificContinuationIterator.fetchNext()
    console.log(`initial specific Continuation scenario ${v}`)
}

run()