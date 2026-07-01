# AvantiPoint Workflow Templates

This repo contains various .NET Workflows to make it easier to create GitHub Actions for your projects. For more information on how to set up reusable workflows, see [GitHub Actions Docs](https://docs.github.com/en/actions/using-workflows/reusing-workflows). For a QuickStart check out the samples in the [Templates](templates/) directory.

These workflow templates are designed to help make it easier to quickly set up GitHub Actions for .NET Projects. The core set of templates are meant to make it easier to setup 4 basic types of GitHub Actions:

- [Pull Request Integration](templates/pr.yml)
- [Continuous Integration / Continuous Delivery](templates/ci.yml)
- [Create a GitHub Release](templates/create-release.yml)
- [Publish to NuGet.org when the GitHub Release is Published](templates/publish-release.yml)

## Example

Build a NuGet package & deploy to a private NuGet feed and NuGet.org

```yaml
jobs:
  build:
    uses: avantipoint/workflow-templates/.github/workflows/dotnet-build.yml@master
    permissions:
      statuses: write
      checks: write
    with:
      name: My Project
      install-workload: maui
      solution-path: MyProject.sln

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
    secrets:
      apiKey: ${{ secrets.NUGET_ORG_API_KEY }}
      codeSignKeyVault: ${{ secrets.CODESIGN_KEYVAULT }}
      codeSignClientId: ${{ secrets.CODESIGN_CLIENTID }}
      codeSignClientSecret: ${{ secrets.CODESIGN_CLIENTSECRET }}
      codeSignTenantId: ${{ secrets.CODESIGN_TENANTID }}
      codeSignCertificate: ${{ secrets.CODESIGN_CERTIFICATE }}
```

> **NOTE** 
> If you are running tests, be sure to add the permissions so that the Test Results can be viewed. Failure to add the permissions will result in a failure running the workflow.

## NuGet Package Signing

Several of the templates include an optional NuGet package signing step (enabled with `code-sign: true`). Packages can be signed with **either** an Azure Key Vault **or** [Azure Artifact Signing](https://github.com/Azure/artifact-signing-action) (formerly Trusted Signing). The method is selected automatically: if you provide the `codeSignEndpoint` input, Azure Artifact Signing is used; otherwise the Azure Key Vault path is used.

### Azure Key Vault (default)

This path uses the NuGetKeyVaultSignTool and authenticates to an Azure Key Vault using a Client Id & Client Secret.

| Secret | Description |
| --------- | ----------- |
| `codeSignKeyVault` | The name of the Key Vault to use for signing. |
| `codeSignClientId` | The Client Id used to access the Key Vault. |
| `codeSignClientSecret` | The Client Secret used to access the Key Vault. |
| `codeSignTenantId` | The Tenant Id used to access the Key Vault. |
| `codeSignCertificate` | The name of the certificate to use for signing. |
| `codeSignTimestampUrl` | The URL of the RFC3161 timestamp server to use for signing. Uses the Microsoft (Azure) timestamp server (`http://timestamp.acs.microsoft.com`) by default. |

### Azure Artifact Signing

Provide the following **inputs** (under `with:`) to sign with Azure Artifact Signing. These select the Artifact Signing path and are not secret. Authentication reuses the same `codeSignClientId` / `codeSignTenantId` / `codeSignClientSecret` secrets.

| Input | Description |
| --------- | ----------- |
| `codeSignEndpoint` | The Azure Artifact Signing account endpoint URI for your region, e.g. `https://eus.codesigning.azure.net/`. **Setting this selects Artifact Signing.** |
| `codeSignAccountName` | The Azure Artifact Signing account name. |
| `codeSignCertificateProfile` | The Azure Artifact Signing certificate profile name. |

Authentication supports two modes:

- **Service principal:** supply `codeSignClientId`, `codeSignTenantId`, and `codeSignClientSecret`.
- **OIDC (federated credentials):** supply `codeSignClientId` and `codeSignTenantId` but omit `codeSignClientSecret`. The calling job must grant `permissions: id-token: write`, and the App Registration must have a federated credential configured for your repository.

> **NOTE**
> Azure Artifact Signing runs on Windows runners only. The build and deploy workflows default to `windows-latest`, so no change is needed unless you override `runs-on`.

```yaml
build:
  uses: avantipoint/workflow-templates/.github/workflows/dotnet-build.yml@master
  permissions:
    statuses: write
    checks: write
    id-token: write   # required only for OIDC authentication
  with:
    name: My Project
    solution-path: MyProject.sln
    code-sign: true
    codeSignEndpoint: https://eus.codesigning.azure.net/
    codeSignAccountName: my-signing-account
    codeSignCertificateProfile: my-cert-profile
  secrets:
    codeSignClientId: ${{ secrets.CODESIGN_CLIENTID }}
    codeSignTenantId: ${{ secrets.CODESIGN_TENANTID }}
    # codeSignClientSecret omitted when using OIDC
    codeSignClientSecret: ${{ secrets.CODESIGN_CLIENTSECRET }}
```

### How to Setup Package Signing

1. Create a Key Vault in Azure. [See the Azure Key Vault documentation](https://docs.microsoft.com/en-us/azure/key-vault/about/about-key-vault) for more information. Make note of the Vault URI https://{your vault name}.vault.azure.net/
2. Create or Upload a Certificate to the Key Vault. You may want to generate the CSR and upload a certificate once issued from a valid CA.
3. Make note of the Certificate Name that you choose.
4. Under the Azure AD Tenant for your Azure Subscription copy the Tenant Id.
5. Next Create a new App Registration in Azure AD. [See the Azure AD documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app) for more information. Be sure to copy the Client Id of the App registration.
6. Navigate to the Certificates & Secrets section of the App Registration and create a new Secret. [See the Azure AD documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-create-secret) for more information. Be sure to copy the secret as it will not be displayed again.
7. Finally add each of these values as secrets in your GitHub organization or repository so that you can reference them from your workflow.

> **NOTE**
> The Microsoft (Azure) Timestamp server (`http://timestamp.acs.microsoft.com`) is automatically selected. If you want to use a different timestamp server, you can add the `codeSignTimestampUrl` parameter to your workflow.

Supported Workflows:
| Workflow | Description |
| ------- | ----------- |
| \*[deploy-nuget.yml](.github/workflows/deploy-nuget.yml) | Deploy a NuGet package to a private NuGet feed or NuGet.org from a Build Artifact |
| [deploy-nuget-from-release.yml](.github/workflows/deploy-nuget-from-release.yml) | Deploys a NuGet package from a release tag |
| \*[dotnet-build.yml](.github/workflows/dotnet-build.yml) | This workflow is used for building newer projects with the `dotnet build` command. |
| \*[msbuild-build.yml](.github/workflows/msbuild-build.yml) | This workflow is used for building typically older / Xamarin based projects with the `msbuild` command. |
| [generate-release.yml](.github/workflows/generate-release.yml) | Generates a GitHub Release using a Build Artifact. This will evaluate the version of a Specified NuGet package to determine the version of the release. |

\* Supports Code Signing as part of the Workflow