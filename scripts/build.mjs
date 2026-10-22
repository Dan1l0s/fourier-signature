import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
async function bundle(name, path, exports, imports = '') {
  const source = (await read(path)).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return `const ${name} = (() => {\n${imports}\n${source}\nreturn {${exports}};\n})();`;
}
const javascript = (await Promise.all([
  bundle('Fourier', 'src/fourier.js', 'fft, ifft, toHarmonics, evaluateHarmonics'),
  bundle('Renderer', 'src/renderer.js', 'createScene', 'const {evaluateHarmonics} = Fourier;'),
  bundle('Svg', 'src/svg.js', 'renderSvg'),
  bundle('App', 'src/app.js', 'startApp', 'const {createScene} = Renderer;\nconst {renderSvg} = Svg;')
])).join('\n\n');
const data = JSON.stringify(JSON.parse(await read('data/word.json'))).replaceAll('<', '\\u003c');
const style = await read('src/style.css');
const page = (await read('index.html'))
  .replace(/<link\b[^>]*href="\.\/src\/style\.css"[^>]*>/, () => `<style>\n${style}\n</style>`)
  .replace(/<script\b[^>]*src="\.\/src\/main\.js"[^>]*><\/script>/, () => `<script type="module">\n${javascript}\n\nApp.startApp(${data});\n</script>`);

if (page.includes('src="./src/main.js"') || page.includes('href="./src/style.css"')) {
  throw new Error('The HTML entry points could not be bundled.');
}
await mkdir(new URL('dist/', root), {recursive:true});
await writeFile(new URL('dist/index.html', root), page);
console.log('Built dist/index.html: opens directly, no server required.');
