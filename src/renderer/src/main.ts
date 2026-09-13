// The page. For now it only proves the whole chain works: page → bridge → the layer underneath.

const engine = document.querySelector<HTMLParagraphElement>('#engine');
if (engine === null) throw new Error('The page is missing its #engine paragraph (src/renderer/index.html).');

const { electron, chromium, node } = window.insanityLoom.versions;
engine.textContent = `Electron ${electron} · Chromium ${chromium} · Node.js ${node}`;
