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

## Immutable action revisions

- `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` (`v8`).
- `azure/login@7184910d9eb2b1c5e48f7073824a90609bb9b6d6` (`v2.3.1`) inside the signing composite action.
- `dansiegel/publish-nuget@3a5a0d5ddd96d6c36d73586e9e0f3b829c14319f` (`v1.2`).
- The repository-owned signing action at `0836b48f03b9309fe1bcadda6109d9e761e5aaef`. That commit changes only the Azure Login reference above, allowing the reusable workflow to pin reviewed signing content without a circular self-reference.
