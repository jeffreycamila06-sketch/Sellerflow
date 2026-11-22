// Seller Website redesign proposal — draws the mock pages (NOT app code). Every section, step, field and
// button of today's buyer pages is here, in today's order; only the look is new.
(function () {
  const { photo, icon, brand, BR } = window.ART;
  const q = new URLSearchParams(location.search);
  const shop = window.SHOPS[q.get("shop")] || window.SHOPS.budgetukay;
  const page = q.get("page") || "home";
  const bare = q.get("bare") === "1";
  const L = shop.look;

  // ── the seller's colours, made safe (same idea as today's guard in src/website/v3/look.ts) ──
  const lum = (h) => { const n = parseInt(h.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a, b, t) => { const c = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = c(a), y = c(b); return "#" + x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, "0")).join(""); };
  const textOn = (h) => (contrast(h, "#ffffff") >= contrast(h, "#151515") ? "#ffffff" : "#151515");
  const paper = L.dark ? "#111112" : "#fdfdfc", ink = L.dark ? "#f1f0ed" : "#151515";
  const readable = (c) => { let o = c; for (let k = 1; contrast(o, paper) < 4.5 && k <= 10; k++) o = mix(c, ink, k / 10); return o; };
  const btn = contrast(L.btn, paper) < 1.6 ? ink : L.btn;
  const vars = { "--sign": L.top1, "--on-sign": textOn(L.top1), "--sign2": L.top2, "--btn": btn, "--on-btn": textOn(btn), "--acct": readable(btn), "--sale": L.sale, "--on-sale": textOn(L.sale), "--sale-t": readable(L.sale) };

  const cur = shop.cur;
  const money = (n) => `<span class="cur">${cur}</span>${Number(n).toLocaleString("en-US")}`;
  const P = (id) => shop.products.find((x) => x.id === id);
  const img = (x, v, alt) => `<img src="${photo(x.kind, x.ground, x.col, v)}" alt="${alt || x.name || ""}" loading="lazy">`;
  const link = (pg) => `?shop=${shop.key}&page=${pg}${bare ? "&bare=1" : ""}`;
  const shape = shop.shape === "square" ? ' style="aspect-ratio:1"' : "";

  function card(x) {
    const tag = x.off ? `<span class="tagp sale">${x.off}% off</span>` : x.left ? `<span class="tagp">${x.left} left</span>` : x.isNew ? `<span class="tagp">New</span>` : "";
    return `<a class="card" href="${link("product")}">
      <div class="ph"${shape}>${img(x)}${tag}<span class="savep" role="button" aria-label="Save"><i>${icon("heart", 17)}</i></span><span class="quick" role="button" aria-label="Add to cart">${icon("plus", 18)}</span></div>
      <div class="cap1"><span class="sw">${(x.sw || []).map((c) => `<i style="background:${c}"></i>`).join("")}</span><span>${x.sold ? x.sold + " sold" : ""}</span></div>
      <div class="cname">${x.name}</div>
      ${x.meta ? `<div class="cmeta">${x.meta}</div>` : ""}
      <div class="price num${x.old ? " cut" : ""}"><span class="now">${money(x.price)}</span>${x.old ? `<span class="was">${cur}${x.old}</span>` : ""}</div>
    </a>`;
  }
  const secHead = (title, more, extra) => `<div class="sec-h"><h2>${title}</h2><div class="more">${extra || ""}${more ? `<a class="u" href="#">${more}</a>` : ""}<span class="arrows"><button aria-label="Back">${icon("back", 18)}</button><button aria-label="Next">${icon("chev", 18)}</button></span></div></div>`;
  const row = (ids) => `<div class="row">${ids.map((i) => card(P(i))).join("")}</div>`;

  function header(inner) {
    const cartN = page === "cart" || page === "checkout" ? 2 : 0;
    const acts = `<a class="ibtn" href="#" aria-label="Saved">${icon("heart")}</a><a class="ibtn" href="${link("cart")}" aria-label="Cart">${icon("cart")}${cartN ? `<span class="count">${cartN}</span>` : ""}</a>`;
    const field = `<div class="sfield" role="search">${icon("search", 18)}<span>Search in ${shop.name}</span></div>`;
    return `<header class="sign">
      ${shop.announcement ? `<div class="sign-note"><div class="wrap">${shop.announcement}</div></div>` : ""}
      <div class="wrap">
        <div class="sign-row">
          ${inner ? `<a class="ibtn" href="${link("home")}" aria-label="Back" style="margin-left:-12px">${icon("back")}</a>` : ""}
          <span class="logo">${shop.letter}</span><span class="sname">${shop.name}</span>
          <span class="wide" style="flex:1">${field}</span>
          ${inner ? `<a class="ibtn phone" href="#" aria-label="Search in ${shop.name}">${icon("search")}</a>` : ""}${acts}
        </div>
        ${inner ? "" : `<div class="sign-search phone">${field}</div>`}
        <nav class="sign-nav">${shop.nav.map((n, i) => `<a href="#"${i === 0 && !inner ? ' class="on"' : ""}>${n}</a>`).join("")}</nav>
      </div>
      ${L.top2.toLowerCase() !== L.top1.toLowerCase() ? '<div class="stripe"></div>' : ""}
    </header>`;
  }
  function footer() {
    return `<footer class="wrap"><div class="foot">
      <div><div class="fname">${shop.name}</div><div class="ftag">${shop.tagline}</div><div class="soc">${shop.socials.map((s) => `<a href="#" aria-label="${BR[s][0]}">${brand(s, 24)}</a>`).join("")}</div></div>
      <div class="cols"><div><h3>Shop</h3><ul><li><a href="#">All products</a></li><li><a href="#">New arrivals</a></li><li><a href="#">Best sellers</a></li><li><a href="#">On sale</a></li></ul></div>
        <div><h3>Help</h3><ul><li><a href="#">How to order</a></li><li><a href="#">Track my order</a></li><li><a href="#">Shipping &amp; pickup</a></li><li><a href="#">Returns</a></li></ul></div></div>
      <div><h3>We accept</h3><p class="plain">${shop.pay.map((x) => x[0]).join(" · ")}</p><h3 style="margin-top:14px">We ship with</h3><p class="plain">${shop.ship.map((x) => x[0]).join(" · ")}</p></div>
      <div class="legal"><span>© 2026 ${shop.name}</span><span>English ▾</span><span>Powered by <a class="u" href="#">SellerFlowLive</a></span></div>
    </div></footer>`;
  }
  const tabbar = (on) => `<nav class="tab phone">${[["home", "Home", "home"], ["grid", "Shop", "home"], ["cart", "Cart", "cart"], ["box", "Orders", "order"], ["chat", "Chat", "home"]].map(([ic, t, pg], i) => `<a href="${link(pg)}"${i === on ? ' class="on"' : ""}>${icon(ic, 22)}<span>${t}</span></a>`).join("")}</nav>`;

  function home() {
    const t = shop.tiles;
    return `${header(false)}<main class="wrap">
      <section class="cover">
        <div><h1>${shop.slide.title}</h1><p>${shop.slide.text}</p>
          <div class="facts wide">${shop.trust.map(([i, s]) => `<div class="fact">${icon(i, 19)}<span>${s}</span></div>`).join("")}</div></div>
        <div class="tiles">${t.map(([n, k, g, c]) => `<a class="tile" href="#"><div class="ph"${shape}>${img({ kind: k, ground: g, col: c }, 0, n)}</div><div class="cap"><span>${n}</span>${icon("right", 18)}</div></a>`).join("")}</div>
      </section>
      <div class="facts phone">${shop.trust.map(([i, s]) => `<div class="fact">${icon(i, 19)}<span>${s}</span></div>`).join("")}</div>
      <section class="sec">${secHead("Best sellers", "See all")}${row(shop.rows.best)}</section>
      <section class="sec">${secHead(`<span class="sale-h">On sale${shop.flashEnds ? `<span class="ends">ends in <b class="num">${shop.flashEnds}</b></span>` : ""}</span>`, "See all")}${row(shop.rows.sale)}</section>
      <section class="sec"><div class="coupon"><h3>${shop.promo.title}</h3><p>${shop.promo.text}</p><a class="btn line sm" href="#">${shop.promo.button}</a></div></section>
      <section class="sec">${secHead("Shop by category", "")}<div class="row catrow">${shop.cats.map(([n, from, k, g, c]) => `<a class="card cat" href="#"><div class="ph"${shape}>${img({ kind: k, ground: g, col: c }, 0, n)}</div><b>${n}</b><span>from ${cur}${from.toLocaleString("en-US")}</span></a>`).join("")}</div></section>
      <section class="sec"><div class="live"><div class="lab"><i></i>Next live</div><div class="when">${shop.live.when}<small>${shop.live.where}</small></div><p>${shop.live.text}</p><a class="btn line sm" href="#">${shop.live.button}</a></div></section>
      <section class="sec">${secHead("New arrivals", "See all")}${row(shop.rows.fresh)}</section>
      <section class="sec about">${secHead(`About ${shop.name}<span class="verified">${icon("check", 14)}Verified seller</span>`, "")}<p>${shop.about}</p>
        <dl class="lead">${shop.stats.map(([k, v]) => `<div><dt>${k}</dt><i></i><dd class="num">${v}</dd></div>`).join("")}</dl></section>
      <div class="two">
        <section class="sec">${secHead("How to order", "")}<ol class="howto">
          <li><span class="n num">1</span><b>Add to cart</b><span>Pick your size and colour. No account needed.</span></li>
          <li><span class="n num">2</span><b>Choose delivery &amp; payment</b><span>${shop.ship.map((x) => x[0]).join(", ")} · ${shop.pay.map((x) => x[0]).join(", ")}</span></li>
          <li><span class="n num">3</span><b>Track your order</b><span>You get a link to follow your order until it reaches you.</span></li></ol></section>
        <section class="sec">${secHead("Good to know", "")}<ul class="faq">${shop.faq.map((f) => `<li><button>${f}${icon("plus", 18)}</button></li>`).join("")}</ul></section>
      </div>
    </main>${footer()}<a class="fab" href="#" aria-label="Chat with ${shop.name}">${icon("chat", 24)}</a>${tabbar(0)}`;
  }

  function product() {
    const d = shop.detail, x = P(d.id);
    return `${header(true)}<main class="wrap">
      <nav class="crumb"><a class="u" href="${link("home")}">${d.crumb[0]}</a> › <a class="u" href="#">${d.crumb[1]}</a> › ${x.name}</nav>
      <div class="pd">
        <div class="gal"><div class="big"><div class="ph"${shape}>${img(x)}<span class="n">1 / 3</span></div></div>
          <div class="thumbs">${[0, 1, 2].map((v) => `<div class="ph${v === 0 ? " on" : ""}">${img(x, v)}</div>`).join("")}</div></div>
        <div>
          <h1 class="pname">${x.name}</h1><div class="psold">${x.sold} sold</div>
          <div class="price pprice num${x.old ? " cut" : ""}"><span class="now">${money(x.price)}</span>${x.old ? `<span class="was" style="font-size:15px">${cur}${x.old}</span><span class="off">−${x.off}%</span>` : ""}</div>
          ${shop.flashEnds && x.old ? `<div class="flash">${icon("clock", 18)}<span>Flash sale price · ends in <b class="num">${shop.flashEnds}</b></span></div>` : ""}
          ${d.options.map(([name, sel, vals], i) => `<div class="optl"><span>${name}: <b>${sel}</b></span>${i === d.options.length - 1 ? `<a class="u" href="#">${d.guide}</a>` : ""}</div>
            <div class="opts">${vals.map(([v, sw, no]) => `<button class="opt${v === sel ? " on" : ""}${no ? " no" : ""}">${sw ? `<i class="dot" style="background:${sw}"></i>` : ""}${v}</button>`).join("")}</div>`).join("")}
          <div class="stock">${d.stock}</div>
          <div class="buyrow"><span class="stepper"><button aria-label="Less">${icon("minus", 16)}</button><b>1</b><button aria-label="More">${icon("plus", 16)}</button></span><button class="btn line sm">${icon("heart", 17)}Save</button></div>
          <div class="buy2 wide"><button class="btn line">Add to cart</button><button class="btn main">Buy now</button></div>
          <ul class="plist">${d.facts.map(([i, a, b]) => `<li>${icon(i, 20)}<div><b>${a}</b><span>${b}</span></div></li>`).join("")}</ul>
          <section class="det"><h2>Details</h2><dl>${d.details.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl><p>${d.text}</p></section>
        </div>
      </div>
      <section class="sec">${secHead("You may also like", "")}${row(d.also)}</section>
    </main>
    <div class="bar phone"><a class="ibtn" href="#" aria-label="Chat">${icon("chat")}</a><button class="btn line">Add to cart</button><button class="btn main">Buy now</button></div>${footer()}`;
  }

  const trail = (n) => `<nav class="trail">${["Cart", "Details", "Done"].map((s, i) => `${i ? "<i></i>" : ""}${i + 1 === n ? `<b>${i + 1} ${s}</b>` : `<span>${i + 1} ${s}</span>`}`).join("")}</nav>`;
  const cartLines = () => shop.cart.map(([id, v, n]) => ({ x: P(id), v, n }));
  const subtotal = () => cartLines().reduce((s, l) => s + l.x.price * l.n, 0);
  const mini = () => cartLines().map((l) => `<div class="mini"><div class="ph">${img(l.x)}</div><div><div class="nm">${l.x.name}</div><div class="vr">${l.v ? l.v + " · " : ""}×${l.n}</div></div><div class="amt num">${money(l.x.price)}</div></div>`).join("");

  function cart() {
    const sub = subtotal(), need = shop.freeOver - sub;
    const summary = `<section class="block"><h2>Order summary</h2><dl class="rows"><div><dt>Items (2)</dt><dd class="num">${money(sub)}</dd></div><div><dt>Shipping</dt><dd>from ${cur}60</dd></div><div class="tot"><dt>Subtotal</dt><dd class="num">${money(sub)}</dd></div></dl>
      <button class="btn main full wide" style="margin-top:18px">Checkout (2)</button></section>`;
    return `${header(true)}<main class="wrap">${trail(1)}
      <div class="side"><div>
        <section class="block" style="padding-bottom:6px"><div class="free">Add <b class="num">${money(need)}</b> more for free shipping</div><div class="track3"><i style="width:${Math.round((sub / shop.freeOver) * 100)}%"></i></div>
          ${cartLines().map((l) => `<div class="cline"><div class="ph">${img(l.x)}</div><div><div class="nm">${l.x.name}</div>${l.v ? `<div class="vr">${l.v}</div>` : ""}<div class="ctl"><span class="stepper"><button aria-label="Less">${icon("minus", 16)}</button><b>${l.n}</b><button aria-label="More">${icon("plus", 16)}</button></span><a class="u" href="#" style="padding:13px 0">Remove</a></div></div><div class="amt num">${money(l.x.price)}</div></div>`).join("")}
        </section>
        <section class="sec" style="margin-top:28px">${secHead("Goes well with", "")}${row(shop.goes)}</section>
        <div class="phone" style="margin-top:28px">${summary}</div>
      </div><aside class="wide">${summary}</aside></div>
    </main>
    <div class="bar phone"><div class="sum"><small>Subtotal</small><b class="num">${money(sub)}</b></div><a class="btn main" href="${link("checkout")}">Checkout (2)</a></div>`;
  }

  function checkout() {
    const sub = subtotal(), total = sub + 60;
    const summary = `<section class="block"><h2>Order summary</h2><div style="margin-top:8px">${mini()}</div>
      <dl class="rows"><div><dt>Items (2)</dt><dd class="num">${money(sub)}</dd></div><div><dt>Shipping · 7-11</dt><dd class="num">${money(60)}</dd></div><div class="tot"><dt>Total</dt><dd class="num">${money(total)}</dd></div></dl>
      <p class="hint" style="margin-top:8px">Add ${cur}${shop.freeOver - sub} more for free shipping</p>
      <button class="btn main full wide" style="margin-top:18px">Place order · ${cur}${total.toLocaleString("en-US")}</button>
      <div class="notice">${icon("lock", 17)}<span>Your name, phone and store go only to ${shop.name} for this order. They are also saved on this device to fill in next time.</span></div></section>`;
    const choice = (on, a, b, fee) => `<label class="choice${on ? " on" : ""}"><i class="radio"></i><div><b>${a}</b><span>${b}</span></div>${fee != null ? `<span class="fee num">${money(fee)}</span>` : "<span></span>"}</label>`;
    return `${header(true)}<main class="wrap">${trail(2)}
      <div class="side"><div>
        <section class="block"><div class="bh"><h2>Your details</h2><a class="u" href="#" style="font-size:13.5px;padding:12px 0;margin:-12px 0">Not you?</a></div><p class="hint">Filled in from this device</p>
          <div class="fld"><label>Name (for the parcel)</label><div class="inp">Demo Buyer</div></div>
          <div class="fld"><label>Mobile number</label><div class="inp">0900 000 000</div></div>
          <div class="fld"><label>Your FB / LINE / IG name (optional)</label><div class="inp"></div></div></section>
        <section class="block"><h2>Delivery</h2><div class="choices">${shop.ship.map(([a, b, f], i) => choice(i === 0, a, b, f)).join("")}</div>
          <div class="sub">Pickup store</div><div class="store"><div><b>板橋門市</b><span>#123456</span></div><button class="btn line sm">Change</button></div></section>
        <section class="block"><h2>Payment</h2><div class="choices">${shop.pay.map(([a, b], i) => choice(i === 0, a, b, null)).join("")}</div>
          <div class="notice">${icon("info", 17)}<span>After you place the order, the shop's account / QR shows. Pay within 24 hours and upload your receipt.</span></div></section>
        <section class="block"><h2>Note to seller (optional)</h2><div class="fld" style="margin-top:10px"><div class="inp area"></div></div></section>
        <div class="phone">${summary}</div>
      </div><aside class="wide">${summary}</aside></div>
    </main>
    <div class="bar phone"><div class="sum"><small>Total</small><b class="num">${money(total)}</b></div><a class="btn main" href="${link("order")}">Place order</a></div>`;
  }

  function order() {
    const sub = subtotal(), total = sub + 60, o = shop.order;
    const summary = `<section class="block"><h2>Order summary</h2><div style="margin-top:8px">${mini()}</div>
      <dl class="rows"><div><dt>Subtotal</dt><dd class="num">${money(sub)}</dd></div><div><dt>Shipping</dt><dd class="num">${money(60)}</dd></div><div class="tot"><dt>Total</dt><dd class="num">${money(total)}</dd></div></dl>
      <dl class="rows" style="margin-top:14px"><div><dt>Ship to</dt><dd>${o.store}</dd></div><div><dt>Payment</dt><dd>Bank transfer</dd></div><div><dt>Name</dt><dd>Demo Buyer · ***000</dd></div></dl></section>
      <section class="block"><h2>Your order link</h2><p class="hint">Keep this link to check your order and upload your receipt.</p><div class="linkrow"><div class="inp">${shop.key}.sellerflowlive.com/o/…</div><button class="btn line sm">${icon("copy", 16)}Copy</button></div></section>
      <a class="btn line full" href="${link("home")}">Back to shop</a>`;
    return `${header(true)}<main class="wrap">${trail(3)}
      <div class="side"><div>
        <section class="block"><div class="oh"><h1>Order <span class="num">${o.no}</span></h1><span class="state">Waiting for payment</span></div>
          <ol class="steps"><li class="done"><i>${icon("check", 13)}</i>Order placed</li><li class="now"><i></i>Waiting for payment</li><li><i></i>The shop is packing your order</li><li><i></i>Shipped</li></ol></section>
        <section class="block"><div class="payh"><h2>Pay by bank transfer</h2><span class="amt num">${money(total)}</span></div>
          <dl class="rows">${o.bank.slice(0, 2).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
          <div class="acctno"><div><small>${o.bank[2][0]}</small><b class="num">${o.bank[2][1]}</b></div><button class="btn line sm">${icon("copy", 16)}Copy</button></div>
          <div class="cancel">${icon("clock", 18)}<span>Auto-cancels in <b class="num">${o.cancelIn}</b></span></div>
          <button class="btn main full">${icon("upload", 18)}Upload receipt</button><p class="hint" style="margin-top:8px">Orders not paid within 24 hours are cancelled.</p></section>
        <section class="block"><h2>Message seller</h2><p class="hint">Your order is copied when you tap — paste it in the chat.</p><div class="chat4">${shop.chats.map((c) => `<button class="btn line sm">${brand(c, 20)}${BR[c][0]}</button>`).join("")}</div></section>
        <div class="phone">${summary}</div>
      </div><aside class="wide">${summary}</aside></div>
    </main>`;
  }

  const PAGES = { home, product: shop.detail ? product : home, cart: shop.cart ? cart : home, checkout: shop.cart ? checkout : home, order: shop.order ? order : home };
  const root = document.getElementById("root");
  root.innerHTML = `<div class="shop f-${L.font}${L.dark ? " dark" : ""}${L.corners === "round" ? " round" : ""}">${(PAGES[page] || home)()}</div>`;
  const el = root.firstElementChild;
  Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v));
  document.documentElement.style.background = paper;
  const bar = document.getElementById("bar");
  if (bare) bar.remove();
  else bar.innerHTML = `<b>Proposal mock</b><span>Shop: ${Object.values(window.SHOPS).map((s) => `<a href="?shop=${s.key}&page=${s.detail || page === "home" ? page : "home"}"${s.key === shop.key ? ' class="on"' : ""}>${s.name} (${s.kind})</a>`).join("")}</span><span>Page: ${Object.keys(PAGES).map((p) => `<a href="?shop=${shop.key}&page=${p}"${p === page ? ' class="on"' : ""}>${p}</a>`).join("")}</span><span style="opacity:.7">Product pictures are drawn stand-ins for the seller's photos.</span>`;
})();
