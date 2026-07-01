/* ==============================================================
   SLICES — Calculus 1/2/3 Lab
   app.js — all interactivity lives here.

   SECTION MAP (search these headers to navigate / extend):
   0. Expression parser + AST + symbolic differentiation
   1. Canvas 2D helpers (axes, mapping, curve plotting)
   2. Three.js reusable 3D scene wrapper
   3. Module framework (config-driven sidebar + panel builder)
   4. Module implementations (Calc 1, Calc 2, Calc 3)
   5. Background music player
   6. Boot / router / mobile nav
   ============================================================== */

/* ==============================================================
   0. EXPRESSION PARSER + SYMBOLIC DIFFERENTIATION
   No eval() anywhere. Supports variables x, y, z, t, theta, r,
   constants pi, e, and functions sin cos tan sqrt exp log ln abs.
   ============================================================== */
function parseToAST(src) {
  const s = String(src).replace(/\s+/g, "");
  let i = 0;
  function peek() { return s[i]; }
  function eat(ch) { if (s[i] !== ch) throw new Error("Expected " + ch); i++; }

  function parseExpression() {
    let node = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++]; node = { type: "bin", op, l: node, r: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = s[i++]; node = { type: "bin", op, l: node, r: parseUnary() };
    }
    return node;
  }
  function parseUnary() {
    if (peek() === "-") { i++; return { type: "neg", v: parseUnary() }; }
    if (peek() === "+") { i++; return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    let node = parseAtom();
    if (peek() === "^") { i++; node = { type: "bin", op: "^", l: node, r: parseUnary() }; }
    return node;
  }
  function parseAtom() {
    if (peek() === "(") { i++; const n = parseExpression(); eat(")"); return n; }
    if (/[0-9.]/.test(peek())) {
      let start = i;
      while (i < s.length && /[0-9.]/.test(s[i])) i++;
      return { type: "num", v: parseFloat(s.slice(start, i)) };
    }
    if (/[a-zA-Z]/.test(peek())) {
      let start = i;
      while (i < s.length && /[a-zA-Z0-9]/.test(s[i])) i++;
      const name = s.slice(start, i);
      if (peek() === "(") {
        i++;
        const args = [parseExpression()];
        while (peek() === ",") { i++; args.push(parseExpression()); }
        eat(")");
        return { type: "call", name, args };
      }
      return { type: "var", name };
    }
    throw new Error("Unexpected token near " + i);
  }
  const tree = parseExpression();
  if (i !== s.length) throw new Error("Trailing input");
  return tree;
}

const MATH_FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sqrt: Math.sqrt, exp: Math.exp, log: Math.log, ln: Math.log, abs: Math.abs
};
const MATH_CONSTS = { pi: Math.PI, e: Math.E };

function astToFn(node) {
  return function (scope) { return evalAST(node, scope || {}); };
}
function evalAST(node, scope) {
  switch (node.type) {
    case "num": return node.v;
    case "neg": return -evalAST(node.v, scope);
    case "var":
      if (node.name in scope) return scope[node.name];
      if (node.name in MATH_CONSTS) return MATH_CONSTS[node.name];
      return 0;
    case "call": {
      const a = node.args.map(x => evalAST(x, scope));
      if (node.name in MATH_FUNCS) return MATH_FUNCS[node.name](...a);
      if (node.name === "pow") return Math.pow(a[0], a[1]);
      return NaN;
    }
    case "bin": {
      const l = evalAST(node.l, scope), r = evalAST(node.r, scope);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return l / r;
      if (node.op === "^") return Math.pow(l, r);
    }
  }
  return NaN;
}

/** Compile a source string straight to an evaluator function(scope). */
function compileExpr(src) { return astToFn(parseToAST(src)); }

/** Compile but fall back to a safe default expression on parse errors. */
function safeCompile(src, fallbackSrc) {
  try {
    const ast = parseToAST(src);
    const fn = astToFn(ast);
    fn({ x: 1, y: 1, t: 1 }); // smoke test
    return fn;
  } catch (e) {
    return compileExpr(fallbackSrc);
  }
}
function safeParse(src, fallbackSrc) {
  try { const ast = parseToAST(src); astToFn(ast)({ x: 1, y: 1, t: 1 }); return ast; }
  catch (e) { return parseToAST(fallbackSrc); }
}

/* ---- AST node builder shorthands ---- */
const N = v => ({ type: "num", v });
const V = name => ({ type: "var", name });
const BIN = (op, l, r) => ({ type: "bin", op, l, r });
const NEG = v => ({ type: "neg", v });
const CALL = (name, ...args) => ({ type: "call", name, args });

/** Symbolic differentiation of an AST with respect to variable `v`. */
function diffAST(node, v) {
  switch (node.type) {
    case "num": return N(0);
    case "var": return N(node.name === v ? 1 : 0);
    case "neg": return NEG(diffAST(node.v, v));
    case "call": {
      const [u] = node.args;
      const du = diffAST(u, v);
      switch (node.name) {
        case "sin": return BIN("*", CALL("cos", u), du);
        case "cos": return NEG(BIN("*", CALL("sin", u), du));
        case "tan": return BIN("/", du, BIN("^", CALL("cos", u), N(2)));
        case "sqrt": return BIN("/", du, BIN("*", N(2), CALL("sqrt", u)));
        case "exp": return BIN("*", CALL("exp", u), du);
        case "log": case "ln": return BIN("/", du, u);
        case "abs": return BIN("*", BIN("/", u, CALL("abs", u)), du);
        default: return N(0);
      }
    }
    case "bin": {
      const { op, l, r } = node;
      const dl = diffAST(l, v), dr = diffAST(r, v);
      if (op === "+") return BIN("+", dl, dr);
      if (op === "-") return BIN("-", dl, dr);
      if (op === "*") return BIN("+", BIN("*", dl, r), BIN("*", l, dr));
      if (op === "/") return BIN("/", BIN("-", BIN("*", dl, r), BIN("*", l, dr)), BIN("^", r, N(2)));
      if (op === "^") {
        if (r.type === "num") {
          // power rule: d(u^k) = k*u^(k-1)*du
          return BIN("*", BIN("*", N(r.v), BIN("^", l, N(r.v - 1))), dl);
        }
        if (l.type === "num") {
          // exponential rule: d(a^v) = a^v * ln(a) * dv
          return BIN("*", BIN("*", node, N(Math.log(l.v))), dr);
        }
        // general case: u^v * (dv*ln(u) + v*du/u)
        return BIN("*", node, BIN("+", BIN("*", dr, CALL("ln", l)), BIN("*", r, BIN("/", dl, l))));
      }
    }
  }
  return N(0);
}

/** Light-touch simplifier so printed derivatives don't look absurd. */
function simplifyAST(node) {
  if (node.type === "neg") {
    const v = simplifyAST(node.v);
    if (v.type === "num") return N(-v.v);
    return NEG(v);
  }
  if (node.type === "call") return CALL(node.name, ...node.args.map(simplifyAST));
  if (node.type === "bin") {
    const l = simplifyAST(node.l), r = simplifyAST(node.r), op = node.op;
    if (l.type === "num" && r.type === "num") {
      if (op === "+") return N(l.v + r.v);
      if (op === "-") return N(l.v - r.v);
      if (op === "*") return N(l.v * r.v);
      if (op === "/") return N(l.v / r.v);
      if (op === "^") return N(Math.pow(l.v, r.v));
    }
    if (op === "+") {
      if (l.type === "num" && l.v === 0) return r;
      if (r.type === "num" && r.v === 0) return l;
    }
    if (op === "-") { if (r.type === "num" && r.v === 0) return l; }
    if (op === "*") {
      if ((l.type === "num" && l.v === 0) || (r.type === "num" && r.v === 0)) return N(0);
      if (l.type === "num" && l.v === 1) return r;
      if (r.type === "num" && r.v === 1) return l;
    }
    if (op === "/") { if (r.type === "num" && r.v === 1) return l; }
    if (op === "^") {
      if (r.type === "num" && r.v === 1) return l;
      if (r.type === "num" && r.v === 0) return N(1);
    }
    return BIN(op, l, r);
  }
  return node;
}

function fmtNum(v) {
  if (Object.is(v, -0)) v = 0;
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return (Math.round(v * 1000) / 1000).toString();
}
/** Pretty-print an AST back to a math-like string. */
function astToString(node) {
  switch (node.type) {
    case "num": return fmtNum(node.v);
    case "var": return node.name;
    case "neg": return "-" + wrap(node.v);
    case "call": return node.name + "(" + node.args.map(astToString).join(", ") + ")";
    case "bin": {
      const l = wrap(node.l), r = wrap(node.r);
      const sym = node.op === "*" ? "\u00B7" : node.op;
      return `${l}${sym}${r}`;
    }
  }
  function wrap(n) {
    const str = astToString(n);
    if (n.type === "bin" && (node.type === "bin") &&
        ((node.op === "*" || node.op === "/") && (n.op === "+" || n.op === "-"))) return "(" + str + ")";
    if (n.type === "bin" && node.type === "bin" && node.op === "^") return "(" + str + ")";
    if (n.type === "neg" && node.type === "bin") return "(" + str + ")";
    return str;
  }
}

/** Convenience: symbolic derivative of a source expr wrt var name. */
function symbolicDeriv(src, varName, fallbackSrc) {
  const ast = safeParse(src, fallbackSrc || "x^2");
  const d = simplifyAST(diffAST(ast, varName));
  return { fn: astToFn(d), str: astToString(d) };
}
/** Numeric central-difference partial derivative (works for any scope fn). */
function numPartial(fn, scope, varName, h) {
  h = h || 1e-4;
  const s1 = Object.assign({}, scope, { [varName]: scope[varName] + h });
  const s2 = Object.assign({}, scope, { [varName]: scope[varName] - h });
  return (fn(s1) - fn(s2)) / (2 * h);
}
function simpson1D(f, a, b, n) {
  n = Math.max(20, n % 2 === 1 ? n + 1 : n);
  const h = (b - a) / n; let sum = f(a) + f(b);
  for (let k = 1; k < n; k++) sum += f(a + k * h) * (k % 2 === 0 ? 2 : 4);
  return sum * h / 3;
}

/* ==============================================================
   1. CANVAS 2D HELPERS
   ============================================================== */
function resizeCanvas(canvas) {
  const stage = canvas.closest(".stage");
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(280, rect.width) * dpr;
  canvas.height = Math.max(280, rect.height) * dpr;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}
function makeMapper(rect, xMin, xMax, yMin, yMax, pad) {
  pad = pad === undefined ? 36 : pad;
  const w = rect.width - pad * 2, h = rect.height - pad * 2;
  const sx = w / (xMax - xMin), sy = h / (yMax - yMin);
  return { toPx: (x, y) => [pad + (x - xMin) * sx, pad + h - (y - yMin) * sy], pad, w, h, sx, sy };
}
function drawAxes(ctx, rect, xMin, xMax, yMin, yMax, mapper) {
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#16283d"; ctx.lineWidth = 1;
  const stepX = niceStep(xMax - xMin), stepY = niceStep(yMax - yMin);
  for (let gx = Math.ceil(xMin / stepX) * stepX; gx <= xMax; gx += stepX) {
    const [px] = mapper.toPx(gx, 0);
    ctx.beginPath(); ctx.moveTo(px, mapper.pad); ctx.lineTo(px, mapper.pad + mapper.h); ctx.stroke();
  }
  for (let gy = Math.ceil(yMin / stepY) * stepY; gy <= yMax; gy += stepY) {
    const [, py] = mapper.toPx(0, gy);
    ctx.beginPath(); ctx.moveTo(mapper.pad, py); ctx.lineTo(mapper.pad + mapper.w, py); ctx.stroke();
  }
  ctx.strokeStyle = "#3a5c80"; ctx.lineWidth = 1.5;
  const [ox, oy] = mapper.toPx(0, 0);
  const cy = Math.min(Math.max(oy, mapper.pad), mapper.pad + mapper.h);
  const cx = Math.min(Math.max(ox, mapper.pad), mapper.pad + mapper.w);
  ctx.beginPath(); ctx.moveTo(mapper.pad, cy); ctx.lineTo(mapper.pad + mapper.w, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, mapper.pad); ctx.lineTo(cx, mapper.pad + mapper.h); ctx.stroke();
}
function niceStep(range) {
  const raw = range / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return step * mag;
}
function plotCurve(ctx, f, mapper, xMin, xMax, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width || 2.2; ctx.beginPath();
  let started = false;
  const NPTS = 400;
  for (let k = 0; k <= NPTS; k++) {
    const x = xMin + (xMax - xMin) * k / NPTS;
    const y = f(x);
    if (!isFinite(y)) { started = false; continue; }
    const [px, py] = mapper.toPx(x, y);
    if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
  }
  ctx.stroke();
}
function autoY(f, xMin, xMax, padFrac) {
  let yMin = Infinity, yMax = -Infinity;
  for (let k = 0; k <= 100; k++) {
    const x = xMin + (xMax - xMin) * k / 100, y = f(x);
    if (isFinite(y)) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
  }
  if (!isFinite(yMin)) { yMin = -4; yMax = 4; }
  if (yMax - yMin < 1e-6) { yMin -= 1; yMax += 1; }
  const pad = Math.max(0.4, (yMax - yMin) * (padFrac === undefined ? 0.2 : padFrac));
  return [yMin - pad, yMax + pad];
}
function drawArrow(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width || 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1), hl = 7;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hl * Math.cos(ang - 0.4), y2 - hl * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - hl * Math.cos(ang + 0.4), y2 - hl * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fill();
}
function dot(ctx, mapper, x, y, color, r) {
  const [px, py] = mapper.toPx(x, y);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, r || 5, 0, Math.PI * 2); ctx.fill();
}

