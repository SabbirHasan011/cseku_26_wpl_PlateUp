import { state } from './state.js';
import { handleLogout } from './auth.js';

export const API_BASE = location.protocol !== 'file:' && location.port !== '5500' ? '/api' :
  'http://' + (location.hostname || 'localhost') + ':5000/api';

export async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      ...options,
      headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type':'application/json' }),
        ...(state.token ? { Authorization:'Bearer ' + state.token } : {}), ...(options.headers || {}) }
    });
  } catch (error) {
    throw new Error('Cannot connect to PlateUp at ' + API_BASE + '. Run npm start, then open http://localhost:5000/.');
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    if (response.status===404) {
      throw new Error('The server at ' + API_BASE + ' is missing ' + path +
        '. An older backend may still be running. Stop the existing server with Ctrl+C, then run npm start again.');
    }
    throw new Error('Expected an API response from ' + API_BASE + path + ', but received a web page (HTTP ' +
      response.status + '). Open PlateUp using the address printed by npm start.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token && !path.startsWith('/auth/')) handleLogout();
    throw new Error(data.message || 'Request failed');
  }
  return data;
}
