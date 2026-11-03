// The terminal's data modules are written for the browser. The few browser
// globals they touch at call time get harmless Node stand-ins here, so the
// pipeline parses every source with exactly the code the app uses.
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.document ??= { hidden: false };