/* ==============================================================
   2. THREE.JS REUSABLE 3D SCENE WRAPPER
   Each 3D module gets its own Scene3D instance (lazily created)
   so camera orbit state persists per-module while switching tabs.
   ============================================================== */
class Scene3D {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(4, 6, 5); this.scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0x6fe7c6, 0.25); dl2.position.set(-4, 2, -3); this.scene.add(dl2);

    this.orbit = { theta: Math.PI * 0.28, phi: Math.PI * 0.32, radius: 8.5 };
    this._updateCam();

    let dragging = false, lastX = 0, lastY = 0;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener("pointerup", () => dragging = false);
    window.addEventListener("pointermove", e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      this.orbit.theta -= dx * 0.006;
      this.orbit.phi = Math.min(Math.PI * 0.49, Math.max(0.06, this.orbit.phi - dy * 0.006));
      this._updateCam();
    });
    el.addEventListener("wheel", e => {
      e.preventDefault();
      this.orbit.radius = Math.min(20, Math.max(2.5, this.orbit.radius + e.deltaY * 0.01));
      this._updateCam();
    }, { passive: false });

    this._loop = this._loop.bind(this);
    this._running = true;
    requestAnimationFrame(this._loop);
  }
  _updateCam() {
    const { theta, phi, radius } = this.orbit;
    this.camera.position.set(radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta));
    this.camera.lookAt(0, 0.3, 0);
  }
  resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(280, rect.width), h = Math.max(280, rect.height);
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  clearExtras() {
    // remove everything except lights
    const keep = new Set(this.scene.children.filter(c => c.isLight));
    [...this.scene.children].forEach(c => { if (!keep.has(c)) this.scene.remove(c); });
  }
  _loop() {
    requestAnimationFrame(this._loop);
    this.renderer.render(this.scene, this.camera);
  }
}
function heightColor(t) {
  const c1 = new THREE.Color(0xff8b5e), c2 = new THREE.Color(0xf2c14e), c3 = new THREE.Color(0x6fe7c6);
  if (t < 0.5) return c1.clone().lerp(c2, t * 2);
  return c2.clone().lerp(c3, (t - 0.5) * 2);
}

/* ==============================================================
   3. MODULE FRAMEWORK
   ============================================================== */
const MODULES = [];
let CURRENT_ID = null;

function fnInputHTML(prefix, presets, label) {
  const opts = presets.map(p => `<option value="${p.expr}">${p.label}</option>`).join("");
  return `<div class="field"><label>${label || "Function"}</label>
    <select id="${prefix}-preset">${opts}<option value="__custom">Custom…</option></select>
    <input type="text" id="${prefix}-src" value="${presets[0].expr}" style="margin-top:6px;" spellcheck="false"></div>`;
}
function wireFnInput(prefix, onChange) {
  const sel = document.getElementById(prefix + "-preset");
  const inp = document.getElementById(prefix + "-src");
  sel.addEventListener("change", () => { if (sel.value !== "__custom") { inp.value = sel.value; onChange(); } });
  inp.addEventListener("input", () => { sel.value = "__custom"; onChange(); });
  return () => inp.value;
}
function setSteps(id, items) {
  const el = document.getElementById("steps-" + id);
  if (!el) return;
  el.innerHTML = items.map((s, i) => `<div class="step${i === items.length - 1 ? " hl" : ""}">${s}</div>`).join("");
}
function buildPanel(mod) {
  const section = document.createElement("section");
  section.className = "panel";
  section.id = "panel-" + mod.id;
  section.innerHTML = `
    <div class="grid2">
      <div class="controls">${mod.controlsHTML}</div>
      <div class="stage" id="stage-${mod.id}">
        ${mod.badge ? `<span class="badge">${mod.badge}</span>` : ""}
        ${mod.is3D ? "" : `<canvas class="plot" id="canvas-${mod.id}"></canvas>`}
      </div>
    </div>
    <div class="explain">${mod.explainHTML}</div>
    <div class="steps"><h4>Step by step</h4><div id="steps-${mod.id}"></div></div>
  `;
  document.getElementById("panelHost").appendChild(section);
  return section;
}
function buildSidebar() {
  const nav = document.getElementById("sidebar");
  let lastCourse = null, counter = 0;
  MODULES.forEach(mod => {
    if (mod.course !== lastCourse) {
      lastCourse = mod.course; counter = 0;
      const h = document.createElement("div");
      h.className = "group-title"; h.textContent = mod.course;
      nav.appendChild(h);
    }
    counter++;
    const btn = document.createElement("button");
    btn.className = "navbtn"; btn.dataset.id = mod.id;
    btn.innerHTML = `<span class="num">${String(counter).padStart(2, "0")}</span><span>${mod.title}</span>`;
    btn.addEventListener("click", () => activateModule(mod.id));
    nav.appendChild(btn);
  });
}
function activateModule(id) {
  const mod = MODULES.find(m => m.id === id);
  if (!mod) return;
  CURRENT_ID = id;
  document.querySelectorAll(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.id === id));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  let panel = document.getElementById("panel-" + id);
  if (!panel) panel = buildPanel(mod);
  panel.classList.add("active");
  document.getElementById("courseLabel").textContent = mod.course;
  document.getElementById("moduleTitle").textContent = mod.title;
  document.getElementById("moduleSub").textContent = mod.sub || "";
  if (!mod._inited) { mod.init(panel); mod._inited = true; }
  else if (mod.onShow) mod.onShow();
  closeMobileNav();
}
window.addEventListener("resize", () => {
  const mod = MODULES.find(m => m.id === CURRENT_ID);
  if (mod && mod.onShow) mod.onShow();
});

/* ==============================================================
   4. MODULE IMPLEMENTATIONS — CALCULUS 1
   ============================================================== */

/* ---- 4.1 Limits ---- */
MODULES.push({
  id: "lim", course: "Calculus 1", title: "Limits", sub: "What f(x) approaches as x approaches a",
  badge: "watch both sides converge",
  controlsHTML: fnInputHTML("lim", [
    { label: "sin(x)/x", expr: "sin(x)/x" },
    { label: "(x²−1)/(x−1)", expr: "(x^2-1)/(x-1)" },
    { label: "x²", expr: "x^2" },
    { label: "1/x", expr: "1/x" },
    { label: "(1−cos(x))/x", expr: "(1-cos(x))/x" }
  ], "Function f(x)") + `
    <div class="field"><label>Approach point a — <span id="lim-a-out">1.00</span></label>
      <input type="range" id="lim-a" min="-3" max="3" step="0.05" value="1"></div>
    <div class="readouts">
      <div class="r"><span class="k">lim x→a⁻</span><span class="v coral" id="lim-left">–</span></div>
      <div class="r"><span class="k">lim x→a⁺</span><span class="v mint" id="lim-right">–</span></div>
      <div class="r"><span class="k">f(a)</span><span class="v gold" id="lim-fa">–</span></div>
      <div class="r"><span class="k">limit exists?</span><span class="v" id="lim-exists">–</span></div>
    </div>`,
  explainHTML: `A limit asks: what value does f(x) get close to as x sneaks up on <b>a</b> — without ever needing
    f to actually be defined <i>at</i> a? Watch the <span class="coral">left-hand</span> and
    <span class="mint">right-hand</span> approach columns in the table below. If both settle on the same number,
    the limit exists, even if f(a) itself is undefined or different — that gap is exactly what makes
    <code>sin(x)/x</code> and <code>(x²−1)/(x−1)</code> interesting at x=0 and x=1.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-lim");
    const getSrc = wireFnInput("lim", update);
    const aSlider = panel.querySelector("#lim-a");
    aSlider.addEventListener("input", update);
    function update() {
      const src = getSrc();
      const f = x => safeCompile(src, "x^2")({ x });
      const a = parseFloat(aSlider.value);
      panel.querySelector("#lim-a-out").textContent = a.toFixed(2);

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const xMin = a - 3.2, xMax = a + 3.2;
      const [yMin, yMax] = autoY(f, xMin, xMax);
      const mapper = makeMapper(rect, xMin, xMax, yMin, yMax);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, xMin, xMax, yMin, yMax, mapper);
      plotCurve(ctx, f, mapper, xMin, xMax, "#e8edf4", 2.2);

      ctx.strokeStyle = "#8fa3bd"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      const [ax] = mapper.toPx(a, 0);
      ctx.beginPath(); ctx.moveTo(ax, mapper.pad); ctx.lineTo(ax, mapper.pad + mapper.h); ctx.stroke();
      ctx.setLineDash([]);

      const hs = [0.5, 0.2, 0.05, 0.01, 0.002];
      let rows = "";
      hs.forEach(h => {
        const yl = f(a - h), yr = f(a + h);
        rows += `<tr><td>${h}</td><td>${isFinite(yl) ? yl.toFixed(5) : "—"}</td><td>${isFinite(yr) ? yr.toFixed(5) : "—"}</td></tr>`;
        dot(ctx, mapper, a - h, yl, "#ff8b5e", 3.5);
        dot(ctx, mapper, a + h, yr, "#6fe7c6", 3.5);
      });
      const leftLim = f(a - hs[hs.length - 1]), rightLim = f(a + hs[hs.length - 1]);
      const fa = f(a);
      const exists = isFinite(leftLim) && isFinite(rightLim) && Math.abs(leftLim - rightLim) < 0.01;

      panel.querySelector("#lim-left").textContent = isFinite(leftLim) ? leftLim.toFixed(4) : "diverges";
      panel.querySelector("#lim-right").textContent = isFinite(rightLim) ? rightLim.toFixed(4) : "diverges";
      panel.querySelector("#lim-fa").textContent = isFinite(fa) ? fa.toFixed(4) : "undefined";
      panel.querySelector("#lim-exists").textContent = exists ? "yes ✓" : "no / undefined";

      setSteps("lim", [
        `Choose a → <b>a = ${a.toFixed(2)}</b>. We test x-values that squeeze in from both sides.`,
        `<h4 style="margin:10px 0 6px;">h</h4><table style="width:100%;border-collapse:collapse;">
           <tr style="color:#8fa3bd;"><td>h</td><td style="color:#ff8b5e;">f(a−h)</td><td style="color:#6fe7c6;">f(a+h)</td></tr>${rows}</table>`,
        `As h → 0, both columns trend toward <b>${exists ? leftLim.toFixed(4) : "different values"}</b>,
         so lim<sub>x→a</sub> f(x) ${exists ? "= " + leftLim.toFixed(4) : "does not exist"}.`
      ]);
    }
    update();
    panel._resize = update;
    this.onShow = update;
  }
});

/* ---- 4.2 Derivatives ---- */
MODULES.push({
  id: "der", course: "Calculus 1", title: "Derivatives", sub: "The secant line's limit as h shrinks to zero",
  badge: "drag x₀ or h",
  controlsHTML: fnInputHTML("der", [
    { label: "x²", expr: "x^2" },
    { label: "x³ − 3x", expr: "x^3-3*x" },
    { label: "sin(x)", expr: "sin(x)" },
    { label: "eˣ / 3", expr: "exp(x)/3" },
    { label: "sqrt(x+3)", expr: "sqrt(x+3)" }
  ]) + `
    <div class="field"><label>Point x₀ — <span id="der-x0-out">0.50</span></label>
      <input type="range" id="der-x0" min="-3" max="3" step="0.01" value="0.5"></div>
    <div class="field"><label>Secant step h — <span id="der-h-out">1.20</span></label>
      <input type="range" id="der-h" min="0.02" max="2.5" step="0.01" value="1.2"></div>
    <button class="action" id="der-animate">Watch h → 0</button>
    <div class="readouts">
      <div class="r"><span class="k">f(x₀)</span><span class="v" id="der-fx0">–</span></div>
      <div class="r"><span class="k">secant slope</span><span class="v coral" id="der-secant">–</span></div>
      <div class="r"><span class="k">f′(x₀) numeric</span><span class="v mint" id="der-tangent">–</span></div>
      <div class="r"><span class="k">f′(x) symbolic</span><span class="v gold" id="der-symbolic">–</span></div>
    </div>`,
  explainHTML: `The <span class="coral">secant</span> connects (x₀,f(x₀)) to (x₀+h, f(x₀+h)) — its slope is an
    <b>average</b> rate of change. Shrink h and the secant rotates onto the <span class="mint">tangent</span>:
    the <b>instantaneous</b> rate of change, f′(x₀) = lim<sub>h→0</sub> [f(x₀+h)−f(x₀)]/h. This app also computes
    f′(x) <b>symbolically</b> using differentiation rules, so you can check the numeric estimate against the
    exact formula.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-der");
    const getSrc = wireFnInput("der", update);
    const x0s = panel.querySelector("#der-x0"), hs = panel.querySelector("#der-h");
    [x0s, hs].forEach(el => el.addEventListener("input", update));
    let animHandle = null;
    panel.querySelector("#der-animate").addEventListener("click", () => {
      if (animHandle) { cancelAnimationFrame(animHandle); animHandle = null; return; }
      (function step() {
        let h = parseFloat(hs.value) * 0.94;
        if (h < 0.02) h = 2.5;
        hs.value = h.toFixed(3); update();
        animHandle = requestAnimationFrame(step);
      })();
    });
    function update() {
      const src = getSrc();
      const f = x => safeCompile(src, "x^2")({ x });
      const x0 = parseFloat(x0s.value), h = parseFloat(hs.value);
      panel.querySelector("#der-x0-out").textContent = x0.toFixed(2);
      panel.querySelector("#der-h-out").textContent = h.toFixed(2);

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const xMin = -3.4, xMax = 3.4;
      const [yMin, yMax] = autoY(f, xMin, xMax);
      const mapper = makeMapper(rect, xMin, xMax, yMin, yMax);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, xMin, xMax, yMin, yMax, mapper);
      plotCurve(ctx, f, mapper, xMin, xMax, "#e8edf4", 2.2);

      const x1 = x0 + h, y0 = f(x0), y1 = f(x1);
      const secantSlope = (y1 - y0) / h;
      const { fn: dfn, str } = symbolicDeriv(src, "x", "x^2");
      const tangentSlope = dfn({ x: x0 });

      ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.strokeStyle = "#ff8b5e"; ctx.beginPath();
      let [sx0, sy0] = mapper.toPx(xMin, y0 + secantSlope * (xMin - x0));
      let [sx1, sy1] = mapper.toPx(xMax, y0 + secantSlope * (xMax - x0));
      ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1); ctx.stroke();

      ctx.strokeStyle = "#6fe7c6"; ctx.setLineDash([6, 5]); ctx.beginPath();
      let [tx0, ty0] = mapper.toPx(xMin, y0 + tangentSlope * (xMin - x0));
      let [tx1, ty1] = mapper.toPx(xMax, y0 + tangentSlope * (xMax - x0));
      ctx.moveTo(tx0, ty0); ctx.lineTo(tx1, ty1); ctx.stroke();
      ctx.setLineDash([]);

      dot(ctx, mapper, x0, y0, "#f2c14e");
      if (isFinite(y1)) dot(ctx, mapper, x1, y1, "#ff8b5e");

      panel.querySelector("#der-fx0").textContent = isFinite(y0) ? y0.toFixed(3) : "–";
      panel.querySelector("#der-secant").textContent = isFinite(secantSlope) ? secantSlope.toFixed(3) : "–";
      panel.querySelector("#der-tangent").textContent = tangentSlope.toFixed(3);
      panel.querySelector("#der-symbolic").textContent = "f′(x) = " + str;

      setSteps("der", [
        `Definition: f′(x₀) = lim<sub>h→0</sub> [f(x₀+h) − f(x₀)] / h.`,
        `At x₀ = ${x0.toFixed(2)}, h = ${h.toFixed(2)}: secant slope = [f(${x1.toFixed(2)}) − f(${x0.toFixed(2)})] / ${h.toFixed(2)}
          = [${y1.toFixed(3)} − ${y0.toFixed(3)}] / ${h.toFixed(2)} = <b>${secantSlope.toFixed(3)}</b>.`,
        `Differentiating symbolically term-by-term gives f′(x) = <b>${str}</b>, so f′(${x0.toFixed(2)}) = <b>${tangentSlope.toFixed(3)}</b> —
          shrink h with the button and watch the secant value converge to this number.`
      ]);
    }
    update();
    this.onShow = update;
  }
});

