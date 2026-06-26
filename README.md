# 📚 Homework Tracker

เว็บแอปพลิเคชันสำหรับบันทึกและจัดการการบ้าน สร้างด้วย HTML/CSS/JavaScript เชื่อมต่อกับ Firebase Cloud Firestore

---

## 🚀 วิธีติดตั้งและใช้งาน

### 1. Clone โปรเจกต์
```bash
git clone <your-repo-url>
cd homework
```

### 2. ตั้งค่า Firebase Config
```bash
# คัดลอก template ไฟล์ config
cp config/firebase.config.example.js config/firebase.config.js
```

จากนั้นแก้ไขไฟล์ `config/firebase.config.js` ใส่ข้อมูล Firebase ของคุณ:
```js
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. ตั้งค่า Firestore Rules
ไปที่ Firebase Console → Firestore Database → Rules แล้วใส่:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
> ⚠️ Rules นี้เหมาะสำหรับการใช้งานส่วนตัว ถ้าต้องการความปลอดภัยเพิ่มเติมควรเพิ่มระบบ Authentication

### 4. เปิดเว็บไซต์
เปิดไฟล์ `index.html` ผ่าน Live Server (VS Code Extension) หรือ HTTP Server ใดๆ

> ⚠️ **ห้ามเปิดไฟล์ด้วย `file://` โดยตรง** เนื่องจาก ES Modules ต้องการ HTTP server

---

## 📁 โครงสร้างไฟล์

```
homework/
├── index.html                    # หน้าหลักของแอป
├── css/
│   └── style.css                 # สไตล์ทั้งหมด
├── js/
│   ├── app.js                    # Logic หลักของแอป
│   └── firebase.js               # Firebase CRUD functions
├── config/
│   ├── firebase.config.js        # 🔒 ข้อมูล credentials (ไม่ขึ้น Git)
│   └── firebase.config.example.js # Template สำหรับ setup ใหม่
├── .gitignore
└── README.md
```

---

## ✨ ฟีเจอร์

- ✅ เพิ่ม/ลบ/แก้ไขการบ้าน
- ✅ จัดการรายชื่อวิชา
- ✅ เรียงลำดับตามวันกำหนดส่ง
- ✅ แสดงสถานะ: ปกติ / ใกล้ถึงกำหนด / เลยกำหนด / เสร็จแล้ว
- ✅ Real-time sync กับ Firebase Firestore
- ✅ ติ๊กถูกเมื่องานเสร็จ

---

## 🛠️ เทคโนโลยีที่ใช้

- HTML5, CSS3 (Vanilla), JavaScript (ES Modules)
- Firebase Cloud Firestore v9 (Modular SDK)
- Google Fonts: Prompt (Thai)

---

## 🛠️ การแก้ไขปัญหาที่พบบ่อย (Troubleshooting)

### ❌ Error: "The current domain is not authorized for OAuth operations..."
ปัญหานี้เกิดขึ้นเนื่องจาก Firebase ไม่อนุญาตให้ล็อกอินผ่าน IP `127.0.0.1` โดยตรง (อนุญาตเพียง `localhost` เป็นค่าเริ่มต้น)

**วิธีแก้ไข (เลือกอย่างใดอย่างหนึ่ง):**

1. **วิธีที่ง่ายที่สุด (แนะนำ):**
   เปลี่ยน URL ในเว็บเบราว์เซอร์ของคุณจาก:
   `http://127.0.0.1:5500/...` เป็น `http://localhost:5500/...` (หรือพอร์ตอื่นตามที่เครื่องของคุณใช้อยู่) การล็อกอินด้วย Google จะทำงานได้ทันทีโดยไม่ต้องแก้ไขค่าใดๆ ใน Firebase

2. **กรณีต้องการใช้ IP 127.0.0.1:**
   ไปที่ **Firebase Console** -> **Authentication** -> **Settings** -> แท็บ **Authorized domains** -> กดปุ่ม **Add domain** -> พิมพ์ `127.0.0.1` แล้วกดบันทึก

