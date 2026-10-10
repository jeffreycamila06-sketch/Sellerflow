-- sql/115 ROLLBACK — stops the automatic switching. Rows the trigger or the backfill already
-- wrote stay as they are (notes start with 'auto'); remove them by hand only if wanted.
drop trigger trg_seller_profiles_zzz_parcel_auto_access on public.seller_profiles;
drop function public.parcel_auto_access_trg();