/* ---- 4.3 Basic Integrals (Riemann sums / area under a curve) ---- */
MODULES.push({
  id: "int1", course: "Calculus 1", title: "Basic Integrals", sub: "Area under a curve, one rectangle at a time",
  badge: "n rectangles approximate the area",
  controlsHTML: fnInputHTML("int1", [
    { label: "x²", expr: "x^2" }, { label: "sin(x)", expr: "sin(x)" },
    { label: "4 − x²", expr: "4-x^2" }, { label: "cos(x)+1.5", expr: "cos(x)+1.5" }, { label: "0.5x³", expr: "0.5*x^3" }
  ]) + `
    <div class="row2">
      <div class="field"><label>a — <span id="int1-a-out">-2.00</span></label><input type="range" id="int1-a" min="-4" max="4" step="0.05" value="-2"></div>
      <div class="field"><label>b — <span id="int1-b-out">2.00</span></label><input type="range" id="int1-b" min="-4" max="4" step="0.05" value="2"></div>
    </div>
    <div class="field"><label>Rectangles n — <span id="int1-n-out">10</span></label><input type="range" id="int1-n" min="1" max="200" step="1" value="10"></div>
    <div class="field"><label>Method</label>
      <div class="radiorow" id="int1-method">
        <label><input type="radio" name="int1method" value="left"><span>left</span></label>
        <label><input type="radio" name="int1method" value="right"><span>right</span></label>
        <label><input type="radio" name="int1method" value="mid" checked><span>midpoint</span></label>
        <label><input type="radio" name="int1method" value="trap"><span>trapezoid</span></label>
      </div></div>
    <button class="action" id="int1-grow">Grow n → converge</button>
    <div class="readouts">
      <div class="r"><span class="k">Δx</span><span class="v" id="int1-dx">–</span></div>
      <div class="r"><span class="k">Riemann sum</span><span class="v coral" id="int1-sum">–</span></div>
      <div class="r"><span class="k">∫ₐᵇ f dx (reference)</span><span class="v mint" id="int1-exact">–</span></div>
      <div class="r"><span class="k">|error|</span><span class="v gold" id="int1-err">–</span></div>
    </div>`,
  explainHTML: `Each rectangle has width Δx = (b−a)/n and a height sampled from f. Summing their signed areas gives a
    <b>Riemann sum</b>, an approximation of the definite integral ∫ₐᵇ f(x) dx. Push n up and the staircase hugs the
    curve tighter — the sum converges to the exact area. This is the same shrink-to-a-limit idea as the derivative,
    just accumulating instead of dividing.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-int1");
    const getSrc = wireFnInput("int1", update);
    const a = panel.querySelector("#int1-a"), b = panel.querySelector("#int1-b"), n = panel.querySelector("#int1-n");
    [a, b, n].forEach(el => el.addEventListener("input", update));
    panel.querySelectorAll('input[name="int1method"]').forEach(r => r.addEventListener("change", update));
    let growHandle = null;
    panel.querySelector("#int1-grow").addEventListener("click", () => {
      if (growHandle) { clearInterval(growHandle); growHandle = null; return; }
      n.value = 1;
      growHandle = setInterval(() => {
        let v = Math.min(200, Math.ceil(parseInt(n.value, 10) * 1.25) + 1);
        n.value = v; update();
        if (v >= 200) { clearInterval(growHandle); growHandle = null; }
      }, 90);
    });
    function update() {
      const f = x => safeCompile(getSrc(), "x^2")({ x });
      let av = parseFloat(a.value), bv = parseFloat(b.value);
      const nv = parseInt(n.value, 10);
      panel.querySelector("#int1-a-out").textContent = av.toFixed(2);
      panel.querySelector("#int1-b-out").textContent = bv.toFixed(2);
      panel.querySelector("#int1-n-out").textContent = nv;
      const method = panel.querySelector('input[name="int1method"]:checked').value;

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const xMin = Math.min(-4.3, av - 0.6), xMax = Math.max(4.3, bv + 0.6);
      let [yMin, yMax] = autoY(f, xMin, xMax, 0.15);
      yMin = Math.min(yMin, -0.2); yMax = Math.max(yMax, 0.2);
      const mapper = makeMapper(rect, xMin, xMax, yMin, yMax);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, xMin, xMax, yMin, yMax, mapper);

      const lo = Math.min(av, bv), hi = Math.max(av, bv);
      const dx = (hi - lo) / nv;
      let sum = 0;
      for (let k = 0; k < nv; k++) {
        const xL = lo + k * dx, xR = xL + dx;
        let height, area;
        if (method === "left") height = f(xL);
        else if (method === "right") height = f(xR);
        else if (method === "mid") height = f((xL + xR) / 2);
        else height = (f(xL) + f(xR)) / 2;
        area = height * dx; sum += area;
        const fillColor = height >= 0 ? "rgba(242,193,78,0.55)" : "rgba(255,122,122,0.5)";
        const strokeColor = height >= 0 ? "#f2c14e" : "#ff7a7a";
        ctx.fillStyle = fillColor; ctx.strokeStyle = strokeColor;
        if (method === "trap") {
          const [pxL, pyL] = mapper.toPx(xL, f(xL)), [pxR, pyR] = mapper.toPx(xR, f(xR)), [, py0] = mapper.toPx(xL, 0);
          ctx.beginPath(); ctx.moveTo(pxL, py0); ctx.lineTo(pxL, pyL); ctx.lineTo(pxR, pyR); ctx.lineTo(pxR, py0); ctx.closePath();
          ctx.fill(); ctx.stroke();
        } else {
          const [pxL, pyTop] = mapper.toPx(xL, height), [pxR] = mapper.toPx(xR, height), [, pyBase] = mapper.toPx(xL, 0);
          const top = Math.min(pyTop, pyBase), h2 = Math.abs(pyBase - pyTop);
          ctx.fillRect(pxL, top, pxR - pxL, h2); ctx.strokeRect(pxL, top, pxR - pxL, h2);
        }
      }
      plotCurve(ctx, f, mapper, xMin, xMax, "#e8edf4", 2.2);

      const exact = simpson1D(f, lo, hi, 400) * (bv < av ? -1 : 1);
      const displaySum = bv < av ? -sum : sum;
      panel.querySelector("#int1-dx").textContent = dx.toFixed(4);
      panel.querySelector("#int1-sum").textContent = displaySum.toFixed(4);
      panel.querySelector("#int1-exact").textContent = exact.toFixed(4);
      panel.querySelector("#int1-err").textContent = Math.abs(displaySum - exact).toFixed(4);

      setSteps("int1", [
        `Split [${av.toFixed(2)}, ${bv.toFixed(2)}] into n = ${nv} pieces of width Δx = ${dx.toFixed(4)}.`,
        `Method: <b>${method}</b> — sample f at each piece and multiply by Δx to get each rectangle's signed area, then add them up.`,
        `Sum ≈ <b>${displaySum.toFixed(4)}</b>, compared with a high-resolution reference integral of <b>${exact.toFixed(4)}</b> —
          error shrinks toward 0 as n grows.`
      ]);
    }
    update();
    this.onShow = update;
  }
});

