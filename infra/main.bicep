// Guardrailed SQL Analyst on Azure Container Apps (consumption plan, scale-to-zero).
// Image comes from GHCR (public), so no Azure Container Registry cost.
// Idempotent: re-running with the same parameters converges to the same state.
targetScope = 'resourceGroup'

@description('Base name used for all resources.')
param name string = 'gsa'
param location string = resourceGroup().location

@description('Full image reference, e.g. ghcr.io/<owner>/guardrailed-sql-analyst:<sha>.')
param image string

@secure()
@description('HMAC key for signed tenant-context tokens. Required.')
param authSecret string

@description('offline | gemini | openai. offline answers only template-matched questions and needs no key.')
@allowed(['offline', 'gemini', 'openai'])
param llmProvider string = 'offline'

@secure()
@description('Google AI Studio key (free tier) when llmProvider=gemini.')
param googleApiKey string = ''

@secure()
@description('OpenAI-compatible key when llmProvider=openai.')
param openaiApiKey string = ''

@description('Demo-only: lets the UI mint tenant tokens at /api/auth/token. Set false once real login exists.')
param allowMockAuth bool = true

param appVersion string = 'dev'

var secrets = concat(
  [{ name: 'auth-secret', value: authSecret }],
  empty(googleApiKey) ? [] : [{ name: 'google-api-key', value: googleApiKey }],
  empty(openaiApiKey) ? [] : [{ name: 'openai-api-key', value: openaiApiKey }]
)
var env = concat(
  [
    { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
    { name: 'ALLOW_MOCK_AUTH', value: string(allowMockAuth) }
    { name: 'LLM_PROVIDER', value: llmProvider }
    { name: 'APP_VERSION', value: appVersion }
  ],
  empty(googleApiKey) ? [] : [{ name: 'GOOGLE_API_KEY', secretRef: 'google-api-key' }],
  empty(openaiApiKey) ? [] : [{ name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }]
)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-app'
  location: location
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          env: env
          resources: { cpu: json('0.5'), memory: '1Gi' }
          probes: [
            { type: 'Readiness', httpGet: { path: '/api/health', port: 3000 }, initialDelaySeconds: 5, periodSeconds: 10 }
            { type: 'Liveness', httpGet: { path: '/api/health', port: 3000 }, initialDelaySeconds: 15, periodSeconds: 30 }
          ]
        }
      ]
      // PGlite is single-process and per-replica, so never run more than one.
      scale: { minReplicas: 0, maxReplicas: 1 }
    }
  }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
output appName string = app.name
