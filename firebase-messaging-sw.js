// firebase-messaging-sw.js
// 배포 위치: https://yourkocs.github.io/chuljo/firebase-messaging-sw.js
// (GitHub Pages 레포지토리 루트에 위치해야 함)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAxyLn2wNlxXqJ3IzjuCR7_c54JMufjXHU",
  authDomain: "mulbit-9195c.firebaseapp.com",
  projectId: "mulbit-9195c",
  storageBucket: "mulbit-9195c.firebasestorage.app",
  messagingSenderId: "754737585082",
  appId: "1:754737585082:web:c84ce6bf7635d10ff11b83"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  console.log('[SW] 백그라운드 메시지 수신:', payload);
  const { title = '출조마당 🎣', body = '새 알림이 있습니다' } = payload.notification || {};
  const data = payload.data || {};
  const options = {
    body,
    icon: '/chuljo/icon-192.png',
    badge: '/chuljo/badge-72.png',
    tag: data.tag || 'chuljo-notif',
    renotify: true,
    data: { url: data.url || '/chuljo/' },
    vibrate: [200, 100, 200],
    actions: data.action ? [{ action: 'open', title: data.action }] : []
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/chuljo/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/chuljo') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
