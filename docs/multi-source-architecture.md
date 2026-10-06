# Khayrat multi-source architecture

The change is additive. Existing `daily_reports`, `image_evidence`, private PDF objects and authentication remain unchanged.

## Data sources

- `daily_reports`: daily construction facts, personnel, issues, risks and report text.
- `image_evidence`: effective site photos with PDF page, figure, bounding box and text association. Decorative images are rejected before AI analysis.
- `progress_measurements`: WBS/item, weight, total quantity/unit, month plan/actual quantities and monthly/cumulative percentages. This is the authoritative S Curve source.
- `equipment_shipments`: equipment category, Package/Lot, shipment batch and equipment-level logistics. Installation area is optional metadata, not the primary key.
- `crosswalk_mappings`: generic typed edges between daily workshop/process, WBS/item, equipment category/item and installation area. Multiple rows implement one-to-many and many-to-many relationships.

## Compatibility

IndexedDB uses separate project/user scopes; unscoped legacy stores are retained without automatic reassignment or clearing. Cloud reads tolerate missing new tables so the deployed application continues to read legacy data before the migration is approved. No existing data is automatically rewritten or deleted.

The legacy-logo cleanup action only marks repeated same-position evidence as ignored after user confirmation. It does not delete the evidence row, storage object or source PDF.

## Evidence classes

Cross-source findings render four separate fields: original facts, system calculation, AI/rule inference and manual confirmation required. Images never supply headcount, quantity or progress percentages.

## Release prerequisites

Keep PR13 open until the user approves merge. The migration and any production configuration remain separately subject to explicit approval. The migration does not seed memberships or change legacy table policies; the optional Storage boundary is a separate reviewed file. See [PR13 security review](pr13-security-review.md) for the permission model, exact validation boundaries and real acceptance checklist.

Monthly S Curve calculations use month-end observations, a complete WBS denominator, and unknown values for missing/stale actuals. Preview uses existing Supabase RLS, so synthetic tests cannot prove production writes or real login.
