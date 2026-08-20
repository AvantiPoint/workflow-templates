# NuGet deployment duration audit

Audited on 2026-08-20 for the reusable `.github/workflows/deploy-nuget.yml` job.

## Sample

- Window: 2026-05-18 20:24:46 UTC through 2026-08-20 20:05:50 UTC.
- Sources: completed `push` runs in the six repositories that currently call the workflow: `appportal-sdk-dotnet`, `appportal-cli`, `mobileauth-lib`, `mauimicromvvm`, `avantipoint.packages`, and `AvantiPoint.Aspire`. Those callers constrain publication pushes to `master`; the two AppPortal consumers also permit version tags.
- Method: GitHub Actions REST run and job metadata; all `deploy-internal` and `deploy-sponsors` job attempts with both start and completion timestamps were inspected. Skipped jobs were excluded from duration statistics.
- Completed executions: 53 (51 successful, 2 failed).
- P95: 114 seconds (nearest-rank method).
- Maximum: 158 seconds ([run 28616933144](https://github.com/AvantiPoint/avantipoint.packages/actions/runs/28616933144/job/84863667558)).
- Failed executions: 58 seconds and 43 seconds, both in [run 28520472905](https://github.com/AvantiPoint/avantipoint.packages/actions/runs/28520472905). They failed promptly during signing-command changes; neither was a timeout or runner stall, and the third attempt succeeded in 114 seconds.

## Budget and runner decision

The deploy job is capped at 10 minutes. That is about 5.3 times the measured P95 and 3.8 times the observed maximum, leaving bounded headroom for a cold signing-tool install plus Azure signing and NuGet feed latency without permitting a 60-minute hang.

`windows-latest` remains intentional because the optional package-signing path uses PowerShell and Windows signing tooling. The policy-only PR check runs on hosted `ubuntu-slim` with a three-minute cap; it executes no product code and needs no self-hosted capacity.

## Credential-free exact-head dry run

`.github/workflows/deploy-nuget-dry-run.yml` creates a minimal valid NuGet ZIP fixture on hosted `ubuntu-slim`, uploads it, and calls `./.github/workflows/deploy-nuget.yml`. GitHub resolves that local reusable-workflow syntax from the caller's exact commit, so the PR proves the reviewed workflow rather than a mutable branch.

The reusable workflow has mutually exclusive jobs:

- `dry-run` runs only when the opt-in boolean input is true. It has a three-minute cap, downloads the selected artifact, validates ZIP central-directory and `.nuspec` structure, and records size and SHA-256. It contains no secret references and no sign or publish action.
- `deploy` runs only when dry-run is false. Its hosted Windows runner, 10-minute cap, signing condition, package glob, feed input, and publication action remain unchanged. GitHub does not support conditionally required `workflow_call` secrets, so `apiKey` is optional during call validation and an early production-only guard rejects an absent key before artifact download, signing, or publication.

The PR caller passes no secrets and grants only `actions: read` plus `contents: read`; the policy rejects any extra workflow permission or job-level override. Secret-context detection covers dot access, bracket access, context serialization, and secret inheritance across the fixture, caller, and reusable dry-run job.

The fail-closed policy binds every parsed `uses` occurrence to its exact reviewed path and SHA, in its expected file and job sequence. The complete reusable deploy workflow, dry-run caller, policy workflow, and signing composite are authoritative hash-locked surfaces; job-level hashes retain focused diagnostics. The suite rejects alternate YAML action syntax, decoy triggers, skipped validation/proof jobs, hidden or disabled publication, a non-blocking API-key guard, added command-line sign/publish paths, runner drift, or expanded timeouts.

## Immutable action revisions

- `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` (`v8`).
- `actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803` (`v6`) and `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` (`v7`) in the dry-run fixture job.
- `azure/login@7184910d9eb2b1c5e48f7073824a90609bb9b6d6` (`v2.3.1`) inside the signing composite action.
- `dansiegel/publish-nuget@3a5a0d5ddd96d6c36d73586e9e0f3b829c14319f` (`v1.2`).
- The repository-owned signing action at `0836b48f03b9309fe1bcadda6109d9e761e5aaef`. That commit changes only the Azure Login reference above, allowing the reusable workflow to pin reviewed signing content without a circular self-reference.

The signing-action pin targets an intermediate commit from this branch. PR #8 must therefore use a normal merge commit so `0836b48f03b9309fe1bcadda6109d9e761e5aaef` remains an ancestor of `master`; do not squash or rebase-merge unless the pin is first moved to an already-merged durable commit.
