# 🔔 คู่มือการติดตั้งระบบแจ้งเตือน (FCM) ด้วย Google Apps Script (GAS) ฉบับละเอียดที่สุด

คู่มือนี้จะอธิบายขั้นตอนอย่างละเอียดในการติดตั้งระบบแจ้งเตือนแบบ Push Notification (FCM v1 API) เข้ากับเว็บแอปพลิเคชันของคุณ โดยใช้ **Google Apps Script (GAS)** ทำหน้าที่เป็น Backend Proxy เพื่อความปลอดภัยในการเข้าถึงสิทธิ์ โดยไม่ต้องการเซิร์ฟเวอร์แยกต่างหาก

---

## 📌 แผนผังการทำงานของระบบ (System Architecture)

เนื่องจากเว็บแอปที่เป็น Client Browser ไม่สามารถเรียกใช้งาน FCM v1 REST API หรือ Google Instance ID API ได้โดยตรง (เนื่องจากต้องเก็บข้อมูล Private Key ซึ่งไม่ปลอดภัยหากอยู่บนเบราว์เซอร์) เราจึงส่งผ่านข้อมูลไปยัง GAS ในการทำงานดังนี้:

```mermaid
sequenceDiagram
    participant Browser as หน้าเว็บ (Client Browser)
    participant SW as Service Worker (Background)
    participant Firestore as Firebase Cloud Firestore
    participant GAS as Google Apps Script (Backend Proxy)
    participant FCM as Firebase Cloud Messaging (v1 API)

    Note over Browser, SW: 1. ขอสิทธิ์และเปิดใช้งานการแจ้งเตือน
    Browser->>Browser: ขออนุญาตแจ้งเตือน (Notification.requestPermission())
    Browser->>SW: รับ FCM Token (Registration Token) จาก Firebase
    
    Note over Browser, GAS: 2. สมัครรับข้อมูลกลุ่ม (Topic Subscription)
    Browser->>GAS: HTTP POST (action: "subscribeToTopic", token, topic: "all_users")
    GAS->>GAS: ขอ Google OAuth2 Access Token (JWT Bearer Flow)
    GAS->>FCM: POST เข้า Google Instance ID (iid.googleapis.com) เพื่อผูก Token เข้ากับกลุ่ม
    GAS-->>Browser: ยืนยันสมัครกลุ่มสำเร็จ
    Browser->>Firestore: บันทึก FCM Token ลง users/{uid}/fcmToken และ notificationsEnabled: true

    Note over Browser, GAS: 3. เมื่อแอดมินส่งข้อความ/เพิ่มการบ้านใหม่
    Browser->>GAS: HTTP POST (action: "sendNotification", title, body, topic: "all_users")
    GAS->>GAS: ขอ Google OAuth2 Access Token
    GAS->>FCM: POST ข้อความแจ้งเตือนหาเป้าหมาย (fcm.googleapis.com/v1/projects/.../messages:send)
    FCM->>SW: ส่ง Push Notification (Background Stream)
    SW->>Browser: แสดงป้าย Banner แจ้งเตือนบนเครื่องผู้ใช้
```

---

## 🛠️ ขั้นตอนที่ 1: การเตรียม Firebase Credentials (Service Account)
ในโปรเจกต์ของคุณมีไฟล์ข้อมูลความลับ Firebase Admin SDK อยู่แล้วในโฟลเดอร์งาน:
👉 `d:\homework\homework-4-6bc0f-firebase-adminsdk-fbsvc-cb78eda217.json`

ให้เปิดไฟล์นี้ขึ้นมาเพื่อเตรียมนำข้อมูลไปกรอกใน Google Apps Script ในขั้นตอนถัดไป:
```json
{
  "type": "service_account",
  "project_id": "homework-4-6bc0f",
  "private_key_id": "cb78eda2174b89b16374bb597ee0b4c1e5253d20",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCpSInP1LdA3f5e...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@homework-4-6bc0f.iam.gserviceaccount.com",
  ...
}
```

---

## 🛠️ ขั้นตอนที่ 2: ติดตั้งสคริปต์ Google Apps Script (GAS)
สคริปต์ตัวนี้ได้รับการเขียนขึ้นมาให้สนับสนุนทั้ง **การอัปโหลดไฟล์ไป Google Drive** และ **การจัดการแจ้งเตือน FCM** (ส่งข้อความ & ลงทะเบียนกลุ่ม) อยู่ในลิงก์สคริปต์ตัวเดียวกัน

