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

// 서버(scripts/notify.mjs)는 data 전용 메시지를 보냄 → 여기서 직접 표시
// (notification 필드가 있는 메시지는 SDK가 자동 표시하므로 중복 표시하지 않음)
messaging.onBackgroundMessage(payload => {
  console.log('[SW] 백그라운드 메시지 수신:', payload);
  if (payload.notification) return;
  const data = payload.data || {};
  const title = data.title || '출조마당 🎣';
  const options = {
    body: data.body || '새 알림이 있습니다',
    icon: '/chuljo/icon-192.png',
    badge: '/chuljo/badge-72.png',
    tag: data.tag || 'chuljo-notif',
    renotify: true,
    data: { url: data.url || '/chuljo/' },
    vibrate: [200, 100, 200],
    actions: data.action ? [{ action: 'open', title: data.action }] : []
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/chuljo/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/chuljo') && 'focus' in client) {
          // 열려 있는 앱 창을 해당 출조 화면으로 이동
          return ('navigate' in client ? client.navigate(url) : Promise.resolve(client))
            .then(c => (c || client).focus())
            .catch(() => clients.openWindow(url));
        }
      }
      return clients.openWindow(url);
    })
  );
});
