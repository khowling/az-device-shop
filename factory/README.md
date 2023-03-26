

### Factory 

Event-based work scheduling


### Internals

factoryStartup

 - factoryState (FactoryStateManager extends common/flux/StateManager)
    - maintain current state of the factory (workitems)

      - items: Array<WorkItemObject>;
      - workitem_sequence: number;

   - workItemsReducer:  operations to modify state
     
      - 'workItems/New'
      - 'workItems/StatusUpdate'
      - 'tidyUp'
      - 'workItems/InventoryAvailable'


 - factoryProcessor (common/Processor)

    - triggered from 'inventory_spec' requests
        - mongoWatchProcessorTrigger ()
        - processor.initiateWorkflow({ trigger: doc._id}, { continuation: { startAfter: doc._id } })


    - workflow for factory orders
       - validateRequest
       - inFactory
       - moveToWarehouse
       - publishInventory
       - tidyUp





common
 - processor.ts
   - Koa inspired workflow engine
   - processorState (common/flux/ProcessorStateManager)
      - maintains current state of workflow engine

        - processor_sequence: number;  // lateset processor_sequence 
        - flow_sequence: number;          // lateset flow_sequence 
        - last_incoming_processed: {
            - sequence: number;
            - continuation: any;
        -  }
        - proc_map: Array<ProcessObject>




   -  initiateWorkflow(new_ctx, trigger)
      - new_ctx = the context to set for the workflow stages { trigger: { doc_id:xx}}
      - trigger =  what triggered the worklow (allows re-starting) : { continuation: { startAfter: doc._id } }
      - ProcessorStateManager.dispatch({type: ProcessActionType.New, options: {new_ctx}, trigger})
         - flux.ts/StateManager/dispatch
            - reduce {action} to [changes] on current state
               - processor.ts/processorReducer()
                 - assert trigger.sequence === state.last_incoming_processed.sequence + 1
                 - trigger.sequence && change: Inc 'last_incoming_processed.sequence'
                 - trigger.continuation && change: Set 'last_incoming_processed.continuation'
                 
            - cs.db.collection(cs.collection).insertOne({sequence: cs.sequence+1, [changes]}}) // Write to log write-ahead!
            - this._stateStore.apply([changes]) // apply changes to local state

            - flux/StateManager/apply

               - 
               - 





 - flux/StateManager
  - apply(State changes)
     - 





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


### Build


```
export ACR_NAME=
```

### Build & Run

```
docker build -t ${ACR_NAME}.azurecr.io/az-device-shop/factory:0.1.0 -f Dockerfile.root ../

docker run --env-file ./.env -d -p 9091:9091 ${$ACR_NAME}.azurecr.io/az-device-shop/factory:0.1.0 
```

### Build and push to ACR

or
```
az acr build --registry $ACR_NAME --image az-device-shop/factory:0.1.0 -f Dockerfile.root ../
```
