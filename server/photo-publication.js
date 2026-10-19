// Project owner authorized automatic publication of subsequent daily-report
// photos on 2026-10-18, after the then-latest report date below. Uploads can
// precede configuration while recognition finishes later; use the report date.
export const PHOTO_AUTO_PUBLICATION = Object.freeze({
  authorizedAt: '2026-10-18T14:23:33.000Z',
  reportDateAfter: '2026-10-13',
});

export function automaticPhotoAuthorized(row) {
  const p = row?.payload;
  return Boolean(p && /^\d{4}-\d{2}-\d{2}$/.test(p.relatedDate || '')
    && p.relatedDate > PHOTO_AUTO_PUBLICATION.reportDateAfter
    && p.sourceType !== 'weekly-report' && p.publicApproved !== false
    && p.visionEnabled === true && p.provider && p.provider !== 'text-only'
    && Number.isFinite(Date.parse(p.analyzedAt))
    && typeof p.aiSummary === 'string' && p.aiSummary.trim()
    && Array.isArray(p.visibleFacts) && p.visibleFacts.some(fact => typeof fact === 'string' && fact.trim())
    && !p.analysisError && !['failed', 'running', 'pending'].includes(p.analysisStatus)
    && p.objectPath);
}
