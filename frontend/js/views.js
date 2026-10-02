// Paths come only from this application-owned allowlist, never from route input.
const files = Object.freeze({
  navbar: 'components/navbar.html', dialogs: 'components/dialogs.html',
  home: 'views/home.html', login: 'views/auth.html', customer: 'views/marketplace.html',
  restaurants: 'views/restaurants.html', restaurant: 'views/restaurant.html',
  'my-orders': 'views/orders.html', favorites: 'views/favorites.html',
  recovery: 'views/recovery.html', 'reset-password': 'views/reset-password.html',
  profile: 'views/profile.html', business: 'views/business.html'
});
const pending = new Map();
const mounted = new Map();

export function hasView(name) { return mounted.has(name); }

export async function ensureView(name) {
  if (!Object.hasOwn(files, name)) throw new Error('Unknown PlateUp screen.');
  if (mounted.has(name)) return mounted.get(name);
  if (pending.has(name)) return pending.get(name);
  const request = (async () => {
    const response = await fetch('/frontend/' + files[name]);
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('This screen could not be loaded. Please try again.');
    }
    const html = await response.text();
    const template = document.createElement('template');
    template.innerHTML = html;
    // Partials contain markup only; executable code belongs in imported modules.
    if (template.content.querySelector('script,html,body') ||
        [...template.content.querySelectorAll('*')].some(node =>
          [...node.attributes].some(attribute => /^on/i.test(attribute.name)))) {
      throw new Error('Invalid PlateUp view.');
    }
    const mount = document.getElementById(name === 'navbar' ? 'navbar' : name === 'dialogs' ? 'dialogs' : 'app');
    const root = template.content.firstElementChild;
    if (!root || !mount || (!['navbar','dialogs'].includes(name) && root.id !== name)) {
      throw new Error('Invalid PlateUp view.');
    }
    root.classList.remove('active');
    mount.appendChild(template.content);
    mounted.set(name, root);
    return root;
  })();
  pending.set(name, request);
  try { return await request; }
  finally { pending.delete(name); }
}

export function showLoadError(error) {
  console.error('PlateUp view loading failed:', error);
  document.getElementById('app-status').hidden = false;
  document.getElementById('app-status-message').textContent = 'Could not load this screen. Check your connection and try again.';
  document.getElementById('app-retry').hidden = false;
}
