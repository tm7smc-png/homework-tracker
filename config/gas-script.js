// ============================================================
// Google Apps Script — File Upload & FCM Notification Portal
// (เวอร์ชันอัปเดต: ใช้ Trigger ภายใน .gs ตรวจสอบเวลารายนาทีแบบข้ามการเช็คส่งซ้ำชั่วคราว)
// ============================================================

// 1. โฟลเดอร์หลักใน Google Drive ที่บันทึกไฟล์อัปโหลด
var PARENT_FOLDER_ID = "1-mDI7bz2-5sOEQF97aD-KhClnh1JkwdG";

// 2. ข้อมูล Firebase Service Account
var FIREBASE_PROJECT_ID = "homework-4-6bc0f";
var CLIENT_EMAIL = "firebase-adminsdk-fbsvc@homework-4-6bc0f.iam.gserviceaccount.com";

// คีย์ลับเวอร์ชันแก้บัค (ตัดตัวอักษร n เกินออกเรียบร้อยแล้ว)
var PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCpSInP1LdA3f5e
/Ng0xIifWdwz+cbLkV0Li54+x3maobMfFBoSoOzfVhZNrVk1KgtQsoFAv5WBQhui
5uMIH6mtLJynz9wfcBqDEypGIBstsGRK2rRgcb74FKw37bw6H97fUAh5KQsQbKLR
wDPRRk0uwwoDS16tkMb+W73DLEx25fi/YIMWbN0vHBo5y1XwXQXdWFy4DsnzX9NM
6TOOMEBwX81NkKQEI3OmzC7scHRoqJoDxGNS/dTgOYHDt8uVf+KsD8Z2TFHB10PB
rrD4RoHsM+dQd0XwVyfhKcBNb/xh41EooBAzxmGyRhOIyFB58+VtRGtmGGGxnIhn
K8qEfXYtAgMBAAECggEAFAp/LEBv6IlPj9HJy+d3kDv8dpfLyfZd6FvBYofNlPmv
Qc7orktod6FStyP+Y22klMtpQ2/bBIg9ytmgR6ot9Y9KRZC1a/Bi5yEp+E7dQNm4
6ea+A4v70pVp9R4bUltLEK+CLUvnYCyoUwI48D3tLcvP3+d4oD47XMoiK1zPeaTb
XCCRl9BWJs8QTteq8wHFKtxxBQY+Izpqi5dxPDfaPqiWra687/uVDCqbSyKDABWC
Q/d058nHUAggHO4OXz8jdu8ytssPi8MEtNLllHUUGBJvUMBsJ+4l/KgogmxvN6tY
DdVV5Nn239078VWIA9LPlm1VZwmv3370bbNm4ngesQKBgQDdvzbEvLzDp54YCPWt
ftguoFXdjsUNVCAMViOtHTqCywyAo6h/RFlSY5Z9cijv4zvj9St8GQNnsHy4kzs8
u8BweXKsaLrFx+VauDTvCc0JW4dYuScCaRDXQSZtFnquggb5etUIRsUKy9YtM8v5
YoRu8K2yAAHoFCSju4kl5MXe/QKBgQDDbrLdEHdO5vKqswigKgcqUL7T8W1VRCPQ
K1deabsq6qlhbNPbHRDYcU6SpOP99MY08siNX3zLcWZI4vFVeHQWNqZzcewKd/Nl
aJ0B9HU2gREDldAKPMlh0EnDj1qLcq2fWK+lVrvxiXICcQQMrRTtbx8EBW8pCyQj
Tmv5y+fS8QKBgQDBzx5PVaamWxoSZ8JSoUrRddGWk/ImdCCOp7sG00UQi+ehh2j9
0v8+w0wE2IJvKGxwERiwniwbtGVN7WEY9AB+TaesiNy1gME1SUr6odZTF2x0X194
+9t8R7UOI1eWro7p/jGzyibuCLppR5w/m5ukWzd1HAyOiwx7Dq4QMKPBAQKBgQCA
Ak9YK4Pqg62pj9Fzj3PYDMGh875onlRS80CsD9dQGhrOPMlb+WLiUv1jYmwQGTeG
0Qv6RfRpEaMs1LG9CUQIlM1cSt+QT9d2sho9gJESHWI2lfeJ7Rz/W74lQQ3Oz1PY
Tu/l/bTnVd7+qGY9o1VU3HdVW/XezXRjR+fD3ALCEQKBgDOb0XQsppBYLtmpwuQV
hXaKvXtClw8C3dbFRUqncnt6yJW2h3vhgt/mgb27lLns+y1O0LbT8zo91pjs7Kpu
PbXt2S6+a1LREQyAMeQN7ekzazeJoOHNMzO8SpFEPTmLK23X7KIOsF2A3IIIeqJl
sQXILwf/jAOXC1kAYAm0rNJi
-----END PRIVATE KEY-----`;

function doGet(e) {
  try {
    checkAndSendDailySummaries();
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "Daily summaries checked successfully."
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    if (params.action === 'upload') {
      return handleFileUpload(params);
    }
    if (params.action === 'sendNotification') {
      return handleSendNotification(params);
    }
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

function handleFileUpload(params) {
  var folderName = params.folder || 'Homework_Files';
  var parentFolder;
  if (PARENT_FOLDER_ID && PARENT_FOLDER_ID.trim() !== "") {
    try { parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID.trim()); } catch (fErr) { parentFolder = DriveApp.getRootFolder(); }
  } else { parentFolder = DriveApp.getRootFolder(); }
  var subFolders = parentFolder.getFoldersByName(folderName);
  var targetFolder = subFolders.hasNext() ? subFolders.next() : parentFolder.createFolder(folderName);
  var decoded = Utilities.base64Decode(params.data);
  var blob = Utilities.newBlob(decoded, params.mimeType, params.fileName);
  var file = targetFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    url: file.getUrl(),
    thumbnailUrl: 'https://lh3.googleusercontent.com/d/' + file.getId(),
    fileId: file.getId()
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleSendNotification(params) {
  if (!FIREBASE_PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY || PRIVATE_KEY.indexOf("...") !== -1) {
    throw new Error("กรุณากรอกข้อมูล Firebase Service Account และ Private Key");
  }
  var accessToken = getGoogleAccessToken();
  var fcmMessage = {
    "message": {
      "notification": {
        "title": params.title || "แจ้งเตือนการบ้านใหม่! 📚",
        "body": params.body || "มีข้อความใหม่แจ้งเตือนถึงคุณ"
      },
      "webpush": {
        "headers": { "Urgency": "high" },
        "notification": {
          "icon": params.icon || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128",
          "click_action": params.clickAction || "http://localhost:5500/"
        }
      }
    }
  };
  if (params.token) fcmMessage.message.token = params.token;
  else if (params.topic) fcmMessage.message.topic = params.topic;
  else throw new Error("ต้องระบุ token หรือ topic");
  var response = UrlFetchApp.fetch("https://fcm.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/messages:send", {
    "method": "post",
    "headers": { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
    "payload": JSON.stringify(fcmMessage),
    "muteHttpExceptions": true
  });
  if (response.getResponseCode() !== 200) throw new Error("FCM error: " + response.getContentText());
  return ContentService.createTextOutput(JSON.stringify({ success: true, response: JSON.parse(response.getContentText()) })).setMimeType(ContentService.MimeType.JSON);
}

function handleSubscribeToTopic(params) {
  if (!FIREBASE_PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY || PRIVATE_KEY.indexOf("...") !== -1) throw new Error("ขาดคีย์สำคัญ");
  var accessToken = getGoogleAccessToken();
  var topicName = params.topic.indexOf("/topics/") === 0 ? params.topic : "/topics/" + params.topic;
  var response = UrlFetchApp.fetch("https://iid.googleapis.com/iid/v1:batchAdd", {
    "method": "post",
    "headers": { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json", "access_token_auth": "true" },
    "payload": JSON.stringify({ "to": topicName, "registration_tokens": [params.token] }),
    "muteHttpExceptions": true
  });
  if (response.getResponseCode() !== 200) throw new Error("Subscription error: " + response.getContentText());
  return ContentService.createTextOutput(JSON.stringify({ success: true, message: "สมัครกลุ่มสำเร็จ" })).setMimeType(ContentService.MimeType.JSON);
}

function getFirestoreUsers(accessToken) {
  var response = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/users?pageSize=300", {
    "method": "get", "headers": { "Authorization": "Bearer " + accessToken }, "muteHttpExceptions": true
  });
  return response.getResponseCode() === 200 ? JSON.parse(response.getContentText()).documents || [] : [];
}

function getFirestoreHomeworks(accessToken) {
  var response = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/homeworks?pageSize=500", {
    "method": "get", "headers": { "Authorization": "Bearer " + accessToken }, "muteHttpExceptions": true
  });
  if (response.getResponseCode() !== 200) return [];
  return (JSON.parse(response.getContentText()).documents || []).map(function (doc) {
    var fields = doc.fields || {};
    var id = doc.name.split("/").pop();
    var assignedTo = "all";
    if (fields.assignedTo) {
      assignedTo = fields.assignedTo.stringValue ? fields.assignedTo.stringValue : (fields.assignedTo.arrayValue?.values?.map(function (v) { return v.stringValue; }) || "all");
    }
    return { id: id, description: fields.description?.stringValue || "", assignedTo: assignedTo, dueDate: fields.dueDate?.timestampValue || null };
  });
}

function getFirestoreCompletions(accessToken, uid) {
  var response = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/completions/" + uid + "/items?pageSize=300", {
    "method": "get", "headers": { "Authorization": "Bearer " + accessToken }, "muteHttpExceptions": true
  });
  var map = {};
  if (response.getResponseCode() === 200) {
    (JSON.parse(response.getContentText()).documents || []).forEach(function (doc) {
      map[doc.name.split("/").pop()] = doc.fields?.isDone?.booleanValue || false;
    });
  }
  return map;
}

function getFirestorePendingPersonalTasks(accessToken, uid) {
  var response = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/personalTasks/" + uid + "/items?pageSize=300", {
    "method": "get", "headers": { "Authorization": "Bearer " + accessToken }, "muteHttpExceptions": true
  });
  var list = [];
  if (response.getResponseCode() === 200) {
    (JSON.parse(response.getContentText()).documents || []).forEach(function (doc) {
      var fields = doc.fields || {};
      if (!fields.isDone?.booleanValue) list.push(fields.description?.stringValue || "");
    });
  }
  return list;
}

function updateFirestoreUserLastNotified(accessToken, uid, dateStr) {
  UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/users/" + uid + "?updateMask.fieldPaths=lastNotifiedDate", {
    "method": "patch", "headers": { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
    "payload": JSON.stringify({ "fields": { "lastNotifiedDate": { "stringValue": dateStr } } }), "muteHttpExceptions": true
  });
}

function sendFCMDirect(accessToken, fcmToken, title, body) {
  var response = UrlFetchApp.fetch("https://fcm.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/messages:send", {
    "method": "post", "headers": { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
    "payload": JSON.stringify({
      "message": {
        "token": fcmToken, "notification": { "title": title, "body": body },
        "webpush": { "headers": { "Urgency": "high" }, "notification": { "icon": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128", "click_action": "/" } }
      }
    }), "muteHttpExceptions": true
  });
  return { success: response.getResponseCode() === 200 };
}

// ------------------------------------------------------------
// ฟังก์ชันช่วยแปลงรูปแบบเวลา "HH:mm" เป็นตัวเลขนาทีตั้งแต่เที่ยงคืน
// ------------------------------------------------------------
function timeToMinutes(timeStr) {
  var p = timeStr.split(":");
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

// ------------------------------------------------------------
// ⏰ ฟังก์ชันสแกนเวลารายนาที (หลักการทำงานในชีวิตประจำวัน)
// แนะนำให้ตั้ง Trigger ใน Google Apps Script ทำงานทุกๆ 1 นาที
// ------------------------------------------------------------
function checkAndSendDailySummaries() {
  if (!FIREBASE_PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY || PRIVATE_KEY.indexOf("...") !== -1) return;
  var accessToken = getGoogleAccessToken();
  
  // 🕒 คำนวณเวลาโซน GMT+7 (กรุงเทพฯ) โดยตรง ป้องกัน Exception เรื่อง Format หรือ Locale ต่างๆ
  var date = new Date();
  var utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  var bangkokDate = new Date(utc + (3600000 * 7));
  
  var pad = function(num) { return (num < 10 ? '0' : '') + num; };
  var currentDateStr = bangkokDate.getFullYear() + "-" + pad(bangkokDate.getMonth() + 1) + "-" + pad(bangkokDate.getDate());
  var currentHourMin = pad(bangkokDate.getHours()) + ":" + pad(bangkokDate.getMinutes());
  var currentDayOfWeek = bangkokDate.getDay(); // 0 = อาทิตย์, 1 = จันทร์, ..., 6 = เสาร์

  Logger.log("⏰ ตรวจสอบรายนาที: วันนี้=" + currentDayOfWeek + " (0=อา., 1=จ.) | เวลาปัจจุบัน=" + currentHourMin + " | วันที่=" + currentDateStr);

  var usersList = getFirestoreUsers(accessToken);
  if (!usersList || usersList.length === 0) return;
  var homeworksList = getFirestoreHomeworks(accessToken);

  var sentTokens = {}; // 🔒 ป้องกันการส่งซ้ำหา Token เดิมในรอบรันเดียวกัน

  for (var i = 0; i < usersList.length; i++) {
    var userDoc = usersList[i];
    var userFields = userDoc.fields;
    if (!userFields) continue;
    var uid = userDoc.name.split("/").pop();

    var enabled = userFields.notificationsEnabled ? userFields.notificationsEnabled.booleanValue : false;
    var fcmToken = userFields.fcmToken ? userFields.fcmToken.stringValue : null;

    // 🚨 เช็คว่ามี Token หรือไม่ (ถ้าไม่มีจะไม่ส่ง)
    if (!enabled || !fcmToken) {
      Logger.log("⏭️ ผู้ใช้ " + uid + " ข้ามเนื่องจากไม่ได้เปิดใช้งานแจ้งเตือน หรือไม่มี fcmToken ในฐานข้อมูล");
      continue;
    }

    var notificationDays = [0, 1, 2, 3, 4, 5, 6];
    if (userFields.notificationDays?.arrayValue?.values) {
      notificationDays = userFields.notificationDays.arrayValue.values.map(function (v) { return parseInt(v.integerValue || v.stringValue, 10); });
    }
    if (notificationDays.indexOf(currentDayOfWeek) === -1) {
      Logger.log("⏭️ ผู้ใช้ " + uid + " ข้ามเนื่องจากวันนี้ไม่ใช่วันที่ตั้งค่าแจ้งเตือน");
      continue;
    }

    // ตรวจสอบเวลาที่ผู้ใช้เลือก (ค่าเริ่มต้น 18:00)
    var notificationTime = userFields.notificationTime ? userFields.notificationTime.stringValue : "18:00";
    
    var currentMin = timeToMinutes(currentHourMin);
    var targetMin = timeToMinutes(notificationTime);
    
    // ⏰ เช็คแบบยืดหยุ่น: ถ้าเวลาปัจจุบันตรงกับหรือเลยเวลาตั้งค่ามาแล้วไม่เกิน 5 นาที (เผื่อทริกเกอร์ดีเลย์)
    var isTimeToSend = (currentMin >= targetMin) && (currentMin - targetMin <= 5);
    if (!isTimeToSend) {
      continue; // ยังไม่ถึงเวลา หรือเลยเวลาส่งของวันนี้มานานแล้ว
    }

    // 🔒 เช็คว่าวันนี้และเวลานี้ถูกส่งไปแล้วหรือยัง เพื่อป้องกันการยิงซ้ำ (และยอมให้ส่งใหม่หากมีการเปลี่ยนเวลาตั้งค่าในวันเดียวกัน)
    var lastNotifiedDate = userFields.lastNotifiedDate ? userFields.lastNotifiedDate.stringValue : "";
    var expectedRecord = currentDateStr + " " + notificationTime;
    if (lastNotifiedDate === expectedRecord) {
      Logger.log("⏭️ ผู้ใช้ " + uid + " ได้ส่งแจ้งเตือนสำหรับเวลา " + notificationTime + " ของวันนี้ไปแล้ว (ข้ามเพื่อป้องกันการส่งซ้ำ)");
      continue; 
    }

    // 🚨 ตรวจสอบการส่งซ้ำหา Token เดิมในรอบเดียวกัน
    if (sentTokens[fcmToken]) {
      Logger.log("⏭️ ผู้ใช้ " + uid + " ข้ามเนื่องจาก fcmToken นี้ได้รับการส่งแจ้งเตือนไปแล้วในรอบนี้");
      continue;
    }

    var pendingCount = 0;
    var pendingHwList = [];
    var completionsMap = getFirestoreCompletions(accessToken, uid);
    var twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    for (var j = 0; j < homeworksList.length; j++) {
      var hw = homeworksList[j];
      if (hw.dueDate && new Date(hw.dueDate) < twoWeeksAgo) continue;
      var isAssigned = hw.assignedTo === "all" || (Array.isArray(hw.assignedTo) && hw.assignedTo.indexOf(uid) !== -1);
      if (isAssigned && completionsMap[hw.id] !== true) {
        pendingCount++;
        pendingHwList.push(hw.description);
      }
    }

    var pendingPersonalTasks = getFirestorePendingPersonalTasks(accessToken, uid);
    pendingCount += pendingPersonalTasks.length;
    for (var k = 0; k < pendingPersonalTasks.length; k++) {
      pendingHwList.push("งานส่วนตัว: " + pendingPersonalTasks[k]);
    }

    if (pendingCount > 0) {
      var title = "📚 คุณมีงานค้างทั้งหมด " + pendingCount + " งาน";
      var body = pendingHwList.slice(0, 3).join(", ");
      if (pendingHwList.length > 3) body += "... และงานอื่นๆ อีก " + (pendingCount - 3) + " งาน";

      Logger.log("🚀 ส่งสรุปงานค้างหา UID: " + uid + " (เวลาตั้งค่า: " + notificationTime + ")");
      var result = sendFCMDirect(accessToken, fcmToken, title, body);
      if (result.success) {
        sentTokens[fcmToken] = true; // บันทึกว่าส่งหาโทเค็นนี้แล้วในรอบนี้ ป้องกันการส่งซ้ำ
        updateFirestoreUserLastNotified(accessToken, uid, expectedRecord);
        Logger.log("✅ ส่งแจ้งเตือนสำเร็จและบันทึก " + expectedRecord + " ลงใน lastNotifiedDate แล้ว");
      } else {
        Logger.log("❌ ส่งแจ้งเตือนล้มเหลว");
      }
    } else {
      Logger.log("🎉 ผู้ใช้ " + uid + " ไม่มีงานค้างในระบบ (ไม่ต้องส่งแจ้งเตือน)");
    }
  }
}

// ------------------------------------------------------------
// 🚀 ฟังก์ชันสำหรับ "ทดลองส่งข้อความทันที" ให้กับทุกคนที่อนุญาตแจ้งเตือน
// ⚠️ ทำงานทันทีโดยข้ามเงื่อนไขเวลา และข้ามการเช็ค lastNotifiedDate (สามารถรันเพื่อเทสได้เรื่อยๆ)
// ⚠️ ไม่บันทึกการส่งลงฐานข้อมูล ทำให้รันเพื่อทดสอบได้บ่อยตามต้องการ
// ------------------------------------------------------------
function forceSendAllPendingSummaries() {
  if (!FIREBASE_PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY || PRIVATE_KEY.indexOf("...") !== -1) {
    Logger.log("❌ ข้อมูล Firebase Service Account หรือ Private Key ไม่ครบถ้วน");
    return;
  }
  Logger.log("🚀 เริ่มต้นระบบบดลพลัง: ส่งพุชสรุปงานค้างทันที (ข้ามเงื่อนไขเวลาและวันส่งซ้ำ)...");
  
  var accessToken = getGoogleAccessToken();
  var usersList = getFirestoreUsers(accessToken);
  if (!usersList || usersList.length === 0) {
    Logger.log("📭 ไม่พบผู้ใช้ในระบบ");
    return;
  }
  
  var homeworksList = getFirestoreHomeworks(accessToken);
  Logger.log("📚 โหลดข้อมูลการบ้านทั้งหมดสำเร็จ: " + homeworksList.length + " รายการ");
  
  var sentTokens = {}; // 🔒 ป้องกันการส่งซ้ำหา Token เดิมในรอบรันเดียวกัน
  var sentCount = 0;
  for (var i = 0; i < usersList.length; i++) {
    var userDoc = usersList[i];
    var userFields = userDoc.fields;
    if (!userFields) continue;
    var uid = userDoc.name.split("/").pop();
    
    var enabled = userFields.notificationsEnabled ? userFields.notificationsEnabled.booleanValue : false;
    var fcmToken = userFields.fcmToken ? userFields.fcmToken.stringValue : null;
    
    if (!enabled || !fcmToken) {
      Logger.log("⏭️ ผู้ใช้ " + uid + " ข้ามเพราะไม่เปิดแจ้งเตือน หรือไม่มี fcmToken ในฐานข้อมูล");
      continue;
    }
    
    // 🚨 ตรวจสอบการส่งซ้ำหา Token เดิมในรอบเดียวกัน
    if (sentTokens[fcmToken]) {
      Logger.log("⏭️ ผู้ใช้ " + uid + " ข้ามเนื่องจาก fcmToken นี้ได้รับการส่งแจ้งเตือนไปแล้วในรอบนี้");
      continue;
    }
    
    var pendingCount = 0;
    var pendingHwList = [];
    var completionsMap = getFirestoreCompletions(accessToken, uid);
    var twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    for (var j = 0; j < homeworksList.length; j++) {
      var hw = homeworksList[j];
      if (hw.dueDate && new Date(hw.dueDate) < twoWeeksAgo) continue;
      var isAssigned = hw.assignedTo === "all" || (Array.isArray(hw.assignedTo) && hw.assignedTo.indexOf(uid) !== -1);
      if (isAssigned && completionsMap[hw.id] !== true) {
        pendingCount++;
        pendingHwList.push(hw.description);
      }
    }
    
    var pendingPersonalTasks = getFirestorePendingPersonalTasks(accessToken, uid);
    pendingCount += pendingPersonalTasks.length;
    for (var k = 0; k < pendingPersonalTasks.length; k++) {
      pendingHwList.push("งานส่วนตัว: " + pendingPersonalTasks[k]);
    }
    
    if (pendingCount > 0) {
      var title = "🔔 [ทดสอบส่งทันที] คุณมีงานค้างทั้งหมด " + pendingCount + " งาน";
      var body = pendingHwList.slice(0, 3).join(", ");
      if (pendingHwList.length > 3) body += "... และงานอื่นๆ อีก " + (pendingCount - 3) + " งาน";
      
      Logger.log("🚀 กำลังส่งทดสอบหา UID: " + uid + " (งานค้าง: " + pendingCount + ")");
      var result = sendFCMDirect(accessToken, fcmToken, title, body);
      if (result.success) {
        sentTokens[fcmToken] = true; // บันทึกว่าส่งหาโทเค็นนี้แล้วในรอบนี้ ป้องกันการส่งซ้ำ
        Logger.log("✅ ส่งทดสอบหา " + uid + " สำเร็จ!");
        sentCount++;
      } else {
        Logger.log("❌ ส่งทดสอบหา " + uid + " ล้มเหลว");
      }
    } else {
      Logger.log("🎉 ผู้ใช้ " + uid + " ไม่มีงานค้างในระบบ (ไม่ต้องส่ง)");
    }
  }
  Logger.log("🏁 เสร็จสิ้นการทดสอบส่ง! จำนวนที่ยิงพุชสำเร็จ: " + sentCount + " รายการ");
}

function getGoogleAccessToken() {
  var header = JSON.stringify({ "alg": "RS256", "typ": "JWT" });
  var now = Math.floor(Date.now() / 1000);
  var claimSet = JSON.stringify({
    "iss": CLIENT_EMAIL,
    "scope": "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
    "aud": "https://oauth2.googleapis.com/token",
    "exp": now + 3600, "iat": now
  });
  var toSign = Utilities.base64EncodeWebSafe(header) + "." + Utilities.base64EncodeWebSafe(claimSet);
  var signatureBytes = Utilities.computeRsaSha256Signature(toSign, cleanPrivateKey(PRIVATE_KEY));
  var options = {
    "method": "post",
    "payload": { "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": toSign + "." + Utilities.base64EncodeWebSafe(signatureBytes) },
    "muteHttpExceptions": true
  };
  var responseData = JSON.parse(UrlFetchApp.fetch("https://oauth2.googleapis.com/token", options).getContentText());
  if (responseData.error) throw new Error("OAuth2 failed: " + responseData.error_description);
  return responseData.access_token;
}

function cleanPrivateKey(rawKey) {
  if (!rawKey) return "";
  var cleaned = rawKey.replace(/\\n/g, '\n').replace(/\r/g, '');
  var body = cleaned.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
  var lines = ['-----BEGIN PRIVATE KEY-----'];
  for (var i = 0; i < body.length; i += 64) lines.push(body.substring(i, i + 64));
  lines.push('-----END PRIVATE KEY-----');
  return lines.join('\n') + '\n';
}

function testSendNotification() {
  var testToken = "eFX8CEs7z9uIpFffH9DLoW:APA91bGwniFPGeiM89YCstM4pWdRBSy7VLDTsmxigBD9j5ZSmerWc7IbMu834FSkxoi0LttbMtwz74_G2EF0IkJcf05SsUjASNNRKB3zjkevzrvtC-om7Bs";
  try {
    var responseOutput = handleSendNotification({ action: "sendNotification", title: "ทดสอบผ่านระบบบอร์ด GAS 🔔", body: "สำเร็จ! 🎉", token: testToken });
    Logger.log("✅ ส่งสำเร็จ: " + responseOutput.getContent());
  } catch (error) { Logger.log("❌ ล้มเหลว: " + error.toString()); }
}
