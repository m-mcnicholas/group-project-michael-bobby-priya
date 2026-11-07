(() => {
  'use strict';
  // Critically damped step response: accelerate, then settle without rebound.
  const omega = 9;
  const normalizer = 1 - (1 + omega) * Math.exp(-omega);
  function response(t) {
    t = Math.max(0, Math.min(1, t));
    return (1 - (1 + omega * t) * Math.exp(-omega * t)) / normalizer;
  }
  const curve = `linear(${Array.from({length:61}, (_,i) => response(i/60).toFixed(6)).join(',')})`;
  const easing = typeof CSS !== 'undefined' && CSS.supports('animation-timing-function',curve) ? curve : 'cubic-bezier(.2,.8,.2,1)';
  const duration = Object.freeze({layout:480,control:240,press:80,release:400,popupOpen:240,popupClose:300,popupContent:120,popupContentOut:60});
  window.DuckMotion = Object.freeze({response,easing,duration});
  if (typeof document !== 'undefined') {
    const style = document.documentElement.style;
    style.setProperty('--motion-ease',easing);
    for (const [name,value] of Object.entries(duration)) style.setProperty(`--motion-${name}`,`${value}ms`);
  }
})();
