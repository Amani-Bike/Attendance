if (new URLSearchParams(location.search).has('livePreview')) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .then(unregistered => {
        if (unregistered.some(Boolean)) location.reload();
      })
      .catch(error => console.error('Unable to disable service worker for live preview:', error));
  }
  document.querySelectorAll('nav a[href]').forEach(link => {
    const url = new URL(link.href, location.href);
    url.searchParams.set('livePreview', '1');
    link.href = `${url.pathname}${url.search}${url.hash}`;
  });
  window.addEventListener('load', () => {
    let revision;
    const refreshIfChanged = async () => {
      const response = await fetch('/__dev/version', { cache: 'no-store' });
      if (!response.ok) throw new Error('Live preview version check failed.');
      const current = (await response.json()).revision;
      if (revision !== undefined && current !== revision) location.reload();
      revision = current;
    };
    refreshIfChanged().catch(error => console.error(error));
    setInterval(() => refreshIfChanged().catch(error => console.error(error)), 1000);
  });
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.error('Service worker registration failed:', error);
    });
  });
}
