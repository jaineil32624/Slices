# Slices — Calculus 1, 2 & 3 Lab

An interactive, animated web app for learning and visualizing Calculus 1, 2,
and 3 — limits, derivatives, integrals, sequences, parametric/polar curves,
vectors, partial derivatives & gradients, multiple integrals, vector fields,
line integrals, and Green's/Stokes'/Divergence theorems.

## Files

- `index.html` — page structure, module panels, and layout
- `styles.css` — all styling, including the animated/liquid button system
- `app.js` — the expression parser + symbolic differentiation engine,
  canvas/3D rendering, all 15 learning modules, touch handling, and the
  ambient math-emoji effect
- `track.mp3` — background music (toggle with the button top-right)

No build step, no dependencies to install. `index.html` pulls in
[Three.js](https://threejs.org/) and Google Fonts from a CDN for the 3D
surfaces (`vec`, `pd`, `mint` modules) and typography; everything else is
plain HTML/CSS/JS.

## Running it

**Locally:** just open `index.html` in a browser. Some browsers block audio
`<audio src>` loads or ES features over the `file://` protocol, so if the
background music or fonts don't load, serve the folder instead:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

**GitHub Pages:** push this folder to a repo and enable Pages (Settings →
Pages → deploy from the branch/folder containing these files). It'll be
live at `https://<username>.github.io/<repo>/`.

## Extending it

Each learning module is a single object pushed into the `MODULES` array in
`app.js` (see the numbered section comments — search for "MODULE
IMPLEMENTATIONS"). To add a new topic, copy the shape of an existing module
(`controlsHTML`, `explainHTML`, and an `init(panel)` function) and push it
into the array in the course group you want it to appear under.
