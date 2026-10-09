-- Rollback of sql/112 (Build 10b). Run only after the app no longer calls my_feature_access()
-- (an app that still calls it falls back to "no preview features" — fail closed).
drop function public.my_feature_access();
drop table public.feature_access_emails;