1. เปิดเว็บไซต์ [Google Apps Script Editor](https://script.google.com/)
2. สร้างโปรเจกต์สคริปต์ใหม่ หรืออัปเดตจากโปรเจกต์เดิม
3. คัดลอกโค้ดด้านล่างนี้ทั้งหมด นำไปวางในไฟล์รหัสของหน้าสคริปต์:

```javascript
// ============================================================
// Google Apps Script — File Upload & FCM Notification Portal
// ============================================================

// 1. (ตัวเลือก) โฟลเดอร์หลักใน Google Drive ที่บันทึกไฟล์อัปโหลด
var PARENT_FOLDER_ID = ""; 

// 2. ⚠️ ข้อมูล Firebase Service Account (คัดลอกมาจากไฟล์ json ในเครื่องของคุณ)
var FIREBASE_PROJECT_ID = "homework-4-6bc0f"; 
var CLIENT_EMAIL = "firebase-adminsdk-fbsvc@homework-4-6bc0f.iam.gserviceaccount.com";

// ⚠️ คัดลอกตัวอักษร private_key จากไฟล์ .json ทั้งหมดมาใส่ในเครื่องหมายคำพูด (รวมถึง \n และตัวขึ้นบรรทัดใหม่)
var PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\n...ใส่คีย์ยาวๆ ของคุณตรงนี้...\n-----END PRIVATE KEY-----\n";

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    
    // ACTION: UPLOAD (สำหรับอัปโหลดไฟล์ไปที่ Google Drive)
    if (params.action === 'upload') {
      return handleFileUpload(params);
    }
    
    // ACTION: SEND NOTIFICATION (สำหรับยิงแจ้งเตือนผ่าน FCM v1 REST API)
    if (params.action === 'sendNotification') {
      return handleSendNotification(params);
    }
    
    // ACTION: SUBSCRIBE_TOPIC (สำหรับผูก FCM Token เข้ากับกลุ่มเพื่อส่งข้อความกลุ่ม)
    if (params.action === 'subscribeToTopic') {
      return handleSubscribeToTopic(params);
    }
    
    throw new Error('Unsupported action: ' + params.action);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ------------------------------------------------------------
// ฟังก์ชัน: จัดการอัปโหลดไฟล์ไป Google Drive
// ------------------------------------------------------------
function handleFileUpload(params) {
  var folderName = params.folder || 'Homework_Files';
  var parentFolder;
  
  if (PARENT_FOLDER_ID && PARENT_FOLDER_ID.trim() !== "") {
    try {
      parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID.trim());
    } catch (fErr) {
      parentFolder = DriveApp.getRootFolder();
    }
  } else {
    parentFolder = DriveApp.getRootFolder();
  }
  
  var subFolders = parentFolder.getFoldersByName(folderName);
  var targetFolder;
  
  if (subFolders.hasNext()) {
    targetFolder = subFolders.next();
  } else {
    targetFolder = parentFolder.createFolder(folderName);
  }
  
  var decoded = Utilities.base64Decode(params.data);
  var blob = Utilities.newBlob(decoded, params.mimeType, params.fileName);
  var file = targetFolder.createFile(blob);
  
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  var fileId = file.getId();
  var viewUrl = file.getUrl();
  var thumbnailUrl = 'https://lh3.googleusercontent.com/d/' + fileId;
  
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    url: viewUrl,
    thumbnailUrl: thumbnailUrl,
    fileId: fileId
  })).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// ฟังก์ชัน: ส่ง Push Notification (FCM v1 REST API)
// ------------------------------------------------------------
function handleSendNotification(params) {
  if (!FIREBASE_PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY || PRIVATE_KEY.indexOf("...") !== -1) {
    throw new Error("กรุณากรอกข้อมูล Firebase Service Account และ Private Key ในสคริปต์ก่อนใช้งาน");
  }
  
  var accessToken = getGoogleAccessToken();
  
  var fcmMessage = {
    "message": {
      "notification": {
        "title": params.title || "แจ้งเตือนการบ้านใหม่! 📚",
        "body": params.body || "มีข้อความใหม่แจ้งเตือนถึงคุณ"
      },
      "webpush": {
        "headers": {
          "Urgency": "high"
        },
        "notification": {
          "icon": params.icon || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128",
          "click_action": params.clickAction || "http://localhost:5500/"
        }
      }
    }
  };
  
  if (params.token) {
    fcmMessage.message.token = params.token;
  } else if (params.topic) {
    fcmMessage.message.topic = params.topic;
  } else {
    throw new Error("ต้องระบุ 'token' หรือ 'topic' อย่างใดอย่างหนึ่งในการส่งแจ้งเตือน");
  }
  
  var url = "https://fcm.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/messages:send";
  
  var options = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    "payload": JSON.stringify(fcmMessage),
    "muteHttpExceptions": true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var responseText = response.getContentText();
  var responseCode = response.getResponseCode();
  
  if (responseCode !== 200) {
    throw new Error("FCM API error (" + responseCode + "): " + responseText);
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    response: JSON.parse(responseText)
  })).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// ฟังก์ชัน: สมัครสมาชิกกลุ่ม (Topic Subscription via Google Instance ID API)
// ------------------------------------------------------------
function handleSubscribeToTopic(params) {
  if (!FIREBASE_PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY || PRIVATE_KEY.indexOf("...") !== -1) {
    throw new Error("กรุณากรอกข้อมูล Firebase Service Account และ Private Key ในสคริปต์ก่อนใช้งาน");
  }
  if (!params.token || !params.topic) {
    throw new Error("ต้องระบุ 'token' และ 'topic' ในการสมัครเข้ากลุ่ม");
  }
  
  var accessToken = getGoogleAccessToken();
  var topicName = params.topic;
  
  // จัดรูปชื่อหัวข้อตามโครงสร้าง /topics/
  if (topicName.indexOf("/topics/") !== 0) {
    topicName = "/topics/" + topicName;
  }
  
  var url = "https://iid.googleapis.com/iid/v1:batchAdd";
  var payload = {
    "to": topicName,
    "registration_tokens": [params.token]
  };
  
  var options = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + accessToken,
      "Content-Type": "application/json",
      "access_token_auth": "true"
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var responseText = response.getContentText();
  var responseCode = response.getResponseCode();
  
  if (responseCode !== 200) {
    throw new Error("Topic Subscription error (" + responseCode + "): " + responseText);
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: "สมัครรับการแจ้งเตือนกลุ่ม " + topicName + " สำเร็จ",
    response: JSON.parse(responseText)
  })).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// ฟังก์ชันช่วย: สร้าง Google Access Token ด้วยการลงลายเซ็น RSA (OAuth2 JWT Flow)
// ------------------------------------------------------------
function getGoogleAccessToken() {
  var header = JSON.stringify({
    "alg": "RS256",
    "typ": "JWT"
  });
  
  var now = Math.floor(Date.now() / 1000);
  var claimSet = JSON.stringify({
    "iss": CLIENT_EMAIL,
    "scope": "https://www.googleapis.com/auth/firebase.messaging",
    "aud": "https://oauth2.googleapis.com/token",
    "exp": now + 3600,
    "iat": now
  });
  
  var toSign = Utilities.base64EncodeWebSafe(header) + "." + Utilities.base64EncodeWebSafe(claimSet);
  
  // จัดฟอร์แมต Key ให้ถูกต้องโดยอัตโนมัติก่อนเข้ารหัสลายเซ็น
  var formattedKey = cleanPrivateKey(PRIVATE_KEY);
  
  Logger.log("--- รายละเอียดของ Key ก่อน Sign ---");
  Logger.log("1. ความยาว PRIVATE_KEY (ดิบ): " + (PRIVATE_KEY ? PRIVATE_KEY.length : 0));
  Logger.log("2. ความยาว formattedKey (ล้างแล้ว): " + (formattedKey ? formattedKey.length : 0));
  if (formattedKey) {
    var lines = formattedKey.split('\n');
    Logger.log("3. บรรทัดแรก: " + lines[0]);
    Logger.log("4. บรรทัดที่สอง (แรกสุดของ Base64): " + (lines[1] ? lines[1].substring(0, 20) + "..." : "ไม่มี"));
    Logger.log("5. บรรทัดสุดท้าย: " + lines[lines.length - 1]);
  }
  
  var signatureBytes = Utilities.computeRsaSha256Signature(toSign, formattedKey);
  var signature = Utilities.base64EncodeWebSafe(signatureBytes);
  var jwt = toSign + "." + signature;
  
  var options = {
    "method": "post",
    "payload": {
      "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
      "assertion": jwt
    },
    "muteHttpExceptions": true
  };
  
  var response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", options);
  var responseData = JSON.parse(response.getContentText());
  
  if (responseData.error) {
    throw new Error("OAuth2 failed: " + responseData.error_description);
  }
  
  return responseData.access_token;
}

// ------------------------------------------------------------
// ฟังก์ชันช่วย: จัดรูปแบบคีย์ลับ RSA ให้ถูกต้องตามมาตรฐาน PKCS#8 ป้องกันบัคเรื่อง newline / space
// ------------------------------------------------------------
function cleanPrivateKey(rawKey) {
  if (!rawKey) return "";
  
  // 1. แปลงคำว่า \n (ที่เป็นตัวอักษร) ให้เป็นขึ้นบรรทัดใหม่จริงๆ
  var cleaned = rawKey.replace(/\\n/g, '\n');
  
  // 2. ตัดเครื่องหมายขึ้นบรรทัดของ Windows (\r) ออก
  cleaned = cleaned.replace(/\r/g, '');
  
  // 3. เอาส่วนหัวและท้ายของ PEM Key ออกชั่วคราวเพื่อเอาเฉพาะ Base64 Body
  var body = cleaned;
  body = body.replace('-----BEGIN PRIVATE KEY-----', '');
  body = body.replace('-----END PRIVATE KEY-----', '');
  
  // เอาเว้นวรรค ขึ้นบรรทัดใหม่ และ tab ออกทั้งหมดจาก body
  body = body.replace(/\s+/g, '');
  
  // 4. ประกอบคีย์กลับเข้ามาใหม่โดยขึ้นบรรทัดใหม่ทุกๆ 64 ตัวอักษรตามมาตรฐาน PEM
  var lines = [];
  lines.push('-----BEGIN PRIVATE KEY-----');
  for (var i = 0; i < body.length; i += 64) {
    lines.push(body.substring(i, i + 64));
  }
  lines.push('-----END PRIVATE KEY-----');
  
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------
// ฟังก์ชันสำหรับรันทดสอบการส่งผ่านปุ่ม Run (เรียกใช้) ใน GAS Editor
// ------------------------------------------------------------
function testSendNotification() {
  // FCM Token ของเครื่องคุณในการทดสอบ
  var testToken = "eFX8CEs7z9uIpFffH9DLoW:APA91bGwniFPGeiM89YCstM4pWdRBSy7VLDTsmxigBD9j5ZSmerWc7IbMu834FSkxoi0LttbMtwz74_G2EF0IkJcf05SsUjASNNRKB3zjkevzrvtC-om7Bs";
  
  Logger.log("--- เริ่มรันการทดสอบส่ง Push Notification ---");
  
  // ตรวจสอบและเปรียบเทียบ SHA-256 Hash ของคีย์ที่ก๊อปวาง
  try {
    var cleanedBody = PRIVATE_KEY.replace(/\\n/g, '\n').replace(/\r/g, '');
    cleanedBody = cleanedBody.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '');
    cleanedBody = cleanedBody.replace(/\s+/g, '');
    
    // คำนวณ SHA-256 Hash ใน Apps Script
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cleanedBody, Utilities.Charset.US_ASCII);
    var hashHex = "";
    for (var i = 0; i < digest.length; i++) {
      var val = digest[i];
      if (val < 0) val += 256;
      var byteString = val.toString(16);
      if (byteString.length == 1) byteString = "0" + byteString;
      hashHex += byteString;
    }
    
    Logger.log("🔎 ข้อมูลวิเคราะห์ความถูกต้องของ Key:");
    Logger.log("  - ความยาวของ Base64 Body: " + cleanedBody.length + " ตัวอักษร (ค่าที่ถูกต้องคือ 1624)");
    Logger.log("  - SHA-256 ของคีย์ที่วาง: " + hashHex);
    Logger.log("  - SHA-256 ที่คาดหวัง: b6298a92ee3714549d19980ab0ef03ec14f61947ffe193d19163e0080922ff36");
    
    if (hashHex === "b6298a92ee3714549d19980ab0ef03ec14f61947ffe193d19163e0080922ff36") {
      Logger.log("  ✅ ผลลัพธ์: คีย์ถูกต้องตรงกัน 100%");
    } else {
      Logger.log("  ❌ ผลลัพธ์: คีย์ไม่ตรงกัน! มีบางตัวอักษรขาดหายหรือผิดพลาดตอนคัดลอก");
    }
  } catch (err) {
    Logger.log("  ❌ เกิดข้อผิดพลาดในการตรวจสอบคีย์: " + err.toString());
  }
  
  var testParams = {
    action: "sendNotification",
    title: "ทดสอบผ่านระบบบอร์ด GAS 🔔",
    body: "การตั้งค่าระบบแจ้งเตือนสำเร็จแล้ว ยินดีด้วยครับ! 🎉",
    token: testToken
  };
  
  try {
    var responseOutput = handleSendNotification(testParams);
    Logger.log("✅ ส่งแจ้งเตือนสำเร็จ!");
    Logger.log("ผลลัพธ์จาก API: " + responseOutput.getContent());
  } catch (error) {
    Logger.log("❌ เกิดข้อผิดพลาดในการส่ง: " + error.toString());
  }
}
```

### 🚀 วิธีการ Deploy สคริปต์เพื่อรับลิงก์ URL (ทำตามทุกขั้นตอน)
1. ในหน้าสคริปต์ ให้กดปุ่ม **บันทึก (Save)** (รูปแผ่นดิสก์)
2. คลิกปุ่ม **การทำให้ใช้งานได้ (Deploy)** -> เลือก **การทำให้ใช้งานได้ใหม่ (New deployment)**
3. คลิกปุ่มเฟืองตั้งค่าข้างประเภทของการทำให้ใช้งานได้ -> เลือก **เว็บแอป (Web app)**
4. ตั้งค่าหน้าต่างข้อความดังนี้:
   * **คำอธิบาย (Description):** `FCM & File Upload Backend API`
   * **เรียกใช้ในฐานะ (Execute as):** เลือก **ฉัน (อีเมลแอดมินของคุณ)**
   * **ผู้ที่เข้าถึงได้ (Who has access):** เลือก **ทุกคน (Anyone)** (เพื่ออนุญาตให้ Javascript ฝั่ง Client สามารถยิง API มาได้)
5. กดปุ่ม **การทำให้ใช้งานได้ (Deploy)**
6. คลิก **ให้สิทธิ์เข้าถึง (Authorize access)** -> เลือกบัญชี Google ของคุณ -> ระบบจะฟ้องว่าสคริปต์ไม่ปลอดภัย ให้คลิก **ขั้นสูง (Advanced)** -> คลิก **ไปที่โปรเจกต์ที่ยังไม่ได้ตั้งชื่อ (ไม่ปลอดภัย) / Go to ... (unsafe)** -> กด **อนุญาต (Allow)**
7. ระบบจะประมวลผลและให้ **URL เว็บแอป (Web App URL)** ที่ลงท้ายด้วย `/exec`
8. คัดลอกลิงก์นั้น ไปกรอกแทนค่า `GAS_ENDPOINT` ในไฟล์ [config/firebase.config.js](file:///d:/homework/config/firebase.config.js) ในเครื่องของคุณ:
   ```javascript
   export const GAS_ENDPOINT = "คัดลอกลิงก์ที่ลงท้ายด้วย /exec มาวางตรงนี้";
   ```

---

## 🛠️ ขั้นตอนที่ 3: ตั้งค่าสิทธิ์ใน Firebase Console แบบละเอียด

เพื่อให้สคริปต์ (GAS) และโปรเจกต์เว็บแอปพลิเคชันของคุณสามารถส่งและรับสตรีมการแจ้งเตือน Push Notification ได้อย่างราบรื่น คุณต้องตั้งค่าเปิดใช้งานสิทธิ์การสื่อสารและสิทธิ์ของบัญชีบริการ (Service Account) ในระบบ Firebase Console และ Google Cloud Console ตามรายละเอียด 3 ส่วนหลักดังต่อไปนี้:

### 3.1 การเปิดใช้งาน Firebase Cloud Messaging API (v1) บน Google Cloud Console
เนื่องจากระบบแจ้งเตือนแบบใหม่ของ Google (FCM v1 REST API) จะถูกปิดการใช้งานเป็นค่าเริ่มต้นในโปรเจกต์ใหม่ เพื่อความปลอดภัย คุณจำเป็นต้องเข้าไปกดยินยอมเปิดใช้บริการผ่านทาง Google Cloud Console:

1. เปิดเว็บไซต์ [Firebase Console](https://console.firebase.google.com/)
2. เลือกโปรเจกต์ของคุณ **`homework-4-6bc0f`**
3. มองหาแถบเมนูด้านซ้ายบน คลิกที่ **รูปฟันเฟือง (Settings)** -> เลือกคลิกที่ **General (ทั่วไป)**
4. เมื่อหน้าจอหลักโหลดแล้ว ให้สังเกต **แถวแท็บแนวนอนที่อยู่ด้านบนสุดของหน้าหลัก** (ไม่ใช่แถบเมนูข้างซ้าย) แล้วคลิกเลือกแท็บ **Cloud Messaging (การรับส่งข้อความบนคลาวด์)**
5. ค้นหาหัวข้อ **Firebase Cloud Messaging API (V1)**
   * **กรณีที่สถานะเป็น "Enabled":** แสดงว่าระบบได้ถูกเปิดใช้งานแล้ว สามารถข้ามข้อนี้ไปทำขั้นตอนถัดไปได้เลย
   * **กรณีที่สถานะเป็น "Disabled" หรือไม่แสดงค่าใช้งาน:** 
     * ให้คลิกปุ่ม **สามจุดแนวตั้ง (`⋮`)** ที่อยู่ด้านขวามือของหัวข้อนั้น -> เลือกคลิกที่ลิงก์ **Manage API in Google Cloud Console**
     * ระบบจะนำคุณเปิดหน้าต่างใหม่ไปยังแดชบอร์ด Google Cloud Console (APIs & Services)
     * ตรวจสอบชื่อโปรเจกต์ด้านบนว่าคือ **`homework-4-6bc0f`** หรือไม่ จากนั้นกดปุ่มสีน้ำเงิน **"Enable" (เปิดใช้งาน)**
     * เมื่อเปิดใช้งานสำเร็จ หน้าจอจะเปลี่ยนสถานะเป็นข้อมูลกราฟการใช้งาน ให้ปิดหน้าต่าง Google Cloud คอนโซลนั้นลงได้เลย
5. **(สำคัญเพิ่มเติม)** แนะนำให้เข้าลิงก์ของ [Firebase Installations API](https://console.cloud.google.com/apis/library/firebaseinstallations.googleapis.com) ใน Google Cloud Console และตรวจสอบให้แน่ใจว่า API นี้อยู่ในสถานะ **Enabled (เปิดใช้งาน)** ด้วยเช่นกัน เนื่องจากจำเป็นสำหรับระบบ FCM v1 ในการจัดสรรไอดีเครื่องผู้รับแจ้งเตือน

---

### 3.2 ตรวจสอบและกำหนดสิทธิ์ IAM (IAM & Admin) ให้กับ Service Account
สคริปต์ Google Apps Script (GAS) ทำงานเสมือนเป็น Backend Service นอกโครงข่าย Firebase โดยอาศัยไฟล์ JSON คีย์ลับ (`homework-4-6bc0f-firebase-adminsdk-fbsvc-cb78eda217.json`) ในการขอ Access Token ผ่านกระบวนการ OAuth2 JWT Flow ดังนั้นสิทธิ์ในการเรียก API จึงผูกติดอยู่กับตัวอีเมลผู้ให้บริการ (Service Account) นี้:

1. เข้าไปยังหน้าบริการจัดการสิทธิ์ [Google Cloud IAM & Admin Console](https://console.cloud.google.com/iam-admin/iam)
2. ตรวจสอบให้แน่ใจว่าโปรเจกต์ที่เลือกคือ **`homework-4-6bc0f`**
3. ค้นหาแถวรายการที่เป็นที่อยู่ของ Service Account หลักของคุณ:
   `firebase-adminsdk-fbsvc@homework-4-6bc0f.iam.gserviceaccount.com`
4. ตรวจสอบว่าในคอลัมน์ **Role (บทบาท)** บัญชีบริการดังกล่าวได้รับสิทธิ์อย่างน้อยข้อใดข้อหนึ่งในนี้หรือไม่:
   * **Firebase Admin** (หรือ **Firebase SDK Admin Service Agent**) - *สิทธิ์นี้จะครอบคลุมครอบจักรวาลและพร้อมใช้ส่ง FCM ทันที*
   * หากมีสิทธิ์ข้างต้นอยู่แล้ว **ไม่ต้องดำเนินการเพิ่มเติมใดๆ**
5. **กรณีที่ไม่พบสิทธิ์ หรือต้องการเพิ่มเพื่อความปลอดภัยสูงขึ้น:**
   * คลิกที่ปุ่ม **แก้ไข (รูปดินสอ)** ท้ายแถวของอีเมลบริการดังกล่าว หรือกดปุ่ม **+ GRANT ACCESS (ให้สิทธิ์เข้าถึง)** ด้านบนสุด
   * ในหัวข้อ **Select a role (เลือกบทบาท)** ให้กรองค้นหาคำว่า:
     👉 **Firebase Cloud Messaging API Admin** (ชื่อรหัสระบบ: `roles/firebasecloudmessaging.admin`)
   * คลิกเลือกบทบาทนั้นและกดปุ่ม **Save (บันทึก)** เพื่อยินยอมสิทธิ์สากลในการเข้าถึง REST API

---

### 3.3 สร้างคู่คีย์ Web Push Certificates (VAPID Key) และติดตั้งลงในโค้ด
VAPID (Voluntary Application Server Identification) เป็นโปรโตคอลความปลอดภัยระดับเว็บที่ทำให้เว็บเบราว์เซอร์ (Chrome, Edge, Safari, Firefox) ยอมรับการร้องขอส่งข้อมูล Push Service จาก Firebase เพื่อป้องกันข้อความขยะ/การฟิชชิ่ง:

1. ย้อนกลับไปหน้า **Firebase Console** -> แท็บ **Cloud Messaging (การรับส่งข้อความบนคลาวด์)**
2. เลื่อนหน้าจอลงมาด้านล่างสุด หาหัวข้อย่อยที่ชื่อว่า **Web Push Certificates (ใบรับรองการผลักดันข้อมูลเว็บ)**
3. หากระบบขึ้นว่ายังไม่มีการสร้างคีย์ ให้คลิกปุ่ม **Generate key pair (สร้างคู่คีย์)**
4. ระบบจะสร้างบรรทัดคีย์และแสดงสายอักขระยาวๆ (เช่น `BFgD4vG-Rj5...`) เรียกว่า **Key pair** หรือ **VAPID Key (Public Key)**
5. คลิกปุ่มคัดลอก (Copy) คีย์ดังกล่าวนั้นเก็บไว้
6. นำคีย์นี้ไปเพิ่มในโค้ดฝั่ง Client ของคุณ เพื่อบังคับใช้การส่งขออนุญาตจากบราวเซอร์อย่างปลอดภัย โดยเปิดไฟล์ **[js/firebase.js](file:///d:/homework/js/firebase.js)**
7. ค้นหาฟังก์ชัน `requestAndSaveNotificationPermission(uid)` ตรงจุดที่เรียกใช้งานคำสั่ง `getToken(...)` แล้วนำไปอัปเดตแทนที่คอมเมนต์เดิมดังนี้:

```javascript
    // ลงทะเบียน Service Worker และดึง token เพื่อระบุเครื่องรับการแจ้งเตือน
    let registration;
    if ('serviceWorker' in navigator) {
      registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(() => null);
    }
    const fcmToken = await getToken(messaging, {
      serviceWorkerRegistration: registration || undefined,
      vapidKey: 'คัดลอก VAPID Key ที่ได้จาก Firebase Console มาวางตรงนี้ทั้งหมด'
    });
```

> [!NOTE]
> การใส่คีย์ VAPID Key (Public Key) ในฟังก์ชัน `getToken()` เป็นสิ่งสำคัญมาก เพื่อให้แน่ใจว่าเว็บเบราว์เซอร์จะได้รับ FCM Token ที่ถูกต้อง ป้องกันปัญหาการปฏิเสธการเชื่อมต่อ (Unauthorized / Access Denied) เมื่อนำ Token ดังกล่าวส่งยิงจากระบบหลังบ้าน GAS ไปยัง FCM v1 API

---

## 🛠️ ขั้นตอนที่ 4: สร้างไฟล์ Service Worker (`firebase-messaging-sw.js`)
Service Worker ทำหน้าที่เปรียบเสมือนเบื้องหลังของระบบคอยรับฟังการแจ้งเตือน Push Notification จาก Firebase แม้ว่าผู้ใช้จะไม่ได้เปิดหน้าเว็บขึ้นมาอยู่ก็ตาม

สร้างไฟล์ใหม่ขึ้นมาที่**โฟลเดอร์ระดับนอกสุดของโปรเจกต์ (Root Directory)** (เคียงข้างไฟล์ `index.html` ของคุณ) ตั้งชื่อไฟล์ว่า **`firebase-messaging-sw.js`** และวางโค้ดด้านล่างนี้ลงไป:

> [!IMPORTANT]
> ชื่อไฟล์ต้องตรงตามนี้สะกดทุกตัวอักษร และต้องนำไปวางไว้ที่โฟลเดอร์ราก (Root) เท่านั้น ห้ามนำไปใส่ในโฟลเดอร์ย่อย เช่น `js/` มิฉะนั้นบราวเซอร์จะไม่สามารถลงทะเบียนเปิดสิทธิ์ใช้งานระบบได้

```javascript
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

// ดักฟังการคลิกบนป้ายแบนเนอร์แจ้งเตือนแล้วส่งผู้ใช้งานเข้าหน้าแอป
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.click_action || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // ค้นหาแท็บเดิมที่เปิดทิ้งไว้แล้วโฟกัสไปที่หน้านั้น
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // หากยังไม่ได้เปิดหน้าเว็บให้ทำการสั่งเปิดหน้าใหม่ขึ้นมาทันที
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
```

---

## 🛠️ ขั้นตอนที่ 5: เขียนโค้ดเชื่อมต่อระบบในหน้าเว็บหลัก (Frontend Setup)

เราต้องนำเข้าบริการและเขียนฟังก์ชันการขออนุญาตจากผู้ใช้งานระบบและลงทะเบียนรับส่งข้อความ

### 1. เขียนฟังก์ชันขอสิทธิ์และลงทะเบียนเข้ากลุ่มในไฟล์ [js/firebase.js](file:///d:/homework/js/firebase.js)
เปิดไฟล์ `js/firebase.js` แล้วนำโค้ดด้านล่างไปใส่เพิ่มที่บรรทัดล่างสุดของไฟล์:

```javascript
// นำเข้าเพิ่มเติมที่บรรทัดบนสุดของไฟล์ js/firebase.js
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

export const messaging = getMessaging(app);

/**
 * ขออนุญาตแจ้งเตือนจากบราวเซอร์ ลงทะเบียน Token บันทึกใน Firestore
 * และผูก Token เข้ากับกลุ่ม Topic: "all_users" ผ่านการแจ้งเตือนทางหลังบ้าน GAS
 */
export async function requestAndSaveNotificationPermission(uid) {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('❌ บราวเซอร์ปฏิเสธสิทธิ์การแจ้งเตือน หรือถูกผู้ใช้ปิดกั้น');
      return null;
    }
    
    console.log('🔔 ได้รับการยอมรับสิทธิ์ในการส่งการแจ้งเตือน');
    
    // ลงทะเบียน Service Worker และดึง token เพื่อระบุเครื่องรับการแจ้งเตือน
    let registration;
    if ('serviceWorker' in navigator) {
      try {
        registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
      } catch (err) {
        console.error('Service Worker registration failed:', err);
      }
    }
    const fcmToken = await getToken(messaging, {
      serviceWorkerRegistration: registration || undefined,
      vapidKey: 'ใส่คีย์ VAPID Key ของคุณ'
    });
    
    if (!fcmToken) {
      console.warn('❌ บราวเซอร์ไม่สามารถดึง FCM Token ออกมาได้สำเร็จ');
      return null;
    }
    
    console.log('🔑 FCM Registration Token ได้รับสำเร็จ:', fcmToken);
    
    // บันทึก Token ลงในฐานข้อมูลของแอปพลิเคชัน
    await updateDoc(ref('users', uid), {
      fcmToken: fcmToken,
      notificationsEnabled: true,
      lastTokenUpdatedAt: serverTimestamp()
    });
    
    // 🔗 เรียกใช้งานหลังบ้าน GAS เพื่อสมัคร Token นี้เข้ารับข่าวกลุ่ม 'all_users' (เพื่อยิงทีเดียวส่งหาทุกคนได้)
    if (GAS_ENDPOINT) {
      await fetch(GAS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'subscribeToTopic',
          token: fcmToken,
          topic: 'all_users'
        })
      });
      console.log('🔗 สมัครเข้ากลุ่มรับพุชเรียบร้อยแล้ว');
    }
    
    return fcmToken;
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาดในการลงทะเบียนรับพุชแจ้งเตือน:', error);
    return null;
  }
}

/**
 * ฟังก์ชันพอร์ทอลในการส่งผ่านข้อมูลแจ้งเตือนไปยังผู้ใช้กลุ่มหลัก
 */
export async function triggerPushNotification({ title, body, token = null, topic = null, clickAction = '/' }) {
  if (!GAS_ENDPOINT) {
    console.warn('ยังไม่ได้ระบุ GAS_ENDPOINT ในระบบ ข้ามการส่ง');
    return;
  }
  
  try {
    const payload = {
      action: 'sendNotification',
      title: title,
      body: body,
      clickAction: clickAction
    };
    
    if (token) {
      payload.token = token;
    } else if (topic) {
      payload.topic = topic;
    } else {
      payload.topic = 'all_users'; // หากไม่ได้ระบุให้พยายามส่งหาทุกคน
    }
    
    const response = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    return result;
  } catch (err) {
    console.error('❌ ยิงแจ้งเตือนผ่าน API ไม่สำเร็จ:', err);
  }
}
```

### 2. กำหนดเงื่อนไขขอสิทธิ์แจ้งเตือนผู้ใช้งานเมื่อล็อกอินสำเร็จใน [js/app.js](file:///d:/homework/js/app.js)
ในไฟล์ `js/app.js` ค้นหาระบบตรวจจับสถานะผู้ใช้ `auth.onAuthStateChanged(...)` และเสริมฟังก์ชันลงไป:

```javascript
// ใน js/app.js แถวๆ ส่วนตรวจสถานะล็อกอิน
auth.onAuthStateChanged(async (user) => {
  if (user) {
    // โหลดบอร์ดแสดงผลการบ้าน...
    
    // เรียกขออนุญาตรับการแจ้งเตือนหลังจากเปิดหน้าเว็บไปแล้ว 3 วินาที
    setTimeout(async () => {
      try {
        const { requestAndSaveNotificationPermission } = await import('./firebase.js');
        await requestAndSaveNotificationPermission(user.uid);
      } catch (err) {
        console.error('เรียกขอเปิดสิทธิ์แจ้งเตือนล้มเหลว:', err);
      }
    }, 3000);
  }
});
```

---

## 🛠️ ขั้นตอนที่ 6: เรียกยิงแจ้งเตือนเวลาที่มีการบ้านใหม่
เมื่อผู้ใช้อำนาจ Admin ทำการเพิ่มรายการการบ้านใหม่ลงในตาราง ให้ส่งสัญญาณไปแจ้งเตือนทุกคนที่กดเปิดรับพุชแจ้งเตือนไว้

เปิดไฟล์ [js/app.js](file:///d:/homework/js/app.js) และไปค้นหาแถวๆ ฟังก์ชันส่งฟอร์มข้อมูล `hw-form`submit ในบรรทัดที่ 670-685 และทำการเรียกใช้งาน:

```javascript
// ... โค้ดหลังจากสร้างข้อมูลการบ้านใหม่สำเร็จ
} else {
  // บันทึกลงฐานข้อมูล Firestore
  await addHomework({ description, subjectId, subjectName, dueDate, assignedTo, attachments: uploadedFiles, createdBy: getUid() });
  showToast('เพิ่มการบ้านเรียบร้อยแล้ว');
  
  // 🔥 สั่งส่งพุชแจ้งเตือนไปยังนักเรียนทุกคนในระบบผ่าน GAS
  try {
    const { triggerPushNotification } = await import('./firebase.js');
    await triggerPushNotification({
      title: `📚 มีการบ้านใหม่วิชา: ${subjectName}`,
      body: description.length > 50 ? description.substring(0, 50) + "..." : description,
      topic: 'all_users', // แจ้งเตือนไปยังกลุ่มที่ติดตามไว้ทุกคน
      clickAction: window.location.origin // ลิงก์ปลายทางเมื่อเปิดแบนเนอร์แจ้งเตือน
    });
  } catch (pushErr) {
    console.error('ไม่สามารถส่งพุชแจ้งเตือนได้:', pushErr);
  }
}
// ... โค้ดปิดการทำฟอร์ม
```

---

## 🔒 ขั้นตอนที่ 7: ปรับปรุง Firestore Rules
เพื่อให้ผู้ใช้สามารถเขียนข้อมูล FCM Token ของตนเองลงในหน้าโปรไฟล์ได้อย่างปลอดภัย ป้องกันไม่ให้แฮกเกอร์เข้ามาแก้ไข ให้ตั้งค่า Rules ในหน้า **Firestore Database -> Rules** ดังนี้:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // กฎป้องกันเอกสารข้อมูลผู้ใช้
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    
    // ปลดสิทธิ์อื่นๆ ในระบบ
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

---

## 🧪 วิธีทดสอบการทำงานของแจ้งเตือนในระบบ
1. **เรื่องความปลอดภัยบราวเซอร์**: ระบบพุชแจ้งเตือนถูกควบคุมโดยสิทธิ์ความปลอดภัยสูงของบราวเซอร์ คุณต้องรันโปรเจกต์ผ่านที่อยู่ **`http://localhost:...`** หรือ **`https://...`** เท่านั้น (ห้ามเปิดหน้าไฟล์ตรงๆ ผ่าน `file://...` หรือไอพีอื่นที่ไม่ได้ลงทะเบียนปลดล็อก)
2. **ยินยอมสิทธิ์ (Permission Allow)**: เมื่อเข้าแอปพลิเคชันรอดีเลย์ 3 วินาที จะมีป๊อปอัพขึ้นถามขอส่งแจ้งเตือน ให้กด **อนุญาต (Allow)**
3. **ตรวจสอบ Token ใน Firestore**: เปิด Firebase Console -> Firestore Database ดูในเอกสาร `users/{uid}` ของบัญชีคุณ จะพบฟิลด์ `fcmToken` ปรากฏพร้อมค่า Token ยาวๆ และมีการเรียก API ไปยังกลุ่ม `all_users` ขึ้นแสดงใน Log
4. **ส่งแจ้งเตือน**: เข้าใช้งานในฐานะผู้ควบคุมระบบ (Admin) กดปุ่ม "เพิ่มการบ้านใหม่" และกดบันทึก ข้อมูลจะวิ่งไปปลุก Service Worker และบราวเซอร์ของคุณจะมีป้ายแจ้งเตือนพร้อมสัญลักษณ์ Banner เด้งขึ้นมาเตือนทันที!
