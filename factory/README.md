

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