/* ---- 4.4 Optimization ---- */
MODULES.push({
  id: "opt", course: "Calculus 1", title: "Optimization", sub: "Where f′(x) = 0 tells you about peaks and valleys",
  badge: "critical points auto-detected",
  controlsHTML: fnInputHTML("opt", [
    { label: "x³ − 3x", expr: "x^3-3*x" }, { label: "x⁴ − 4x²", expr: "x^4-4*x^2" },
    { label: "sin(x) + x/3", expr: "sin(x)+x/3" }, { label: "x² − 4x + 3", expr: "x^2-4*x+3" }
  ]) + `
    <div class="row2">
      <div class="field"><label>a — <span id="opt-a-out">-3.00</span></label><input type="range" id="opt-a" min="-6" max="6" step="0.05" value="-3"></div>
      <div class="field"><label>b — <span id="opt-b-out">3.00</span></label><input type="range" id="opt-b" min="-6" max="6" step="0.05" value="3"></div>
    </div>
    <div class="readouts" id="opt-readouts"><div class="r"><span class="k">f′(x)</span><span class="v gold" id="opt-symbolic">–</span></div></div>`,
  explainHTML: `A function's slope is zero exactly at its peaks and valleys. This module finds where <b>f′(x) = 0</b>
    on [a,b] by scanning for sign changes in the symbolic derivative, then classifies each point with the
    <b>second-derivative test</b>: f″ &lt; 0 means a local max, f″ &gt; 0 means a local min. The largest and
    smallest values among critical points and endpoints give the <b>absolute</b> max/min on the interval.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-opt");
    const getSrc = wireFnInput("opt", update);
    const a = panel.querySelector("#opt-a"), b = panel.querySelector("#opt-b");
    [a, b].forEach(el => el.addEventListener("input", update));
    function update() {
      const src = getSrc();
      const f = x => safeCompile(src, "x^3-3*x")({ x });
      const { fn: dfn, str: dstr } = symbolicDeriv(src, "x", "x^3-3*x");
      const { fn: ddfn } = symbolicDeriv(dstr.replace(/\u00B7/g, "*"), "x", "x");
      let av = parseFloat(a.value), bv = parseFloat(b.value);
      if (bv <= av) bv = av + 0.5;
      panel.querySelector("#opt-a-out").textContent = av.toFixed(2);
      panel.querySelector("#opt-b-out").textContent = bv.toFixed(2);
      panel.querySelector("#opt-symbolic").textContent = "f′(x) = " + dstr;

      // scan for sign changes of f'
      const SCAN = 400;
      const crit = [];
      let prevSign = Math.sign(dfn({ x: av }));
      for (let k = 1; k <= SCAN; k++) {
        const x = av + (bv - av) * k / SCAN;
        const s = Math.sign(dfn({ x }));
        if (s !== 0 && prevSign !== 0 && s !== prevSign) {
          // bisect for a cleaner root
          let lo = av + (bv - av) * (k - 1) / SCAN, hi = x;
          for (let it = 0; it < 30; it++) {
            const mid = (lo + hi) / 2;
            if (Math.sign(dfn({ x: mid })) === prevSign) lo = mid; else hi = mid;
          }
          crit.push((lo + hi) / 2);
        }
        if (s !== 0) prevSign = s;
      }

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const [yMin, yMax] = autoY(f, av, bv);
      const mapper = makeMapper(rect, av, bv, yMin, yMax);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, av, bv, yMin, yMax, mapper);
      plotCurve(ctx, f, mapper, av, bv, "#e8edf4", 2.2);

      let candidates = [{ x: av, label: "endpoint" }, { x: bv, label: "endpoint" }];
      const stepLines = [`f′(x) = <b>${dstr}</b>. Scanning [${av.toFixed(2)}, ${bv.toFixed(2)}] for sign changes gives ${crit.length} critical point(s).`];
      crit.forEach(x => {
        const f2 = ddfn({ x });
        const kind = f2 < -1e-6 ? "local max" : f2 > 1e-6 ? "local min" : "inflection";
        candidates.push({ x, label: kind });
        dot(ctx, mapper, x, f(x), kind === "local max" ? "#ff8b5e" : kind === "local min" ? "#6fe7c6" : "#8fa3bd", 6);
        stepLines.push(`x = ${x.toFixed(3)}: f″(x) ≈ ${f2.toFixed(3)} → <b>${kind}</b>, f(x) = ${f(x).toFixed(3)}.`);
      });
      candidates.forEach(c => c.y = f(c.x));
      const absMax = candidates.reduce((m, c) => c.y > m.y ? c : m, candidates[0]);
      const absMin = candidates.reduce((m, c) => c.y < m.y ? c : m, candidates[0]);
      dot(ctx, mapper, absMax.x, absMax.y, "#f2c14e", 7);
      dot(ctx, mapper, absMin.x, absMin.y, "#f2c14e", 7);

      stepLines.push(`Comparing all critical points and endpoints: absolute max f(${absMax.x.toFixed(3)}) = <b>${absMax.y.toFixed(3)}</b>,
         absolute min f(${absMin.x.toFixed(3)}) = <b>${absMin.y.toFixed(3)}</b> on this interval.`);
      setSteps("opt", stepLines);
    }
    update();
    this.onShow = update;
  }
});

/* ---- 4.5 Related Rates ---- */
MODULES.push({
  id: "rr", course: "Calculus 1", title: "Related Rates", sub: "The sliding-ladder problem, worked live",
  badge: "classic example: ladder sliding down a wall",
  controlsHTML: `
    <div class="field"><label>Ladder length L — <span id="rr-L-out">5.0</span> m</label><input type="range" id="rr-L" min="3" max="9" step="0.1" value="5"></div>
    <div class="field"><label>Base distance x — <span id="rr-x-out">3.0</span> m</label><input type="range" id="rr-x" min="0.5" max="8.9" step="0.05" value="3"></div>
    <div class="field"><label>Base speed dx/dt — <span id="rr-dxdt-out">0.50</span> m/s</label><input type="range" id="rr-dxdt" min="0.1" max="2" step="0.05" value="0.5"></div>
    <div class="readouts">
      <div class="r"><span class="k">height y</span><span class="v" id="rr-y">–</span></div>
      <div class="r"><span class="k">dx/dt (given)</span><span class="v coral" id="rr-dxdt-v">–</span></div>
      <div class="r"><span class="k">dy/dt (found)</span><span class="v mint" id="rr-dydt">–</span></div>
    </div>`,
  explainHTML: `A ${"<b>related rates</b>"} problem links two changing quantities through one equation, then differentiates
    <i>with respect to time</i> to relate their rates. Here x² + y² = L² always holds for the ladder, so
    2x(dx/dt) + 2y(dy/dt) = 0 — meaning as the base slides out (dx/dt &gt; 0), the top must slide down
    (dy/dt &lt; 0), and it accelerates as the ladder nears the ground.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-rr");
    const L = panel.querySelector("#rr-L"), x = panel.querySelector("#rr-x"), dxdt = panel.querySelector("#rr-dxdt");
    [L, x, dxdt].forEach(el => el.addEventListener("input", update));
    function update() {
      let Lv = parseFloat(L.value), xv = Math.min(parseFloat(x.value), Lv - 0.05), dxv = parseFloat(dxdt.value);
      x.max = (Lv - 0.05).toFixed(2);
      const yv = Math.sqrt(Lv * Lv - xv * xv);
      const dydt = -(xv / yv) * dxv;
      panel.querySelector("#rr-L-out").textContent = Lv.toFixed(1);
      panel.querySelector("#rr-x-out").textContent = xv.toFixed(2);
      panel.querySelector("#rr-dxdt-out").textContent = dxv.toFixed(2);
      panel.querySelector("#rr-y").textContent = yv.toFixed(3) + " m";
      panel.querySelector("#rr-dxdt-v").textContent = dxv.toFixed(3) + " m/s";
      panel.querySelector("#rr-dydt").textContent = dydt.toFixed(3) + " m/s";

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const dim = Math.max(Lv + 1, 6);
      const mapper = makeMapper(rect, -0.5, dim, -0.5, dim, 40);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, -0.5, dim, -0.5, dim, mapper);
      // wall + ground
      ctx.strokeStyle = "#3a5c80"; ctx.lineWidth = 3;
      let [gx0, gy0] = mapper.toPx(0, 0), [gx1] = mapper.toPx(dim, 0);
      ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy0); ctx.stroke();
      let [, wy1] = mapper.toPx(0, dim);
      ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx0, wy1); ctx.stroke();
      // ladder
      const [px0, py0] = mapper.toPx(xv, 0), [px1, py1] = mapper.toPx(0, yv);
      ctx.strokeStyle = "#f2c14e"; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.stroke();
      dot(ctx, mapper, xv, 0, "#ff8b5e", 6); dot(ctx, mapper, 0, yv, "#6fe7c6", 6);
      // rate arrows
      drawArrow(ctx, px0, py0, px0 + 40, py0, "#ff8b5e", 2.5);
      drawArrow(ctx, px1, py1, px1, py1 + 40, "#6fe7c6", 2.5);

      setSteps("rr", [
        `Relation: x² + y² = L² = ${Lv.toFixed(1)}². Currently x = ${xv.toFixed(2)} m, so y = √(L²−x²) = <b>${yv.toFixed(3)} m</b>.`,
        `Differentiate both sides with respect to t: 2x(dx/dt) + 2y(dy/dt) = 0 → dy/dt = −(x/y)(dx/dt).`,
        `Plugging in: dy/dt = −(${xv.toFixed(2)}/${yv.toFixed(3)}) × ${dxv.toFixed(2)} = <b>${dydt.toFixed(3)} m/s</b> —
          negative because the top of the ladder is sliding <i>down</i> as the base slides out.`
      ]);
    }
    update();
    this.onShow = update;
  }
});

/* ==============================================================
   4. MODULE IMPLEMENTATIONS — CALCULUS 2
   ============================================================== */

/* ---- 4.6 Techniques of Integration ---- */
const TECHNIQUES = [
  {
    name: "u-Substitution", expr: "2*x*sin(x^2)", a: 0, b: Math.sqrt(Math.PI),
    antideriv: "-cos(x^2)",
    steps: [
      "Spot an inner function whose derivative also appears: u = x², so du = 2x dx.",
      "Rewrite ∫2x·sin(x²) dx = ∫sin(u) du = −cos(u) + C = −cos(x²) + C.",
      "Evaluate on the bounds using the antiderivative F(x) = −cos(x²)."
    ]
  },
  {
    name: "Integration by Parts", expr: "x*exp(x)", a: 0, b: 2,
    antideriv: "(x-1)*exp(x)",
    steps: [
      "Pick u = x (gets simpler when differentiated) and dv = eˣ dx (easy to integrate).",
      "Then du = dx, v = eˣ. Formula: ∫u dv = uv − ∫v du = x·eˣ − ∫eˣ dx.",
      "So ∫x·eˣ dx = x·eˣ − eˣ + C = (x−1)eˣ + C — evaluate on the bounds."
    ]
  },
  {
    name: "Trig Substitution", expr: "1/sqrt(4-x^2)", a: -1, b: 1,
    antideriv: "asin(x/2)",
    steps: [
      "The √(4−x²) pattern suggests x = 2 sin(θ), so dx = 2 cos(θ) dθ and 4−x² = 4cos²(θ).",
      "∫ dx/√(4−x²) = ∫ 2cos(θ) dθ / (2cos(θ)) = ∫ dθ = θ + C.",
      "Back-substitute θ = arcsin(x/2): antiderivative F(x) = arcsin(x/2) — evaluate on the bounds."
    ]
  }
];
MODULES.push({
  id: "tech", course: "Calculus 2", title: "Techniques of Integration", sub: "u-substitution, by parts, and trig substitution",
  badge: "pick a technique",
  controlsHTML: `<div class="techcards" id="tech-cards">${TECHNIQUES.map((t, i) =>
    `<div class="techcard${i === 0 ? " active" : ""}" data-i="${i}"><h4>${t.name}</h4><p>∫ ${t.expr.replace(/\*/g, "·")} dx</p></div>`).join("")}</div>
    <div class="readouts">
      <div class="r"><span class="k">antiderivative F(x)</span><span class="v gold" id="tech-F">–</span></div>
      <div class="r"><span class="k">Simpson estimate</span><span class="v coral" id="tech-num">–</span></div>
      <div class="r"><span class="k">F(b) − F(a)</span><span class="v mint" id="tech-exact">–</span></div>
    </div>`,
  explainHTML: `Every technique below is a different way to reverse the chain rule, product rule, or a substitution
    that simplifies a hard-looking integrand into something recognizable. Pick a card; the numeric check compares a
    high-resolution Riemann/Simpson estimate of the definite integral against directly evaluating the antiderivative
    the technique produces — they should agree.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-tech");
    let active = 0;
    panel.querySelectorAll(".techcard").forEach(card => card.addEventListener("click", () => {
      active = parseInt(card.dataset.i, 10); update();
    }));
    function update() {
      panel.querySelectorAll(".techcard").forEach((c, i) => c.classList.toggle("active", i === active));
      const t = TECHNIQUES[active];
      const f = x => safeCompile(t.expr, "x^2")({ x });
      const F = x => t.antideriv === "asin(x/2)" ? Math.asin(x / 2) : safeCompile(t.antideriv, "x")({ x });

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const pad = Math.max(1, (t.b - t.a) * 0.6);
      const xMin = t.a - pad, xMax = t.b + pad;
      const [yMin, yMax] = autoY(f, xMin, xMax);
      const mapper = makeMapper(rect, xMin, xMax, yMin, yMax);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, xMin, xMax, yMin, yMax, mapper);
      // shade region
      ctx.fillStyle = "rgba(242,193,78,0.35)";
      ctx.beginPath();
      const [start] = mapper.toPx(t.a, 0);
      ctx.moveTo(start, mapper.toPx(t.a, 0)[1]);
      const N = 60;
      for (let k = 0; k <= N; k++) {
        const x = t.a + (t.b - t.a) * k / N;
        const [px, py] = mapper.toPx(x, f(x));
        ctx.lineTo(px, py);
      }
      ctx.lineTo(mapper.toPx(t.b, 0)[0], mapper.toPx(t.b, 0)[1]);
      ctx.closePath(); ctx.fill();
      plotCurve(ctx, f, mapper, xMin, xMax, "#e8edf4", 2.2);

      const num = simpson1D(f, t.a, t.b, 300);
      const exact = F(t.b) - F(t.a);
      panel.querySelector("#tech-F").textContent = "F(x) = " + t.antideriv.replace(/\*/g, "\u00B7");
      panel.querySelector("#tech-num").textContent = num.toFixed(4);
      panel.querySelector("#tech-exact").textContent = exact.toFixed(4);

      setSteps("tech", t.steps.concat([
        `Numerically, ∫<sub>${t.a.toFixed(2)}</sub><sup>${t.b.toFixed(2)}</sup> ≈ <b>${num.toFixed(4)}</b>,
          matching F(${t.b.toFixed(2)}) − F(${t.a.toFixed(2)}) = <b>${exact.toFixed(4)}</b>.`
      ]));
    }
    update();
    this.onShow = update;
  }
});

/* ---- 4.7 Sequences & Series ---- */
MODULES.push({
  id: "seq", course: "Calculus 2", title: "Sequences & Series", sub: "Terms, partial sums, and the ratio test",
  badge: "coral = terms · mint = partial sums",
  controlsHTML: fnInputHTML("seq", [
    { label: "1/n", expr: "1/n" }, { label: "(-1)^n / n", expr: "(-1)^n/n" },
    { label: "n / (n+1)", expr: "n/(n+1)" }, { label: "1/n^2", expr: "1/n^2" }, { label: "1/n!  ≈ using n^-n·e^n (approx)", expr: "1/n^n" }
  ], "Term aₙ (use variable n)") + `
    <div class="field"><label>Terms N — <span id="seq-N-out">20</span></label><input type="range" id="seq-N" min="3" max="60" step="1" value="20"></div>
    <div class="readouts">
      <div class="r"><span class="k">aₙ (last term)</span><span class="v coral" id="seq-last">–</span></div>
      <div class="r"><span class="k">partial sum Sₙ</span><span class="v mint" id="seq-sum">–</span></div>
      <div class="r"><span class="k">ratio |a_(n+1)/aₙ|</span><span class="v gold" id="seq-ratio">–</span></div>
      <div class="r"><span class="k">ratio test says</span><span class="v" id="seq-verdict">–</span></div>
    </div>`,
  explainHTML: `A <b>sequence</b> aₙ is just a function of whole numbers; a <b>series</b> Σaₙ tracks its running total —
    the <span class="mint">partial sums</span>. If the terms shrink fast enough, the partial sums level off and the
    series <b>converges</b>. The <b>ratio test</b> looks at L = lim|a_(n+1)/aₙ|: L&lt;1 means convergence, L&gt;1 means
    divergence, and L=1 is inconclusive.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-seq");
    const getSrc = wireFnInput("seq", update);
    const Ns = panel.querySelector("#seq-N");
    Ns.addEventListener("input", update);
    function update() {
      const src = getSrc();
      const a = n => safeCompile(src, "1/n")({ n });
      const N = parseInt(Ns.value, 10);
      panel.querySelector("#seq-N-out").textContent = N;

      const terms = [], sums = [];
      let running = 0;
      for (let n = 1; n <= N; n++) { const v = a(n); terms.push(v); running += isFinite(v) ? v : 0; sums.push(running); }

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const allVals = terms.concat(sums).filter(isFinite);
      let yMin = Math.min(0, ...allVals), yMax = Math.max(0, ...allVals);
      const pad = Math.max(0.3, (yMax - yMin) * 0.15); yMin -= pad; yMax += pad;
      const mapper = makeMapper(rect, 0.5, N + 0.5, yMin, yMax);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, 0.5, N + 0.5, yMin, yMax, mapper);

      ctx.strokeStyle = "#6fe7c6"; ctx.lineWidth = 1.6; ctx.beginPath();
      sums.forEach((v, idx) => { const [px, py] = mapper.toPx(idx + 1, v); if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
      sums.forEach((v, idx) => dot(ctx, mapper, idx + 1, v, "#6fe7c6", 2.6));
      terms.forEach((v, idx) => { if (isFinite(v)) dot(ctx, mapper, idx + 1, v, "#ff8b5e", 3); });

      const last = terms[terms.length - 1];
      const ratio = Math.abs(terms[terms.length - 1] / terms[terms.length - 2]);
      const verdict = ratio < 0.97 ? "converges (L<1)" : ratio > 1.03 ? "diverges (L>1)" : "inconclusive (L≈1)";
      panel.querySelector("#seq-last").textContent = isFinite(last) ? last.toFixed(5) : "–";
      panel.querySelector("#seq-sum").textContent = sums[sums.length - 1].toFixed(5);
      panel.querySelector("#seq-ratio").textContent = isFinite(ratio) ? ratio.toFixed(4) : "–";
      panel.querySelector("#seq-verdict").textContent = verdict;

      setSteps("seq", [
        `Terms a₁..a_${N} are plotted in <span style="color:#ff8b5e">coral</span>; running totals S_n = a₁+…+aₙ in <span style="color:#6fe7c6">mint</span>.`,
        `Ratio test: |a_(n+1)/aₙ| ≈ <b>${isFinite(ratio) ? ratio.toFixed(4) : "–"}</b> for large n → the series <b>${verdict}</b>.`,
        `If it converges, the partial-sum curve should be flattening out toward S_${N} ≈ <b>${sums[sums.length - 1].toFixed(4)}</b>.`
      ]);
    }
    update();
    this.onShow = update;
  }
});

