# Khayrat multi-source architecture

The change is additive. Existing `daily_reports`, `image_evidence`, private PDF objects and authentication remain unchanged.

## Data sources

- `daily_reports`: daily construction facts, personnel, issues, risks and report text.
- `image_evidence`: effective site photos with PDF page, figure, bounding box and text association. Decorative images are rejected before AI analysis.
- `progress_measurements`: WBS/item, weight, total quantity/unit, month plan/actual quantities and monthly/cumulative percentages. This is the authoritative S Curve source.
- `equipment_shipments`: equipment category, Package/Lot, shipment batch and equipment-level logistics. Installation area is optional metadata, not the primary key.
- `crosswalk_mappings`: generic typed edges between daily workshop/process, WBS/item, equipment category/item and installation area. Multiple rows implement one-to-many and many-to-many relationships.

## Compatibility

IndexedDB upgrades from version 2 to 3 without clearing existing stores. Cloud reads tolerate missing new tables so the deployed application continues to read legacy data before the migration is approved. No existing data is automatically rewritten or deleted.

The legacy-logo cleanup action only marks repeated same-position evidence as ignored after user confirmation. It does not delete the evidence row, storage object or source PDF.

## Evidence classes

Cross-source findings render four separate fields: original facts, system calculation, AI/rule inference and manual confirmation required. Images never supply headcount, quantity or progress percentages.

## Deployment order

1. Review and merge application code.
2. Approve and apply `supabase/migrations/20261005_multi_source_architecture.sql` with the final project-membership RLS policy.
3. Verify password login and one small CSV import for each new source.
4. Verify Supabase rows, refresh restoration and S Curve/cross-analysis display.
