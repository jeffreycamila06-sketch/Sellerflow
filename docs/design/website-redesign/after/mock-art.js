// Seller Website redesign proposal — drawings used by the mock (NOT app code).
// 1) PHOTO STAND-INS: plain drawings on a studio-like ground. They hold the place of the seller's own
//    photos, which a real shop uploads. They are not part of the design.
// 2) Line icons (one stroke weight) that replace today's emoji.
(function () {
  const shade = (hex, t) => {
    const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const to = t < 0 ? 0 : 255, k = Math.abs(t);
    return "#" + c.map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, "0")).join("");
  };
  // each drawing: (c = object colour, d = darker, l = lighter) → svg inner markup, in a 400 × 500 box
  const LONG = "M112 152 L165 126 Q200 164 235 126 L288 152 L332 362 L292 374 L272 244 V412 H128 V244 L108 374 L68 362 Z";
  const SHAPES = {
    tee: (c, d) => `<path d="M120 152 L165 126 Q200 162 235 126 L280 152 L336 202 L300 246 L274 226 V402 H126 V226 L100 246 L64 202 Z" fill="${c}"/><path d="M165 126 Q200 162 235 126" fill="none" stroke="${d}" stroke-width="5"/>`,
    hoodie: (c, d) => `<ellipse cx="200" cy="130" rx="50" ry="40" fill="${d}"/><path d="${LONG}" fill="${c}"/><path d="M152 330 H248 L260 382 H140 Z" fill="${d}"/><path d="M188 160 V214 M212 160 V214" stroke="${d}" stroke-width="4"/>`,
    jacket: (c, d) => `<path d="${LONG}" fill="${c}"/><path d="M200 150 V412" stroke="${d}" stroke-width="4"/><path d="M165 126 L200 176 L235 126" fill="none" stroke="${d}" stroke-width="5"/><rect x="146" y="262" width="40" height="34" fill="${d}"/><rect x="214" y="262" width="40" height="34" fill="${d}"/>`,
    shirt: (c, d) => `<path d="${LONG}" fill="${c}"/><path d="M200 150 V412" stroke="${d}" stroke-width="3"/><path d="M165 126 L200 170 L235 126" fill="none" stroke="${d}" stroke-width="5"/><g fill="${d}"><circle cx="200" cy="210" r="4"/><circle cx="200" cy="260" r="4"/><circle cx="200" cy="310" r="4"/><circle cx="200" cy="360" r="4"/></g><path d="M128 280 H272 M128 340 H272" stroke="${d}" stroke-width="2" opacity=".5"/>`,
    jeans: (c, d) => `<path d="M134 96 H266 L284 424 H216 L200 196 L184 424 H116 Z" fill="${c}"/><path d="M134 122 H266" stroke="${d}" stroke-width="4"/><path d="M200 122 V196" stroke="${d}" stroke-width="3"/>`,
    dress: (c, d) => `<path d="M166 100 L182 100 Q200 132 218 100 L234 100 L250 204 L304 414 H96 L150 204 Z" fill="${c}"/><path d="M150 204 H250" stroke="${d}" stroke-width="4"/>`,
    skirt: (c, d) => `<path d="M148 160 H252 L306 384 H94 Z" fill="${c}"/><rect x="148" y="160" width="104" height="18" fill="${d}"/><path d="M180 178 L166 384 M220 178 L234 384 M200 178 V384" stroke="${d}" stroke-width="2" opacity=".6"/>`,
    cap: (c, d) => `<path d="M108 300 Q108 180 200 180 Q292 180 292 300 Z" fill="${c}"/><path d="M290 296 Q352 296 368 322 Q300 310 108 312 L108 296 Z" fill="${d}"/><circle cx="200" cy="182" r="7" fill="${d}"/>`,
    tote: (c, d) => `<path d="M150 210 Q150 110 200 110 Q250 110 250 210" fill="none" stroke="${d}" stroke-width="10"/><rect x="112" y="204" width="176" height="200" fill="${c}"/><rect x="112" y="204" width="176" height="16" fill="${d}"/>`,
    sneaker: (c, d, l) => `<path d="M70 330 Q70 296 104 296 L168 296 Q204 240 252 244 L276 290 Q336 302 348 334 L348 352 H70 Z" fill="${c}"/><rect x="66" y="350" width="286" height="20" rx="6" fill="${l}"/><path d="M186 286 L226 262 M204 300 L244 276" stroke="${l}" stroke-width="5"/>`,
    jar: (c, d, l) => `<rect x="148" y="126" width="104" height="36" rx="6" fill="${d}"/><rect x="134" y="162" width="132" height="238" rx="22" fill="${c}"/><rect x="134" y="226" width="132" height="110" fill="${l}"/><path d="M158 262 H242 M158 284 H218" stroke="${d}" stroke-width="5"/>`,
    bottle: (c, d, l) => `<rect x="180" y="78" width="40" height="30" rx="4" fill="${d}"/><path d="M184 108 H216 V150 Q252 166 252 204 V386 Q252 408 230 408 H170 Q148 408 148 386 V204 Q148 166 184 150 Z" fill="${c}"/><rect x="148" y="236" width="104" height="110" fill="${l}"/><path d="M166 270 H234 M166 292 H212" stroke="${d}" stroke-width="5"/>`,
    box: (c, d, l) => `<rect x="86" y="160" width="228" height="228" rx="8" fill="${l}"/><rect x="86" y="160" width="228" height="228" rx="8" fill="none" stroke="${d}" stroke-width="4"/><g fill="${c}"><circle cx="142" cy="230" r="34"/><circle cx="200" cy="230" r="34"/><circle cx="258" cy="230" r="34"/><circle cx="142" cy="318" r="34"/><circle cx="200" cy="318" r="34"/><circle cx="258" cy="318" r="34"/></g><g fill="${d}" opacity=".35"><circle cx="142" cy="226" r="14"/><circle cx="200" cy="226" r="14"/><circle cx="258" cy="226" r="14"/><circle cx="142" cy="314" r="14"/><circle cx="200" cy="314" r="14"/><circle cx="258" cy="314" r="14"/></g>`,
    loaf: (c, d) => `<path d="M82 336 Q82 214 200 214 Q318 214 318 336 V372 Q318 388 302 388 H98 Q82 388 82 372 Z" fill="${c}"/><path d="M140 244 L160 284 M190 232 L210 276 M240 238 L260 280" stroke="${d}" stroke-width="7" stroke-linecap="round"/>`,
    tin: (c, d, l) => `<rect x="104" y="232" width="192" height="140" rx="12" fill="${c}"/><ellipse cx="200" cy="232" rx="96" ry="28" fill="${l}"/><ellipse cx="200" cy="232" rx="70" ry="18" fill="none" stroke="${d}" stroke-width="3"/><rect x="104" y="286" width="192" height="46" fill="${d}" opacity=".5"/>`,
    pouch: (c, d, l) => `<path d="M128 118 H272 L290 404 H110 Z" fill="${c}"/><path d="M128 118 H272 L274 148 H126 Z" fill="${d}"/><rect x="150" y="212" width="100" height="120" fill="${l}"/><path d="M166 246 H234 M166 270 H216 M166 294 H226" stroke="${d}" stroke-width="5"/>`,
    earbuds: (c, d, l) => `<rect x="118" y="232" width="164" height="136" rx="46" fill="${c}"/><path d="M118 286 H282" stroke="${d}" stroke-width="4"/><circle cx="200" cy="322" r="6" fill="${l}"/><g fill="${l}"><rect x="150" y="128" width="30" height="64" rx="15"/><rect x="220" y="128" width="30" height="64" rx="15"/></g><g fill="${d}"><circle cx="165" cy="146" r="8"/><circle cx="235" cy="146" r="8"/></g>`,
    phone: (c, d, l) => `<rect x="132" y="86" width="136" height="320" rx="24" fill="${c}"/><rect x="150" y="104" width="52" height="58" rx="14" fill="${d}"/><circle cx="166" cy="121" r="9" fill="${l}"/><circle cx="187" cy="145" r="9" fill="${l}"/>`,
    charger: (c, d, l) => `<rect x="164" y="132" width="16" height="50" rx="3" fill="${d}"/><rect x="220" y="132" width="16" height="50" rx="3" fill="${d}"/><rect x="128" y="178" width="144" height="180" rx="22" fill="${c}"/><rect x="176" y="300" width="48" height="16" rx="8" fill="${d}"/><path d="M182 230 H218" stroke="${l}" stroke-width="5"/>`,
    cable: (c, d) => `<circle cx="200" cy="250" r="96" fill="none" stroke="${c}" stroke-width="18"/><circle cx="200" cy="250" r="62" fill="none" stroke="${c}" stroke-width="18"/><rect x="286" y="318" width="26" height="62" rx="6" fill="${d}" transform="rotate(-38 299 349)"/><rect x="88" y="120" width="26" height="62" rx="6" fill="${d}" transform="rotate(-38 101 151)"/>`,
    powerbank: (c, d, l) => `<rect x="126" y="104" width="148" height="296" rx="22" fill="${c}"/><g fill="${l}"><circle cx="160" cy="140" r="6"/><circle cx="182" cy="140" r="6"/><circle cx="204" cy="140" r="6"/></g><circle cx="226" cy="140" r="6" fill="${d}"/><rect x="170" y="366" width="60" height="12" rx="6" fill="${d}"/>`,
    speaker: (c, d, l) => `<rect x="124" y="126" width="152" height="262" rx="70" fill="${c}"/><circle cx="200" cy="296" r="50" fill="${d}"/><circle cx="200" cy="296" r="22" fill="${c}"/><circle cx="200" cy="184" r="20" fill="${d}"/><circle cx="200" cy="184" r="7" fill="${l}"/>`,
    watch: (c, d, l) => `<rect x="166" y="70" width="68" height="360" rx="16" fill="${d}"/><rect x="134" y="186" width="132" height="132" rx="34" fill="${c}"/><rect x="154" y="206" width="92" height="92" rx="20" fill="${l}"/><path d="M200 226 V254 L220 266" fill="none" stroke="${d}" stroke-width="5" stroke-linecap="round"/>`,
    ringlight: (c, d, l) => `<path d="M200 300 V410 M150 410 H250" stroke="${d}" stroke-width="10" stroke-linecap="round"/><circle cx="200" cy="200" r="100" fill="none" stroke="${c}" stroke-width="26"/><circle cx="200" cy="200" r="100" fill="none" stroke="${l}" stroke-width="8"/>`,
    serum: (c, d, l) => `<rect x="184" y="84" width="32" height="56" rx="12" fill="${d}"/><rect x="176" y="136" width="48" height="34" rx="4" fill="${l}"/><rect x="150" y="170" width="100" height="226" rx="16" fill="${c}"/><rect x="150" y="238" width="100" height="92" fill="${l}"/><path d="M168 270 H232 M168 292 H210" stroke="${d}" stroke-width="5"/>`,
    creamjar: (c, d, l) => `<rect x="122" y="216" width="156" height="54" rx="8" fill="${d}"/><rect x="132" y="270" width="136" height="104" rx="14" fill="${c}"/><rect x="156" y="296" width="88" height="48" fill="${l}"/>`,
    lipstick: (c, d, l) => `<path d="M180 156 L220 122 V230 H180 Z" fill="${c}"/><rect x="172" y="228" width="56" height="42" fill="${l}"/><rect x="164" y="268" width="72" height="140" rx="4" fill="${d}"/>`,
    tube: (c, d, l) => `<path d="M156 100 H244 L258 372 H142 Z" fill="${c}"/><rect x="164" y="372" width="72" height="42" rx="6" fill="${d}"/><rect x="170" y="190" width="60" height="110" fill="${l}"/><path d="M182 222 H218 M182 244 H208" stroke="${d}" stroke-width="5"/>`,
    compact: (c, d, l) => `<circle cx="200" cy="262" r="108" fill="${c}"/><circle cx="200" cy="262" r="78" fill="${l}"/><circle cx="200" cy="262" r="78" fill="none" stroke="${d}" stroke-width="3"/>`,
  };
  const TR = ["", "translate(-150 -150) scale(1.75)", "translate(46 60) scale(.77) rotate(-8 200 250)"];
  /** A stand-in photo as a data URL. kind = a SHAPES key, ground = backdrop colour, col = object colour, view 0-2. */
  function photo(kind, ground, col, view) {
    const v = view || 0, dark = parseInt(ground.slice(1, 3), 16) < 90;
    const floor = shade(ground, dark ? 0.06 : -0.06), wall2 = shade(ground, dark ? 0.03 : 0.35);
    const body = (SHAPES[kind] || SHAPES.tee)(col, shade(col, -0.28), shade(col, 0.55));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wall2}"/><stop offset="1" stop-color="${ground}"/></linearGradient><radialGradient id="s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity="${dark ? 0.5 : 0.22}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs><rect width="400" height="500" fill="url(#w)"/><rect y="418" width="400" height="82" fill="${floor}"/><g transform="${TR[v]}"><ellipse cx="200" cy="420" rx="150" ry="16" fill="url(#s)"/>${body}</g></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
  // line icons, 24 × 24, stroke 1.6
  const I = {
    search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm9 2-4.2-4.2",
    heart: "M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20Z",
    cart: "M3 4h2.2l2.3 11h10.4L20 7.5H6.3M9.5 20a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2Zm7.5 0a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2Z",
    home: "M4 11 12 4l8 7v8.5h-5.5V14h-5v5.5H4Z",
    grid: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
    box: "M4 8 12 4l8 4v8l-8 4-8-4Zm0 0 8 4 8-4M12 12v8",
    chat: "M4 5h16v11H9l-5 4Z",
    back: "M15 5 8 12l7 7",
    right: "M5 12h14m-5-5 5 5-5 5",
    chev: "m9 6 6 6-6 6",
    check: "m5 12.5 4.5 4.5L19 7.5",
    copy: "M9 9h10v11H9zM5 15V4h10",
    truck: "M3 6h11v10H3zM14 9h4l3 3.5V16h-7M7.5 19a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Zm9.5 0a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z",
    cash: "M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 10v4m12-4v4",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2",
    shield: "M12 3 5 6v5.5c0 4.3 3 7.6 7 9.5 4-1.9 7-5.2 7-9.5V6Zm-3 9 2.2 2.2L15.5 10",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    tag: "M4 4h8l8 8-8 8-8-8Zm4.5 4.5h.01",
    store: "M4 10 5.5 4h13L20 10M5 10v10h14V10M9.5 20v-5h5v5M4 10a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 10",
    upload: "M12 16V5m-4.5 4L12 4.5 16.5 9M5 19h14",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5h.01",
  };
  const icon = (k, size) => `<svg class="ic" width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${I[k]}"/></svg>`;
  // the chat / social marks: the official marks are used in the real shop (src/website/brandData.ts, Simple Icons).
  // The mock draws a plain coloured square with the first letter so no mark is redrawn by hand.
  const BR = { line: ["LINE", "#00C300"], messenger: ["Messenger", "#00B2FF"], whatsapp: ["WhatsApp", "#25D366"], instagram: ["Instagram", "#FF0069"], facebook: ["Facebook", "#0866FF"], tiktok: ["TikTok", "#000000"], youtube: ["YouTube", "#FF0000"] };
  const brand = (k, size) => `<span class="bm" style="width:${size || 22}px;height:${size || 22}px;background:${BR[k][1]}" aria-hidden="true">${BR[k][0][0]}</span>`;
  window.ART = { photo, icon, brand, BR, shade };
})();