/* ---- 4.8 Parametric Equations ---- */
MODULES.push({
  id: "param", course: "Calculus 2", title: "Parametric Equations", sub: "Tracing a curve as t varies, with its tangent vector",
  badge: "drag the t slider",
  controlsHTML: `
    <div class="field"><label>x(t)</label><input type="text" id="param-x" value="cos(t)"></div>
    <div class="field"><label>y(t)</label><input type="text" id="param-y" value="sin(t)*2"></div>
    <div class="row2">
      <div class="field"><label>t min</label><input type="text" id="param-tmin" value="0"></div>
      <div class="field"><label>t max</label><input type="text" id="param-tmax" value="6.283"></div>
    </div>
    <div class="field"><label>t — <span id="param-t-out">1.00</span></label><input type="range" id="param-t" min="0" max="6.283" step="0.01" value="1"></div>
    <div class="readouts">
      <div class="r"><span class="k">dx/dt</span><span class="v coral" id="param-dxdt">–</span></div>
      <div class="r"><span class="k">dy/dt</span><span class="v coral" id="param-dydt">–</span></div>
      <div class="r"><span class="k">dy/dx</span><span class="v mint" id="param-dydx">–</span></div>
    </div>`,
  explainHTML: `A parametric curve traces (x(t), y(t)) as t sweeps forward — useful when a curve isn't a simple
    function of x (like a circle or spiral). The velocity vector (dx/dt, dy/dt) is <b>tangent</b> to the path,
    and its slope dy/dx = (dy/dt)/(dx/dt) tells you the direction of motion at each instant.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-param");
    const xEl = panel.querySelector("#param-x"), yEl = panel.querySelector("#param-y");
    const tminEl = panel.querySelector("#param-tmin"), tmaxEl = panel.querySelector("#param-tmax"), tEl = panel.querySelector("#param-t");
    [xEl, yEl, tminEl, tmaxEl].forEach(el => el.addEventListener("input", () => { syncRange(); update(); }));
    tEl.addEventListener("input", update);
    function syncRange() {
      const tmin = parseFloat(tminEl.value) || 0, tmax = parseFloat(tmaxEl.value) || 1;
      tEl.min = tmin; tEl.max = tmax;
      if (parseFloat(tEl.value) < tmin || parseFloat(tEl.value) > tmax) tEl.value = (tmin + tmax) / 2;
    }
    function update() {
      const xSrc = xEl.value, ySrc = yEl.value;
      const xt = t => safeCompile(xSrc, "cos(t)")({ t });
      const yt = t => safeCompile(ySrc, "sin(t)")({ t });
      const tmin = parseFloat(tminEl.value) || 0, tmax = parseFloat(tmaxEl.value) || 1;
      const tval = parseFloat(tEl.value);
      panel.querySelector("#param-t-out").textContent = tval.toFixed(2);

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      const N = 300, pts = [];
      for (let k = 0; k <= N; k++) {
        const t = tmin + (tmax - tmin) * k / N;
        const x = xt(t), y = yt(t);
        pts.push([x, y]);
        if (isFinite(x)) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
        if (isFinite(y)) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
      }
      if (!isFinite(xMin)) { xMin = -2; xMax = 2; }
      if (!isFinite(yMin)) { yMin = -2; yMax = 2; }
      const padX = Math.max(0.4, (xMax - xMin) * 0.15), padY = Math.max(0.4, (yMax - yMin) * 0.15);
      xMin -= padX; xMax += padX; yMin -= padY; yMax += padY;
      const mapper = makeMapper(rect, xMin, xMax, yMin, yMax);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, xMin, xMax, yMin, yMax, mapper);

      ctx.strokeStyle = "#e8edf4"; ctx.lineWidth = 2.2; ctx.beginPath();
      pts.forEach(([x, y], idx) => { const [px, py] = mapper.toPx(x, y); if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();

      const eps = 1e-4;
      const dxdt = (xt(tval + eps) - xt(tval - eps)) / (2 * eps);
      const dydt = (yt(tval + eps) - yt(tval - eps)) / (2 * eps);
      const dydx = dxdt !== 0 ? dydt / dxdt : NaN;
      panel.querySelector("#param-dxdt").textContent = dxdt.toFixed(3);
      panel.querySelector("#param-dydt").textContent = dydt.toFixed(3);
      panel.querySelector("#param-dydx").textContent = isFinite(dydx) ? dydx.toFixed(3) : "vertical";

      const x0 = xt(tval), y0 = yt(tval);
      dot(ctx, mapper, x0, y0, "#f2c14e", 6);
      const mag = Math.hypot(dxdt, dydt) || 1;
      const scale = Math.min(xMax - xMin, yMax - yMin) * 0.18;
      const [ax0, ay0] = mapper.toPx(x0, y0);
      const [ax1, ay1] = mapper.toPx(x0 + dxdt / mag * scale, y0 + dydt / mag * scale);
      drawArrow(ctx, ax0, ay0, ax1, ay1, "#6fe7c6", 2.5);

      setSteps("param", [
        `At t = ${tval.toFixed(2)}: position = (${x0.toFixed(3)}, ${y0.toFixed(3)}).`,
        `Velocity vector: (dx/dt, dy/dt) ≈ (${dxdt.toFixed(3)}, ${dydt.toFixed(3)}) — this is the <span class="mint">mint arrow</span>,
          tangent to the curve and pointing in the direction of increasing t.`,
        `Slope of the curve there: dy/dx = (dy/dt)/(dx/dt) ≈ <b>${isFinite(dydx) ? dydx.toFixed(3) : "vertical tangent"}</b>.`
      ]);
    }
    syncRange(); update();
    this.onShow = update;
  }
});

/* ---- 4.9 Polar Coordinates ---- */
MODULES.push({
  id: "polar", course: "Calculus 2", title: "Polar Coordinates", sub: "r(θ) curves and the polar area formula",
  badge: "shaded wedge = swept area",
  controlsHTML: fnInputHTML("polar", [
    { label: "cardioid: 1+cos(θ)", expr: "1+cos(theta)" }, { label: "rose: cos(3θ)", expr: "cos(3*theta)" },
    { label: "circle: r=2", expr: "2" }, { label: "spiral: θ/3", expr: "theta/3" }
  ], "r(θ)  (use variable theta)") + `
    <div class="field"><label>Sweep to θ — <span id="polar-t-out">3.14</span></label><input type="range" id="polar-t" min="0.1" max="12.57" step="0.02" value="3.14"></div>
    <div class="readouts">
      <div class="r"><span class="k">r(θ)</span><span class="v" id="polar-r">–</span></div>
      <div class="r"><span class="k">swept area ½∫r²dθ</span><span class="v gold" id="polar-area">–</span></div>
    </div>`,
  explainHTML: `Polar curves plot r as a function of angle θ instead of y as a function of x. The area swept from
    0 to θ isn't just ∫r dθ — because area scales with <i>radius squared</i>, the formula is
    <b>A = ½∫r(θ)² dθ</b>, computed numerically here as θ sweeps around.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-polar");
    const getSrc = wireFnInput("polar", update);
    const tEl = panel.querySelector("#polar-t");
    tEl.addEventListener("input", update);
    function update() {
      const src = getSrc();
      const r = th => safeCompile(src, "1+cos(theta)")({ theta: th });
      const tmax = parseFloat(tEl.value);
      panel.querySelector("#polar-t-out").textContent = tmax.toFixed(2);

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const N = 400, full = [];
      let maxR = 0.5;
      for (let k = 0; k <= N; k++) { const th = k / N * 4 * Math.PI; const rv = r(th); if (isFinite(rv)) maxR = Math.max(maxR, Math.abs(rv)); full.push(th); }
      const mapper = makeMapper(rect, -maxR * 1.15, maxR * 1.15, -maxR * 1.15, maxR * 1.15);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, -maxR * 1.15, maxR * 1.15, -maxR * 1.15, maxR * 1.15, mapper);

      // shaded swept wedge
      ctx.fillStyle = "rgba(242,193,78,0.3)";
      ctx.beginPath(); ctx.moveTo(...mapper.toPx(0, 0));
      for (let k = 0; k <= 200; k++) {
        const th = tmax * k / 200, rv = r(th);
        ctx.lineTo(...mapper.toPx(rv * Math.cos(th), rv * Math.sin(th)));
      }
      ctx.closePath(); ctx.fill();

      // full curve
      ctx.strokeStyle = "#e8edf4"; ctx.lineWidth = 2; ctx.beginPath();
      full.forEach((th, idx) => {
        const rv = r(th); if (!isFinite(rv)) return;
        const [px, py] = mapper.toPx(rv * Math.cos(th), rv * Math.sin(th));
        if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();

      const rNow = r(tmax);
      dot(ctx, mapper, rNow * Math.cos(tmax), rNow * Math.sin(tmax), "#f2c14e", 6);

      const area = simpson1D(th => 0.5 * Math.pow(r(th), 2), 0, tmax, 300);
      panel.querySelector("#polar-r").textContent = isFinite(rNow) ? rNow.toFixed(3) : "–";
      panel.querySelector("#polar-area").textContent = area.toFixed(4);

      setSteps("polar", [
        `r(θ) = ${src.replace(/\*/g, "\u00B7")}. At θ = ${tmax.toFixed(2)} rad, r ≈ <b>${isFinite(rNow) ? rNow.toFixed(3) : "–"}</b>.`,
        `Area formula: A = ½∫₀^θ r(θ)² dθ, evaluated numerically with Simpson's rule.`,
        `Swept area from 0 to ${tmax.toFixed(2)} rad ≈ <b>${area.toFixed(4)}</b> square units (the gold wedge).`
      ]);
    }
    update();
    this.onShow = update;
  }
});

/* ==============================================================
   4. MODULE IMPLEMENTATIONS — CALCULUS 3
   ============================================================== */

