const TOKEN_KEY = 'noc_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
}

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !url.includes('/auth/login')) {
    setToken(null);
    window.location.hash = '#/login';
    throw new Error('Sesi berakhir, silakan login ulang');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: u => request('GET', u),
  post: (u, b) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: u => request('DELETE', u)
};

let onStatus = null;
export function subscribeEvents(cb) {
  onStatus = cb;
  let es = null;
  function connect() {
    es = new EventSource('/api/events?token=' + encodeURIComponent(getToken() || ''));
    es.addEventListener('message', ev => {
      try {
        const data = JSON.parse(ev.data);
        cb && cb(data);
      } catch {}
    });
    es.onerror = () => {
      es.close();
      setTimeout(connect, 4000);
    };
  }
  connect();
  return () => es && es.close();
}
