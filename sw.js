const C='symphonai-v1',A=['./','index.html','style.css','src/main.js','src/audio.js','src/tracker.js','src/engines.js','icon.svg','manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A))));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));
