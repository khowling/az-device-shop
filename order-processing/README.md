
## Tech Objectives


* Typescript
* steaming architecture
   * a service listens to events, 
   * a service emits events, doesnt call services, doesnt have responsibility for service discovery
   * if the service needs a database, it builds it locally from subscribing to events. 
* IoT?
* real-time monitoring

## Order Process

 1. Create
 2. Reserve Inventory
 3. Warehouse Picking/packing
 4. Shipping
 

## order processing

Need a event broker that I can run easily locally 

mongo change stream :(, no se

Mongo Change Streams (until easy kafka without zookeeper for localhost dev)
allow applications to access real-time data changes without the complexity and risk of tailing the oplog. 

You can open change streams against: a collection, or a database

