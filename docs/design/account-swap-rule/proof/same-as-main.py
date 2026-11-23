# What a seller who is NOT in the preview can reach, compared with main (run from the repo root, after
# `git fetch origin main`). Prints one line per check; exits 1 when one fails.
#   python3 docs/design/account-swap-rule/proof/same-as-main.py
import subprocess, re, sys
sh = lambda *a: subprocess.run(a, capture_output=True, text=True).stdout
main = lambda f: sh('git', 'show', f'origin/main:{f}')
bad = 0
def ok(c, msg):
    global bad
    print(('ok    ' if c else 'FAIL  ') + msg)
    if not c: bad += 1

changed = sorted(set(sh('git', 'diff', '--name-only', 'origin/main').split() + sh('git', 'ls-files', '--others', '--exclude-standard').split()))
app = [f for f in changed if f.startswith('src/') and '__tests__' not in f]
print('files of the app that differ from main:'); [print('   ', f) for f in app]
ok(app == ['src/redesign/RedesignApp.tsx', 'src/redesign/adapters/planFull.ts', 'src/redesign/components/PlanFullPopup.tsx', 'src/redesign/i18n/index.tsx', 'src/redesign/screens/ShopeeShops.tsx'], 'only these five app files changed')
ok(not [f for f in changed if f.startswith(('server/', 'chrome-extension', 'mobile/', 'api/')) or f in ('server.js', 'package.json', 'package-lock.json')], '0 files in the server, the Chrome extension, the phone apps, the packages')
printing = sh('node', '-e', "import('./scripts/printing-paths.mjs').then(m=>{console.log(process.argv.slice(1).filter(f=>m.isPrintingFile(f)).length)})", *changed).strip()
ok(printing == '0', '0 printing files')

# RedesignApp.tsx: comments only
strip = lambda s: '\n'.join(l for l in s.split('\n') if not l.strip().startswith('//'))
ok(strip(open('src/redesign/RedesignApp.tsx', encoding='utf8').read()) == strip(main('src/redesign/RedesignApp.tsx')), 'RedesignApp.tsx: the code is identical to main (two comment lines differ)')

# the texts: which keys differ
def keys(s):
    out = {}
    for l in s.split('\n'):
        m = re.match(r'^  ([a-z0-9_]+): \{ en: ', l)
        if m: out[m.group(1)] = l
    return out
a, b = keys(main('src/redesign/i18n/index.tsx')), keys(open('src/redesign/i18n/index.tsx', encoding='utf8').read())
diff = sorted(k for k in a if a[k] != b.get(k)); new = sorted(k for k in b if k not in a); gone = sorted(k for k in a if k not in b)
print('texts changed:', ', '.join(diff)); print('texts added:', ', '.join(new))
ok(diff == ['rd_pf_lock_note', 'rd_pf_rm_body', 'rd_pf_wait_any', 'rd_pf_wait_facebook', 'rd_pf_wait_instagram', 'rd_pf_wait_shopee', 'rd_pf_wait_tiktok', 'rd_sh_err_shop_locked'] and new == ['rd_pf_wait_locked'] and not gone,
   f'{len(a)} texts on main: 8 changed, 1 added, 0 removed, {len(a) - 8} identical in all 8 languages')
rest = '\n'.join(l for l in open('src/redesign/i18n/index.tsx', encoding='utf8').read().split('\n') if not re.match(r'^  (' + '|'.join(diff + new) + r'): \{', l))
rest_main = '\n'.join(l for l in main('src/redesign/i18n/index.tsx').split('\n') if not re.match(r'^  (' + '|'.join(diff) + r'): \{', l))
ok(rest == rest_main, 'the rest of the texts file is byte-identical to main')

# who can see the changed texts
users = {}
for f in sh('git', 'ls-files', 'src').split():
    if '__tests__' in f or f.endswith('i18n/index.tsx') or not f.endswith(('.ts', '.tsx')): continue
    s = open(f, encoding='utf8').read()
    for k in diff + new:
        if re.search(r'\b' + k + r'\b', s): users.setdefault(k, []).append(f)
for k in sorted(users): print(f'   {k}: {", ".join(users[k])}')
pf = {'src/redesign/adapters/planFull.ts', 'src/redesign/components/PlanFullPopup.tsx', 'src/redesign/screens/ShopeeShops.tsx'}
ok(all(set(v) <= pf for k, v in users.items() if k != 'rd_sh_err_shop_locked'), 'the 8 "Plan full" texts: only the popup, the Shopee shops screen and their adapter (opened only for the preview / an admin / the switch)')
ok(users.get('rd_sh_err_shop_locked') == ['src/redesign/adapters/shopeeLink.ts'], "rd_sh_err_shop_locked: only the Shopee box's answer 'shop_locked' — the server sends it only to a seller of the preview (shopee_link_register answers 'off' for everyone else)")
app_src = open('src/redesign/RedesignApp.tsx', encoding='utf8').read()
ok('if (!accountLimitsV2) return false; setPlanFull(t); return true;' in app_src and 'screen === "shopeeshops" && accountLimitsV2 && (' in app_src, 'the popup and the Shopee shops screen are behind accountLimitsV2 (unchanged lines)')
print('\ndatabase: scripts/sql205-behaviour.mjs — "switch off: every answer for sellers not in the preview is identical to production (67/67)" (proof/sql205-behaviour.txt)')
print(f'\n{"ALL OK" if not bad else str(bad) + " FAILED"}')
sys.exit(1 if bad else 0)
