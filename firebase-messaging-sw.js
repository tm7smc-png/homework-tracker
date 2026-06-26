// firebase-messaging-sw.js

// 🚨 ต้องดักฟังการคลิกก่อนโหลด Firebase SDK เพื่อไม่ให้โดน Firebase ขัดขวาง
self.addEventListener('notificationclick', (event) => {
  // บล็อกไม่ให้ Firebase SDK ทำงานซ้อนทับ
  event.stopImmediatePropagation();
  event.notification.close();

  // ดึง click_action จากข้อมูลที่แนบมาโดยละเอียด
  const notifData = event.notification.data;
  let clickAction = null;
  if (notifData) {
    clickAction = notifData.click_action ||
      notifData.clickAction ||
      notifData.FCM_MSG?.notification?.click_action ||
      notifData.FCM_MSG?.notification?.clickAction ||
      notifData.FCM_MSG?.data?.click_action ||
      notifData.FCM_MSG?.data?.clickAction ||
      notifData.FCM_MSG?.webpush?.notification?.click_action ||
      notifData.FCM_MSG?.webpush?.notification?.clickAction;
  }
  if (!clickAction && event.notification.clickAction) {
    clickAction = event.notification.clickAction;
  }

  let targetUrl = self.location.origin + '/';
  if (clickAction) {
    if (clickAction.startsWith('http')) {
      // ป้องกัน localhost vs ngrok ข้ามกัน โดยเปลี่ยน origin ให้ตรงกับตัวรับแจ้งเตือนเสมอ
      try {
        const parsedUrl = new URL(clickAction);
        targetUrl = self.location.origin + parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
      } catch (e) {
        targetUrl = clickAction;
      }
    } else {
      targetUrl = self.location.origin + (clickAction.startsWith('/') ? '' : '/') + clickAction;
    }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // ค้นหาแท็บเดิมที่เปิดทิ้งไว้เพื่อเปลี่ยนเส้นทางหรือโฟกัส
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          // แจ้งเตือนไปยังเพจโดยตรงเพื่อเปิดหน้าต่าง modal ทันทีโดยไม่ต้องโหลดเพจใหม่
          client.postMessage({
            type: 'OPEN_NOTIFICATION',
            url: targetUrl
          });
          return client.focus();
        }
      }
      // หากไม่มีแท็บเว็บนี้เปิดอยู่เลย ให้สร้างแท็บใหม่ไปยังปลายทาง
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ตั้งค่า Firebase Config ของคุณให้ Service Worker เข้าใจปลายทาง
const firebaseConfig = {
  apiKey: "AIzaSyBE9VOkEqkzHxcEtD3FV6LV07qFN5In61Y",
  authDomain: "homework-4-6bc0f.firebaseapp.com",
  projectId: "homework-4-6bc0f",
  storageBucket: "homework-4-6bc0f.firebasestorage.app",
  messagingSenderId: "222843763631",
  appId: "1:222843763631:web:8387b22fe8d6921c580d5a"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// รับสตรีมการแจ้งเตือนจากหลังบ้านขณะหน้าเว็บปิดอยู่หรืออยู่ในโหมด Background
messaging.onBackgroundMessage((payload) => {
  console.log('[Service Worker] ได้รับพุชเบื้องหลัง: ', payload);

  // ⚠️ หากพุชมีฟิลด์ notification อยู่แล้ว บราวเซอร์จะสร้างป้ายแบนเนอร์แจ้งเตือนให้อัตโนมัติ
  // เราไม่ต้องสั่งแสดงผลเองซ้ำอีกครั้ง เพื่อป้องกันการแจ้งเตือนซ้อนกัน 2 รอบ
  if (payload.notification) {
    console.log('[Service Worker] บราวเซอร์จะจัดการแสดงแบนเนอร์แจ้งเตือนโดยอัตโนมัติ');
    return;
  }

  // รองรับกรณีส่งข้อความแบบมีแต่ข้อมูลดิบ (Data-only payload)
  const notificationTitle = payload.data?.title || 'อัปเดตใหม่จากระบบการบ้าน';
  const notificationOptions = {
    body: payload.data?.body || 'กรุณาตรวจสอบแอปพลิเคชัน',
    icon: payload.data?.icon || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128', // ลิงก์รูปภาพไอคอน
    data: {
      click_action: payload.data?.click_action || '/'
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

