// CloudPilot — on-demand cloud computer for AI sessions and meetings.
// Deploy with infra/bootstrap.sh (Azure Cloud Shell). Designed for ~$8/month budgets.
targetScope = 'resourceGroup'

@description('Region. Must be allowed by your subscription policy (Azure for Students limits this).')
param location string = resourceGroup().location

@description('Short lowercase prefix for resource names.')
@minLength(3)
@maxLength(12)
param prefix string = 'cloudpilot'

@description('Globally-unique DNS label → <label>.<region>.cloudapp.azure.com')
param dnsLabel string

@allowed(['Standard_B2als_v2', 'Standard_B2as_v2', 'Standard_B4als_v2', 'Standard_B4as_v2', 'Standard_B8als_v2', 'Standard_B2s', 'Standard_B2ms'])
param vmSize string = 'Standard_B2als_v2'

param adminUsername string = 'pilot'

@description('SSH public key for the admin user.')
@secure()
param sshPublicKey string

@description('SSH stays closed unless you give an address to allow, e.g. 203.0.113.7/32. The app terminal works without it.')
param sshAllowFrom string = ''

@description('SHA-256 (hex) of the owner token. The plain token is never stored in Azure.')
@secure()
param ownerTokenSha256 string

@description('Base32 TOTP secret for authenticator-app login (empty = owner key only).')
@secure()
param totpSecret string = ''

@description('HMAC key for scoped tokens, shared by control plane and agent.')
@secure()
param signingKey string

@description('Git repo the VM clones the agent from.')
param agentRepo string = 'https://github.com/OWNER/cloudpilot.git'
param agentRef string = 'main'

@description('Monthly budget (USD) for the alert. 0 disables the budget resource.')
param budgetUsd int = 8
@description('Email for budget alerts (optional).')
param budgetEmail string = ''
@description('Budget start (first of current month).')
param budgetStartDate string = '${utcNow('yyyy-MM')}-01'

@description('Nightly safety shutdown time (HHmm) and Windows time-zone id.')
param autoShutdownTime string = '0200'
param autoShutdownTimeZone string = 'India Standard Time'

@description('Minutes of inactivity before the agent deallocates the VM. 0 = never.')
param idleShutdownMinutes int = 20

param tags object = { app: 'cloudpilot' }

var vmName = '${prefix}-vm'
var nicName = '${prefix}-nic'
var pipName = '${prefix}-pip'
var nsgName = '${prefix}-nsg'
var vnetName = '${prefix}-vnet'
var funcName = '${prefix}-ctl-${uniqueString(resourceGroup().id)}'
var storageName = toLower('${take(replace(prefix, '-', ''), 10)}${uniqueString(resourceGroup().id)}')
var fqdn = '${dnsLabel}.${location}.cloudapp.azure.com'

// Built-in role ids
var roleVmContributor = '9980e02c-c2be-4d73-94e8-173b1dc7cf3c'
var roleNetworkContributor = '4d97b98b-1d4f-4787-a291-c67834d212e7'

/* ------------------------------------------------------------------ network */

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: nsgName
  location: location
  tags: tags
  properties: {
    securityRules: concat([
      {
        name: 'https'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRanges: ['443', '80', '8443'] // 80: Let's Encrypt + redirect; 8443: live desktop
        }
      }
      {
        name: 'webrtc'
        properties: {
          priority: 105
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Udp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '32768-60999' // Chrome's ephemeral range: phone → meeting live takeover (DTLS-encrypted)
        }
      }
    ], empty(sshAllowFrom) ? [] : [
      {
        name: 'ssh'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: sshAllowFrom
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
    ])
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/24'] }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.42.0.0/26'
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

// Exists only while the VM runs: the control plane deletes it on stop and recreates it
// (same DNS label) on start, so you don't pay for an idle IP.
resource pip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: pipName
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: { domainNameLabel: dnsLabel }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: nicName
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: vnet.properties.subnets[0].id }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: { id: pip.id }
        }
      }
    ]
  }
}

