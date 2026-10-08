-- ============================================================================
-- sql/89 ROLLBACK — removes sales_by_platform. Nothing else uses it; the Sales tab's
-- per-platform view then shows its error card (the "All" view is unaffected).
-- ============================================================================
drop function public.sales_by_platform(date, date, text);
