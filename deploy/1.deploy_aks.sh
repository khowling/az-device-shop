#  Create Cluster - Community solutions, Simple Cluster no additional security
# Additiomal - No System Pool, ACR - Basic, Contor cert-mana & external-dns


export AKS_NAME=basic-dev-k8s
export AKS_RG=${AKS_NAME}-rg
export AZ_DNSZONE_ID=/subscriptions/95efa97a-9b5d-4f74-9f75-a3396e23344d/resourceGroups/kh-common/providers/Microsoft.Network/dnszones/labhome.biz

az group create -l WestEurope -n ${AKS_RG} 

# Deploy template with in-line parameters 
az deployment group create -g ${AKS_RG}  --template-uri https://github.com/Azure/Aks-Construction/releases/download/0.3.0-preview/main.json --parameters \
	resourceName=${AKS_NAME} \
	kubernetesVersion=1.20.9 \
	agentCount=2 \
	JustUseSystemPool=true \
	agentVMSize=Standard_DS3_v2 \
	registries_sku=Basic \
	acrPushRolePrincipalId=$(az ad signed-in-user show --query objectId --out tsv) \
	dnsZoneId=${AZ_DNSZONE_ID}