/* ---- 4.10 Vectors ---- */
MODULES.push({
  id: "vec", course: "Calculus 3", title: "Vectors", sub: "Dot products, cross products, and the angle between",
  is3D: true, badge: "drag to orbit · scroll to zoom",
  controlsHTML: `
    <div class="field"><label>Vector A</label>
      <div class="row2"><input type="text" id="vec-ax" value="3"><input type="text" id="vec-ay" value="1"></div>
      <input type="text" id="vec-az" value="1" style="margin-top:6px;"></div>
    <div class="field"><label>Vector B</label>
      <div class="row2"><input type="text" id="vec-bx" value="1"><input type="text" id="vec-by" value="2"></div>
      <input type="text" id="vec-bz" value="3" style="margin-top:6px;"></div>
    <div class="readouts">
      <div class="r"><span class="k">A · B (dot)</span><span class="v coral" id="vec-dot">–</span></div>
      <div class="r"><span class="k">A × B (cross)</span><span class="v mint" id="vec-cross">–</span></div>
      <div class="r"><span class="k">|A|, |B|</span><span class="v" id="vec-mag">–</span></div>
      <div class="r"><span class="k">angle between</span><span class="v gold" id="vec-angle">–</span></div>
    </div>`,
  explainHTML: `The <b>dot product</b> A·B = |A||B|cos(θ) measures how much two vectors point the same way (zero means
    perpendicular). The <b>cross product</b> A×B is a new vector perpendicular to both, whose length equals the area
    of the parallelogram they span — the backbone of surface-normal and torque calculations in Calc 3.`,
  init(panel) {
    const stage = panel.querySelector("#stage-vec");
    const s3 = new Scene3D(stage);
    // grid + axes helpers
    const grid = new THREE.GridHelper(8, 8, 0x24405c, 0x16283d);
    s3.scene.add(grid);
    const axes = new THREE.AxesHelper(4.5);
    s3.scene.add(axes);

    const ids = ["ax", "ay", "az", "bx", "by", "bz"].map(k => panel.querySelector("#vec-" + k));
    ids.forEach(el => el.addEventListener("input", update));

    function update() {
      const [ax, ay, az, bx, by, bz] = ids.map(el => parseFloat(el.value) || 0);
      s3.clearExtras(); s3.scene.add(grid); s3.scene.add(axes);
      const A = new THREE.Vector3(ax, az, ay), B = new THREE.Vector3(bx, bz, by); // world Y = math z-ish "up"; keep y->height mapping consistent w/ pd module (x, z=up, y)
      const arrowA = new THREE.ArrowHelper(A.clone().normalize(), new THREE.Vector3(0, 0, 0), A.length() || 0.001, 0xff8b5e, 0.3, 0.16);
      const arrowB = new THREE.ArrowHelper(B.clone().normalize(), new THREE.Vector3(0, 0, 0), B.length() || 0.001, 0x6fe7c6, 0.3, 0.16);
      s3.scene.add(arrowA); s3.scene.add(arrowB);

      const dotv = ax * bx + ay * by + az * bz;
      const cross = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      const magA = Math.hypot(ax, ay, az), magB = Math.hypot(bx, by, bz);
      const cosT = dotv / (magA * magB || 1);
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosT))) * 180 / Math.PI;

      const C = new THREE.Vector3(cross[0], cross[2], cross[1]);
      if (C.length() > 1e-6) {
        const arrowC = new THREE.ArrowHelper(C.clone().normalize(), new THREE.Vector3(0, 0, 0), Math.min(4, C.length()), 0xf2c14e, 0.3, 0.16);
        s3.scene.add(arrowC);
      }

      panel.querySelector("#vec-dot").textContent = dotv.toFixed(3);
      panel.querySelector("#vec-cross").textContent = `(${cross.map(v => v.toFixed(2)).join(", ")})`;
      panel.querySelector("#vec-mag").textContent = `${magA.toFixed(3)}, ${magB.toFixed(3)}`;
      panel.querySelector("#vec-angle").textContent = angleDeg.toFixed(2) + "°";

      setSteps("vec", [
        `A = (${ax}, ${ay}, ${az}) shown in <span class="coral">coral</span>, B = (${bx}, ${by}, ${bz}) shown in <span class="mint">mint</span>.`,
        `Dot: A·B = ${ax}(${bx})+${ay}(${by})+${az}(${bz}) = <b>${dotv.toFixed(3)}</b>. Cross: A×B = <b>(${cross.map(v => v.toFixed(2)).join(", ")})</b>,
          drawn in <span class="gold">gold</span>, perpendicular to both.`,
        `Angle: cos(θ) = A·B/(|A||B|) = ${dotv.toFixed(3)}/(${magA.toFixed(2)}×${magB.toFixed(2)}) → θ ≈ <b>${angleDeg.toFixed(2)}°</b>.`
      ]);
    }
    update();
    this.onShow = () => { s3.resize(); update(); };
    window.addEventListener("resize", () => s3.resize());
    s3.resize();
  }
});

/* ---- 4.11 Partial Derivatives & Gradients ---- */
MODULES.push({
  id: "pd", course: "Calculus 3", title: "Partial Derivatives & Gradients", sub: "Tangent planes and steepest ascent on a surface",
  is3D: true, badge: "drag to orbit · scroll to zoom",
  controlsHTML: fnInputHTML("pd", [
    { label: "x² + y²", expr: "x^2+y^2" }, { label: "sin(x)·cos(y)", expr: "sin(x)*cos(y)" },
    { label: "x² − y² (saddle)", expr: "x^2-y^2" }, { label: "sin(sqrt(x²+y²))", expr: "sin(sqrt(x*x+y*y))" }
  ], "Surface f(x, y)") + `
    <div class="field"><label>x₀ — <span id="pd-x0-out">0.80</span></label><input type="range" id="pd-x0" min="-2.5" max="2.5" step="0.02" value="0.8"></div>
    <div class="field"><label>y₀ — <span id="pd-y0-out">0.60</span></label><input type="range" id="pd-y0" min="-2.5" max="2.5" step="0.02" value="0.6"></div>
    <div class="field"><label>Direction θ — <span id="pd-theta-out">30°</span></label><input type="range" id="pd-theta" min="0" max="360" step="1" value="30"></div>
    <div class="togglerow"><input type="checkbox" id="pd-plane" checked><label for="pd-plane">show tangent plane</label></div>
    <div class="togglerow"><input type="checkbox" id="pd-grad" checked><label for="pd-grad">show gradient ∇f</label></div>
    <div class="readouts">
      <div class="r"><span class="k">∂f/∂x</span><span class="v coral" id="pd-fx">–</span></div>
      <div class="r"><span class="k">∂f/∂y</span><span class="v coral" id="pd-fy">–</span></div>
      <div class="r"><span class="k">∇f</span><span class="v gold" id="pd-grad-v">–</span></div>
      <div class="r"><span class="k">D_u f (θ)</span><span class="v mint" id="pd-du">–</span></div>
    </div>`,
  explainHTML: `Drag x₀/y₀ across the surface and watch the <span class="mint">tangent plane</span> tilt with it — its
    slopes along x and y are the partial derivatives ∂f/∂x and ∂f/∂y, found symbolically by differentiating while
    holding the other variable constant. Together they form the <span class="gold">gradient ∇f</span>, the direction
    of steepest ascent. Rotate θ to test any direction u; D_u f = ∇f·u is the instantaneous rate of change that way.`,
  init(panel) {
    const stage = panel.querySelector("#stage-pd");
    const s3 = new Scene3D(stage);
    const DOMAIN = 3.0;
    const getSrc = wireFnInput("pd", rebuild);
    const x0s = panel.querySelector("#pd-x0"), y0s = panel.querySelector("#pd-y0"), thetaS = panel.querySelector("#pd-theta");
    const planeT = panel.querySelector("#pd-plane"), gradT = panel.querySelector("#pd-grad");
    [x0s, y0s, thetaS, planeT, gradT].forEach(el => el.addEventListener("input", update));

    let f = null, surfaceGroup = null;
    function buildSurface() {
      if (surfaceGroup) s3.scene.remove(surfaceGroup);
      surfaceGroup = new THREE.Group();
      const RES = 52;
      const positions = [], colors = [], indices = [];
      const grid = [];
      let zMin = Infinity, zMax = -Infinity;
      for (let j = 0; j <= RES; j++) {
        const row = [];
        for (let i = 0; i <= RES; i++) {
          const x = -DOMAIN + 2 * DOMAIN * i / RES, y = -DOMAIN + 2 * DOMAIN * j / RES;
          let z = f({ x, y }); if (!isFinite(z)) z = 0; z = Math.max(-4, Math.min(4, z));
          row.push(z); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
        }
        grid.push(row);
      }
      const zRange = Math.max(1e-4, zMax - zMin);
      for (let j = 0; j <= RES; j++) for (let i = 0; i <= RES; i++) {
        const x = -DOMAIN + 2 * DOMAIN * i / RES, y = -DOMAIN + 2 * DOMAIN * j / RES, z = grid[j][i];
        positions.push(x, z, y);
        const c = heightColor((z - zMin) / zRange); colors.push(c.r, c.g, c.b);
      }
      for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
        const a = j * (RES + 1) + i, b = a + 1, c = a + RES + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setIndex(indices);
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
      surfaceGroup.add(mesh);
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x16283d, transparent: true, opacity: 0.35 }));
      surfaceGroup.add(wire);
      s3.scene.add(surfaceGroup);
    }
    function rebuild() { f = safeCompile(getSrc(), "x^2+y^2"); buildSurface(); update(); }

    let dynGroup = null;
    function update() {
      if (dynGroup) s3.scene.remove(dynGroup);
      dynGroup = new THREE.Group();
      const x0 = parseFloat(x0s.value), y0 = parseFloat(y0s.value), theta = parseFloat(thetaS.value) * Math.PI / 180;
      panel.querySelector("#pd-x0-out").textContent = x0.toFixed(2);
      panel.querySelector("#pd-y0-out").textContent = y0.toFixed(2);
      panel.querySelector("#pd-theta-out").textContent = Math.round(theta * 180 / Math.PI) + "°";

      const src = getSrc();
      const { fn: fxFn, str: fxStr } = symbolicDeriv(src, "x", "x^2+y^2");
      const { fn: fyFn, str: fyStr } = symbolicDeriv(src, "y", "x^2+y^2");
      const z0 = f({ x: x0, y: y0 });
      const fx = fxFn({ x: x0, y: y0 }), fy = fyFn({ x: x0, y: y0 });
      const gradMag = Math.hypot(fx, fy);
      const ux = Math.cos(theta), uy = Math.sin(theta);
      const du = fx * ux + fy * uy;

      panel.querySelector("#pd-fx").textContent = fx.toFixed(3) + "  (" + fxStr + ")";
      panel.querySelector("#pd-fy").textContent = fy.toFixed(3) + "  (" + fyStr + ")";
      panel.querySelector("#pd-grad-v").textContent = `(${fx.toFixed(2)}, ${fy.toFixed(2)})  |∇f| = ${gradMag.toFixed(2)}`;
      panel.querySelector("#pd-du").textContent = du.toFixed(3);

      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222 }));
      marker.position.set(x0, z0, y0); dynGroup.add(marker);

      if (planeT.checked) {
        const size = 1.6;
        const planeGeo = new THREE.PlaneGeometry(size * 2, size * 2, 1, 1);
        const pa = planeGeo.attributes.position;
        for (let i = 0; i < pa.count; i++) pa.setZ(i, fx * pa.getX(i) + fy * pa.getY(i));
        planeGeo.computeVertexNormals();
        const plane = new THREE.Mesh(planeGeo, new THREE.MeshStandardMaterial({ color: 0x6fe7c6, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        plane.rotation.x = -Math.PI / 2; plane.position.set(x0, z0, y0);
        dynGroup.add(plane);
      }
      if (gradT.checked && gradMag > 1e-6) {
        const len = Math.min(2.2, 0.9 + gradMag * 0.6);
        dynGroup.add(new THREE.ArrowHelper(new THREE.Vector3(fx, 0, fy).normalize(), new THREE.Vector3(x0, z0 + 0.05, y0), len, 0xf2c14e, len * 0.28, len * 0.16));
      }
      dynGroup.add(new THREE.ArrowHelper(new THREE.Vector3(ux, 0, uy).normalize(), new THREE.Vector3(x0, z0 + 0.12, y0), 1.5, 0x6fe7c6, 0.35, 0.18));
      s3.scene.add(dynGroup);

      setSteps("pd", [
        `∂f/∂x treats y as a constant: ∂f/∂x = <b>${fxStr}</b> → at (x₀,y₀) this is <b>${fx.toFixed(3)}</b>.
          ∂f/∂y = <b>${fyStr}</b> → <b>${fy.toFixed(3)}</b>.`,
        `Gradient ∇f = (∂f/∂x, ∂f/∂y) = <b>(${fx.toFixed(2)}, ${fy.toFixed(2)})</b>, the direction of steepest ascent,
          with magnitude |∇f| = <b>${gradMag.toFixed(3)}</b>.`,
        `Directional derivative along u = (cos θ, sin θ): D_u f = ∇f·u = ${fx.toFixed(2)}(${ux.toFixed(2)}) + ${fy.toFixed(2)}(${uy.toFixed(2)})
          = <b>${du.toFixed(3)}</b>.`
      ]);
    }
    rebuild();
    this.onShow = () => { s3.resize(); update(); };
    window.addEventListener("resize", () => s3.resize());
    s3.resize();
  }
});

