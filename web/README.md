
```
export ACR_NAME=
```

### Build & Run

```
docker build -t ${ACR_NAME}.azurecr.io/az-device-shop/web:0.1.0 -f Dockerfile.root ../

docker run --env-file ./.env -d -p 3000:3000 ${$ACR_NAME}.azurecr.io/az-device-shop/web:0.1.0 
```

### Build and push to ACR

or
```
az acr build --registry $ACR_NAME --image az-device-shop/web:0.1.0 -f Dockerfile.root ../
```
