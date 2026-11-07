(() => {
  "use strict";

  const CONTROL_SELECTOR = "button, [role='button'], a.secondary-button, a.nav-open-button";
  const releaseTimers = new WeakMap();
  const activePointerControls = new Map();
  let activeKeyboardControl = null;

  function interactiveControlFrom(target) {
    const control = target instanceof Element ? target.closest(CONTROL_SELECTOR) : null;
    if (!control || control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") return null;
    return control;
  }

  function beginInteraction(control) {
    clearTimeout(releaseTimers.get(control));
    control.classList.remove("interaction-released");
    control.classList.add("interaction-pressed");
  }

  function releaseInteraction(control) {
    if (!control) return;
    control.classList.remove("interaction-pressed");
    if (control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") return;
    control.classList.remove("interaction-released");
    void control.offsetWidth;
    control.classList.add("interaction-released");
    releaseTimers.set(control, setTimeout(() => {
      control.classList.remove("interaction-released");
      releaseTimers.delete(control);
    }, window.DuckMotion?.duration.release || 360));
  }

  document.addEventListener("pointerdown", (event) => {
    const control = interactiveControlFrom(event.target);
    if (!control) return;
    activePointerControls.set(event.pointerId, control);
    if (control.classList.contains("glass-button")) {
      const rect = control.getBoundingClientRect();
      control.style.setProperty("--glass-x", `${Math.max(0, Math.min(100, (event.clientX - rect.left) / Math.max(1, rect.width) * 100))}%`);
      control.style.setProperty("--glass-y", `${Math.max(0, Math.min(100, (event.clientY - rect.top) / Math.max(1, rect.height) * 100))}%`);
    }
    beginInteraction(control);
  }, true);

  document.addEventListener("pointerup", (event) => {
    const control = activePointerControls.get(event.pointerId);
    if (!control) return;
    activePointerControls.delete(event.pointerId);
    releaseInteraction(control);
  }, true);

  const cancelPointerInteraction = (event) => {
    const control = activePointerControls.get(event.pointerId);
    if (!control) return;
    activePointerControls.delete(event.pointerId);
    control.classList.remove("interaction-pressed");
  };

  document.addEventListener("pointercancel", cancelPointerInteraction, true);
  document.addEventListener("lostpointercapture", cancelPointerInteraction, true);

  document.addEventListener("keydown", (event) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    const control = interactiveControlFrom(event.target);
    if (control) {
      control.style.removeProperty("--glass-x");
      control.style.removeProperty("--glass-y");
      beginInteraction(control);
      activeKeyboardControl = control;
    }
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Opening a panel can move focus before keyup; release the original control.
    const control = activeKeyboardControl || interactiveControlFrom(event.target);
    activeKeyboardControl = null;
    if (control?.classList.contains("interaction-pressed")) releaseInteraction(control);
  }, true);

  document.addEventListener("click", (event) => {
    const control = interactiveControlFrom(event.target);
    if (control && !control.classList.contains("interaction-pressed") && !control.classList.contains("interaction-released")) {
      releaseInteraction(control);
    }
  }, true);

  window.addEventListener("blur", () => {
    activePointerControls.clear();
    activeKeyboardControl = null;
    document.querySelectorAll(".interaction-pressed").forEach((control) => control.classList.remove("interaction-pressed"));
  });
})();
