-- Rollback of sql/152 — puts the old phrase back in support_guide 'parcel-scan' (that phrase only).
begin;
update public.support_guide
   set body = replace(body, 'FamilyMart store # (6 digits starting with 0 — ', 'FamilyMart store # (6 digits — '),
       updated_at = now()
 where id = 'parcel-scan'
   and position('FamilyMart store # (6 digits starting with 0 — ' in body) > 0;
commit;