/* ---- 4.12 Multiple Integrals ---- */
MODULES.push({
  id: "mint", course: "Calculus 3", title: "Multiple Integrals", sub: "Volume under a surface, one prism at a time",
  is3D: true, badge: "each prism = one term of the double Riemann sum",
  controlsHTML: fnInputHTML("mint", [
    { label: "x² + y²", expr: "x^2+y^2" }, { label: "4 − x² − y²", expr: "4-x^2-y^2" },
    { label: "sin(x)·cos(y)+1.2", expr: "sin(x)*cos(y)+1.2" }
  ], "f(x, y)") + `
    <div class="row2">
      <div class="field"><label>a — <span id="mint-a-out">-1.5</span></label><input type="range" id="mint-a" min="-2.5" max="0" step="0.1" value="-1.5"></div>
      <div class="field"><label>b — <span id="mint-b-out">1.5</span></label><input type="range" id="mint-b" min="0" max="2.5" step="0.1" value="1.5"></div>
    </div>
    <div class="row2">
      <div class="field"><label>c — <span id="mint-c-out">-1.5</span></label><input type="range" id="mint-c" min="-2.5" max="0" step="0.1" value="-1.5"></div>
      <div class="field"><label>d — <span id="mint-d-out">1.5</span></label><input type="range" id="mint-d" min="0" max="2.5" step="0.1" value="1.5"></div>
    </div>
    <div class="field"><label>Grid m×m — <span id="mint-m-out">8</span></label><input type="range" id="mint-m" min="2" max="18" step="1" value="8"></div>
    <div class="readouts">
      <div class="r"><span class="k">ΔA</span><span class="v" id="mint-dA">–</span></div>
      <div class="r"><span class="k">double Riemann sum</span><span class="v coral" id="mint-sum">–</span></div>
      <div class="r"><span class="k">fine reference</span><span class="v mint" id="mint-exact">–</span></div>
    </div>`,
  explainHTML: `A double integral ∬ f(x,y) dA adds up the volume under a surface over a region. Chop the rectangle
    [a,b]×[c,d] into an m×m grid, and each cell contributes one <b>prism</b> of height f(midpoint) and base area
    ΔA — that's a double Riemann sum. (A triple integral works the same way one dimension further up: chop a solid
    region into little boxes and sum f(x,y,z)·ΔV, which is where mass, charge, or probability totals over 3D
    regions come from.)`,
  init(panel) {
    const stage = panel.querySelector("#stage-mint");
    const s3 = new Scene3D(stage);
    const DOMAIN = 3.0;
    const getSrc = wireFnInput("mint", update);
    const aEl = panel.querySelector("#mint-a"), bEl = panel.querySelector("#mint-b"), cEl = panel.querySelector("#mint-c"), dEl = panel.querySelector("#mint-d"), mEl = panel.querySelector("#mint-m");
    [aEl, bEl, cEl, dEl, mEl].forEach(el => el.addEventListener("input", update));

    let group = null;
    function update() {
      const f = safeCompile(getSrc(), "x^2+y^2");
      const av = parseFloat(aEl.value), bv = parseFloat(bEl.value), cv = parseFloat(cEl.value), dv = parseFloat(dEl.value), m = parseInt(mEl.value, 10);
      panel.querySelector("#mint-a-out").textContent = av.toFixed(1); panel.querySelector("#mint-b-out").textContent = bv.toFixed(1);
      panel.querySelector("#mint-c-out").textContent = cv.toFixed(1); panel.querySelector("#mint-d-out").textContent = dv.toFixed(1);
      panel.querySelector("#mint-m-out").textContent = m;

      if (group) s3.scene.remove(group);
      group = new THREE.Group();

      // base surface (translucent, for context)
      const RES = 44;
      const positions = [], colors = [], indices = [];
      const grid = []; let zMin = Infinity, zMax = -Infinity;
      for (let j = 0; j <= RES; j++) { const row = [];
        for (let i = 0; i <= RES; i++) {
          const x = -DOMAIN + 2 * DOMAIN * i / RES, y = -DOMAIN + 2 * DOMAIN * j / RES;
          let z = f({ x, y }); if (!isFinite(z)) z = 0; z = Math.max(-4, Math.min(4, z));
          row.push(z); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
        } grid.push(row); }
      const zRange = Math.max(1e-4, zMax - zMin);
      for (let j = 0; j <= RES; j++) for (let i = 0; i <= RES; i++) {
        const x = -DOMAIN + 2 * DOMAIN * i / RES, y = -DOMAIN + 2 * DOMAIN * j / RES, z = grid[j][i];
        positions.push(x, z, y); const c = heightColor((z - zMin) / zRange); colors.push(c.r, c.g, c.b);
      }
      for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) { const a = j * (RES + 1) + i, b = a + 1, c = a + RES + 1, d = c + 1; indices.push(a, c, b, b, c, d); }
      const geo = new THREE.BufferGeometry(); geo.setIndex(indices);
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
      group.add(mesh);

      // prisms
      const dx = (bv - av) / m, dy = (dv - cv) / m;
      let sum = 0;
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
        const mx = av + (i + 0.5) * dx, my = cv + (j + 0.5) * dy;
        let h = f({ x: mx, y: my }); if (!isFinite(h)) h = 0;
        sum += h * dx * dy;
        const boxH = Math.max(0.001, Math.abs(h));
        const box = new THREE.Mesh(new THREE.BoxGeometry(dx * 0.92, boxH, dy * 0.92),
          new THREE.MeshStandardMaterial({ color: heightColor((h - zMin) / zRange), transparent: true, opacity: 0.75 }));
        box.position.set(mx, h >= 0 ? h / 2 : h / 2, my);
        group.add(box);
      }
      s3.scene.add(group);

      const exact = simpson2D(f, av, bv, cv, dv, 26);
      panel.querySelector("#mint-dA").textContent = (dx * dy).toFixed(4);
      panel.querySelector("#mint-sum").textContent = sum.toFixed(4);
      panel.querySelector("#mint-exact").textContent = exact.toFixed(4);

      setSteps("mint", [
        `Region [${av.toFixed(1)},${bv.toFixed(1)}] × [${cv.toFixed(1)},${dv.toFixed(1)}] split into ${m}×${m} = ${m * m} cells,
          each ΔA = ${(dx * dy).toFixed(4)}.`,
        `Each prism's height is f at the cell's midpoint; volume of a cell ≈ f(mid)·ΔA. Summing every prism gives
          the double Riemann sum ≈ <b>${sum.toFixed(4)}</b>.`,
        `A much finer numeric reference gives ∬ f dA ≈ <b>${exact.toFixed(4)}</b> — increase the grid slider to see
          the sum close in on this value.`
      ]);
    }
    function simpson2D(f, a, b, c, d, n) {
      let total = 0; const hy = (d - c) / n;
      for (let j = 0; j <= n; j++) {
        const y = c + j * hy, wy = (j === 0 || j === n) ? 1 : (j % 2 === 0 ? 2 : 4);
        total += wy * simpson1D(x => f({ x, y }), a, b, n);
      }
      return total * hy / 3;
    }
    update();
    this.onShow = () => { s3.resize(); update(); };
    window.addEventListener("resize", () => s3.resize());
    s3.resize();
  }
});

/* ---- 4.13 Vector Fields ---- */
MODULES.push({
  id: "vf", course: "Calculus 3", title: "Vector Fields", sub: "Flow arrows, divergence, and curl",
  badge: "arrows show (P, Q) at each grid point",
  controlsHTML: `
    <div class="field"><label>P(x, y)  (i-component)</label><input type="text" id="vf-p" value="-y"></div>
    <div class="field"><label>Q(x, y)  (j-component)</label><input type="text" id="vf-q" value="x"></div>
    <div class="row2">
      <div class="field"><label>x₀ — <span id="vf-x0-out">1.0</span></label><input type="range" id="vf-x0" min="-3" max="3" step="0.1" value="1"></div>
      <div class="field"><label>y₀ — <span id="vf-y0-out">1.0</span></label><input type="range" id="vf-y0" min="-3" max="3" step="0.1" value="1"></div>
    </div>
    <div class="readouts">
      <div class="r"><span class="k">divergence ∂P/∂x+∂Q/∂y</span><span class="v coral" id="vf-div">–</span></div>
      <div class="r"><span class="k">scalar curl ∂Q/∂x−∂P/∂y</span><span class="v mint" id="vf-curl">–</span></div>
    </div>`,
  explainHTML: `A vector field assigns an arrow (P(x,y), Q(x,y)) to every point — think wind speed or fluid flow.
    <b>Divergence</b> (∂P/∂x + ∂Q/∂y) measures whether flow is spreading out (source, positive) or collapsing in
    (sink, negative) at a point. <b>Curl</b> (∂Q/∂x − ∂P/∂y) measures local spinning motion. Try P=−y, Q=x for pure
    rotation (zero divergence, constant curl), or P=x, Q=y for pure outward flow (zero curl).`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-vf");
    const pEl = panel.querySelector("#vf-p"), qEl = panel.querySelector("#vf-q");
    const x0s = panel.querySelector("#vf-x0"), y0s = panel.querySelector("#vf-y0");
    [pEl, qEl, x0s, y0s].forEach(el => el.addEventListener("input", update));
    function update() {
      const P = safeCompile(pEl.value, "-y"), Q = safeCompile(qEl.value, "x");
      const x0 = parseFloat(x0s.value), y0 = parseFloat(y0s.value);
      panel.querySelector("#vf-x0-out").textContent = x0.toFixed(1);
      panel.querySelector("#vf-y0-out").textContent = y0.toFixed(1);

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const R = 3.2;
      const mapper = makeMapper(rect, -R, R, -R, R);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, -R, R, -R, R, mapper);

      const GN = 11;
      let maxMag = 0;
      const samples = [];
      for (let i = 0; i <= GN; i++) for (let j = 0; j <= GN; j++) {
        const x = -R + 2 * R * i / GN, y = -R + 2 * R * j / GN;
        const p = P({ x, y }), q = Q({ x, y });
        samples.push([x, y, p, q]); maxMag = Math.max(maxMag, Math.hypot(p, q));
      }
      const scale = (2 * R / GN) * 0.85 / (maxMag || 1);
      samples.forEach(([x, y, p, q]) => {
        const [px, py] = mapper.toPx(x, y);
        const [px2, py2] = mapper.toPx(x + p * scale, y + q * scale);
        const mag = Math.hypot(p, q) / (maxMag || 1);
        const col = heightColorCss(mag);
        drawArrow(ctx, px, py, px2, py2, col, 1.6);
      });

      dot(ctx, mapper, x0, y0, "#ffffff", 5);

      const eps = 1e-3;
      const dPdx = (P({ x: x0 + eps, y: y0 }) - P({ x: x0 - eps, y: y0 })) / (2 * eps);
      const dPdy = (P({ x: x0, y: y0 + eps }) - P({ x: x0, y: y0 - eps })) / (2 * eps);
      const dQdx = (Q({ x: x0 + eps, y: y0 }) - Q({ x: x0 - eps, y: y0 })) / (2 * eps);
      const dQdy = (Q({ x: x0, y: y0 + eps }) - Q({ x: x0, y: y0 - eps })) / (2 * eps);
      const div = dPdx + dQdy, curl = dQdx - dPdy;
      panel.querySelector("#vf-div").textContent = div.toFixed(3);
      panel.querySelector("#vf-curl").textContent = curl.toFixed(3);

      setSteps("vf", [
        `Field: P = ${pEl.value}, Q = ${qEl.value}. At (${x0.toFixed(1)}, ${y0.toFixed(1)}):
          ∂P/∂x ≈ ${dPdx.toFixed(3)}, ∂Q/∂y ≈ ${dQdy.toFixed(3)}.`,
        `Divergence = ∂P/∂x + ∂Q/∂y ≈ <b>${div.toFixed(3)}</b> —
          ${Math.abs(div) < 0.05 ? "flow is neither expanding nor contracting here." : div > 0 ? "flow is spreading out (source-like)." : "flow is converging (sink-like)."}`,
        `Curl = ∂Q/∂x − ∂P/∂y ≈ <b>${curl.toFixed(3)}</b> —
          ${Math.abs(curl) < 0.05 ? "negligible local rotation." : curl > 0 ? "counter-clockwise spin." : "clockwise spin."}`
      ]);
    }
    update();
    this.onShow = update;
  }
});
function heightColorCss(t) {
  const c1 = [111, 231, 198], c2 = [242, 193, 78], c3 = [255, 139, 94];
  const lerp = (a, b, k) => a + (b - a) * k;
  const c = t < 0.5 ? [0, 1, 2].map(i => lerp(c1[i], c2[i], t * 2)) : [0, 1, 2].map(i => lerp(c2[i], c3[i], (t - 0.5) * 2));
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

/* ---- 4.14 Line & Surface Integrals ---- */
MODULES.push({
  id: "lsi", course: "Calculus 3", title: "Line & Surface Integrals", sub: "Accumulating a field along a path or across a sheet",
  badge: "curve colored by field strength",
  controlsHTML: `
    <div class="field"><label>Scalar field f(x, y)</label><input type="text" id="lsi-f" value="x^2+y^2"></div>
    <div class="row2">
      <div class="field"><label>x(t)</label><input type="text" id="lsi-x" value="2*cos(t)"></div>
      <div class="field"><label>y(t)</label><input type="text" id="lsi-y" value="2*sin(t)"></div>
    </div>
    <div class="row2">
      <div class="field"><label>t min</label><input type="text" id="lsi-tmin" value="0"></div>
      <div class="field"><label>t max</label><input type="text" id="lsi-tmax" value="6.283"></div>
    </div>
    <div class="readouts">
      <div class="r"><span class="k">arc length ∫|r′(t)|dt</span><span class="v" id="lsi-len">–</span></div>
      <div class="r"><span class="k">line integral ∫f ds</span><span class="v gold" id="lsi-int">–</span></div>
    </div>`,
  explainHTML: `A <b>line integral</b> ∫f ds accumulates a scalar field along a path, weighting by arc length —
    picture a curved fence whose height at each point is f(x,y): the integral is the fence's surface area. It's
    computed as ∫f(x(t),y(t))·|r′(t)| dt, splitting the path into tiny arc-length pieces |r′(t)|dt. A <b>surface
    integral</b> is the natural extension one dimension up: instead of accumulating along a curve, you accumulate a
    field over a curved <i>sheet</i> in space (parametrized by two variables), weighting each patch by its stretched
    area — the same idea used for the tangent-plane patches in the Partial Derivatives module, integrated over an
    entire surface instead of evaluated at one point.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-lsi");
    const fEl = panel.querySelector("#lsi-f"), xEl = panel.querySelector("#lsi-x"), yEl = panel.querySelector("#lsi-y");
    const tminEl = panel.querySelector("#lsi-tmin"), tmaxEl = panel.querySelector("#lsi-tmax");
    [fEl, xEl, yEl, tminEl, tmaxEl].forEach(el => el.addEventListener("input", update));
    function update() {
      const f = safeCompile(fEl.value, "x^2+y^2");
      const xt = t => safeCompile(xEl.value, "2*cos(t)")({ t });
      const yt = t => safeCompile(yEl.value, "2*sin(t)")({ t });
      const tmin = parseFloat(tminEl.value) || 0, tmax = parseFloat(tmaxEl.value) || 1;

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const N = 300;
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      const pts = [], vals = [];
      let maxF = 1e-6;
      for (let k = 0; k <= N; k++) {
        const t = tmin + (tmax - tmin) * k / N;
        const x = xt(t), y = yt(t), v = f({ x, y });
        pts.push([x, y]); vals.push(isFinite(v) ? v : 0); maxF = Math.max(maxF, Math.abs(v) || 0);
        if (isFinite(x)) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
        if (isFinite(y)) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
      }
      if (!isFinite(xMin)) { xMin = -2; xMax = 2; } if (!isFinite(yMin)) { yMin = -2; yMax = 2; }
      const padX = Math.max(0.4, (xMax - xMin) * 0.2), padY = Math.max(0.4, (yMax - yMin) * 0.2);
      const mapper = makeMapper(rect, xMin - padX, xMax + padX, yMin - padY, yMax + padY);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, xMin - padX, xMax + padX, yMin - padY, yMax + padY, mapper);

      for (let k = 0; k < pts.length - 1; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
        ctx.strokeStyle = heightColorCss(Math.abs(vals[k]) / maxF); ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(...mapper.toPx(x1, y1)); ctx.lineTo(...mapper.toPx(x2, y2)); ctx.stroke();
      }

      const eps = 1e-4;
      const integrand = t => {
        const dx = (xt(t + eps) - xt(t - eps)) / (2 * eps), dy = (yt(t + eps) - yt(t - eps)) / (2 * eps);
        const speed = Math.hypot(dx, dy);
        const fv = f({ x: xt(t), y: yt(t) });
        return { arc: speed, weighted: (isFinite(fv) ? fv : 0) * speed };
      };
      const arcLen = simpson1D(t => integrand(t).arc, tmin, tmax, 300);
      const lineInt = simpson1D(t => integrand(t).weighted, tmin, tmax, 300);
      panel.querySelector("#lsi-len").textContent = arcLen.toFixed(4);
      panel.querySelector("#lsi-int").textContent = lineInt.toFixed(4);

      setSteps("lsi", [
        `Path r(t) = (${xEl.value}, ${yEl.value}) for t ∈ [${tmin.toFixed(2)}, ${tmax.toFixed(2)}], colored by f(x,y) = ${fEl.value}
          (mint = low, coral = high).`,
        `Arc length element: ds = |r′(t)| dt. Total arc length ≈ <b>${arcLen.toFixed(4)}</b>.`,
        `Line integral ∫f ds = ∫f(x(t),y(t))·|r′(t)| dt ≈ <b>${lineInt.toFixed(4)}</b> — the "fence area" swept out
          by f along the path.`
      ]);
    }
    update();
    this.onShow = update;
  }
});

/* ---- 4.15 Theorems: Green's, Stokes', Divergence (conceptual) ---- */
MODULES.push({
  id: "thm", course: "Calculus 3", title: "Green's, Stokes' & Divergence Theorems", sub: "Boundary behavior equals interior accumulation",
  badge: "same field as Vector Fields module",
  controlsHTML: `
    <div class="field"><label>P(x, y)</label><input type="text" id="thm-p" value="-y"></div>
    <div class="field"><label>Q(x, y)</label><input type="text" id="thm-q" value="x"></div>
    <div class="row2">
      <div class="field"><label>a — <span id="thm-a-out">-1.5</span></label><input type="range" id="thm-a" min="-3" max="0" step="0.1" value="-1.5"></div>
      <div class="field"><label>b — <span id="thm-b-out">1.5</span></label><input type="range" id="thm-b" min="0" max="3" step="0.1" value="1.5"></div>
    </div>
    <div class="row2">
      <div class="field"><label>c — <span id="thm-c-out">-1.5</span></label><input type="range" id="thm-c" min="-3" max="0" step="0.1" value="-1.5"></div>
      <div class="field"><label>d — <span id="thm-d-out">1.5</span></label><input type="range" id="thm-d" min="0" max="3" step="0.1" value="1.5"></div>
    </div>
    <div class="readouts">
      <div class="r"><span class="k">circulation ∮ P dx + Q dy</span><span class="v coral" id="thm-line">–</span></div>
      <div class="r"><span class="k">∬ curl dA</span><span class="v mint" id="thm-area">–</span></div>
      <div class="r"><span class="k">match?</span><span class="v gold" id="thm-match">–</span></div>
    </div>`,
  explainHTML: `These three theorems all say the same kind of thing at different dimensions: <b>what happens on a
    boundary equals the total accumulation inside it.</b>
    <br><br><b class="coral">Green's theorem</b> (2D): circulation of a field around a closed curve equals the total
    curl inside the region it encloses — verified numerically below on a rectangle.
    <br><b class="mint">Stokes' theorem</b> (3D): circulation of a field around the boundary of a curved surface
    equals the total curl flowing through that surface — Green's theorem lifted onto a bent sheet.
    <br><b class="gold">Divergence theorem</b> (3D): flow out through a closed surface equals the total divergence
    (sources minus sinks) inside the solid it wraps.`,
  init(panel) {
    const canvas = panel.querySelector("#canvas-thm");
    const pEl = panel.querySelector("#thm-p"), qEl = panel.querySelector("#thm-q");
    const aEl = panel.querySelector("#thm-a"), bEl = panel.querySelector("#thm-b"), cEl = panel.querySelector("#thm-c"), dEl = panel.querySelector("#thm-d");
    [pEl, qEl, aEl, bEl, cEl, dEl].forEach(el => el.addEventListener("input", update));
    function update() {
      const P = safeCompile(pEl.value, "-y"), Q = safeCompile(qEl.value, "x");
      const av = parseFloat(aEl.value), bv = parseFloat(bEl.value), cv = parseFloat(cEl.value), dv = parseFloat(dEl.value);
      panel.querySelector("#thm-a-out").textContent = av.toFixed(1); panel.querySelector("#thm-b-out").textContent = bv.toFixed(1);
      panel.querySelector("#thm-c-out").textContent = cv.toFixed(1); panel.querySelector("#thm-d-out").textContent = dv.toFixed(1);

      resizeCanvas(canvas);
      const rect = canvas.getBoundingClientRect();
      const R = Math.max(Math.abs(av), Math.abs(bv), Math.abs(cv), Math.abs(dv)) + 1;
      const mapper = makeMapper(rect, -R, R, -R, R);
      const ctx = canvas.getContext("2d");
      drawAxes(ctx, rect, -R, R, -R, R, mapper);

      // shade region + draw boundary with direction arrows (counter-clockwise)
      ctx.fillStyle = "rgba(111,231,198,0.15)";
      ctx.fillRect(...mapper.toPx(av, dv), mapper.sx * (bv - av), mapper.sy * (dv - cv));
      ctx.strokeStyle = "#f2c14e"; ctx.lineWidth = 2.5;
      const corners = [[av, cv], [bv, cv], [bv, dv], [av, dv], [av, cv]];
      ctx.beginPath();
      corners.forEach(([x, y], i) => { const [px, py] = mapper.toPx(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = corners[i], [x2, y2] = corners[i + 1];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const dx = (x2 - x1) * 0.18, dy = (y2 - y1) * 0.18;
        const [ax0, ay0] = mapper.toPx(mx - dx, my - dy), [ax1, ay1] = mapper.toPx(mx + dx, my + dy);
        drawArrow(ctx, ax0, ay0, ax1, ay1, "#f2c14e", 2.5);
      }

      // line integral around rectangle boundary (counter-clockwise), via 4 straight-segment integrals
      function segInt(x1, y1, x2, y2) {
        return simpson1D(s => {
          const x = x1 + (x2 - x1) * s, y = y1 + (y2 - y1) * s;
          return P({ x, y }) * (x2 - x1) + Q({ x, y }) * (y2 - y1);
        }, 0, 1, 60);
      }
      const line = segInt(av, cv, bv, cv) + segInt(bv, cv, bv, dv) + segInt(bv, dv, av, dv) + segInt(av, dv, av, cv);

      const eps = 1e-3;
      const curlAt = (x, y) => {
        const dQdx = (Q({ x: x + eps, y }) - Q({ x: x - eps, y })) / (2 * eps);
        const dPdy = (P({ x, y: y + eps }) - P({ x, y: y - eps })) / (2 * eps);
        return dQdx - dPdy;
      };
      let area = 0; const n = 30, hx = (bv - av) / n, hy = (dv - cv) / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) area += curlAt(av + (i + 0.5) * hx, cv + (j + 0.5) * hy) * hx * hy;

      panel.querySelector("#thm-line").textContent = line.toFixed(4);
      panel.querySelector("#thm-area").textContent = area.toFixed(4);
      const matches = Math.abs(line - area) < Math.max(0.02, Math.abs(area) * 0.02);
      panel.querySelector("#thm-match").textContent = matches ? "yes ✓ (Green's theorem)" : "≈ (grid is coarse)";

      setSteps("thm", [
        `Boundary of the rectangle traced counter-clockwise (gold), field P=${pEl.value}, Q=${qEl.value}.`,
        `Circulation ∮P dx + Q dy, computed as four straight-line integrals around the rectangle ≈ <b>${line.toFixed(4)}</b>.`,
        `Curl (∂Q/∂x − ∂P/∂y) summed over the interior (double Riemann sum) ≈ <b>${area.toFixed(4)}</b> —
          Green's theorem says these must be equal, and they numerically agree here.`
      ]);
    }
    update();
    this.onShow = update;
  }
});

