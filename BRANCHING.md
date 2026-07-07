# Branching & Deployment Flow

Two long-lived branches map to the two hosted environments (see `MIGRATION_PLAN.md`):

| Branch | Environment | Deploys to                     |
|--------|-------------|--------------------------------|
| `qa`   | QA / staging| Railway QA + Vercel preview    |
| `main` | Production  | Railway Prod + Vercel prod     |

## The rule

```
feature/*  ──PR──►  qa  ──PR (approved)──►  main
   (no approval needed)     (1 approval, must come from qa)
```

1. **Branch off `qa`** for any new work: `git checkout qa && git checkout -b feature/my-thing`.
2. **Open a PR into `qa`.** CI must pass. No human approval required — merge it yourself.
3. **Promote to prod** by opening a PR from `qa` into `main`.
   - CI must pass.
   - The PR must originate from `qa` (enforced by the `enforce-merge-flow` workflow —
     any other source branch fails the check).
   - **1 approval is required**, and it cannot be the PR author's own. On a solo push,
     that means your collaborator reviews it.

## Protection settings (configured on GitHub)

**`main`**
- Require a pull request before merging.
- Require **1 approving review**; author cannot approve their own PR;
  require approval of the most recent push.
- Require status checks to pass: `backend-check`, `frontend-build`, `only-from-qa`.
- No force pushes, no branch deletion.
- Admins **can** bypass in an emergency — but this is discouraged and shows up in the audit log.

**`qa`**
- No required approvals (frictionless staging).
- No force pushes, no branch deletion.

## Reverting this setup

If something goes wrong, the pre-setup state of `main` is tagged
`backup/pre-branch-setup`. Restore with:

```bash
git checkout main
git reset --hard backup/pre-branch-setup
git push --force-with-lease origin main   # requires temporarily lifting protection
```
