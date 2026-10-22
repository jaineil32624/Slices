/* ==============================================================
   SLICES — extras.js
   The interactive layer on top of the 15 learning modules:
     A. Saved progress, XP and levels
     B. Quick Check quizzes (2 per module) with confetti
     C. Stage toolbar: fullscreen, save image, 3D auto-rotate/reset
     D. Live plot coordinates + drag-on-the-graph to move points
     E. Prev / next, keyboard shortcuts, command palette (Ctrl+K)
     F. Share link, install-as-app, welcome tour, offline service worker
   Everything hooks into app.js through the "slices:module" event.
   ============================================================== */
(function () {
  "use strict";

  /* ---------- A. persistence ---------- */
  const KEY = "slices.progress.v1";
  function load() {
    try { return Object.assign({ visited: [], solved: {}, xp: 0, welcomed: false }, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return { visited: [], solved: {}, xp: 0, welcomed: false }; }
  }
  const S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: keep in memory */ } }

  const LEVELS = [
    { xp: 0, name: "Curious" }, { xp: 60, name: "Limit Seeker" }, { xp: 160, name: "Slope Rider" },
    { xp: 300, name: "Area Hunter" }, { xp: 480, name: "Series Sage" }, { xp: 700, name: "Gradient Climber" },
    { xp: 950, name: "Flux Master" }
  ];
  function levelOf(xp) {
    let i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
    const cur = LEVELS[i], next = LEVELS[i + 1];
    return { idx: i, name: cur.name, frac: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1, next };
  }
  function addXP(n, why) {
    const before = levelOf(S.xp).idx;
    S.xp += n; save(); renderXP(true);
    toast(`+${n} XP · ${why}`, "mint");
    const after = levelOf(S.xp);
    if (after.idx > before) { setTimeout(() => toast(`🎉 Level up! You're now a <b>${after.name}</b>`, "gold", 3800), 500); confetti(160); }
  }

  /* ---------- B. quiz bank ---------- */
  const QUIZ = {
    lim: [
      { q: "lim<sub>x→0</sub> sin(x)/x = ?", a: ["0", "1", "∞", "Does not exist"], c: 1, why: "Both one-sided approaches settle on 1 even though the function is undefined at 0. Try it in the plot above." },
      { q: "lim<sub>x→1</sub> (x²−1)/(x−1) = ?", a: ["0", "1", "2", "Undefined"], c: 2, why: "Factor: (x−1)(x+1)/(x−1) = x+1 for x≠1, which approaches 2." }
    ],
    der: [
      { q: "d/dx [ x³ ] = ?", a: ["x²", "3x²", "3x³", "x⁴/4"], c: 1, why: "Power rule: bring the exponent down and subtract one." },
      { q: "d/dx [ sin(x) ] = ?", a: ["−cos(x)", "cos(x)", "−sin(x)", "tan(x)"], c: 1, why: "The slope of sin is cos — check the symbolic readout with sin(x) selected." }
    ],
    int1: [
      { q: "∫₀² x dx = ?", a: ["1", "2", "4", "½"], c: 1, why: "It's a triangle with base 2 and height 2: ½·2·2 = 2." },
      { q: "As the number of rectangles n grows, the Riemann sum…", a: ["Grows without bound", "Approaches the exact area", "Goes to zero", "Stays the same"], c: 1, why: "More, thinner rectangles hug the curve better — the limit is the definite integral." }
    ],
    opt: [
      { q: "Where does f(x) = x² − 4x have its minimum?", a: ["x = 0", "x = 2", "x = 4", "x = −2"], c: 1, why: "f′(x) = 2x − 4 = 0 gives x = 2, and f″ = 2 > 0 so it's a minimum." },
      { q: "If f′(c) = 0 and f″(c) < 0, then at c there is a…", a: ["Local minimum", "Local maximum", "Inflection point", "Vertical asymptote"], c: 1, why: "Concave down at a flat point means a peak." }
    ],
    rr: [
      { q: "Ladder: x² + y² = L². Differentiating in time gives dy/dt = ?", a: ["−(x/y)·dx/dt", "(y/x)·dx/dt", "−dx/dt", "2x·dx/dt"], c: 0, why: "2x·dx/dt + 2y·dy/dt = 0, then solve for dy/dt." },
      { q: "As the ladder's top nears the ground (y → 0), |dy/dt|…", a: ["Shrinks to 0", "Stays constant", "Grows without bound", "Equals dx/dt"], c: 2, why: "dy/dt = −(x/y)·dx/dt and dividing by a tiny y blows up. Slide x toward L to watch it." }
    ],
    tech: [
      { q: "∫ 2x·cos(x²) dx = ?", a: ["sin(x²) + C", "2 sin(x²) + C", "cos(x²) + C", "x² sin(x) + C"], c: 0, why: "u = x², du = 2x dx turns it into ∫ cos(u) du." },
      { q: "∫ x·eˣ dx = ?", a: ["x·eˣ + C", "x·eˣ − eˣ + C", "eˣ + C", "½x²·eˣ + C"], c: 1, why: "By parts with u = x, dv = eˣ dx: x·eˣ − ∫eˣ dx." }
    ],
    seq: [
      { q: "Σ<sub>n=1</sub><sup>∞</sup> 1/2ⁿ = ?", a: ["½", "1", "2", "Diverges"], c: 1, why: "Geometric series: (½)/(1 − ½) = 1." },
      { q: "The harmonic series Σ 1/n…", a: ["Converges to 1", "Converges to ln 2", "Diverges", "Converges to π²/6"], c: 2, why: "Its terms go to 0 but too slowly — partial sums grow like ln n." }
    ],
    param: [
      { q: "x = cos t, y = sin t for 0 ≤ t ≤ 2π traces…", a: ["A line", "The unit circle", "A parabola", "A spiral"], c: 1, why: "cos²t + sin²t = 1 for every t." },
      { q: "For a parametric curve, dy/dx = ?", a: ["dy/dt · dx/dt", "(dy/dt)/(dx/dt)", "(dx/dt)/(dy/dt)", "d²y/dt²"], c: 1, why: "Chain rule: dy/dt = dy/dx · dx/dt." }
    ],
    polar: [
      { q: "Area enclosed by a polar curve r(θ) is…", a: ["∫ r dθ", "½ ∫ r² dθ", "∫ r² dθ", "2π ∫ r dθ"], c: 1, why: "Each thin wedge is a sector with area ½ r² dθ." },
      { q: "The polar curve r = 2 is…", a: ["A line through the origin", "A circle of radius 2", "A cardioid", "A rose"], c: 1, why: "Every angle, same distance 2 from the origin." }
    ],
    vec: [
      { q: "⟨1, 2, 3⟩ · ⟨4, −5, 6⟩ = ?", a: ["12", "32", "−12", "⟨4, −10, 18⟩"], c: 0, why: "4 − 10 + 18 = 12. A dot product is a number, not a vector." },
      { q: "If a · b = 0 (both nonzero), the vectors are…", a: ["Parallel", "Perpendicular", "Equal", "Opposite"], c: 1, why: "a · b = |a||b|cos θ, and cos θ = 0 means θ = 90°." }
    ],
    pd: [
      { q: "f(x, y) = x²y. ∂f/∂x = ?", a: ["2xy", "x²", "2x", "x²y"], c: 0, why: "Treat y as a constant while differentiating in x." },
      { q: "The gradient ∇f points in the direction of…", a: ["Steepest descent", "Steepest ascent", "Zero change", "The x-axis"], c: 1, why: "Directional derivative is largest along ∇f; along a level curve it's zero." }
    ],
    mint: [
      { q: "∬ 1 dA over the rectangle [0,2] × [0,3] = ?", a: ["5", "6", "3", "9"], c: 1, why: "Integrating 1 gives the area: 2 · 3." },
      { q: "∫₀¹ ∫₀¹ xy dy dx = ?", a: ["1", "½", "¼", "⅛"], c: 2, why: "It separates: (∫₀¹ x dx)(∫₀¹ y dy) = ½ · ½." }
    ],
    vf: [
      { q: "Divergence of F = ⟨x, y⟩ is…", a: ["0", "1", "2", "x + y"], c: 2, why: "∂x/∂x + ∂y/∂y = 1 + 1. Pure outward flow everywhere." },
      { q: "Scalar curl of F = ⟨−y, x⟩ is…", a: ["0", "1", "2", "−2"], c: 2, why: "∂Q/∂x − ∂P/∂y = 1 − (−1) = 2. Load the default field and check the readout." }
    ],
    lsi: [
      { q: "For a conservative field F = ∇f, ∮ around any closed loop of F·dr = ?", a: ["0", "1", "2π", "Depends on the loop"], c: 0, why: "It equals f(end) − f(start), and a closed loop ends where it starts." },
      { q: "For F = ∇f, ∫<sub>C</sub> F·dr from A to B equals…", a: ["f(B) − f(A)", "f(A) + f(B)", "|B − A|", "0 always"], c: 0, why: "The Fundamental Theorem for line integrals — path doesn't matter." }
    ],
    thm: [
      { q: "Green's theorem turns ∮<sub>C</sub> P dx + Q dy into…", a: ["∬ (∂Q/∂x − ∂P/∂y) dA", "∬ (∂P/∂x + ∂Q/∂y) dA", "∭ div F dV", "∫ |F| ds"], c: 0, why: "Circulation around the boundary = total curl inside." },
      { q: "The Divergence theorem says outward flux through a closed surface equals…", a: ["The surface area", "∭ div F dV", "∬ curl F · dS", "Zero"], c: 1, why: "Net outflow through the skin = total sources inside the solid." }
    ]
  };
  const TOTAL_Q = Object.values(QUIZ).reduce((n, a) => n + a.length, 0);

  /* ---------- small helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function modIndex(id) { return MODULES.findIndex(m => m.id === id); }

  let audioCtx = null;
  function blip(good) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = good ? [660, 880, 1175] : [300, 220];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.09;
        o.type = good ? "triangle" : "sawtooth"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(good ? 0.12 : 0.06, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.25);
      });
    } catch (e) { /* audio is optional */ }
  }

  /* ---------- toast + confetti ---------- */
  function toast(html, tone, ms) {
    let host = $("#toastHost"); if (!host) { host = el("div"); host.id = "toastHost"; document.body.appendChild(host); }
    const t = el("div", "toast " + (tone || ""), html); host.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 350); }, ms || 2200);
  }
  function confetti(count) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = el("canvas"); c.className = "confetti"; document.body.appendChild(c);
    const dpr = window.devicePixelRatio || 1; c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    const cols = ["#ff8b5e", "#6fe7c6", "#f2c14e", "#8fb8ff", "#ff7ab6"], glyphs = ["∫", "π", "Σ", "∂", "∞", "√"];
    const ps = Array.from({ length: count || 120 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * 0.35,
      vx: (Math.random() - .5) * 12, vy: -Math.random() * 11 - 4, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
      s: 6 + Math.random() * 7, col: cols[(Math.random() * cols.length) | 0], g: Math.random() < .18 ? glyphs[(Math.random() * glyphs.length) | 0] : null
    }));
    let frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach(p => {
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
        if (p.g) { ctx.font = "600 " + (p.s * 2) + "px Fraunces, serif"; ctx.fillText(p.g, 0, 0); }
        else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (++frames < 150) requestAnimationFrame(tick); else c.remove();
    })();
  }

  /* ---------- topbar: XP pill, search, share, install ---------- */
  function buildTopbar() {
    const actions = $(".top-actions");
    const search = el("button", "chip", `<span aria-hidden="true">⌕</span><span class="lbl">Search</span><kbd>Ctrl K</kbd>`);
    search.id = "searchBtn"; search.title = "Jump to a topic (Ctrl+K or /)";
    search.addEventListener("click", openPalette);
    const xp = el("button", "chip xp", `<svg viewBox="0 0 36 36" class="ring"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" id="xpRing"/></svg><span id="xpText">0 XP</span>`);
    xp.id = "xpBtn"; xp.title = "Your progress"; xp.addEventListener("click", openStats);
    const share = el("button", "chip icon", "🔗"); share.id = "shareBtn"; share.title = "Share this topic"; share.setAttribute("aria-label", "Share this topic");
    share.addEventListener("click", shareCurrent);
    const install = el("button", "chip install", "⬇ <span class=\"lbl\">Get the app</span>"); install.id = "installBtn"; install.title = "Install Slices";
    install.addEventListener("click", openInstall);
    const help = el("button", "chip icon", "?"); help.id = "helpBtn"; help.title = "Keyboard shortcuts"; help.setAttribute("aria-label", "Keyboard shortcuts");
    help.addEventListener("click", openHelp);
    [search, xp, share, install, help].forEach(b => actions.insertBefore(b, $("#musicBtn")));
    renderXP(false);
  }
  function renderXP(pulse) {
    const lv = levelOf(S.xp), ring = $("#xpRing"), txt = $("#xpText");
    if (!ring) return;
    const C = 2 * Math.PI * 15; ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - lv.frac);
    txt.innerHTML = `${S.xp} XP<span class="lvl"> · ${lv.name}</span>`;
    if (pulse) { const b = $("#xpBtn"); b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse"); }
  }

  /* ---------- sidebar marks + overall progress bar ---------- */
  function renderSidebarMarks() {
    document.querySelectorAll(".navbtn").forEach(b => {
      const id = b.dataset.id, q = QUIZ[id] || [];
      const solved = q.filter((_, i) => S.solved[id + ":" + i]).length;
      let m = b.querySelector(".mark-st"); if (!m) { m = el("span", "mark-st"); b.appendChild(m); }
      m.textContent = solved === q.length && q.length ? "★" : S.visited.includes(id) ? "✓" : "";
      m.className = "mark-st " + (solved === q.length && q.length ? "star" : S.visited.includes(id) ? "seen" : "");
      m.title = solved === q.length ? "Mastered" : S.visited.includes(id) ? "Visited" : "";
    });
    let bar = $("#sideProgress");
    if (!bar) {
      bar = el("div", "side-progress", `<div class="sp-top"><span>Mastery</span><span id="spPct">0%</span></div><div class="sp-track"><div class="sp-fill" id="spFill"></div></div>`);
      bar.id = "sideProgress"; $("#sidebar").prepend(bar);
    }
    const solvedAll = Object.keys(S.solved).length, pct = Math.round(100 * solvedAll / TOTAL_Q);
    $("#spPct").textContent = `${pct}% · ${solvedAll}/${TOTAL_Q} checks`;
    $("#spFill").style.width = pct + "%";
  }

  /* ---------- per-panel augmentation ---------- */
  function augmentPanel(mod, panel) {
    if (panel._augmented) return; panel._augmented = true;
    const stage = panel.querySelector(".stage");

    // C. stage toolbar
    const tb = el("div", "stage-tools");
    const fs = el("button", "tool", "⤢"); fs.title = "Fullscreen"; fs.setAttribute("aria-label", "Fullscreen");
    fs.addEventListener("click", () => toggleFullscreen(stage));
    const shot = el("button", "tool", "📷"); shot.title = "Save as image"; shot.setAttribute("aria-label", "Save as image");
    shot.addEventListener("click", () => saveImage(mod, stage));
    tb.append(fs, shot);
    if (mod.is3D) {
      const spin = el("button", "tool", "⟳"); spin.title = "Auto-rotate"; spin.setAttribute("aria-label", "Auto-rotate");
      spin.addEventListener("click", () => { const sc = find3D(stage); if (!sc) return; sc.autoRotate = !sc.autoRotate; spin.classList.toggle("on", sc.autoRotate); });
      const reset = el("button", "tool", "⌂"); reset.title = "Reset view (or double-click)"; reset.setAttribute("aria-label", "Reset view");
      reset.addEventListener("click", () => { const sc = find3D(stage); if (sc) sc.resetView(); });
      tb.append(spin, reset);
    }
    stage.appendChild(tb);

    // D. live coordinates + drag on 2D plots
    const canvas = stage.querySelector("canvas.plot");
    if (canvas) wirePlot(mod, stage, canvas);

    // B. quick check
    if (QUIZ[mod.id]) panel.appendChild(buildQuiz(mod));

    // E. prev / next
    const i = modIndex(mod.id), prev = MODULES[i - 1], next = MODULES[i + 1];
    const nav = el("div", "pager");
    nav.innerHTML = `
      ${prev ? `<button class="pg prev" data-go="${prev.id}"><span class="dir">← Previous</span><span class="t">${prev.title}</span></button>` : "<span></span>"}
      ${next ? `<button class="pg next" data-go="${next.id}"><span class="dir">Next →</span><span class="t">${next.title}</span></button>` : `<button class="pg next" data-go="${MODULES[0].id}"><span class="dir">Finished! ↺</span><span class="t">Back to ${MODULES[0].title}</span></button>`}`;
    nav.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) { activateModule(b.dataset.go); scrollTo({ top: 0, behavior: "smooth" }); } });
    panel.appendChild(nav);
  }
  function find3D(stage) { return stage._scene3d || (stage.querySelector("canvas") && stage.querySelector("canvas").parentElement._scene3d) || null; }
  function toggleFullscreen(stage) {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (req) req.call(stage).catch(() => stage.classList.toggle("pseudo-fs"));
    else stage.classList.toggle("pseudo-fs");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
  }
  document.addEventListener("fullscreenchange", () => setTimeout(() => window.dispatchEvent(new Event("resize")), 120));
  function saveImage(mod, stage) {
    const src = stage.querySelector("canvas");
    if (!src) return;
    const out = document.createElement("canvas"); out.width = src.width; out.height = src.height;
    const ctx = out.getContext("2d"); ctx.fillStyle = "#0b1622"; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    const k = out.width / 900; ctx.font = `600 ${Math.round(16 * k)}px Fraunces, serif`; ctx.fillStyle = "#ff8b5e";
    ctx.fillText("Slices · " + mod.title, 14 * k, out.height - 14 * k);
    out.toBlob(b => {
      if (!b) return;
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `slices-${mod.id}.png`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("📷 Image saved", "mint");
    });
  }

  /* ---------- D. plot hover + drag ---------- */
  const DRAG = {
    der: { x: ["der-x0"] }, int1: { x: ["int1-a", "int1-b"] },
    rr: { x: ["rr-x"] }, vf: { x: ["vf-x0"], y: ["vf-y0"] }
  };
  function toWorld(canvas, px, py) {
    const v = canvas._view; if (!v) return null;
    return { x: v.xMin + (px - v.pad) / v.sx, y: v.yMin + (v.pad + v.h - py) / v.sy };
  }
  function fmt(n) { const a = Math.abs(n); return a >= 100 ? n.toFixed(0) : a >= 10 ? n.toFixed(1) : n.toFixed(2); }
  function setSlider(id, value) {
    const s = document.getElementById(id); if (!s) return;
    const min = parseFloat(s.min), max = parseFloat(s.max), step = parseFloat(s.step) || 0.01;
    const v = Math.min(max, Math.max(min, Math.round(value / step) * step));
    if (Math.abs(parseFloat(s.value) - v) < 1e-9) return;
    s.value = v; s.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function nearest(ids, value) {
    let best = ids[0], d = Infinity;
    ids.forEach(id => { const s = document.getElementById(id); if (s && Math.abs(parseFloat(s.value) - value) < d) { d = Math.abs(parseFloat(s.value) - value); best = id; } });
    return best;
  }
  function wirePlot(mod, stage, canvas) {
    const tip = el("div", "coord-tip"), vline = el("div", "xh v"), hline = el("div", "xh h");
    stage.append(vline, hline, tip);
    const drag = DRAG[mod.id];
    if (drag) {
      canvas.classList.add("draggable"); canvas.style.touchAction = "none";
      const hint = el("div", "drag-hint", "✋ drag on the graph");
      stage.appendChild(hint); setTimeout(() => hint.classList.add("gone"), 4200);
    }
    let dragging = false, grabX = null, grabY = null;
    function pos(e) { const r = canvas.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; }
    function show(px, py) {
      const w = toWorld(canvas, px, py); const v = canvas._view;
      if (!w || px < v.pad || px > v.pad + v.w || py < v.pad || py > v.pad + v.h) { hide(); return; }
      vline.style.left = px + "px"; hline.style.top = py + "px";
      tip.innerHTML = `x <b>${fmt(w.x)}</b> &nbsp; y <b>${fmt(w.y)}</b>`;
      const right = px > canvas.clientWidth - 150;
      tip.style.left = (right ? px - 12 - tip.offsetWidth : px + 12) + "px";
      tip.style.top = Math.max(8, py - 34) + "px";
      stage.classList.add("hovering");
    }
    function hide() { stage.classList.remove("hovering"); }
    function apply(px, py) {
      const w = toWorld(canvas, px, py); if (!w || !drag) return;
      if (drag.x) setSlider(grabX || drag.x[0], w.x);
      if (drag.y) setSlider(grabY || drag.y[0], w.y);
    }
    canvas.addEventListener("pointerdown", e => {
      if (!drag) return;
      const { px, py } = pos(e), w = toWorld(canvas, px, py); if (!w) return;
      dragging = true; canvas.setPointerCapture(e.pointerId);
      grabX = drag.x ? nearest(drag.x, w.x) : null; grabY = drag.y ? nearest(drag.y, w.y) : null;
      stage.classList.add("dragging"); apply(px, py); show(px, py);
      stage.querySelector(".drag-hint") && stage.querySelector(".drag-hint").classList.add("gone");
    });
    canvas.addEventListener("pointermove", e => { const { px, py } = pos(e); if (dragging) apply(px, py); show(px, py); });
    const end = () => { dragging = false; stage.classList.remove("dragging"); };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { if (!dragging) hide(); });
  }

  /* ---------- B. quiz card ---------- */
  function buildQuiz(mod) {
    const qs = QUIZ[mod.id];
    const card = el("div", "quiz");
    let qi = qs.findIndex((_, i) => !S.solved[mod.id + ":" + i]); if (qi < 0) qi = 0;
    function render() {
      const q = qs[qi], key = mod.id + ":" + qi, done = !!S.solved[key];
      card.innerHTML = `
        <div class="quiz-head"><h4>⚡ Quick check</h4>
          <div class="quiz-dots">${qs.map((_, i) => `<button class="qd ${S.solved[mod.id + ":" + i] ? "ok" : ""} ${i === qi ? "cur" : ""}" data-qi="${i}" aria-label="Question ${i + 1}"></button>`).join("")}</div></div>
        <p class="quiz-q">${q.q}</p>
        <div class="quiz-opts">${q.a.map((t, i) => `<button class="opt" data-i="${i}"><span class="l">${"ABCD"[i]}</span><span>${t}</span></button>`).join("")}</div>
        <div class="quiz-fb" aria-live="polite">${done ? `<span class="mint">✓ Already solved — +25 XP earned.</span> ${q.why}` : "Pick an answer. First correct try earns <b>+25 XP</b>."}</div>`;
      card.querySelectorAll(".qd").forEach(b => b.addEventListener("click", () => { qi = +b.dataset.qi; render(); }));
      card.querySelectorAll(".opt").forEach(b => b.addEventListener("click", () => answer(+b.dataset.i, b)));
    }
    function answer(i, btn) {
      const q = qs[qi], key = mod.id + ":" + qi, fb = card.querySelector(".quiz-fb");
      if (i === q.c) {
        card.querySelectorAll(".opt").forEach(b => b.disabled = true);
        btn.classList.add("right"); blip(true);
        const first = !S.solved[key];
        if (first) { S.solved[key] = true; save(); addXP(25, "Quick check"); confetti(90); renderSidebarMarks(); }
        const allDone = qs.every((_, k) => S.solved[mod.id + ":" + k]);
        const nextQ = qs.findIndex((_, k) => !S.solved[mod.id + ":" + k]);
        fb.innerHTML = `<span class="mint">✓ Correct!</span> ${q.why}
          <div class="quiz-actions">${nextQ >= 0 ? `<button class="action secondary" data-next="${nextQ}">Next question</button>` :
            `<span class="gold">★ ${mod.title} mastered${allDone && first ? "!" : ""}</span>`}</div>`;
        const nb = fb.querySelector("[data-next]"); if (nb) nb.addEventListener("click", () => { qi = +nb.dataset.next; render(); });
        if (allDone && first) { setTimeout(() => toast(`★ <b>${mod.title}</b> mastered`, "gold", 3000), 400); }
      } else {
        btn.classList.add("wrong"); btn.disabled = true; blip(false);
        card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
        fb.innerHTML = `<span class="coral">Not quite —</span> try another option. Hint: play with the visual above.`;
      }
    }
    render();
    return card;
  }

  /* ---------- E. command palette ---------- */
  let pal = null;
  function openPalette() {
    if (!pal) {
      pal = el("div", "overlay", `<div class="palette" role="dialog" aria-label="Jump to topic">
        <input id="palInput" type="text" placeholder="Jump to a topic… (derivatives, series, curl)" autocomplete="off" spellcheck="false">
        <div class="pal-list" id="palList"></div>
        <div class="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</div></div>`);
      document.body.appendChild(pal);
      pal.addEventListener("click", e => { if (e.target === pal) closeOverlay(pal); });
      const inp = $("#palInput", pal);
      inp.addEventListener("input", () => renderPal(inp.value));
      inp.addEventListener("keydown", e => {
        const items = [...pal.querySelectorAll(".pal-item")]; let i = items.findIndex(x => x.classList.contains("sel"));
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); i = (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items.forEach((x, k) => x.classList.toggle("sel", k === i)); items[i] && items[i].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" && items[i]) { go(items[i].dataset.id); }
      });
    }
    pal.classList.add("show"); const inp = $("#palInput", pal); inp.value = ""; renderPal(""); inp.focus(); setTimeout(() => inp.focus(), 30);
    function go(id) { closeOverlay(pal); activateModule(id); }
    function renderPal(q) {
      const t = q.trim().toLowerCase();
      const hits = MODULES.map((m, i) => ({ m, i, hay: (m.title + " " + (m.sub || "") + " " + m.course + " " + m.id).toLowerCase() }))
        .filter(o => !t || t.split(/\s+/).every(w => o.hay.includes(w)));
      $("#palList", pal).innerHTML = hits.length ? hits.map((o, k) => {
        const q2 = QUIZ[o.m.id] || [], solved = q2.filter((_, j) => S.solved[o.m.id + ":" + j]).length;
        return `<button class="pal-item ${k === 0 ? "sel" : ""}" data-id="${o.m.id}"><span class="c">${o.m.course.replace("Calculus ", "Calc ")}</span>
          <span class="tt"><b>${o.m.title}</b><small>${o.m.sub || ""}</small></span><span class="st">${solved === q2.length ? "★" : S.visited.includes(o.m.id) ? "✓" : ""}</span></button>`;
      }).join("") : `<div class="pal-empty">No topic matches “${q}”.</div>`;
      pal.querySelectorAll(".pal-item").forEach(b => b.addEventListener("click", () => go(b.dataset.id)));
    }
  }
  function closeOverlay(o) { if (o) o.classList.remove("show"); }

  /* ---------- help / stats / install overlays ---------- */
  function modal(id, html) {
    let o = document.getElementById(id);
    if (!o) {
      o = el("div", "overlay"); o.id = id; document.body.appendChild(o);
      o.addEventListener("click", e => { if (e.target === o || e.target.closest("[data-close]")) closeOverlay(o); });
    }
    o.innerHTML = `<div class="modal" role="dialog">${html}<button class="x" data-close aria-label="Close">✕</button></div>`;
    o.classList.add("show"); return o;
  }
  function openHelp() {
    modal("helpModal", `<h3>Shortcuts</h3><div class="keys">
      <div><kbd>←</kbd> <kbd>→</kbd><span>Previous / next topic</span></div>
      <div><kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>/</kbd><span>Search topics</span></div>
      <div><kbd>1</kbd>–<kbd>4</kbd><span>Answer the quick check</span></div>
      <div><kbd>F</kbd><span>Fullscreen the visual</span></div>
      <div><kbd>M</kbd><span>Music on / off</span></div>
      <div><kbd>?</kbd><span>This panel</span></div></div>
      <p class="muted">On the graph: hover for live coordinates, and drag to move the point in Limits, Derivatives, Integrals, Related Rates and Vector Fields. In 3D: drag to orbit, pinch or scroll to zoom, double-click to reset.</p>`);
  }
  function openStats() {
    const lv = levelOf(S.xp), solvedAll = Object.keys(S.solved).length;
    const rows = MODULES.map(m => {
      const q = QUIZ[m.id] || [], s = q.filter((_, i) => S.solved[m.id + ":" + i]).length;
      return `<button class="srow" data-go="${m.id}"><span>${m.title}</span><span class="bar"><i style="width:${q.length ? 100 * s / q.length : 0}%"></i></span><span class="n">${s}/${q.length}</span></button>`;
    }).join("");
    const o = modal("statsModal", `<h3>Your progress</h3>
      <div class="stat-cards"><div><b>${S.xp}</b><span>XP</span></div><div><b>${lv.name}</b><span>level ${lv.idx + 1}${lv.next ? ` · ${lv.next.xp - S.xp} XP to next` : " · max"}</span></div>
      <div><b>${S.visited.length}/${MODULES.length}</b><span>topics explored</span></div><div><b>${solvedAll}/${TOTAL_Q}</b><span>checks solved</span></div></div>
      <div class="srows">${rows}</div>
      <button class="action secondary" id="resetProg">Reset progress</button>`);
    o.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => { closeOverlay(o); activateModule(b.dataset.go); }));
    o.querySelector("#resetProg").addEventListener("click", () => {
      if (!confirm("Reset all XP and quiz progress?")) return;
      S.visited = []; S.solved = {}; S.xp = 0; save(); renderXP(false); renderSidebarMarks(); closeOverlay(o);
      document.querySelectorAll(".panel").forEach(p => { const q = p.querySelector(".quiz"); if (q) { const m = MODULES.find(x => "panel-" + x.id === p.id); q.replaceWith(buildQuiz(m)); } });
      toast("Progress reset", "coral");
    });
  }
  const APK_URL = "https://github.com/jaineil32624/Slices/releases/latest/download/Slices.apk";
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; });
  function openInstall() {
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const o = modal("installModal", `<h3>Get Slices</h3>
      <div class="dl-grid">
        <a class="dl" href="${APK_URL}"><span class="ic">🤖</span><b>Android</b><small>Download the APK</small></a>
        <button class="dl" id="pwaInstall"><span class="ic">💻</span><b>Install app</b><small>Chrome / Edge desktop & Android</small></button>
        <div class="dl"><span class="ic">🍎</span><b>iPhone / iPad</b><small>Safari → Share → Add to Home Screen</small></div>
        <a class="dl" href="https://github.com/jaineil32624/Slices/releases/latest"><span class="ic">📦</span><b>All downloads</b><small>APK + offline web zip</small></a>
      </div>
      <p class="muted">${isNative ? "You're already in the app 🎉. " : ""}Everything works offline once installed — no account, no ads.</p>`);
    o.querySelector("#pwaInstall").addEventListener("click", async () => {
      if (deferredInstall) { deferredInstall.prompt(); const r = await deferredInstall.userChoice; deferredInstall = null; if (r.outcome === "accepted") { toast("Installed 🎉", "mint"); closeOverlay(o); } }
      else toast("Use your browser menu → “Install app” / “Add to Home screen”", "gold", 3600);
    });
  }
  async function shareCurrent() {
    const mod = MODULES.find(m => m.id === CURRENT_ID);
    const url = location.href.split("#")[0] + "#" + CURRENT_ID, title = "Slices · " + (mod ? mod.title : "Calculus Lab");
    try {
      if (navigator.share) { await navigator.share({ title, text: "Learn calculus visually with Slices", url }); return; }
      await navigator.clipboard.writeText(url); toast("🔗 Link copied", "mint");
    } catch (e) { if (e && e.name !== "AbortError") prompt("Copy this link:", url); }
  }
  function welcome() {
    if (S.welcomed) return;
    const o = modal("welcomeModal", `<div class="welcome"><div class="logo">∫</div><h3>Welcome to Slices</h3>
      <p>15 hands-on labs for Calculus 1, 2 and 3. Every graph is live:</p>
      <ul><li>🎚️ <b>Drag</b> sliders — or drag right on the graph</li><li>⚡ Solve <b>quick checks</b> to earn XP and level up</li>
      <li>⌕ <b>Ctrl K</b> jumps anywhere · <b>←/→</b> flips topics</li><li>⬇ Install it as an <b>app</b> — works offline</li></ul>
      <button class="action" data-close>Start exploring →</button></div>`);
    o.classList.add("welcome-ov");
    S.welcomed = true; save();
  }

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape") { document.querySelectorAll(".overlay.show").forEach(closeOverlay); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".overlay.show")) return;
    const i = modIndex(CURRENT_ID);
    if (e.key === "ArrowRight" && MODULES[i + 1]) activateModule(MODULES[i + 1].id);
    else if (e.key === "ArrowLeft" && MODULES[i - 1]) activateModule(MODULES[i - 1].id);
    else if (e.key === "/") { e.preventDefault(); openPalette(); }
    else if (e.key === "?") openHelp();
    else if (e.key.toLowerCase() === "m") $("#musicBtn").click();
    else if (e.key.toLowerCase() === "f") { const s = document.querySelector(".panel.active .stage"); if (s) toggleFullscreen(s); }
    else if (/^[1-4]$/.test(e.key)) { const b = document.querySelectorAll(".panel.active .quiz .opt")[+e.key - 1]; if (b && !b.disabled) b.click(); }
  });

  /* ---------- wire up ---------- */
  document.addEventListener("slices:module", e => {
    const { id, mod, panel } = e.detail;
    augmentPanel(mod, panel);
    if (!S.visited.includes(id)) { S.visited.push(id); save(); if (document.readyState === "complete" && S.welcomed) addXP(10, "New topic explored"); }
    renderSidebarMarks();
    document.title = `${mod.title} · Slices`;
    panel.classList.remove("enter"); void panel.offsetWidth; panel.classList.add("enter");
  });
  window.addEventListener("load", () => {
    buildTopbar(); renderSidebarMarks(); welcome();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  });
})();