/* ==============================================================
   5. BACKGROUND MUSIC PLAYER
   Audio comes straight from track.mp3 (see the <audio> tag in
   index.html) — swap that file for a different track any time.
   ============================================================== */
function initMusic() {
  const bgm = document.getElementById("bgm");
  const btn = document.getElementById("musicBtn");
  const lbl = document.getElementById("musicLbl");
  const icon = document.getElementById("musicIcon");
  bgm.loop = true; // belt-and-suspenders alongside the HTML loop attribute
  bgm.volume = 0.45;
  let playing = false;
  btn.addEventListener("click", () => {
    playing = !playing;
    if (playing) {
      bgm.play().catch(() => { playing = false; updateBtn(); });
    } else {
      bgm.pause();
    }
    updateBtn();
  });
  // in case the browser ever stalls the loop (e.g. after a tab was backgrounded)
  bgm.addEventListener("ended", () => { if (playing) bgm.play().catch(() => {}); });
  function updateBtn() {
    btn.classList.toggle("playing", playing);
    lbl.textContent = playing ? "Music: on" : "Music: off";
    icon.textContent = playing ? "🎵" : "🔈";
  }
  updateBtn();
}

/* ==============================================================
   6. BOOT / ROUTER / MOBILE NAV
   ============================================================== */
function closeMobileNav() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("scrim").classList.remove("show");
}
window.addEventListener("load", () => {
  buildSidebar();
  activateModule(MODULES[0].id);
  initMusic();

  const hamburger = document.getElementById("hamburger");
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("scrim");
  hamburger.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    scrim.classList.toggle("show");
  });
  scrim.addEventListener("click", closeMobileNav);
});

/* ==============================================================
   7. LIVELY BUTTON INTERACTIONS — ripple burst + click squish,
   delegated on document so it also covers lazily-built panels
   (nav buttons, technique cards, action buttons, music toggle).
   ============================================================== */
const RIPPLE_SELECTOR = "button.action, #musicBtn, #hamburger, .navbtn, .techcard";
function spawnRipple(el, evt) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.8;
  const span = document.createElement("span");
  span.className = "ripple-el";
  const cx = (evt && evt.clientX !== undefined) ? evt.clientX - rect.left : rect.width / 2;
  const cy = (evt && evt.clientY !== undefined) ? evt.clientY - rect.top : rect.height / 2;
  span.style.width = span.style.height = size + "px";
  span.style.left = cx + "px";
  span.style.top = cy + "px";
  el.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}
document.addEventListener("pointerdown", e => {
  const el = e.target.closest(RIPPLE_SELECTOR);
  if (!el) return;
  spawnRipple(el, e);
  el.classList.remove("is-clicking");
  void el.offsetWidth; // restart the click-squish animation even on rapid re-clicks
  el.classList.add("is-clicking");
  setTimeout(() => el.classList.remove("is-clicking"), 450);
});

/* ==============================================================
   8. TOUCH PARITY — mirror :hover with a class, since phones and
   tablets don't reliably fire CSS hover on tap.
   ============================================================== */
document.addEventListener("touchstart", e => {
  const el = e.target.closest(RIPPLE_SELECTOR);
  if (el) el.classList.add("is-touch-hover");
}, { passive: true });
document.addEventListener("touchend", () => {
  document.querySelectorAll(".is-touch-hover").forEach(el => el.classList.remove("is-touch-hover"));
}, { passive: true });
document.addEventListener("touchcancel", () => {
  document.querySelectorAll(".is-touch-hover").forEach(el => el.classList.remove("is-touch-hover"));
}, { passive: true });

/* ==============================================================
   9. AMBIENT MATH EMOJI — floats up occasionally, purely
   decorative (pointer-events:none on its whole layer), so it
   never intercepts clicks/taps on the controls underneath.
   ============================================================== */
const MATH_EMOJI = ["∫", "π", "√", "∞", "Σ", "Δ", "≈", "∂", "θ", "∇", "±", "÷", "×", "½", "°", "ƒ(x)"];
const EMOJI_COLORS = ["#ff8b5e", "#6fe7c6", "#f2c14e", "#8fa3bd"];
function spawnMathEmoji() {
  const layer = document.getElementById("mathFloaters");
  if (!layer || layer.children.length >= 5) return;
  const span = document.createElement("span");
  span.className = "math-emoji";
  span.textContent = MATH_EMOJI[Math.floor(Math.random() * MATH_EMOJI.length)];
  const size = 16 + Math.random() * 20;
  const dur = 10 + Math.random() * 8;
  const drift = Math.round(Math.random() * 100 - 50) + "px";
  const rot = Math.round(Math.random() * 50 - 25) + "deg";
  span.style.left = (Math.random() * 92) + "vw";
  span.style.fontSize = size.toFixed(0) + "px";
  span.style.color = EMOJI_COLORS[Math.floor(Math.random() * EMOJI_COLORS.length)];
  span.style.setProperty("--drift", drift);
  span.style.setProperty("--rot", rot);
  span.style.animationDuration = dur.toFixed(1) + "s";
  layer.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}
function scheduleMathEmoji() {
  spawnMathEmoji();
  setTimeout(scheduleMathEmoji, 3200 + Math.random() * 4200);
}
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.addEventListener("load", () => setTimeout(scheduleMathEmoji, 1500));
}
