// Tiny URL router
// -----------------------------------------------------------------------------
// Not a "real" SPA router — just a wrapper around URLSearchParams + history API
// so the app can react to ?room=... and ?template=... without duplicating
// parsing logic everywhere.

const listeners = new Set();

export function getRoute() {
  const params = new URLSearchParams(window.location.search);
  return {
    room: params.get('room') || null,
    template: params.get('template') || null,
  };
}

export function setRoute(patch, { replace = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  const url = window.location.pathname + (qs ? '?' + qs : '');
  if (replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }
  emit();
}

export function onRouteChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  const route = getRoute();
  for (const cb of listeners) cb(route);
}

window.addEventListener('popstate', emit);
