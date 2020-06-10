

### Factory 

Event-based work scheduling


## Tech Objectives


* Typescript
* steaming architecture
   * a service listens to events, 
   * a service emits events, doesnt call services, doesnt have responsibility for service discovery
   * if the service needs a database, it builds it locally from subscribing to events. 
* IoT?
* real-time monitoring

## Factory Process

 1. WorkItem Backlog Queue
 2. Production
 3. Shipping to Warehouse


## Events

- WorkItem Creation (from web)
  - emit  {Status: 'New' Kind: 'WorkItem'}


- factory scheduling service
    - mastering
        - factory emplyees
        - factory capacity
    - watching for 
        (1) new capacity / employees
        (2) New WorkItems, Completed WorkItems
    - action
        (1) check for New WorkItems
        (2)  -  Check factory capacity / engineers avaiablility
            -  if available
                    - allocate engineers and factory capacity & emit {Status: 'InProgress' Kind: 'WorkItem'}

 - warehouse service
     - watching for 
        (1)  - emit workitem finished 
    - action
        - start shipping clock.
            - when job clock finishes, 
            - allocate Warehouse Location code, emit - WarehouseGoodsIn


- ProgressController
 - watching for 
        (1) New WorkItems, 
        Completed WorkItems