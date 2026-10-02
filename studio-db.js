(function (root) {
  let pending;
  function open() {
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const req = indexedDB.open('easy-ts-cache-v1', 2);
      req.onupgradeneeded = () => {
        for (const [name, keyPath] of [['jobs', 'jobKey'], ['audio', 'key'], ['sources', 'key'], ['exports', 'key']]) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); pending = null; }; resolve(req.result); };
      req.onerror = () => { pending = null; reject(req.error); };
      req.onblocked = () => { pending = null; reject(new Error('افزونه را Reload کنید تا پایگاه داده به‌روز شود.')); };
    });
    return pending;
  }
  async function request(store, method, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, ['get', 'getAll'].includes(method) ? 'readonly' : 'readwrite');
      const req = tx.objectStore(store)[method](value);
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = tx.onerror = () => reject(tx.error || req.error || new Error('ذخیره‌سازی ناموفق بود.'));
    });
  }
  root.StudioDB = { open, get: (s, k) => request(s, 'get', k), all: s => request(s, 'getAll'), put: (s, v) => request(s, 'put', v), remove: (s, k) => request(s, 'delete', k) };
})(globalThis);
