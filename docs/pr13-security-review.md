# PR13 corrections and release boundaries — 2026-10-06

This review concerns the existing `codex/multi-source-architecture-20261005` branch of `myiwbjh/Khayrat-daily-report`, starting at `ef6f61af2358cb77ccef8b433a25b4178a315c99`. No new project, repository or PR is needed.

## Changes prepared

- Three new data tables use `project_members(project_id,user_id,role)` with reader/editor roles. Clients can only SELECT their own membership and cannot enroll or promote themselves. Tables explicitly revoke PUBLIC/anon grants and grant authenticated SELECT/INSERT/UPDATE; DELETE is not granted. RLS distinguishes read/insert/update, and a restrictive membership boundary guards against accidentally additive permissive policies. An invoker trigger prevents updates to an existing record's ID or project; full-column UPDATE grants allow ordinary PostgREST upserts.
- Migration contains no member seed and no data UPDATE/DELETE/TRUNCATE, and does not modify legacy production table policies. `schema.sql` is for fresh installations, not an upgrade script.
- `storage-member-boundary.sql` is a separately reviewed optional restrictive policy. It intersects existing owner policies, respects the first object path component, and does not widen old owner-only access. A restrictive DELETE policy also retains all source PDF/evidence objects, since the application has no file-deletion flow. Production inspection found 67 objects all under `khayrat/`; no object must be renamed. Confirm membership before applying, since an empty member table would deny old file access.
- Cloud reads use `image_id` only for image_evidence and `id` for the other four data tables. Pagination stays stable. Missing new tables degrade only for explicit 42P01/PGRST205 table errors; 401/403/other 404/5xx remain visible failures.
- New source IDs encode project and full identity components without lowercasing, punctuation replacement or truncation; shipments also include supplier. Cloud rejects cross-project rows and malformed/legacy source IDs before writing. Legacy Khayrat report/photo IDs remain unchanged; another project's newly imported report/photo IDs are namespaced.
- Crosswalk is a graph of `(type,value)` nodes. Both endpoints' types and values matter, including reverse and multi-hop links. Same text in unrelated types and other projects cannot produce an alert. Logistics must explicitly indicate site arrival; stale progress and future arrival dates are excluded.
- The progress/cross-analysis cutoff is separate from the daily report date filter and cannot exceed today in Baghdad. Monthly values are observations at month end. The entire imported WBS roster supplies a fixed denominator; missing/invalid values do not shrink it. Incomplete or stale month-end observations return unknown rather than a made-up project percentage. Future planned points remain visible but future actual points and gaps are not plotted as zero. Changing historical weights requires review.
- IndexedDB and localStorage names include project and verified user ID. Sign-out clears displayed state and signed links, without deleting cache. Unscoped legacy caches remain untouched and are not automatically assigned to a new user. Existing cloud records rehydrate into the verified user's scope; offline legacy recovery requires a separately confirmed export/adoption, not silent migration. Scoped IndexedDB updates use puts, not clear(). Pending operations check identity before committing.
- Initialization now installs handlers before asynchronous cloud hydration, avoiding early clicks losing their handler. Personnel bar width scales within its grid cell; the old maximum-width cap incorrectly made different totals the same width.

## Observed production baseline

Read-only inspection: 44 daily_reports, 62 image_evidence, 5 import_audits, 67 private storage objects. None of project_members/progress_measurements/equipment_shipments/crosswalk_mappings exists. Existing legacy table and Storage policies restrict access to the owner's verified email; they are not open to every authenticated user. No production database or environment change was made.

## Preview configuration

The prior Preview lacked Supabase values because existing preview variables were scoped to the older layout-vision branch. Only SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_BUCKET and ACCESS_CONTROL_REQUIRED were copied from the previous Preview into branch-specific preview variables for PR13. No production target was edited, no service-role key copied, and no AI configuration enabled. This Preview uses the existing database and its current RLS; it is not a separate database sandbox. Do not assume new-source writes can succeed before an approved migration.

## Validation and approval matrix

| Item | Status / boundary |
|---|---|
| Unit and PostgreSQL security tests | 113/113 passed. Run `npm test`; real local PostgreSQL via pinned PGlite exercises grants/RLS, unauthorized users, reader/editor roles, upsert, immutable IDs, self-enrollment denial, cross-project denial and Storage paths. No production SQL mutations. |
| Browser regressions | 25/25 passed. Run `npm run test:e2e`; synthetic REST/Auth/Storage fixtures exercise PDF extraction, logo exclusion, pairing, private object upload, refresh, errors, source imports, S Curve, personnel and account cache switching. Synthetic Auth success is not real login proof. |
| Build | Passed. Run `npm run build`; dependency lockfile retained. |
| Production migration | **Requires explicit user approval** of the migration and authorized auth.users UUID/role mapping. Never run schema.sql over the existing database. |
| Storage restriction | **Requires separate approval** after verifying seeded membership and object prefixes. Preserve current owner policy. |
| Real new-source write/refresh acceptance | Blocked until approved tables/membership exist. Do not describe mocks as Supabase writes. |
| Real email/password acceptance | Requires the owner to securely sign in to the Preview; never request credentials in chat or manufacture a test production account. |
| Merge and production configuration | **Not authorized** in this task. Keep PR open; do not enable auto-merge or modify production environment variables. |

## Real acceptance checklist after prerequisites

1. Owner uses email/password in Preview; refresh and confirm restored identity. Verify no secrets in source, logs or browser-visible config.
2. Record production counts/fingerprints, then import a designated small real PDF under a new import ID; verify private original, text, effective construction images, logo exclusion and page/block pairing. Do not modify existing reports/images for the test.
3. Confirm actual Supabase rows and original Storage object, refresh and compare the restored data.
4. After migration/membership approval, import small WBS, shipment and typed Crosswalk samples; verify saved rows and restored IDs.
5. Independently calculate the weighted month-end percentages and compare S Curve, crew bars and inferred alerts.
6. Compare the pre-existing report/image JSON and old Storage object fingerprints, not only row counts. Retain test data with clear provenance; cleanup is outside this authorization.
