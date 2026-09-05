const CACHE_NAME = 'daedalus-core-v1';

const CORE_ASSETS = [
  '/index.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
];

async function handleInstall(event) {
  try {
    await event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(CORE_ASSETS);
      })
    );
    self.skipWaiting();
  } catch (error) {
    console.error('[ServiceWorker] Install failed:', error);
  }
}

async function handleActivate(event) {
  try {
    await event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        );
      })
    );
    self.clients.claim();
  } catch (error) {
    console.error('[ServiceWorker] Activate failed:', error);
  }
}

async function handleFetch(event) {
  try {
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const networkResponse = await fetch(event.request);
    if (networkResponse && networkResponse.status === 200) {
      const responseClone = networkResponse.clone();
      await caches.open(CACHE_NAME).then((cache) => {
        return cache.put(event.request, responseClone);
      });
    }

    return networkResponse;
  } catch (error) {
    console.error('[ServiceWorker] Fetch failed:', error);
    
    // For navigation requests, return a fallback offline page
    if (event.request.mode === 'navigate') {
      const cachedIndex = await caches.match('/index.html');
      if (cachedIndex) {
        return cachedIndex;
      }
      return new Response(
        '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>Offline</h1><p>The application is currently unavailable. Please check your connection.</p></body></html>',
        {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/html' }
        }
      );
    }
    
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

self.addEventListener('install', handleInstall);
self.addEventListener('activate', handleActivate);
self.addEventListener('fetch', handleFetch);
