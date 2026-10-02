const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../frontend/js');

// Run the real browser ES modules, including their imports and circular dependencies.
// Each test gets an isolated module graph and session state.
async function loadModules(context) {
  const cache = new Map();
  const files = fs.readdirSync(root).filter(name => name.endsWith('.js') && name !== 'app.js');
  const entry = new vm.SourceTextModule(files.map((name, index) =>
    `import * as m${index} from './${name}'; export { m${index} };`).join('\n'), {
    context, identifier: path.join(root, '__test__.js')
  });
  function getModule(filename) {
    if (!filename.startsWith(root + path.sep)) throw new Error('Unexpected module path');
    if (!cache.has(filename)) cache.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename }));
    return cache.get(filename);
  }
  await entry.link((specifier, referencing) => getModule(path.resolve(path.dirname(referencing.identifier), specifier)));
  await entry.evaluate();
  for (const namespace of Object.values(entry.namespace)) Object.assign(context, namespace);
  const state = context.state;
  // Preserve the existing behavioral assertions' convenience access to test state.
  for (const key of Object.keys(state)) Object.defineProperty(context, key, {
    configurable: true, get: () => state[key], set: value => { state[key] = value; }
  });
  return { cache, entry, async bootstrap() {
    const app = getModule(path.join(root, 'app.js'));
    await app.link((specifier, referencing) => getModule(path.resolve(path.dirname(referencing.identifier), specifier)));
    await app.evaluate();
    return app.namespace;
  } };
}

module.exports = { loadModules };
