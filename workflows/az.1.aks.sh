#  Create Cluster - Community solutions, Simple Cluster no additional security
# Additiomal - No System Pool, ACR - Basic, Contor cert-mana & external-dns

dnsZoneId=""
aks=""
certEmail=""

while getopts "n:z:e:" opt; do
  case ${opt} in
    n )
     aks=$OPTARG
     ;;
    z )
     dnsZoneId=$OPTARG
     ;;
	e )
     certEmail=$OPTARG
     ;;
    \? )
      echo "Unknown arg"
      show_usage=true
      ;;
  esac
done




if [ "$dnsZoneId" ]; then
    if [[ $dnsZoneId =~ ^/subscriptions/([^/ ]+)/resourceGroups/([^/ ]+)/providers/Microsoft.Network/(dnszones|privateDnsZones)/([^/ ]+)$ ]]; then
        dnsZoneId_sub=${BASH_REMATCH[1]}
        dnsZoneId_rg=${BASH_REMATCH[2]}
        dnsZoneId_type=${BASH_REMATCH[3]}
        dnsZoneId_domain=${BASH_REMATCH[4]}
    else
        echo "dnsZoneId paramter needs to be a resourceId format for Azure DNS Zone"
        show_usage=true
    fi

fi

if [ -z "$dnsZoneId" ] || [ -z "$aks" ]  || [ -z "$certEmail" ]|| [ "$show_usage" ]; then
	echo "Usage: $0"
    echo "args:"
    echo " < -z Azure DNS Zone resourceId > (required)"
    echo " < -n aks-name > (required)"
	echo " < -e email for certman certificates > (required)"
	exit 1
fi

## Following is Generated from:
## https://azure.github.io/AKS-Construction
##

export AKS_RG=${aks}-rg
az group create -l WestEurope -n ${AKS_RG} 

# Deploy template with in-line parameters 
az deployment group create -g ${AKS_RG}  --template-uri https://github.com/Azure/AKS-Construction/releases/download/0.5.2-preview/main.json --parameters \
	resourceName=${aks} \
	agentCount=2 \
	JustUseSystemPool=true \
	custom_vnet=true \
	enable_aad=true \
	AksDisableLocalAccounts=true \
	enableAzureRBAC=true \
	adminprincipleid=$(az ad signed-in-user show --query objectId --out tsv) \
	registries_sku=Standard \
	acrPushRolePrincipalId=$(az ad signed-in-user show --query objectId --out tsv) \
	azurepolicy=audit \
	dnsZoneId=${dnsZoneId} \
	azureKeyvaultSecretsProvider=true \
	createKV=true \
	kvOfficerRolePrincipalId=$(az ad signed-in-user show --query objectId --out tsv)


export aksName="aks-${aks}"
# ------------------------------------------------
#         Get credentials for your new AKS cluster
az aks get-credentials -g ${AKS_RG} -n ${aksName}

# ------------------------------------------------
#               Install Contour Ingress Controller
helm repo add bitnami https://charts.bitnami.com/bitnami
helm upgrade --install  contour-ingress bitnami/contour --version 7.3.4 --namespace ingress-basic --create-namespace \
    --set envoy.kind=deployment \
    --set contour.service.externalTrafficPolicy=cluster \
    --set metrics.serviceMonitor.enabled=true \
    --set commonLabels."release"=monitoring \
    --set metrics.serviceMonitor.namespace=monitoring

# ------------------------------------------------
#                             Install external-dns
kubectl create secret generic aks-kube-msi --from-literal=azure.json="{
  userAssignedIdentityID: $(az aks show -g ${AKS_RG} -n ${aksName} --query identityProfile.kubeletidentity.clientId -o tsv),
  tenantId: $(az account show --query tenantId -o tsv),
  useManagedIdentityExtension: true,
  subscriptionId: ${dnsZoneId_sub},
  resourceGroup: ${dnsZoneId_rg}
}"
helm upgrade --install externaldns https://github.com/kubernetes-sigs/external-dns/releases/download/external-dns-helm-chart-1.7.1/external-dns-1.7.1.tgz \
  --set domainFilters={"${dnsZoneId_domain}"} \
  --set provider="azure" \
  --set extraVolumeMounts[0].name=aks-kube-msi,extraVolumeMounts[0].mountPath=/etc/kubernetes,extraVolumeMounts[0].readOnly=true \
  --set extraVolumes[0].name=aks-kube-msi,extraVolumes[0].secret.secretName=aks-kube-msi 

# ------------------------------------------------
#                             Install cert-manager
kubectl apply -f https://github.com/jetstack/cert-manager/releases/download/v1.6.0/cert-manager.yaml
sleep 20s # wait for cert-manager webhook to install
helm upgrade --install letsencrypt-issuer https://raw.githubusercontent.com/Azure/AKS-Construction/main/postdeploy/helm/Az-CertManagerIssuer-0.3.0.tgz \
    --set email=${certEmail}  \
    --set ingressClass=contour

# ------------------------------------------------
#              Install kube-prometheus-stack chart
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
kubectl create namespace monitoring
helm upgrade --install  monitoring prometheus-community/kube-prometheus-stack --namespace monitoring \
  --set grafana.ingress.enabled=true \
  --set grafana.ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set grafana.ingress.annotations."ingress\.kubernetes\.io/force-ssl-redirect"=\"true\" \
  --set grafana.ingress.ingressClassName=contour \
  --set grafana.ingress.hosts[0]=grafana.${dnsZoneId_domain} \
  --set grafana.ingress.tls[0].hosts[0]=grafana.labhome.biz,grafana.ingress.tls[0].secretName=aks-grafana

