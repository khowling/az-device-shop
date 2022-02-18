
# Github Actions setup

1. Create new Environment

2. Create Deployment user for Github Action, and allocate perms

 az ad sp create-for-rbac --name github-kh-emp-dev --role contributor --scopes /subscriptions/{sub}/resourceGroups/{rg} --sdk-auth

3. Save Auth Creds command output JSON in Envionment variable `AZURE_CREDENTIALS`

