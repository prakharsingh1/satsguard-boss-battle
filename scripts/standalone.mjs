import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
const css = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);
if (!script || !css) throw new Error('Build output did not contain the expected standalone assets.');
const js = await readFile('dist' + script[1], 'utf8');
const style = await readFile('dist' + css[1], 'utf8');
const icon = await readFile('public/favicon.svg', 'utf8');
const output = html.replace(script[0], () => '<script type="module">' + js.replace(/<\/script/gi, '<\\/script') + '</script>')
  .replace(css[0], () => '<style>' + style + '</style>')
  .replace('href="/favicon.svg"', () => 'href="data:image/svg+xml,' + encodeURIComponent(icon) + '"')
  .replace('href="/guide.html"', 'href="./guide.html"');
await mkdir('publication', { recursive: true });
await writeFile('publication/index.html', output);
await copyFile('public/guide.html', 'publication/guide.html');
await copyFile('public/demo.html', 'publication/demo.html');
console.log('Standalone publication/index.html prepared; application needs no asset requests.');