/* ------------------------------------------------------------------ VM */

var cloudInitVars = {
  __ADMIN__: adminUsername
  __FQDN__: fqdn
  __OWNER_TOKEN_SHA256__: ownerTokenSha256
  __SIGNING_KEY__: signingKey
  __CONTROL_URL__: 'https://${funcName}.azurewebsites.net/api'
  __AGENT_REPO__: agentRepo
  __AGENT_REF__: agentRef
  __IDLE_MINUTES__: string(idleShutdownMinutes)
}
var cloudInit = reduce(
  items(cloudInitVars),
  loadTextContent('cloud-init.yaml'),
  (acc, kv) => replace(string(acc), kv.key, kv.value)
)

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: vmName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' } // lets the agent deallocate itself when idle
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: { publicKeys: [{ path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: sshPublicKey }] }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: 32 // E4 tier
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
        deleteOption: 'Delete'
      }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id, properties: { deleteOption: 'Detach' } }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } } // managed storage, free tier
  }
}

resource autoShutdown 'Microsoft.DevTestLab/schedules@2018-09-15' = {
  name: 'shutdown-computevm-${vmName}'
  location: location
  tags: tags
  properties: {
    status: 'Enabled'
    taskType: 'ComputeVmShutdownTask'
    dailyRecurrence: { time: autoShutdownTime }
    timeZoneId: autoShutdownTimeZone
    targetResourceId: vm.id
    notificationSettings: { status: 'Disabled' }
  }
}

/* ------------------------------------------------------------------ control plane */

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource deployContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobSvc
  name: 'deploy'
}

var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${prefix}-plan'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}

resource func 'Microsoft.Web/sites@2024-04-01' = {
  name: funcName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      cors: { allowedOrigins: ['*'] } // bearer-token auth, no cookies
      appSettings: [
        { name: 'AzureWebJobsStorage', value: storageConn }
        { name: 'DEPLOYMENT_STORAGE_CONNECTION_STRING', value: storageConn }
        { name: 'CP_SUBSCRIPTION_ID', value: subscription().subscriptionId }
        { name: 'CP_RESOURCE_GROUP', value: resourceGroup().name }
        { name: 'CP_LOCATION', value: location }
        { name: 'CP_VM_NAME', value: vmName }
        { name: 'CP_NIC_NAME', value: nicName }
        { name: 'CP_PIP_NAME', value: pipName }
        { name: 'CP_DNS_LABEL', value: dnsLabel }
        { name: 'CP_OWNER_TOKEN_SHA256', value: ownerTokenSha256 }
        { name: 'CP_SIGNING_KEY', value: signingKey }
        { name: 'CP_TOTP_SECRET', value: totpSecret }
        { name: 'CP_BUDGET_USD', value: string(budgetUsd) }
        { name: 'CP_PREJOIN_MINUTES', value: '8' }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deploy'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING'
          }
        }
      }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 512 }
      runtime: { name: 'node', version: '22' }
    }
  }
  dependsOn: [deployContainer]
}

// Control plane may start/stop/resize the VM and create/delete the public IP.
resource funcVmRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, func.id, roleVmContributor)
  properties: {
    principalId: func.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleVmContributor)
  }
}
resource funcNetRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, func.id, roleNetworkContributor)
  properties: {
    principalId: func.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleNetworkContributor)
  }
}
// The VM may deallocate itself when idle (scoped to the VM only).
resource vmSelfRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vm.id, roleVmContributor)
  scope: vm
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleVmContributor)
  }
}

/* ------------------------------------------------------------------ budget */

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (budgetUsd > 0 && !empty(budgetEmail)) {
  name: '${prefix}-monthly'
  properties: {
    category: 'Cost'
    amount: budgetUsd
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: {
      actual75: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 75
        contactEmails: [budgetEmail]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [budgetEmail]
      }
    }
  }
}

output fqdn string = fqdn
output controlUrl string = 'https://${func.properties.defaultHostName}/api'
output functionAppName string = func.name
output vmName string = vm.name
