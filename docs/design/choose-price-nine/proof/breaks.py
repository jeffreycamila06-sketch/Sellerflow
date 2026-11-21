# On-purpose breaks: each one edits ONE file the wrong way, runs the tests that should catch it,
# then puts the file back. A break is "caught" when at least one of its tests fails.
#   python3 docs/design/choose-price-nine/proof/breaks.py            (from the repo root)
# PGlite breaks also run scripts/sql196-behaviour.mjs when PGLITE_DIR is set.
import os, subprocess, sys
T = {
  "old": "src/redesign/adapters/__tests__/choosePriceNine.oldDevice.test.tsx",
  "sheet": "src/redesign/components/__tests__/ChoosePriceSheet.nine.test.tsx",
  "set": "src/redesign/screens/__tests__/GeneralSettings.chooseNine.test.tsx",
  "sql": "src/redesign/adapters/__tests__/choosePriceNineSql.test.ts",
  "app": "src/redesign/__tests__/choosePriceNine.app.test.tsx",
  "hook": "src/redesign/adapters/__tests__/useChoosePrice.test.tsx",
}
H = "src/redesign/adapters/useChoosePrice.ts"
S = "src/redesign/components/ChoosePriceSheet.tsx"
G = "src/redesign/screens/GeneralSettings.tsx"
I = "src/redesign/i18n/index.tsx"
U = "sql/196_choose_price_nine.sql"
D = "sql/196_choose_price_nine_rollback.sql"
B = [
  ("new app always sends prices_more (also with 6 or fewer)", H, "if (cols.more) row.prices_more = cols.more;", "row.prices_more = nextPrices.slice(6);", ["old", "sql"], False),
  ("new app never sends prices_more", H, "if (cols.more) row.prices_more = cols.more;", "", ["old", "sql"], False),
  ("all 9 prices in the prices column (no split)", H, "const row: Record<string, unknown> = { user_id: uid, enabled: nextEnabled, prices: cols.prices,", "const row: Record<string, unknown> = { user_id: uid, enabled: nextEnabled, prices: nextPrices,", ["old", "sql"], False),
  ("prices_more sent only when the NEW list has more than 6 (7 → 6 never empties it)", H, "const send = next.length > PRICES_COLUMN_MAX || prev.length > PRICES_COLUMN_MAX;", "const send = next.length > PRICES_COLUMN_MAX;", ["old", "sql"], False),
  ("the read ignores prices_more", H, "return normalizePriceList([...(Array.isArray(prices) ? prices : []), ...(Array.isArray(more) ? more : [])]);", "return normalizePriceList(Array.isArray(prices) ? prices : []);", ["old", "sql"], False),
  ("limit back to 6", H, "export const MAX_CHOICE_PRICES = 9;", "export const MAX_CHOICE_PRICES = 6;", ["old", "sheet", "set", "sql", "hook"], False),
  ("Free on its own row from 7 prices", S, "prices.length === FREE_OWN_ROW_AT ?", "prices.length >= 7 ?", ["sheet"], False),
  ("Free never on its own row", S, "prices.length === FREE_OWN_ROW_AT ? { ...freeBtn, gridColumn: \"1 / -1\" } : freeBtn", "freeBtn", ["sheet", "app"], False),
  ("the 9th price answers a different price", S, "onClick={() => { if (armed()) send(p); }}", "onClick={() => { if (armed()) send(i === 8 ? p + 1 : p); }}", ["sheet", "app"], False),
  ("Settings: the Add row still shows at 9", G, "{choosePrices.length < MAX_CHOICE_PRICES && (", "{choosePrices.length <= MAX_CHOICE_PRICES && (", ["set"], False),
  ("Settings: no 9-of-9 note", G, "{!cppErrText && choosePrices.length >= MAX_CHOICE_PRICES && (", "{false && (", ["set"], False),
  ("the note missing in Bulgarian", I, ', bg: "Запазени са 9 от 9 цени. Премахнете една, за да добавите нова." }', ' }', ["set"], False),
  ("the hint still says up to 6", I, 'rd_cpp_list_hint: { en: "Your prices (up to 9).', 'rd_cpp_list_hint: { en: "Your prices (up to 6).', ["set"], False),
  ("sql/196 without the no-price-twice check across columns", U, ",\n  add constraint seller_price_choices_all_distinct  check (public.seller_price_choices_distinct(prices || prices_more));", ";", ["sql"], True),
  ("sql/196 allows 4 in prices_more", U, "check (cardinality(prices_more) <= 3)", "check (cardinality(prices_more) <= 4)", ["sql"], True),
  ("rollback without the refusal", D, "      raise exception 'sql/196 rollback refused: % seller(s) have a 7th-9th price — nothing was changed', n;", "      null;", ["sql"], True),
  ("rollback checks BEFORE it locks the table", D, "lock table public.seller_price_choices in access exclusive mode;\n", "", ["sql"], False),
  ("sql/197 still says up to 6", "sql/197_guide_choose_price_nine.sql", "add up to 9 prices.", "add up to 6 prices.", ["sql"], False),
]
pg = os.environ.get("PGLITE_DIR")
caught = 0
out = []
for name, f, old, new, tests, pglite in B:
    src = open(f, encoding="utf-8").read()
    assert src.count(old) == 1, f"{name}: text not found exactly once in {f}"
    open(f, "w", encoding="utf-8").write(src.replace(old, new))
    try:
        r = subprocess.run(["npx", "vitest", "run", *[T[t] for t in tests]], capture_output=True, text=True)
        how = []
        if r.returncode != 0: how.append("tests")
        if pglite and pg:
            r2 = subprocess.run(["node", "scripts/sql196-behaviour.mjs"], env={**os.environ, "PGLITE_DIR": pg}, capture_output=True, text=True)
            if r2.returncode != 0: how.append("PGlite")
    finally:
        open(f, "w", encoding="utf-8").write(src)
    ok = bool(how)
    caught += ok
    out.append(f"{'CAUGHT' if ok else 'MISSED'}  {name}  ({', '.join(how) or 'nothing failed'})")
    print(out[-1], flush=True)
print(f"\n{caught} of {len(B)} breaks caught")
sys.exit(0 if caught == len(B) else 1)
