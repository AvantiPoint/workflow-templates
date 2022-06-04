# AvantiPoint Workflow Templates

This repo contains various .NET Workflows to make it easier to create GitHub Actions for your projects.

## Examples

Build a NuGet package & deploy to a private NuGet feed and NuGet.org

```yaml
jobs:
  build:
    uses: avantipoint/workflow-templates/.github/workflows/dotnet-build.yml@master
    with:
      name: My Project
      install-workload: maui
      solution-path: MyProject.sln
      run-tests: true

  deploy-internal:
    needs: build
    uses: avantipoint/workflow-templates/.github/workflows/deploy-nuget.yml@master
    with:
      name: Deploy Internally
    secrets:
      feedUrl: https://my-private-feed.com/v3/index.json
      apiKey: ${{ secrets.MYPRIVATEFEED_API_KEY }}

  deploy-nuget:
    needs: build
    uses: avantipoint/workflow-templates/.github/workflows/deploy-nuget.yml@master
    environment: NuGetOrg
    with:
      name: Deploy NuGet.org
      code-sign: true
    secrets:
      apiKey: ${{ secrets.MYPRIVATEFEED_API_KEY }}
      codeSignKeyVault: ${{ secrets.CODESIGN_KEYVAULT }}
      codeSignClientId: ${{ secrets.CODESIGN_CLIENTID }}
      codeSignClientSecret: ${{ secrets.CODESIGN_CLIENTSECRET }}
      codeSignTenantId: ${{ secrets.CODESIGN_TENANTID }}
      codeSignCertificate: ${{ secrets.CODESIGN_CERTIFICATE }}
```

## NuGet Package Signing

Several of the templates include an optional NuGet package signing step. This step uses the NuGetKeyVaultSignTool. It only supports authentication with an Azure Key Vault using a Client Id & Client Secret.

| Parameter | Description |
| --------- | ----------- |
| `codeSignKeyVault` | The name of the Key Vault to use for signing. |
| `codeSignClientId` | The Client Id of the Key Vault to use for signing. |
| `codeSignClientSecret` | The Client Secret of the Key Vault to use for signing. |
| `codeSignTenantId` | The Tenant Id of the Key Vault to use for signing. |
| `codeSignCertificate` | The name of the certificate to use for signing. |
| `codeSignTimestampUrl` | The URL of the timestamp server to use for signing. Uses DigiCert Timestamp server by default. |

Supported Workflows:
- [deploy-nuget.yml](.github/workflows/deploy-nuget.yml)
- [dotnet-build.yml](.github/workflows/dotnet-build.yml)
- [generate-release.yml](.github/workflows/generate-release.yml)