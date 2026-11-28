# On-purpose breaks: each one edits ONE file the wrong way, runs the tests that should catch it,
# then puts the file back. A break is "caught" when at least one of its tests fails.
#   python3 docs/design/choose-price-twelve/proof/breaks.py            (from the repo root)
# PGlite breaks also run scripts/sql238-behaviour.mjs when PGLITE_DIR is set.
import os, subprocess
T = {
  "old": "src/redesign/adapters/__tests__/choosePriceTwelve.oldDevice.test.tsx",
  "old9": "src/redesign/adapters/__tests__/choosePriceNine.oldDevice.test.tsx",
  "sheet": "src/redesign/components/__tests__/ChoosePriceSheet.twelve.test.tsx",
  "sheet9": "src/redesign/components/__tests__/ChoosePriceSheet.nine.test.tsx",
  "set": "src/redesign/screens/__tests__/GeneralSettings.chooseTwelve.test.tsx",
  "sql": "src/redesign/adapters/__tests__/choosePriceTwelveSql.test.ts",
  "app": "src/redesign/__tests__/choosePriceTwelve.app.test.tsx",
  "hook": "src/redesign/adapters/__tests__/useChoosePrice.test.tsx",
}
H = "src/redesign/adapters/useChoosePrice.ts"
Q = "src/redesign/adapters/priceChoiceQueue.ts"
S = "src/redesign/components/ChoosePriceSheet.tsx"
G = "src/redesign/screens/GeneralSettings.tsx"
I = "src/redesign/i18n/index.tsx"
U = "sql/238_choose_price_twelve.sql"
D = "sql/238_choose_price_twelve_rollback.sql"
B = [
  ("new app always sends prices_extra (also with 9 or fewer)", H, "if (cols.extra) row.prices_extra = cols.extra;", "row.prices_extra = nextPrices.slice(9);", ["old", "old9"], False),
  ("new app never sends prices_extra", H, "if (cols.extra) row.prices_extra = cols.extra;", "", ["old"], False),
  ("prices 10–12 left in prices_more (no third column)", H, "more: sendMore ? next.slice(PRICES_COLUMN_MAX, MORE_COLUMN_END) : null,", "more: sendMore ? next.slice(PRICES_COLUMN_MAX) : null,", ["old", "sql"], False),
  ("prices_extra sent only when the NEW list has more than 9 (10 → 9 never empties it)", H, "const sendExtra = next.length > MORE_COLUMN_END || prev.length > MORE_COLUMN_END;", "const sendExtra = next.length > MORE_COLUMN_END;", ["old"], False),
  ("the read ignores prices_extra", H, "return normalizePriceList([...a(prices), ...a(more), ...a(extra)]);", "return normalizePriceList([...a(prices), ...a(more)]);", ["old"], False),
  ("the app never passes prices_extra to the read", H, "const list = joinStoredPrices(data?.prices, cols?.prices_more, cols?.prices_extra);", "const list = joinStoredPrices(data?.prices, cols?.prices_more);", ["old"], False),
  ("limit back to 9", H, "export const MAX_CHOICE_PRICES = 12;", "export const MAX_CHOICE_PRICES = 9;", ["old", "sheet", "set", "sql", "hook"], False),
  ("limit 15 (no matching column)", H, "export const MAX_CHOICE_PRICES = 12;", "export const MAX_CHOICE_PRICES = 15;", ["old", "sql", "hook"], False),
  ("Free on its own row at 10 and 11 too", Q, "return count >= FREE_OWN_ROW_FROM && count % 3 === 0;", "return count >= FREE_OWN_ROW_FROM;", ["sheet"], False),
  ("Free on its own row only at 12 (9 changed)", Q, "return count >= FREE_OWN_ROW_FROM && count % 3 === 0;", "return count === 12;", ["sheet9"], False),
  ("Free never on its own row", S, "freeOwnRow(prices.length) ? { ...freeBtn, gridColumn: \"1 / -1\" } : freeBtn", "freeBtn", ["sheet", "sheet9", "app"], False),
  ("the 12th price answers a different price", S, "onClick={() => { if (armed()) send(p); }}", "onClick={() => { if (armed()) send(i === 11 ? p + 1 : p); }}", ["sheet", "app"], False),
  ("Settings: the Add row still shows at 12", G, "{choosePrices.length < MAX_CHOICE_PRICES && (", "{choosePrices.length <= MAX_CHOICE_PRICES && (", ["set"], False),
  ("Settings: no 12-of-12 note", G, "{!cppErrText && choosePrices.length >= MAX_CHOICE_PRICES && (", "{false && (", ["set"], False),
  ("the note still says 9 in Bulgarian", I, 'bg: "Запазени са 12 от 12 цени.', 'bg: "Запазени са 9 от 9 цени.', ["set"], False),
  ("the hint still says up to 9", I, 'rd_cpp_list_hint: { en: "Your prices (up to 12).', 'rd_cpp_list_hint: { en: "Your prices (up to 9).', ["set"], False),
  ("sql/238 without the no-price-twice check across the three columns", U, ",\n  add constraint seller_price_choices_all3_distinct  check (public.seller_price_choices_distinct(prices || prices_more || prices_extra));", ";", ["sql"], True),
  ("sql/238 allows 4 in prices_extra", U, "check (cardinality(prices_extra) <= 3)", "check (cardinality(prices_extra) <= 4)", ["sql"], True),
  ("rollback without the refusal", D, "      raise exception 'sql/238 rollback refused: % seller(s) have a 10th-12th price — nothing was changed', n;", "      null;", ["sql"], True),
  ("rollback checks BEFORE it locks the table", D, "lock table public.seller_price_choices in access exclusive mode;\n", "", ["sql"], False),
  ("sql/239 still says up to 9", "sql/239_guide_choose_price_twelve.sql", "'Under the switch, add up to 12 prices.", "'Under the switch, add up to 9 prices.", ["sql"], False),
]
pg = os.environ.get("PGLITE_DIR")
caught = 0
for name, f, old, new, tests, pglite in B:
    src = open(f, encoding="utf-8").read()
    assert src.count(old) == 1, f"{name}: text not found exactly once in {f}"
    open(f, "w", encoding="utf-8").write(src.replace(old, new))
    try:
        r = subprocess.run(["npx", "vitest", "run", *[T[t] for t in tests]], capture_output=True, text=True)
        how = []
        if r.returncode != 0: how.append("tests")
        if pglite and pg:
            r2 = subprocess.run(["node", "scripts/sql238-behaviour.mjs"], env={**os.environ, "PGLITE_DIR": pg}, capture_output=True, text=True)
            if r2.returncode != 0: how.append("PGlite")
    finally:
        open(f, "w", encoding="utf-8").write(src)
    ok = bool(how)
    caught += ok
    print(f"{'CAUGHT' if ok else 'MISSED'}  {name}  ({', '.join(how) or 'nothing failed'})", flush=True)
print(f"\n{caught} of {len(B)} breaks caught")
