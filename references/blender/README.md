# Blender fur reference

Open `duckplan-fur-reference.blend` as a separate Blender project. It contains the `DuckPlan Fur Reference` scene, a 60 fps timeline (frames 1–271), 4,000 seeded short double-ribbon bundles with fine barbs, a filled growing substrate and a separate 64-fiber contact probe. The user's previously open journal project was not saved or overwritten; its original scene was restored after reference work.

## Method and limits

Blender MCP exposed Blender 4.5.9 LTS, mesh/curve creation, Python simulation, collision/cloth/soft-body APIs, animation, rendering and library export. No paid generator or asset library was used. This reference uses custom integration and baked mesh shape keys, **not native hair dynamics**.

The contact probe uses five rooted segments per fiber, eight stretch/contact constraint iterations and a moving sphere at 240 Hz. The central pile depresses while surrounding segments splay through collision response. The deformed rest shape is retained for 280 ms after the contact releases, then relaxes without a visible rebound. The main expansion study uses a reduced target/spring solver based on the approved browser button, seeded orientations, one filled rolling crest, fixed roots and a material-space destination color field. The whole pile flattens together after coloring. Rectangular card and border colors are sampled in fixed UV coordinates, avoiding polar mesh color bands.

This is a stylized short-down reference, not a photorealistic or biologically calibrated feather model. One CSS pixel is represented as one millimeter for the illustration; its masses, scale and collision settings must not be copied literally into the browser. The main reduced spring study shares the browser equation, so agreement is a translation check, not independent physical validation. The independent constrained contact probe supplies qualitative evidence for central compression and neighboring splay. Sparse baked shape keys are for visual study, not browser playback.

## Measurements

See `measurements.json`, `contact-probe.csv` and `spring-reference.csv`.

- Probe mean tip height: 5.000 mm at rest, minimum 4.133 mm at 0.183 s; returned to 5.000 mm.
- Maximum lateral tip splay: 3.533 mm at 0.450 s.
- Contact release: 0.300 s; retained rest shape until 0.580 s.
- Recovered to within 0.05 mm in both mean height and lateral splay by 1.200 s.
- No measured mean-height overshoot above rest (floating-point residue only).

These observations support compression, splay and a gradual target recovery. They do not establish a universal duck-down recovery time.

## Inspect and reproduce

`press-reference.png`, `growth-reference.png`, `contact-probe.png`, `dyed-reference.png` and `flat-reference.png` are rendered study frames. The final two share the destination color field; the first retains raised fibers, the second has flattened them into the panel plane.

Inside Blender, run `build_reference.py` with its real `__file__` path, then `refine_formation.py`. The generator replaces only its own marked reference scene and exports that scene with `bpy.data.libraries.write`; it never calls save-as on the user's open file. The second script maps panel colors, corrects the final held shape key, exports the isolated project and renders the colored/flat frames. Measurements are exported as plain CSV/JSON. The website has no Blender runtime, image, mesh or animation dependency.

## Contact-shape browser experiment

`strand-shape-reference.json` is the five-node centerline extracted from fiber35 of the contact probe at its `Contact frame 18` shape key. A cubic lateral-profile fit (k=3.78113472) now drives pressure-dependent browser ribbon curvature. It is a shape approximation driven by the existing spring, not an imported Blender simulation or independent biological validation. See [matched recordings and failed promotion gate](../curved-fur/README.md). The reduced spring, appearance references and unimplemented full collision physics remain distinct from this contribution.
