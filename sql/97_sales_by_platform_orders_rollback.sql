-- sql/97 ROLLBACK — removes the per-platform 2-month report function (roll back the web first).
drop function public.sales_by_platform_orders(date, date, text);
