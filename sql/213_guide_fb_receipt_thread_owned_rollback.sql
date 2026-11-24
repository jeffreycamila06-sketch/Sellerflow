-- Rollback of sql/213: the added sentence is taken out again (only where it is found).
-- "checked" is left as it is.
begin;

update public.support_guide
   set body = replace(body, 'it is shown on the receipt and added to the total. It starts empty each time. If you see "Not sent. Facebook says another app is handling this buyer''s chat with your Page right now…", nothing was sent to the buyer and the buyer''s comment was not used up.', 'it is shown on the receipt and added to the total. It starts empty each time.')
 where id = 'connect-facebook'
   and position('it is shown on the receipt and added to the total. It starts empty each time. If you see "Not sent. Facebook says another app is handling this buyer''s chat with your Page right now…", nothing was sent to the buyer and the buyer''s comment was not used up.' in body) > 0;

commit;
