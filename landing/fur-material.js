(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    quality: "medium",
    waveSpeed: 540,
    waveWidth: 22,
    waveBend: 0.56,
    waveCompression: 0.22,
    waveEnabled: true,
    density: 1,
    length: 5.4,
    stiffness: 62,
    damping: 22,
    radius: 54,
    pressRadius: null,
    brushStrength: 5.8,
    compression: 0.92,
    recoveryDelay: 280,
    pressDepth: 0.78,
    splay: 0.76,
    transitionWidth: 0.36,
    labelScale: 2,
    labelSharpness: 1.15,
    labelLengthScale: 0.8,
    labelWidthScale: 0.9,
    labelOrientationVariance: 0.06,
    labelDensity: 2.4,
    glyphTransition: 0.55,
    glyphGuardWidth: 1.4,
    glyphGuardStrength: 0.9,
    motionGuardStart: 0.12,
    motionGuardEnd: 0.58,
    boundaryLabelWidthScale: 0.72,
    boundaryLabelLeanScale: 0.62,
    silhouetteOverscan: 18,
    silhouetteFringe: 0.55,
    fragmentGlyphMask: true,
    silhouette: false,
  });

  const ROOT_STRIDE = 6;
  const STATE_STRIDE = 4;
  const MATERIAL_STRIDE = 3;
  const GLYPH_SDF_RANGE = 12;
  const MOTION_GUARD_MIN = 0.04;
  const REST_TOLERANCE = Object.freeze({ state: 0.0015, velocity: 0.002, target: 0.0015 });

  const QUALITY = Object.freeze({
    low: { fibersPerPixel: 0.12, maxFibers: 1800, dpr: 1.25 },
    medium: { fibersPerPixel: 0.28, maxFibers: 5200, dpr: 1.75 },
    high: { fibersPerPixel: 0.35, maxFibers: 30000, dpr: 2 },
  });

  const registry = new WeakMap();
  const liveSurfaces = new Set();
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const stableRandom = (index, salt = 0) => {
    const value = Math.sin((index + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
    return value - Math.floor(value);
  };
  const motionGuardProtection = (motion, start = 0.12, end = 0.58) => {
    const release = smoothstep(start, Math.max(start + 0.001, end), clamp(motion, 0, 1));
    return 1 - (1 - MOTION_GUARD_MIN) * release;
  };
  const overscanLayout = (width, height, overscan, dpr) => ({
    canvasWidth: Math.max(1, Math.round((width + overscan * 2) * dpr)),
    canvasHeight: Math.max(1, Math.round((height + overscan * 2) * dpr)),
    surfaceWidth: width * dpr,
    surfaceHeight: height * dpr,
    offset: overscan * dpr,
  });
  const silhouetteRootIncluded = (distance, fringe = 0.55) => distance <= fringe;
  const encodeSignedDistance = (data, range = GLYPH_SDF_RANGE) => {
    const encoded = new Uint8Array(data.length);
    for (let index = 0; index < data.length; index += 1) {
      encoded[index] = Math.round((clamp(data[index], -range, range) / range * 0.5 + 0.5) * 255);
    }
    return encoded;
  };
  const pressProfile = (normalizedDistance, options) => {
    const distance = clamp(normalizedDistance, 0, 1);
    const coreRadius = 0.28;
    const transitionEnd = clamp(coreRadius + Number(options.transitionWidth || 0.36), 0.5, 0.92);
    const center = 1 - smoothstep(0.04, coreRadius, distance);
    const transitionIn = smoothstep(coreRadius * 0.42, coreRadius, distance);
    const transitionOut = 1 - smoothstep(coreRadius, transitionEnd, distance);
    const transition = transitionIn * transitionOut;
    const depressionEnvelope = 1 - smoothstep(0, transitionEnd, distance);
    const compressionEnvelope = Math.max(center, transition * 0.58);
    return {
      center,
      transition,
      depression: depressionEnvelope * Number(options.pressDepth || 0),
      compression: compressionEnvelope * Number(options.compression || 0),
      splay: transition * Number(options.splay || 0),
      influence: Math.max(center, transition, depressionEnvelope),
    };
  };

  function shader(gl, type, source) {
    const compiled = gl.createShader(type);
    gl.shaderSource(compiled, source);
    gl.compileShader(compiled);
    if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(compiled);
      gl.deleteShader(compiled);
      throw new Error(message || "DuckFur shader compilation failed");
    }
    return compiled;
  }

  function program(gl, vertexSource, fragmentSource) {
    const linked = gl.createProgram();
    gl.attachShader(linked, shader(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(linked, shader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(linked);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(linked) || "DuckFur shader linking failed");
    }
    return linked;
  }

  const CURVE_GLSL = `
    vec2 furPath(float t,vec2 rest,vec2 bend,vec2 memory,float amount,float pressure){
      float k=mix(0.38,3.781135,clamp(pressure*1.4,0.0,1.0));
      return rest*t+bend*mix(t,t*t*(k+(1.0-k)*t),amount)+memory*t*t*(3.0-2.0*t);
    }
    vec2 furTangent(float t,vec2 rest,vec2 bend,vec2 memory,float amount,float pressure){
      float k=mix(0.38,3.781135,clamp(pressure*1.4,0.0,1.0));
      return rest+bend*mix(1.0,2.0*k*t+3.0*(1.0-k)*t*t,amount)+memory*6.0*t*(1.0-t);
    }
  `;
  const VERTEX_SHADER = `#version 300 es
    precision highp float;
    layout(location = 0) in vec2 a_corner;
    layout(location = 1) in vec2 a_root;
    layout(location = 2) in vec4 a_seed;
    layout(location = 3) in vec4 a_state;
    layout(location = 4) in vec3 a_material;

    uniform float u_curve,u_hasPile;
    uniform sampler2D u_pileField;
    ${CURVE_GLSL}
    vec4 pileAt(vec2 uv){
      ivec2 size=textureSize(u_pileField,0);vec2 p=clamp(uv*vec2(size)-0.5,vec2(0),vec2(size-1)),f=fract(p);ivec2 a=ivec2(floor(p)),b=min(a+1,size-1);
      return mix(mix(texelFetch(u_pileField,a,0),texelFetch(u_pileField,ivec2(b.x,a.y),0),f.x),mix(texelFetch(u_pileField,ivec2(a.x,b.y),0),texelFetch(u_pileField,b,0),f.x),f.y);
    }
    uniform vec2 u_canvasResolution;
    uniform vec2 u_surfaceResolution;
    uniform vec2 u_surfaceOffset;
    uniform float u_length;
    uniform float u_dpr;
    uniform float u_labelLengthScale;
    uniform float u_labelWidthScale;
    uniform float u_boundaryLabelWidthScale;
    uniform float u_boundaryLabelLeanScale;

    out float v_height;
    out float v_side;
    out float v_color;
    out float v_compression;
    out float v_light;
    out float v_label;
    out float v_edge;
    out float v_depression;
    out float v_boundary;
    out float v_motion;
    out vec2 v_surfaceUv;

    void main() {
      float strandT=a_corner.y;
      if(u_curve>0.0){float activity=length(a_state.xy)+a_state.z+a_state.w; if(u_hasPile>0.5)activity+=length(pileAt(a_root));strandT=mix(min(strandT*3.0,1.0),strandT,smoothstep(0.0,0.04,activity));}
      float compression = clamp(a_state.z, 0.0, 1.0);
      float depression = clamp(a_state.w, 0.0, 1.0);
      vec4 pile=vec4(0.0);if(u_hasPile>0.5)pile=pileAt(a_root);
      compression=clamp(compression+pile.z*0.5,0.0,1.0);depression=clamp(depression+pile.w*0.3,0.0,1.0);
      float labelFiber = clamp(a_material.x, 0.0, 1.0);
      float edgeFiber = clamp(a_material.y, 0.0, 1.0);
      float glyphBoundary = labelFiber * clamp(a_material.z, 0.0, 1.0);
      float labelLengthScale = mix(1.0, u_labelLengthScale, labelFiber);
      float lengthVariation = mix(a_seed.x, 1.0, edgeFiber * 0.78);
      float lengthPx = u_length * u_dpr * lengthVariation * labelLengthScale * (1.0 + edgeFiber * 0.4);
      float heightScale = 1.0 - compression * 0.78 - depression * 0.16;
      vec2 naturalLean = vec2(cos(a_seed.y), sin(a_seed.y)) * lengthPx * mix(0.28, 0.38, a_seed.z) * mix(1.0, u_boundaryLabelLeanScale, glyphBoundary);
      vec2 bend = a_state.xy * lengthPx * 1.62;
      vec2 direction = naturalLean * heightScale + bend * mix(0.68, 1.45, compression);
      float projectedLength = max(length(direction), 1.15 * u_dpr);
      vec2 tangent = direction / projectedLength;
      vec2 normal = vec2(-tangent.y, tangent.x);
      float rootWidth = mix(1.05, 1.5, a_seed.z) * u_dpr * mix(1.0, u_labelWidthScale, labelFiber) * mix(1.0, u_boundaryLabelWidthScale, glyphBoundary) * (1.0 + edgeFiber * 0.1 + compression * 0.3 + depression * 0.18);
      float tipWidth = rootWidth * mix(0.82, 1.68, compression);
      float width = mix(rootWidth, tipWidth, strandT);
      vec2 rootPx = a_root * u_surfaceResolution + u_surfaceOffset;
      vec2 pixel = rootPx + direction * strandT + normal * a_corner.x * width;
      if(u_curve>0.0 || u_hasPile>0.5){
        vec2 rest=naturalLean*heightScale,deflect=bend*mix(0.68,1.45,compression),memory=pile.xy*lengthPx*.85;
        vec2 localTangent=furTangent(strandT,rest,deflect,memory,u_curve,compression);tangent=localTangent/max(length(localTangent),1.15*u_dpr);normal=vec2(-tangent.y,tangent.x);
        pixel=rootPx+furPath(strandT,rest,deflect,memory,u_curve,compression)+normal*a_corner.x*width;
      }
      vec2 clip = pixel / u_canvasResolution * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

      v_height = strandT;
      v_side = a_corner.x;
      v_color = a_seed.z;
      v_compression = compression;
      v_light = 0.78 + 0.22 * clamp(dot(normalize(vec3(tangent, 0.7)), normalize(vec3(-0.35, -0.45, 0.82))), 0.0, 1.0);
      v_label = labelFiber;
      v_edge = edgeFiber;
      v_depression = depression;
      v_boundary = clamp(a_material.z, 0.0, 1.0);
      v_motion = clamp(length(a_state.xy) * 0.9 + compression * 0.55 + depression * 0.55, 0.0, 1.0);
      v_surfaceUv = clamp((pixel - u_surfaceOffset) / u_surfaceResolution, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    in float v_height;
    in float v_side;
    in float v_color;
    in float v_compression;
    in float v_light;
    in float v_label;
    in float v_edge;
    in float v_depression;
    in float v_boundary;
    in float v_motion;
    in vec2 v_surfaceUv;
    uniform sampler2D u_glyphField;
    uniform float u_hasGlyph;
    uniform float u_fragmentGlyphMask;
    uniform float u_sdfRange;
    uniform float u_glyphTransition;
    uniform float u_glyphGuardStrength;
    uniform float u_motionGuardStart;
    uniform float u_motionGuardEnd;
    out vec4 outColor;

    void main() {
      float signedDistance = (texture(u_glyphField, v_surfaceUv).r * 2.0 - 1.0) * u_sdfRange;
      float sampledGlyph = smoothstep(-u_glyphTransition, u_glyphTransition, signedDistance);
      float rootGlyph = clamp(v_label, 0.0, 1.0);
      float glyph = rootGlyph * u_hasGlyph;
      float backgroundSoftEdge = 1.0 - smoothstep(0.62, 1.0, abs(v_side));
      float labelSoftEdge = 1.0 - smoothstep(0.80, 1.0, abs(v_side));
      float softEdge = mix(backgroundSoftEdge, labelSoftEdge, glyph);
      float taperedTip = 1.0 - smoothstep(0.86, 1.0, v_height) * 0.24;
      vec3 root = mix(vec3(0.72, 0.49, 0.10), vec3(0.86, 0.66, 0.22), v_color);
      vec3 middle = mix(vec3(0.98, 0.84, 0.46), vec3(1.0, 0.92, 0.65), v_color);
      vec3 tip = mix(vec3(1.0, 0.95, 0.76), vec3(1.0, 0.985, 0.88), v_color);
      vec3 color = mix(root, middle, smoothstep(0.0, 0.58, v_height));
      color = mix(color, tip, smoothstep(0.58, 1.0, v_height));
      vec3 labelRoot = vec3(0.012, 0.007, 0.001);
      vec3 labelMiddle = vec3(0.032, 0.018, 0.002);
      vec3 labelTip = vec3(0.075, 0.041, 0.004);
      vec3 labelColor = mix(labelRoot, labelMiddle, smoothstep(0.0, 0.58, v_height));
      labelColor = mix(labelColor, labelTip, smoothstep(0.58, 1.0, v_height));
      color = mix(color, labelColor, glyph);
      color *= mix(1.0, 0.76, v_edge * (1.0 - glyph));
      float pressure = max(v_compression, v_depression * 0.92);
      float occlusion = mix(1.0, 0.36, pressure * (1.0 - v_height * 0.42));
      float depressionShade = mix(1.0, 0.72, v_depression * (0.82 - v_height * 0.28));
      float tipGlow = 1.0 + smoothstep(0.76, 1.0, v_height) * 0.11;
      color *= v_light * occlusion * depressionShade * tipGlow;
      float alpha = softEdge * taperedTip * mix(0.82, 0.94, v_height) * (1.0 + v_edge * 0.08 + pressure * 0.12);
      alpha = mix(alpha, max(alpha, 0.98 * softEdge), glyph);
      float ownershipMismatch = abs(sampledGlyph - rootGlyph);
      float motionRelease = smoothstep(u_motionGuardStart, u_motionGuardEnd, v_motion);
      float restingProtection = mix(1.0, ${MOTION_GUARD_MIN.toFixed(2)}, motionRelease);
      float boundaryProtection = 1.0 - v_boundary * ownershipMismatch * u_glyphGuardStrength * u_fragmentGlyphMask * restingProtection;
      alpha *= mix(1.0, boundaryProtection, u_hasGlyph);
      outColor = vec4(color, alpha);
    }
  `;

  class DuckFurSurface {
    constructor(host, options = {}) {
      this.host = host;
      this.options = { ...DEFAULTS, ...options };
      this.canvas = document.createElement("canvas");
      this.canvas.className = "fur-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      this.host.prepend(this.canvas);
      this.host.classList.add("fur-material");
      this.host.classList.toggle("fur-button-silhouette", Boolean(this.options.silhouette));

      this.destroyed = false;
      this.width = 0;
      this.height = 0;
      this.count = 0;
      this.visible = true;
      this.running = false;
      this.pressed = false;
      this.activePointerId = null;
      this.hovered = false;
      this.waves = [];
      this.pointer = { x: 0, y: 0, previousX: 0, previousY: 0, time: 0 };
      this.lastFrame = 0;
      this.frames = 0;
      this.fpsClock = performance.now();
      this.fps = 0;
      this.lastRebuildMs = 0;
      this.glyphTextureBytes = 0;
      this.labelFieldCache = new Map();
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.lowPower = (navigator.deviceMemory && navigator.deviceMemory <= 4) || navigator.hardwareConcurrency <= 4;

      this.onPointerEnter = this.onPointerEnter.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
      this.onPointerCancel = this.onPointerCancel.bind(this);
      this.onLostPointerCapture = this.onLostPointerCapture.bind(this);
      this.onPointerLeave = this.onPointerLeave.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);
      this.onActivate = this.onActivate.bind(this);
      this.onVisibility = this.onVisibility.bind(this);
      this.onWindowBlur = this.onWindowBlur.bind(this);
      this.onMotionChange = this.onMotionChange.bind(this);
      this.onContextLost = this.onContextLost.bind(this);
      this.onContextRestored = this.onContextRestored.bind(this);
      this.frame = this.frame.bind(this);

      this.labelObserver = new MutationObserver(() => {
        if (this.options.silhouette && this.width && this.gl) this.rebuildFibers();
      });
      this.labelObserver.observe(this.host, { childList: true, characterData: true, subtree: true });

      this.bindEvents();
      this.initializeGraphics();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host);
      if ("IntersectionObserver" in window) {
        this.intersectionObserver = new IntersectionObserver(([entry]) => {
          this.visible = entry.isIntersecting;
          if (this.visible) this.wake();
        }, { rootMargin: "80px" });
        this.intersectionObserver.observe(this.host);
      }
      this.resize();
    }

    bindEvents() {
      this.host.addEventListener("pointerenter", this.onPointerEnter);
      this.host.addEventListener("pointermove", this.onPointerMove);
      this.host.addEventListener("pointerdown", this.onPointerDown);
      this.host.addEventListener("pointerup", this.onPointerUp);
      this.host.addEventListener("pointercancel", this.onPointerCancel);
      this.host.addEventListener("lostpointercapture", this.onLostPointerCapture);
      this.host.addEventListener("pointerleave", this.onPointerLeave);
      this.host.addEventListener("keydown", this.onKeyDown);
      this.host.addEventListener("keyup", this.onKeyUp);
      this.host.addEventListener("click", this.onActivate);
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("blur", this.onWindowBlur);
      this.canvas.addEventListener("webglcontextlost", this.onContextLost);
      this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
      if (this.reducedMotion.addEventListener) this.reducedMotion.addEventListener("change", this.onMotionChange);
    }

    initializeGraphics() {
      try {
        this.gl = this.canvas.getContext("webgl2", {
          alpha: true,
          antialias: true,
          depth: false,
          stencil: false,
          powerPreference: this.lowPower ? "low-power" : "high-performance",
          premultipliedAlpha: true,
        });
        if (!this.gl) throw new Error("WebGL 2 unavailable");
        this.program = program(this.gl, VERTEX_SHADER, FRAGMENT_SHADER);
        this.canvasResolutionLocation = this.gl.getUniformLocation(this.program, "u_canvasResolution");
        this.surfaceResolutionLocation = this.gl.getUniformLocation(this.program, "u_surfaceResolution");
        this.surfaceOffsetLocation = this.gl.getUniformLocation(this.program, "u_surfaceOffset");
        this.lengthLocation = this.gl.getUniformLocation(this.program, "u_length");
        this.dprLocation = this.gl.getUniformLocation(this.program, "u_dpr");
        this.labelLengthScaleLocation = this.gl.getUniformLocation(this.program, "u_labelLengthScale");
        this.labelWidthScaleLocation = this.gl.getUniformLocation(this.program, "u_labelWidthScale");
        this.boundaryLabelWidthScaleLocation = this.gl.getUniformLocation(this.program, "u_boundaryLabelWidthScale");
        this.boundaryLabelLeanScaleLocation = this.gl.getUniformLocation(this.program, "u_boundaryLabelLeanScale");
        this.glyphFieldLocation = this.gl.getUniformLocation(this.program, "u_glyphField");
        this.hasGlyphLocation = this.gl.getUniformLocation(this.program, "u_hasGlyph");
        this.fragmentGlyphMaskLocation = this.gl.getUniformLocation(this.program, "u_fragmentGlyphMask");
        this.sdfRangeLocation = this.gl.getUniformLocation(this.program, "u_sdfRange");
        this.glyphTransitionLocation = this.gl.getUniformLocation(this.program, "u_glyphTransition");
        this.glyphGuardStrengthLocation = this.gl.getUniformLocation(this.program, "u_glyphGuardStrength");
        this.motionGuardStartLocation = this.gl.getUniformLocation(this.program, "u_motionGuardStart");
        this.motionGuardEndLocation = this.gl.getUniformLocation(this.program, "u_motionGuardEnd");
        this.curveLocation=this.gl.getUniformLocation(this.program,"u_curve");this.hasPileLocation=this.gl.getUniformLocation(this.program,"u_hasPile");this.pileFieldLocation=this.gl.getUniformLocation(this.program,"u_pileField");
        if(this.options.experimentalStrands && window.DuckPile){
          const gl=this.gl;this.pileTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.pileTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,32,16,0,gl.RGBA,gl.FLOAT,null);
          for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
          for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
        }
        this.createBuffers();
        this.host.classList.remove("fur-static-fallback");
      } catch (error) {
        this.gl = null;
        this.host.classList.add("fur-static-fallback");
        this.fallbackReason = error.message;
      }
    }

    createBuffers() {
      const gl = this.gl;
      this.vertexArray = gl.createVertexArray();
      gl.bindVertexArray(this.vertexArray);

      const corners = this.options.experimentalStrands && window.DuckPile ? window.DuckPile.corners(3) : new Float32Array([
        -1, 0, 1, 0, -1, 1,
        -1, 1, 1, 0, 1, 1,
      ]);
      this.strandVertices=corners.length/2;
      this.cornerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.rootBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rootBuffer);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, ROOT_STRIDE * 4, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, ROOT_STRIDE * 4, 2 * 4);
      gl.vertexAttribDivisor(2, 1);

      this.stateBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STATE_STRIDE * 4, 0);
      gl.vertexAttribDivisor(3, 1);

      this.materialBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.materialBuffer);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 3, gl.FLOAT, false, MATERIAL_STRIDE * 4, 0);
      gl.vertexAttribDivisor(4, 1);

      gl.bindVertexArray(null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    resize() {
      this.waves = [];
      const rect = this.host.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (!width || !height) return;
      const quality = QUALITY[this.options.quality] || QUALITY.medium;
      const dprLimit = this.lowPower ? Math.min(quality.dpr, 1.25) : quality.dpr;
      this.dpr = Math.min(window.devicePixelRatio || 1, dprLimit);
      const configuredOverscan = Number(this.options.silhouetteOverscan);
      this.overscan = this.options.silhouette ? Math.max(0, Number.isFinite(configuredOverscan) ? configuredOverscan : 18) : 0;
      const canvasWidth = width + this.overscan * 2;
      const canvasHeight = height + this.overscan * 2;
      const layout = overscanLayout(width, height, this.overscan, this.dpr);
      this.canvas.style.inset = `${-this.overscan}px`;
      this.canvas.style.width = `${canvasWidth}px`;
      this.canvas.style.height = `${canvasHeight}px`;
      this.canvas.width = layout.canvasWidth;
      this.canvas.height = layout.canvasHeight;
      this.width = width;
      this.height = height;
      if (this.options.experimentalStrands && window.DuckPile && (!this.pileField || this.pileField.width!==this.width || this.pileField.height!==this.height))this.pileField=new window.DuckPile.PileField(this.width,this.height);
      if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.rebuildFibers();
    }

    rebuildFibers() {
      if (!this.gl || !this.width || !this.height) return;
      const rebuildStarted = performance.now();
      const quality = QUALITY[this.options.quality] || QUALITY.medium;
      const baseCap = Number(this.options.maxFibers) || quality.maxFibers;
      const customCap = this.options.silhouette ? Math.round(baseCap * 3.2) : baseCap;
      const silhouetteDensity = this.options.silhouette ? 3.15 : 1;
      const baseCount = Math.max(90, Math.min(customCap, Math.round(this.width * this.height * quality.fibersPerPixel * this.options.density * silhouetteDensity)));
      const labelField = this.createLabelField();
      this.uploadLabelField(labelField);
      const silhouetteRadius = Math.min(this.height / 2, this.width / 2);
      const configuredFringe = Number(this.options.silhouetteFringe);
      const silhouetteFringe = this.options.silhouette
        ? Math.max(0, Number.isFinite(configuredFringe) ? configuredFringe : 0.55)
        : 0;
      const rootValues = [];
      const seedValues = [];
      const materialValues = [];
      const samplingWidth = this.width + silhouetteFringe * 2;
      const samplingHeight = this.height + silhouetteFringe * 2;
      const aspect = samplingWidth / samplingHeight;
      const samplingAreaScale = samplingWidth * samplingHeight / (this.width * this.height);
      const candidateCount = this.options.silhouette ? Math.ceil(baseCount * 1.18 * samplingAreaScale) : baseCount;
      const columns = Math.ceil(Math.sqrt(candidateCount * aspect));
      const rows = Math.ceil(candidateCount / columns);
      const labelDensity = Math.max(1, Number(this.options.labelDensity) || 1);
      const labelSharpness = Math.max(0.45, Number(this.options.labelSharpness) || 1.15);
      const labelSoftness = Math.max(0.28, 1.2 / labelSharpness);
      const guardWidth = Math.max(0.25, Number(this.options.glyphGuardWidth) || 1.4);
      const orientationVariance = Math.max(0, Number(this.options.labelOrientationVariance) || 0);

      const appendFiber = (x, y, labelDistance, edgeFiber, outwardAngle, randomKey) => {
        if (rootValues.length / 2 >= customCap) return false;
        const labelFiber = smoothstep(-labelSoftness, labelSoftness, labelDistance);
        const boundaryFiber = 1 - smoothstep(0, guardWidth, Math.abs(labelDistance));
        rootValues.push(x, y);
        seedValues.push(
          x,
          y,
          0.78 + stableRandom(randomKey, 4) * 0.44,
          labelFiber > 0.08
            ? -Math.PI / 2 + (stableRandom(randomKey, 5) - 0.5) * orientationVariance
            : edgeFiber > 0.08
              ? outwardAngle + (stableRandom(randomKey, 6) - 0.5) * 0.12
              : stableRandom(randomKey, 7) * Math.PI * 2,
          stableRandom(randomKey, 8),
          stableRandom(randomKey, 9),
        );
        materialValues.push(labelFiber, edgeFiber, boundaryFiber);
        return true;
      };

      let baseIndex = 0;
      for (let row = 0; row < rows && rootValues.length / 2 < customCap; row += 1) {
        for (let column = 0; column < columns && rootValues.length / 2 < customCap; column += 1) {
          const centerX = -silhouetteFringe + (column + 0.5) / columns * samplingWidth;
          const centerY = -silhouetteFringe + (row + 0.5) / rows * samplingHeight;
          const centerDistance = labelField && centerX >= 0 && centerX <= this.width && centerY >= 0 && centerY <= this.height
            ? this.sampleLabelField(labelField, centerX, centerY)
            : -100;
          const jitterScale = centerDistance > -guardWidth ? 0.22 : 0.78;
          const jitterX = (stableRandom(baseIndex, 0) - 0.5) * jitterScale;
          const jitterY = (stableRandom(baseIndex, 1) - 0.5) * jitterScale;
          const pixelX = -silhouetteFringe + (column + 0.5 + jitterX) / columns * samplingWidth;
          const pixelY = -silhouetteFringe + (row + 0.5 + jitterY) / rows * samplingHeight;
          const x = pixelX / this.width;
          const y = pixelY / this.height;
          const silhouetteDistance = this.options.silhouette
            ? this.roundedRectDistance(pixelX, pixelY, silhouetteRadius)
            : -Math.min(this.width, this.height);
          if (this.options.silhouette && !silhouetteRootIncluded(silhouetteDistance, silhouetteFringe)) {
            baseIndex += 1;
            continue;
          }
          const edgeFiber = this.options.silhouette ? smoothstep(-6.5, silhouetteFringe, silhouetteDistance) : 0;
          const silhouetteCenterX = clamp(pixelX, silhouetteRadius, this.width - silhouetteRadius);
          const silhouetteCenterY = this.height / 2;
          const outwardAngle = Math.atan2(pixelY - silhouetteCenterY, pixelX - silhouetteCenterX);
          const labelDistance = labelField && pixelX >= 0 && pixelX <= this.width && pixelY >= 0 && pixelY <= this.height
            ? this.sampleLabelField(labelField, pixelX, pixelY)
            : -100;
          appendFiber(x, y, labelDistance, edgeFiber, outwardAngle, baseIndex * 4);

          baseIndex += 1;
        }
      }

      const baseFiberCount = rootValues.length / 2;
      let requestedGlyphFibers = 0;
      let allocatedGlyphFibers = 0;
      if (labelField && labelDensity > 1) {
        const extraScale = Math.sqrt(labelDensity - 1);
        const extraColumns = Math.max(1, Math.round(columns * extraScale));
        const extraRows = Math.max(1, Math.round(rows * extraScale));
        let extraIndex = 0;
        for (let row = 0; row < extraRows; row += 1) {
          for (let column = 0; column < extraColumns; column += 1) {
            const randomKey = candidateCount * 8 + extraIndex;
            const x = clamp((column + 0.5 + (stableRandom(randomKey, 20) - 0.5) * 0.08) / extraColumns, 0.002, 0.998);
            const y = clamp((row + 0.5 + (stableRandom(randomKey, 21) - 0.5) * 0.08) / extraRows, 0.002, 0.998);
            const pixelX = x * this.width;
            const pixelY = y * this.height;
            const labelDistance = this.sampleLabelField(labelField, pixelX, pixelY);
            if (labelDistance >= -labelSoftness * 0.35) {
              const silhouetteDistance = this.roundedRectDistance(pixelX, pixelY, silhouetteRadius);
              if (silhouetteDistance <= -0.45) {
                requestedGlyphFibers += 1;
                const edgeFiber = smoothstep(-6.5, -0.45, silhouetteDistance);
                const silhouetteCenterX = clamp(pixelX, silhouetteRadius, this.width - silhouetteRadius);
                const outwardAngle = Math.atan2(pixelY - this.height / 2, pixelX - silhouetteCenterX);
                if (appendFiber(x, y, labelDistance, edgeFiber, outwardAngle, randomKey)) allocatedGlyphFibers += 1;
              }
            }
            extraIndex += 1;
          }
        }
      }
      this.roots = Float32Array.from(rootValues);
      this.rootSeeds = Float32Array.from(seedValues);
      this.materialMask = Float32Array.from(materialValues);
      this.count = this.roots.length / 2;
      this.baseFiberCount = baseFiberCount;
      this.requestedGlyphFibers = requestedGlyphFibers;
      this.allocatedGlyphFibers = allocatedGlyphFibers;
      this.fiberCap = customCap;
      this.fiberCapReached = this.count >= customCap;
      this.glyphAllocationLimited = allocatedGlyphFibers < requestedGlyphFibers;
      this.labelFiberCount = 0;
      for (let index = 0; index < this.count; index += 1) {
        if (this.materialMask[index * MATERIAL_STRIDE] >= 0.5) this.labelFiberCount += 1;
      }
      this.state = new Float32Array(this.count * STATE_STRIDE);
      this.velocity = new Float32Array(this.count * STATE_STRIDE);
      this.pressTargets = new Float32Array(this.count * STATE_STRIDE);
      this.recoveryHold = new Float32Array(this.count);
      this.activePress = new Uint8Array(this.count);

      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rootBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.rootSeeds, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.state, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.materialBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.materialMask, gl.STATIC_DRAW);
      this.lastRebuildMs = performance.now() - rebuildStarted;
      this.draw();
    }

    roundedRectDistance(x, y, radius) {
      const halfWidth = this.width / 2;
      const halfHeight = this.height / 2;
      const qx = Math.abs(x - halfWidth) - (halfWidth - radius);
      const qy = Math.abs(y - halfHeight) - (halfHeight - radius);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
    }

    createLabelField() {
      if (!this.options.silhouette) return null;
      const label = String(this.options.label || this.host.textContent || "").replace(/\s+/g, " ").trim();
      if (!label) return null;
      const scale = clamp(Math.round(Number(this.options.labelScale) || 2), 1, 3);
      const style = getComputedStyle(this.host);
      const family = style.fontFamily || "sans-serif";
      const weight = style.fontWeight || "700";
      const styledSize = Number.parseFloat(style.fontSize) || 14;
      const maxWidth = Math.max(20, this.width - 28);
      const cacheKey = [label, this.width, this.height, scale, family, weight, styledSize, maxWidth].join("|");
      const cached = this.labelFieldCache.get(cacheKey);
      if (cached) return cached;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(this.width * scale));
      canvas.height = Math.max(1, Math.round(this.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      let size = styledSize;
      const setFont = () => { context.font = `${weight} ${size * scale}px ${family}`; };
      setFont();
      while (size > 9 && context.measureText(label).width > maxWidth * scale) {
        size -= 0.5;
        setFont();
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, canvas.width / 2, canvas.height / 2 + size * scale * 0.03);

      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const inside = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < inside.length; index += 1) inside[index] = rgba[index * 4 + 3] >= 128 ? 1 : 0;
      const distanceToInside = this.chamferDistance(inside, canvas.width, canvas.height, 1);
      const distanceToOutside = this.chamferDistance(inside, canvas.width, canvas.height, 0);
      const signedDistance = new Float32Array(inside.length);
      for (let index = 0; index < inside.length; index += 1) {
        signedDistance[index] = (inside[index] ? distanceToOutside[index] : -distanceToInside[index]) / scale;
      }
      const field = { data: signedDistance, width: canvas.width, height: canvas.height, scale, cacheKey };
      this.labelFieldCache.set(cacheKey, field);
      if (this.labelFieldCache.size > 6) this.labelFieldCache.delete(this.labelFieldCache.keys().next().value);
      return field;
    }

    uploadLabelField(field) {
      const gl = this.gl;
      if (!gl) return;
      if (!this.glyphTexture) this.glyphTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (field) {
        const encoded = encodeSignedDistance(field.data);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, field.width, field.height, 0, gl.RED, gl.UNSIGNED_BYTE, encoded);
        this.hasGlyphTexture = true;
        this.glyphTextureBytes = encoded.byteLength;
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
        this.hasGlyphTexture = false;
        this.glyphTextureBytes = 1;
      }
    }

    chamferDistance(mask, width, height, feature) {
      const diagonal = Math.SQRT2;
      const distance = new Float32Array(width * height);
      for (let index = 0; index < distance.length; index += 1) distance[index] = mask[index] === feature ? 0 : 1e6;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          let best = distance[index];
          if (x > 0) best = Math.min(best, distance[index - 1] + 1);
          if (y > 0) best = Math.min(best, distance[index - width] + 1);
          if (x > 0 && y > 0) best = Math.min(best, distance[index - width - 1] + diagonal);
          if (x + 1 < width && y > 0) best = Math.min(best, distance[index - width + 1] + diagonal);
          distance[index] = best;
        }
      }
      for (let y = height - 1; y >= 0; y -= 1) {
        for (let x = width - 1; x >= 0; x -= 1) {
          const index = y * width + x;
          let best = distance[index];
          if (x + 1 < width) best = Math.min(best, distance[index + 1] + 1);
          if (y + 1 < height) best = Math.min(best, distance[index + width] + 1);
          if (x + 1 < width && y + 1 < height) best = Math.min(best, distance[index + width + 1] + diagonal);
          if (x > 0 && y + 1 < height) best = Math.min(best, distance[index + width - 1] + diagonal);
          distance[index] = best;
        }
      }
      return distance;
    }

    sampleLabelField(field, x, y) {
      const sampleX = clamp(x * field.scale, 0, field.width - 1);
      const sampleY = clamp(y * field.scale, 0, field.height - 1);
      const x0 = Math.floor(sampleX);
      const y0 = Math.floor(sampleY);
      const x1 = Math.min(field.width - 1, x0 + 1);
      const y1 = Math.min(field.height - 1, y0 + 1);
      const tx = sampleX - x0;
      const ty = sampleY - y0;
      const top = field.data[y0 * field.width + x0] * (1 - tx) + field.data[y0 * field.width + x1] * tx;
      const bottom = field.data[y1 * field.width + x0] * (1 - tx) + field.data[y1 * field.width + x1] * tx;
      return top * (1 - ty) + bottom * ty;
    }

    localPointer(event) {
      const rect = this.host.getBoundingClientRect();
      return {
        x: clamp(event.clientX - rect.left, 0, rect.width),
        y: clamp(event.clientY - rect.top, 0, rect.height),
      };
    }

    onPointerEnter(event) {
      if (this.host.disabled) return;
      const point = this.localPointer(event);
      this.hovered = true;
      this.pointer = { ...point, previousX: point.x, previousY: point.y, time: event.timeStamp };
      this.host.classList.add("fur-hovered");
    }

    onPointerMove(event) {
      if (this.host.disabled) return;
      const point = this.localPointer(event);
      const elapsed = Math.max(8, event.timeStamp - this.pointer.time);
      if (!this.reducedMotion.matches && !this.options.reducedMotion && (this.hovered || this.pressed)) {
        this.brush(this.pointer.x, this.pointer.y, point.x, point.y, elapsed);
      }
      this.pointer = { ...point, previousX: this.pointer.x, previousY: this.pointer.y, time: event.timeStamp };
      this.wake();
    }

    releaseActivePressFibers() {
      if (!this.activePress) return;
      for (let index = 0; index < this.count; index += 1) {
        if (this.activePress[index]) this.recoveryHold[index] = 0;
      }
      this.activePress.fill(0);
    }

    interactionRadius(pressed = this.pressed) {
      const baseRadius = Math.max(0.1, Number(this.options.radius) || DEFAULTS.radius);
      if (!pressed) return baseRadius;
      const configuredPressRadius = Number(this.options.pressRadius);
      return Number.isFinite(configuredPressRadius) && configuredPressRadius > 0
        ? configuredPressRadius
        : baseRadius;
    }

    brush(fromX, fromY, toX, toY, elapsed) {
      const segmentX = toX - fromX;
      const segmentY = toY - fromY;
      const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
      const segmentLength = Math.sqrt(segmentLengthSquared);
      if (segmentLength < 0.2) return;
      const speed = segmentLength / elapsed * 1000;
      const directionX = segmentX / segmentLength;
      const directionY = segmentY / segmentLength;
      const impulse = clamp(speed / 560, 0.12, 1) * this.options.brushStrength;
      const radius = this.interactionRadius(this.pressed);
      const recoveryDelay = Math.max(0, Number(this.options.recoveryDelay) || 0) / 1000;
      if(this.pileField && !this.reducedMotion.matches && !this.options.reducedMotion){this.pileField.brush(fromX,fromY,toX,toY,radius,recoveryDelay,Number(this.options.pileMemory)||0);if(this.pressed)this.pileField.press(toX,toY,radius,recoveryDelay,Number(this.options.pileNeighbors)||0);}
      if (this.pressed) this.releaseActivePressFibers();
      for (let index = 0; index < this.count; index += 1) {
        const root = index * 2;
        const rootX = this.roots[root] * this.width;
        const rootY = this.roots[root + 1] * this.height;
        const projection = clamp(((rootX - fromX) * segmentX + (rootY - fromY) * segmentY) / segmentLengthSquared, 0, 1);
        const closestX = fromX + segmentX * projection;
        const closestY = fromY + segmentY * projection;
        const dx = rootX - closestX;
        const dy = rootY - closestY;
        const normalizedDistance = Math.hypot(dx, dy) / radius;
        if (normalizedDistance >= 1) continue;
        const falloff = 1 - smoothstep(0.05, 1, normalizedDistance);
        const state = index * STATE_STRIDE;
        const profile = this.pressed ? pressProfile(normalizedDistance, this.options) : null;
        const bendImpulseScale = profile ? 1 - profile.center * 0.94 : 1;
        this.velocity[state] = clamp(this.velocity[state] + directionX * impulse * falloff * bendImpulseScale, -12, 12);
        this.velocity[state + 1] = clamp(this.velocity[state + 1] + directionY * impulse * falloff * bendImpulseScale, -12, 12);
        this.velocity[state + 2] = clamp(this.velocity[state + 2] + impulse * falloff * (this.pressed ? 0.045 : 0.03), -3, 3);
        if (this.pressed) {
          const sideDistance = Math.hypot(dx, dy);
          const seedAngle = this.rootSeeds[index * ROOT_STRIDE + 3];
          const outwardX = sideDistance > 0.5 ? dx / sideDistance : Math.cos(seedAngle);
          const outwardY = sideDistance > 0.5 ? dy / sideDistance : Math.sin(seedAngle);
          const foldX = Math.cos(seedAngle) * profile.center * 0.1;
          const foldY = Math.sin(seedAngle) * profile.center * 0.1;
          const targetX = outwardX * profile.splay + foldX;
          const targetY = outwardY * profile.splay + foldY;
          const blend = (0.7 + profile.center * 0.24) * smoothstep(0, 1, profile.influence);
          this.pressTargets[state] = targetX;
          this.pressTargets[state + 1] = targetY;
          this.pressTargets[state + 2] = profile.compression;
          this.pressTargets[state + 3] = profile.depression;
          this.state[state] += (targetX - this.state[state]) * blend;
          this.state[state + 1] += (targetY - this.state[state + 1]) * blend;
          this.state[state + 2] += (profile.compression - this.state[state + 2]) * blend;
          this.state[state + 3] += (profile.depression - this.state[state + 3]) * blend;
          this.activePress[index] = 1;
          this.recoveryHold[index] = recoveryDelay;
        } else {
          const hoverTargetX = directionX * falloff * 0.68;
          const hoverTargetY = directionY * falloff * 0.68;
          const hoverCompression = falloff * falloff * this.options.compression * 0.34;
          const blend = 0.55 * smoothstep(0, 1, falloff);
          this.pressTargets[state] = hoverTargetX;
          this.pressTargets[state + 1] = hoverTargetY;
          this.pressTargets[state + 2] = hoverCompression;
          this.pressTargets[state + 3] = 0;
          this.state[state] += (hoverTargetX - this.state[state]) * blend;
          this.state[state + 1] += (hoverTargetY - this.state[state + 1]) * blend;
          this.state[state + 2] += (hoverCompression - this.state[state + 2]) * blend;
          this.recoveryHold[index] = recoveryDelay;
        }
      }
    }

    captureRestFrame() {
      if(!this.gl || !this.state)return this.canvas.toDataURL();
      const saved=this.state.slice();
      try{this.state.fill(0);this.draw();return this.canvas.toDataURL();}
      finally{this.state.set(saved);this.draw();}
    }

    captureDispersalState(record = {}) {
      if(this.cancelledDispersal)return null;
      const saved = this.releasedDispersal;
      if (saved && performance.now()-saved.capturedAt < 1000) return Object.freeze({...saved, activationId:record.id??saved.activationId, modality:record.modality||saved.modality, contactAt:record.contactAt??saved.contactAt});
      return window.DuckDispersal?.capture(this,record);
    }

    onPointerDown(event) {
      if (this.host.disabled) return;
      this.pressStartedAt=performance.now();this.pressRecord=window.DuckTransitions?.getContact?.(this.host);
      this.cancelledDispersal=false;this.releasedDispersal = null;
      const point = this.localPointer(event);
      this.pointer = { ...point, previousX: point.x, previousY: point.y, time: event.timeStamp };
      this.pressed = true;
      this.activePointerId = event.pointerId;
      this.releaseActivePressFibers();
      this.host.classList.add("fur-pressed");
      if (this.host.setPointerCapture) this.host.setPointerCapture(event.pointerId);
      if (this.reducedMotion.matches || this.options.reducedMotion) this.setReducedPress(true);
      else if (this.gl) this.imprintPress();
      this.wake();
    }

    onPointerUp(event) {
      this.finishPress(event, true);
    }

    onPointerCancel(event) {
      this.cancelledDispersal=true;this.releasedDispersal = null;
      this.finishPress(event, false);
    }

    onLostPointerCapture(event) {
      if (this.pressed && (this.activePointerId === null || event.pointerId === this.activePointerId)) this.finishPress(event, false);
    }

    finishPress(event = {}, releaseCapture = false) {
      if (!this.pressed) return;
      if (releaseCapture || event.type === "keyup") this.releasedDispersal = window.DuckDispersal?.capture(this, {...this.pressRecord,modality:event.type === "keyup"?"keyboard":"pointer"});
      this.pressed = false;
      this.releaseActivePressFibers();
      this.host.classList.remove("fur-pressed");
      const pointerId = event.pointerId ?? this.activePointerId;
      if (releaseCapture && pointerId !== null && pointerId !== undefined && this.host.hasPointerCapture?.(pointerId)) this.host.releasePointerCapture(pointerId);
      this.activePointerId = null;
      if (this.reducedMotion.matches || this.options.reducedMotion) {
        this.setReducedPress(false);
      }
      this.wake();
    }

    onPointerLeave() {
      this.hovered = false;
      this.host.classList.remove("fur-hovered");
      if (!this.pressed) this.wake();
    }

    onKeyDown(event) {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ") || this.host.disabled) return;
      this.pressStartedAt=performance.now();this.pressRecord=window.DuckTransitions?.getContact?.(this.host);
      this.cancelledDispersal=false;this.releasedDispersal = null;
      this.pointer.x = this.width / 2;
      this.pointer.y = this.height / 2;
      this.pressed = true;
      this.activePointerId = null;
      this.releaseActivePressFibers();
      this.host.classList.add("fur-pressed");
      if (this.reducedMotion.matches || this.options.reducedMotion) this.setReducedPress(true);
      else if (this.gl) this.imprintPress();
      this.wake();
    }

    onKeyUp(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      this.finishPress({...event,type:"keyup"}, false);
    }

    setReducedPress(pressed) {
      if (!this.state) return;
      const radius = this.interactionRadius(true);
      for (let index = 0; index < this.count; index += 1) {
        const root = index * 2;
        const distance = Math.hypot(this.roots[root] * this.width - this.pointer.x, this.roots[root + 1] * this.height - this.pointer.y);
        const falloff = 1 - smoothstep(0, radius, distance);
        const state = index * STATE_STRIDE;
        this.state[state] = 0;
        this.state[state + 1] = 0;
        this.state[state + 2] = pressed ? falloff * this.options.compression : 0;
        this.state[state + 3] = pressed ? falloff * this.options.pressDepth : 0;
        this.velocity[state] = 0;
        this.velocity[state + 1] = 0;
        this.velocity[state + 2] = 0;
        this.velocity[state + 3] = 0;
      }
      this.draw();
    }

    imprintPress(strength = 0.82) {
      if(this.pileField)this.pileField.press(this.pointer.x,this.pointer.y,this.interactionRadius(true),Math.max(0,this.options.recoveryDelay)/1000,Number(this.options.pileNeighbors)||0);
      const recoveryDelay = Math.max(0, Number(this.options.recoveryDelay) || 0) / 1000;
      const radius = this.interactionRadius(true);
      this.releaseActivePressFibers();
      for (let index = 0; index < this.count; index += 1) {
        const root = index * 2;
        const deltaX = this.roots[root] * this.width - this.pointer.x;
        const deltaY = this.roots[root + 1] * this.height - this.pointer.y;
        const distance = Math.hypot(deltaX, deltaY);
        const normalizedDistance = distance / radius;
        const profile = pressProfile(normalizedDistance, this.options);
        if (profile.influence <= 0) continue;

        const safeDistance = Math.max(distance, 0.001);
        const seedAngle = this.rootSeeds[index * ROOT_STRIDE + 3];
        const outwardX = distance > 0.5 ? deltaX / safeDistance : Math.cos(seedAngle);
        const outwardY = distance > 0.5 ? deltaY / safeDistance : Math.sin(seedAngle);
        const targetX = outwardX * profile.splay + Math.cos(seedAngle) * profile.center * 0.1;
        const targetY = outwardY * profile.splay + Math.sin(seedAngle) * profile.center * 0.1;
        const blend = Math.min(0.99, strength + profile.center * 0.17) * smoothstep(0, 1, profile.influence);
        const state = index * STATE_STRIDE;

        this.state[state] += (targetX - this.state[state]) * blend;
        this.state[state + 1] += (targetY - this.state[state + 1]) * blend;
        this.state[state + 2] += (profile.compression - this.state[state + 2]) * blend;
        this.state[state + 3] += (profile.depression - this.state[state + 3]) * blend;
        this.pressTargets[state] = targetX;
        this.pressTargets[state + 1] = targetY;
        this.pressTargets[state + 2] = profile.compression;
        this.pressTargets[state + 3] = profile.depression;
        this.velocity[state] = clamp(this.velocity[state] + targetX * 2.4, -18, 18);
        this.velocity[state + 1] = clamp(this.velocity[state + 1] + targetY * 2.4, -18, 18);
        this.velocity[state + 2] = clamp(this.velocity[state + 2] + (profile.compression - this.state[state + 2]) * 4.2, -18, 18);
        this.velocity[state + 3] = clamp(this.velocity[state + 3] + (profile.depression - this.state[state + 3]) * 3.4, -18, 18);
        this.activePress[index] = 1;
        this.recoveryHold[index] = recoveryDelay;
      }
      this.draw();
      this.pressResponseMs=Math.max(0,performance.now()-(this.pressStartedAt??performance.now()));
    }

    onActivate(event) {
      if (this.host.disabled || this.host.dataset.transition === "none" || this.options.waveEnabled === false) return;
      const record=window.DuckTransitions?.getActivation(this.host);
      const rect=this.host.getBoundingClientRect();
      const point = record ? {x:record.contact.x-rect.left,y:record.contact.y-rect.top} : event.detail ? this.localPointer(event) : { x: this.width / 2, y: this.height / 2 };
      if(record?.impulse){
        // Workspace handlers consume this physical event later in the same native click.
        queueMicrotask(()=>{if(!record.consumed)this.emitWave(point,{activationId:record.id});});return;
      }
      this.emitWave(point,record?{timeline:record.timeline,activationId:record.id}:{});
    }

    emitWave(point = { x: this.width / 2, y: this.height / 2 }, shared = {}) {
      if (this.destroyed || this.reducedMotion?.matches || this.options.reducedMotion || !this.gl) return;
      const reach = Math.max(...[[0, 0], [this.width, 0], [0, this.height], [this.width, this.height]].map(([x,y]) => Math.hypot(x-point.x,y-point.y)));
      this.waves ||= [];
      if(shared.activationId && this.waves.some(w=>w.activationId===shared.activationId))return;
      let rootField=null;
      if(shared.impulse && shared.impulse.responseVersion!==2){
        rootField=new Float64Array(this.count*13);
        for(let i=0;i<this.count;i++){
          const dx=this.roots[i*2]*this.width-point.x,dy=this.roots[i*2+1]*this.height-point.y,r=Math.hypot(dx,dy),sample=window.DuckDispersal.angular(shared.impulse,Math.atan2(dy,dx));
          const outside=Math.max(0,r-sample.radius),edge=this.materialMask?.[i*3+1]||0,label=this.materialMask?.[i*3]||0;
          const variation=this.rootSeeds[i*ROOT_STRIDE]*(1-edge*.78)+edge*.78;
          const length=this.options.length*variation*(1+label*((this.options.labelLengthScale??1)-1))*(1+edge*.4);
          rootField.set([r,dx/Math.max(.001,r),dy/Math.max(.001,r),sample.radial,sample.tangential,sample.velocity,sample.tangentialVelocity,sample.compression,sample.depression,outside/Math.max(60,shared.impulse.material.waveSpeed||540),Math.exp(-outside/Math.max(1,shared.impulse.pressRadius*8)),length,sample.radius],i*13);
        }
      }
      this.waves.push({ rootField,x: point.x, y: point.y, radius: shared.impulse?shared.impulse.samples.reduce((n,s)=>n+s.radius,0)/shared.impulse.samples.length:0, reach, ...shared });
      this.waves = this.waves.slice(-3);
      this.wake();
    }

    advanceWaves(step) {
      if(this.dispersalOwned)this.dispersalOwned.fill(0);
      const width = Math.max(4, Number(this.options.waveWidth) || 22);
      const speed = Math.max(60, Number(this.options.waveSpeed) || 540);
      this.waves = (this.waves || []).filter((wave) => wave.impulse ? (wave.timeline?.progressAt?.(performance.now())??0)<1 : wave.radius < wave.reach + width);
      for (const wave of this.waves) {
        const previous = wave.radius;
        wave.radius = wave.timeline?.radiusAt ? Math.max(previous,wave.timeline.radiusAt(performance.now())) : previous+speed*step;
        // The new contract uses this live spring as the reference. Do not replace
        // its per-root targets/velocity/remaining holds with a second solver.
        if(wave.impulse?.responseVersion===2)continue;
        const seconds=wave.impulse?(wave.timeline?.impulseSecondsAt?.(performance.now())??Math.max(0,(performance.now()-wave.impulse.capturedAt)/1000)):0;
        const fade=wave.timeline?.deformationAt?.(performance.now())??1;
        for (let index = 0; index < this.count; index += 1) {
          if (this.pressed && this.activePress[index]) continue;
          const dx = this.roots[index*2] * this.width - wave.x;
          const dy = this.roots[index*2+1] * this.height - wave.y;
          const distance = Math.hypot(dx,dy);
          if(wave.impulse){
            const data=wave.rootField,k=index*13;
            if(distance>wave.radius || distance<data[k+12])continue;
            const age=Math.max(0,seconds-data[k+9]),hold=Math.max(0,Number(wave.impulse.material.recoveryDelay)||0)/1000,attenuation=data[k+10]*fade,decay=Math.exp(-3*Math.max(0,age-hold))*attenuation;
            const radial=window.DuckDispersal.evolve(data[k+3],data[k+5],age,hold)*attenuation;
            const tangent=window.DuckDispersal.evolve(data[k+4],data[k+6],age,hold)*attenuation;
            const c=data[k+7]*decay,scale=Math.max(.001,data[k+11]*1.62*(.68+.77*c)),nx=data[k+1],ny=data[k+2],offset=index*STATE_STRIDE;
            this.state[offset]=(nx*radial-ny*tangent)/scale;
            this.state[offset+1]=(ny*radial+nx*tangent)/scale;
            this.state[offset+2]=c;this.state[offset+3]=data[k+8]*decay;
            // Hand back the current held/recovered state, not stale press targets
            // or pre-handoff velocity when this temporary owner finishes.
            for(let component=0;component<STATE_STRIDE;component++){
              if(this.pressTargets)this.pressTargets[offset+component]=this.state[offset+component];
              if(this.velocity)this.velocity[offset+component]=0;
            }
            if(this.recoveryHold)this.recoveryHold[index]=Math.max(0,hold-age);
            this.dispersalOwned ||= new Uint8Array(this.count);this.dispersalOwned[index]=1;
            continue;
          }
          // Swept wavefront sampling prevents gaps at low frame rates.
          const nearest = clamp(distance, previous, wave.radius);
          const envelope = 1 - smoothstep(0, width, Math.abs(distance-nearest));
          const amplitude = envelope * Math.exp(-distance / Math.max(1,wave.reach) * 0.6);
          if (amplitude <= 0) continue;
          const offset = index*STATE_STRIDE;
          const bend = amplitude * (Number(this.options.waveBend) || 0);
          this.state[offset] += (dx / Math.max(1,distance) * bend - this.state[offset]) * Math.min(1,step*35);
          this.state[offset+1] += (dy / Math.max(1,distance) * bend - this.state[offset+1]) * Math.min(1,step*35);
          this.state[offset+2] = Math.max(this.state[offset+2],amplitude * (Number(this.options.waveCompression) || 0));
        }
      }
    }

    simulate(step) {
      if(this.options.inspectionFreeze)return;
      this.advanceWaves(step);
      const stiffness = this.options.stiffness;
      const damping = this.options.damping;
      let maximumEnergy = 0;
      if(this.pileField){if(this.pressed)this.pileField.press(this.pointer.x,this.pointer.y,this.interactionRadius(true),Math.max(0,this.options.recoveryDelay)/1000,Number(this.options.pileNeighbors)||0);maximumEnergy=this.pileField.advance(step);}
      let recoveringFibers = 0;
      for (let index = 0; index < this.count; index += 1) {
        const state = index * STATE_STRIDE;
        if(this.dispersalOwned?.[index]){maximumEnergy=Math.max(maximumEnergy,.01);continue;}
        const activelyPressed = this.pressed && this.activePress[index] === 1;
        let fiberIsMoving = activelyPressed || this.recoveryHold[index] > 0;
        if (activelyPressed) {
          this.recoveryHold[index] = Math.max(0, Number(this.options.recoveryDelay) || 0) / 1000;
        } else if (this.recoveryHold[index] > 0) {
          this.recoveryHold[index] = Math.max(0, this.recoveryHold[index] - step);
        } else {
          const recoveryVariation = this.rootSeeds[index * ROOT_STRIDE + 5];
          const bendRetention = Math.exp(-step * (4.6 + recoveryVariation * 1.8));
          const compressionRetention = Math.exp(-step * (3.8 + recoveryVariation * 1.4));
          const depressionRetention = Math.exp(-step * (3.25 + recoveryVariation * 1.1));
          this.pressTargets[state] *= bendRetention;
          this.pressTargets[state + 1] *= bendRetention;
          this.pressTargets[state + 2] *= compressionRetention;
          this.pressTargets[state + 3] *= depressionRetention;
          if (Math.abs(this.pressTargets[state]) < 0.001) this.pressTargets[state] = 0;
          if (Math.abs(this.pressTargets[state + 1]) < 0.001) this.pressTargets[state + 1] = 0;
          if (this.pressTargets[state + 2] < 0.001) this.pressTargets[state + 2] = 0;
          if (this.pressTargets[state + 3] < 0.001) this.pressTargets[state + 3] = 0;
        }

        let fiberEnergy = 0;
        for (let component = 0; component < STATE_STRIDE; component += 1) {
          const target = this.pressTargets[state + component];
          const offset = state + component;
          const componentStiffness = component === 3 ? stiffness * 0.82 : stiffness;
          const acceleration = componentStiffness * (target - this.state[offset]) - damping * this.velocity[offset];
          this.velocity[offset] = clamp(this.velocity[offset] + acceleration * step, -18, 18);
          this.state[offset] += this.velocity[offset] * step;
          if (component < 2) this.state[offset] = clamp(this.state[offset], -1.35, 1.35);
          else this.state[offset] = clamp(this.state[offset], -0.08, 1);
          if (
            !activelyPressed
            && this.recoveryHold[index] === 0
            && Math.abs(target) <= REST_TOLERANCE.target
            && Math.abs(this.state[offset]) <= REST_TOLERANCE.state
            && Math.abs(this.velocity[offset]) <= REST_TOLERANCE.velocity
          ) {
            this.pressTargets[offset] = 0;
            this.state[offset] = 0;
            this.velocity[offset] = 0;
          }
          const targetMagnitude = Math.abs(this.pressTargets[offset]);
          const stateMagnitude = Math.abs(this.state[offset]);
          const velocityMagnitude = Math.abs(this.velocity[offset]);
          fiberEnergy = Math.max(fiberEnergy, targetMagnitude, stateMagnitude, velocityMagnitude);
          if (
            targetMagnitude > REST_TOLERANCE.target
            || stateMagnitude > REST_TOLERANCE.state
            || velocityMagnitude > REST_TOLERANCE.velocity
          ) fiberIsMoving = true;
        }
        if (fiberIsMoving) recoveringFibers += 1;
        maximumEnergy = Math.max(maximumEnergy, fiberEnergy);
      }
      this.recoveringFibers = recoveringFibers;
      this.lastEnergy = maximumEnergy;
      return maximumEnergy;
    }

    frame(time) {
      this.frameId = 0;
      if (this.destroyed || !this.running) return;
      if (!this.visible || document.hidden) {
        this.running = false;
        this.lastFrame = 0;
        return;
      }
      const elapsed = this.lastFrame ? clamp((time - this.lastFrame) / 1000, 1 / 240, 1 / 24) : 1 / 60;
      this.lastFrame = time;
      const substeps = Math.ceil(elapsed / (1 / 60));
      const step = elapsed / substeps;
      let energy = 0;
      for (let index = 0; index < substeps; index += 1) energy = Math.max(energy, this.simulate(step));
      this.draw();
      this.frames += 1;
      if (time - this.fpsClock >= 500) {
        this.fps = Math.round(this.frames * 1000 / (time - this.fpsClock));
        this.frames = 0;
        this.fpsClock = time;
      }
      if (this.pressed || this.waves?.length || this.recoveringFibers > 0 || energy > REST_TOLERANCE.target) this.frameId = requestAnimationFrame(this.frame);
      else {
        this.running = false;
        this.lastFrame = 0;
      }
    }

    draw() {
      const gl = this.gl;
      if (!gl || !this.count) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.uniform2f(this.canvasResolutionLocation, this.canvas.width, this.canvas.height);
      gl.uniform2f(this.surfaceResolutionLocation, this.width * this.dpr, this.height * this.dpr);
      gl.uniform2f(this.surfaceOffsetLocation, this.overscan * this.dpr, this.overscan * this.dpr);
      gl.uniform1f(this.lengthLocation, this.options.length);
      gl.uniform1f(this.dprLocation, this.dpr);
      gl.uniform1f(this.labelLengthScaleLocation, clamp(Number(this.options.labelLengthScale) || 0.8, 0.2, 1));
      gl.uniform1f(this.labelWidthScaleLocation, clamp(Number(this.options.labelWidthScale) || 0.9, 0.2, 1));
      gl.uniform1f(this.boundaryLabelWidthScaleLocation, clamp(Number(this.options.boundaryLabelWidthScale) || 0.72, 0.35, 1));
      gl.uniform1f(this.boundaryLabelLeanScaleLocation, clamp(Number(this.options.boundaryLabelLeanScale) || 0.62, 0.2, 1));
      gl.uniform1f(this.curveLocation,this.options.experimentalStrands && this.options.strandCurvature!==false?1:0);
      gl.uniform1f(this.hasPileLocation,this.pileTexture && this.pileField?1:0);gl.uniform1i(this.pileFieldLocation,1);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.pileTexture||this.glyphTexture);
      if(this.pileTexture && this.pileField)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,32,16,gl.RGBA,gl.FLOAT,this.pileField.data);
      gl.uniform1i(this.glyphFieldLocation, 0);
      gl.uniform1f(this.hasGlyphLocation, this.hasGlyphTexture ? 1 : 0);
      gl.uniform1f(this.fragmentGlyphMaskLocation, this.options.fragmentGlyphMask === false ? 0 : 1);
      gl.uniform1f(this.sdfRangeLocation, GLYPH_SDF_RANGE);
      gl.uniform1f(this.glyphTransitionLocation, Math.max(0.12, Number(this.options.glyphTransition) || 0.55));
      gl.uniform1f(this.glyphGuardStrengthLocation, clamp(Number(this.options.glyphGuardStrength) || 0.9, 0, 0.98));
      const motionGuardStart = clamp(Number(this.options.motionGuardStart) || 0.12, 0, 0.8);
      const motionGuardEnd = clamp(Number(this.options.motionGuardEnd) || 0.58, motionGuardStart + 0.05, 1);
      gl.uniform1f(this.motionGuardStartLocation, motionGuardStart);
      gl.uniform1f(this.motionGuardEndLocation, motionGuardEnd);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.state);
      gl.bindVertexArray(this.vertexArray);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.strandVertices||6, this.count);
      gl.bindVertexArray(null);
    }

    wake() {
      if (this.destroyed || this.transitionRetains || this.running || !this.gl || !this.visible || document.hidden) return;
      this.running = true;
      this.lastFrame = 0;
      this.frames = 0;
      this.fpsClock = performance.now();
      this.frameId = requestAnimationFrame(this.frame);
    }

    setParameters(parameters) {
      if(this.transitionRetains){this.pendingParameters={...this.pendingParameters,...parameters};return;}
      const previousDensity = this.options.density;
      const previousQuality = this.options.quality;
      const previousSilhouette = this.options.silhouette;
      const previousLabel = this.options.label;
      const previousLabelScale = this.options.labelScale;
      const previousLabelSharpness = this.options.labelSharpness;
      const previousLabelDensity = this.options.labelDensity;
      const previousLabelOrientationVariance = this.options.labelOrientationVariance;
      const previousGlyphGuardWidth = this.options.glyphGuardWidth;
      const previousSilhouetteOverscan = this.options.silhouetteOverscan;
      const previousSilhouetteFringe = this.options.silhouetteFringe;
      this.options = { ...this.options, ...parameters };
      if(this.options.reducedMotion) this.resetFibers();
      this.host.classList.toggle("fur-button-silhouette", Boolean(this.options.silhouette));
      if (
        previousDensity !== this.options.density
        || previousQuality !== this.options.quality
        || previousSilhouette !== this.options.silhouette
        || previousLabel !== this.options.label
        || previousLabelScale !== this.options.labelScale
        || previousLabelSharpness !== this.options.labelSharpness
        || previousLabelDensity !== this.options.labelDensity
        || previousLabelOrientationVariance !== this.options.labelOrientationVariance
        || previousGlyphGuardWidth !== this.options.glyphGuardWidth
        || previousSilhouetteOverscan !== this.options.silhouetteOverscan
        || previousSilhouetteFringe !== this.options.silhouetteFringe
      ) this.resize();
      else {
        this.draw();
        this.wake();
      }
    }

    getStats() {
      const diagnostic = this.getDiagnostics();
      return {
        renderer: this.gl ? "WebGL2 instanced strands" : "static fallback",
        fibers: this.count,
        strandVertices:this.strandVertices||6,pileBytes:this.pileField?this.pileField.data.byteLength*3+this.pileField.hold.byteLength:0,
        labelFibers: this.labelFiberCount || 0,
        requestedGlyphFibers: this.requestedGlyphFibers || 0,
        allocatedGlyphFibers: this.allocatedGlyphFibers || 0,
        baseFibers: this.baseFiberCount || 0,
        fiberCap: this.fiberCap || 0,
        fiberCapUtilization: this.fiberCap ? this.count / this.fiberCap : 0,
        fiberCapReached: Boolean(this.fiberCapReached),
        glyphAllocationLimited: Boolean(this.glyphAllocationLimited),
        overscan: this.overscan || 0,
        fringe: this.options.silhouette ? Math.max(0, Number(this.options.silhouetteFringe) || 0.55) : 0,
        fps: this.running ? this.fps : 0,
        drawCalls: this.gl ? 1 : 0,
        rebuildMs: this.lastRebuildMs,
        gpuBytes: (this.rootSeeds?.byteLength || 0) + (this.state?.byteLength || 0) + (this.materialMask?.byteLength || 0) + this.glyphTextureBytes + (this.pileTexture?8192:0),
        glyphTextureBytes: this.glyphTextureBytes,
        cachedGlyphFields: this.labelFieldCache?.size || 0,
        settled: diagnostic.recoveringFibers === 0,
        recoveringFibers: diagnostic.recoveringFibers,
        maximumDisplacement: diagnostic.maximumDisplacement,
        maximumCompression: diagnostic.maximumCompression,
        maximumDepression: diagnostic.maximumDepression,
        sample: diagnostic.sample,
        quality: this.options.quality,
        fallbackReason: this.fallbackReason || "",
      };
    }

    getDiagnostics() {
      if (!this.state || !this.velocity || !this.pressTargets || !this.recoveryHold || !this.roots) {
        return {
          recoveringFibers: 0,
          maximumDisplacement: 0,
          maximumCompression: 0,
          maximumDepression: 0,
          sample: null,
        };
      }
      let recoveringFibers = 0;
      let maximumDisplacement = 0;
      let maximumCompression = 0;
      let maximumDepression = 0;
      let nearestIndex = -1;
      let nearestDistance = Infinity;
      for (let index = 0; index < this.count; index += 1) {
        const state = index * STATE_STRIDE;
        const displacement = Math.hypot(this.state[state], this.state[state + 1]);
        maximumDisplacement = Math.max(maximumDisplacement, displacement);
        maximumCompression = Math.max(maximumCompression, this.state[state + 2]);
        maximumDepression = Math.max(maximumDepression, this.state[state + 3]);
        const moving = displacement > REST_TOLERANCE.state
          || this.state[state + 2] > REST_TOLERANCE.state
          || this.state[state + 3] > REST_TOLERANCE.state
          || Math.abs(this.velocity[state]) > REST_TOLERANCE.velocity
          || Math.abs(this.velocity[state + 1]) > REST_TOLERANCE.velocity
          || Math.abs(this.velocity[state + 2]) > REST_TOLERANCE.velocity
          || Math.abs(this.velocity[state + 3]) > REST_TOLERANCE.velocity
          || this.recoveryHold[index] > 0;
        if (moving) recoveringFibers += 1;
        const root = index * 2;
        const distance = Math.hypot(this.roots[root] * this.width - this.pointer.x, this.roots[root + 1] * this.height - this.pointer.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
      const sampleOffset = nearestIndex >= 0 ? nearestIndex * STATE_STRIDE : 0;
      return {
        recoveringFibers,
        maximumDisplacement,
        maximumCompression,
        maximumDepression,
        sample: nearestIndex >= 0 ? {
          index: nearestIndex,
          bendX: this.state[sampleOffset],
          bendY: this.state[sampleOffset + 1],
          compression: this.state[sampleOffset + 2],
          depression: this.state[sampleOffset + 3],
          hold: this.recoveryHold[nearestIndex],
        } : null,
      };
    }

    resetFibers() {
      this.pileField?.clear();
      if(this.frameId) cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.waves = [];
      this.pressed = false;
      this.activePointerId = null;
      this.host.classList.remove("fur-pressed", "fur-hovered");
      this.activePress?.fill(0);
      this.recoveryHold?.fill(0);
      this.pressTargets?.fill(0);
      this.state?.fill(0);
      this.velocity?.fill(0);
      this.recoveringFibers = 0;
      this.lastEnergy = 0;
      this.running = false;
      this.lastFrame = 0;
      this.draw();
    }

    onVisibility() {
      if (document.hidden) {
        if(this.frameId) cancelAnimationFrame(this.frameId);
        this.frameId = 0;
        this.waves = [];
        this.finishPress({}, false);
        this.running = false;
        this.lastFrame = 0;
      } else this.wake();
    }

    onWindowBlur() {
      this.hovered = false;
      this.host.classList.remove("fur-hovered");
      this.finishPress({}, false);
    }

    onMotionChange() {
      if (this.reducedMotion.matches) {
        this.resetFibers();
      }
    }

    onContextLost(event) {
      event.preventDefault();
      this.running = false;
      this.glyphTexture = null;this.pileTexture=null;
      this.gl = null;
      this.host.classList.add("fur-static-fallback");
      this.fallbackReason = "WebGL context lost";
    }

    onContextRestored() {
      if (this.destroyed) return;
      this.initializeGraphics();
      this.resize();
    }

    retainDispersal() {
      this.transitionRetains=(this.transitionRetains||0)+1;
      this.resizeObserver?.disconnect();this.intersectionObserver?.disconnect();this.labelObserver?.disconnect();
      if(this.frameId)cancelAnimationFrame(this.frameId);this.frameId=0;this.running=false;
      let released=false;
      return ()=>{if(released)return;released=true;this.transitionRetains--;if(!this.transitionRetains){if(this.pendingDestroy)this.destroy();else{this.resizeObserver?.observe(this.host);this.intersectionObserver?.observe(this.host);this.labelObserver?.observe(this.host,{childList:true,characterData:true,subtree:true});if(this.pendingParameters){const pending=this.pendingParameters;this.pendingParameters=null;this.setParameters(pending);}this.wake();}}};
    }

    destroy() {
      if(this.transitionRetains){this.pendingDestroy=true;if(this.frameId)cancelAnimationFrame(this.frameId);this.frameId=0;this.running=false;return;}
      if (this.destroyed) return;
      if(this.frameId) cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.destroyed = true;
      liveSurfaces.delete(this);
      this.running = false;
      this.resizeObserver?.disconnect();
      this.intersectionObserver?.disconnect();
      this.labelObserver?.disconnect();
      this.host.removeEventListener("pointerenter", this.onPointerEnter);
      this.host.removeEventListener("pointermove", this.onPointerMove);
      this.host.removeEventListener("pointerdown", this.onPointerDown);
      this.host.removeEventListener("pointerup", this.onPointerUp);
      this.host.removeEventListener("pointercancel", this.onPointerCancel);
      this.host.removeEventListener("lostpointercapture", this.onLostPointerCapture);
      this.host.removeEventListener("pointerleave", this.onPointerLeave);
      this.host.removeEventListener("keydown", this.onKeyDown);
      this.host.removeEventListener("keyup", this.onKeyUp);
      this.host.removeEventListener("click", this.onActivate);
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("blur", this.onWindowBlur);
      this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
      this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
      if (this.reducedMotion.removeEventListener) this.reducedMotion.removeEventListener("change", this.onMotionChange);

      const gl = this.gl;
      if (gl) {
        if (this.pileTexture) gl.deleteTexture(this.pileTexture);
        if (this.glyphTexture) gl.deleteTexture(this.glyphTexture);
        if (this.cornerBuffer) gl.deleteBuffer(this.cornerBuffer);
        if (this.rootBuffer) gl.deleteBuffer(this.rootBuffer);
        if (this.stateBuffer) gl.deleteBuffer(this.stateBuffer);
        if (this.materialBuffer) gl.deleteBuffer(this.materialBuffer);
        if (this.vertexArray) gl.deleteVertexArray(this.vertexArray);
        if (this.program) gl.deleteProgram(this.program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      this.gl = null;
      this.canvas.remove();
      this.host.classList.remove("fur-material", "fur-button-silhouette", "fur-static-fallback", "fur-hovered", "fur-pressed");
    }
  }

  function mount(host, options = {}) {
    if (!host) return null;
    const existing = registry.get(host);
    if (existing) {
      existing.setParameters(options);
      return existing;
    }
    const surface = new DuckFurSurface(host, options);
    registry.set(host, surface);
    liveSurfaces.add(surface);
    return surface;
  }

  function mountAll(root = document, selector = "[data-fur-material]") {
    return [...root.querySelectorAll(selector)].map((host) => mount(host));
  }

  function unmount(host) {
    const surface = registry.get(host);
    if (!surface) return false;
    surface.destroy();
    registry.delete(host);
    return true;
  }

  // Dynamic task/calendar rendering may remove controls before a view refresh.
  // Release their contexts explicitly instead of retaining detached surfaces.
  if(typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    new MutationObserver(records=> {
      if(!records.some(record=>record.removedNodes.length))return;
      for(const surface of [...liveSurfaces])if(!surface.host.isConnected)unmount(surface.host);
    }).observe(document.documentElement,{childList:true,subtree:true});
  }

  DuckFurSurface.pressProfileForHandoff = pressProfile;
  window.DuckFur = {
    mount,
    mountAll,
    unmount,
    get: (host) => registry.get(host),
    getRendererStats: () => ({ contexts: [...liveSurfaces].filter(surface=>Boolean(surface.gl)).length, gpuBytes: [...liveSurfaces].reduce((sum,surface)=>sum+surface.getStats().gpuBytes,0) }),
    // Reuse the approved resting pile on temporary deforming surfaces.
    materialShaders: Object.freeze({vertex:VERTEX_SHADER,fragment:FRAGMENT_SHADER,curve:CURVE_GLSL,
      fibersPerPixel:QUALITY.medium.fibersPerPixel*3.15}),
    defaults: { ...DEFAULTS },
    __testing: { DuckFurSurface, pressProfile, encodeSignedDistance, stableRandom, motionGuardProtection, overscanLayout, silhouetteRootIncluded, REST_TOLERANCE, ROOT_STRIDE, STATE_STRIDE, MATERIAL_STRIDE },
  };
})();
