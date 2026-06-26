// ============================================================
// js/firebase.js — Firebase Init & All Firestore CRUD
// Schema: users, students, subjects(soft-delete), homeworks,
//         completions/{uid}/items/{hwId}, personalTasks/{uid}/items/{taskId}
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  initializeFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp,
  where, getDoc, setDoc, writeBatch, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { firebaseConfig, GAS_ENDPOINT } from "../config/firebase.config.js";

// ─── Init ────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
export const db   = initializeFirestore(app, {
  experimentalForceLongPolling: true
});
export const auth = getAuth(app);

// ── Collection Shortcuts ──────────────────────────────────
const col = (path) => collection(db, path);
const ref = (...segs) => doc(db, ...segs);

// ══════════════════════════════════════════════════════════
//  SUBJECTS  (Soft-Delete — isDeleted flag)
// ══════════════════════════════════════════════════════════

export function subscribeSubjects(callback) {
  return onSnapshot(query(col('subjects'), orderBy('createdAt', 'asc')), snap =>
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function addSubject(name) {
  const n = name.trim();
  if (!n) throw new Error('ชื่อวิชาต้องไม่ว่างเปล่า');
  return addDoc(col('subjects'), { name: n, createdAt: serverTimestamp(), isDeleted: false, deletedAt: null });
}

/** Soft delete — ข้อมูลการบ้านยังคงอยู่ */
export async function softDeleteSubject(id) {
  await updateDoc(ref('subjects', id), { isDeleted: true, deletedAt: serverTimestamp() });
}

export async function restoreSubject(id) {
  await updateDoc(ref('subjects', id), { isDeleted: false, deletedAt: null });
}

export async function updateSubject(id, newName) {
  const name = newName.trim();
  if (!name) throw new Error('ชื่อวิชาต้องไม่ว่างเปล่า');

  // 1. Update the subject record
  await updateDoc(ref('subjects', id), { name });

  // 2. Query and update all homeworks with this subjectId
  const hwSnap = await getDocs(query(col('homeworks'), where('subjectId', '==', id)));
  const hwDocs = hwSnap.docs;

  // 3. Query and update all personal tasks of current user with this subjectId
  let ptDocs = [];
  const uid = auth.currentUser?.uid;
  if (uid) {
    const ptSnap = await getDocs(query(col(`personalTasks/${uid}/items`), where('subjectId', '==', id)));
    ptDocs = ptSnap.docs;
  }

  // [BUG FIX] Chunk updates to prevent Firestore 500-ops limit crash
  const allDocs = [...hwDocs, ...ptDocs];
  const CHUNK = 499;
  for (let i = 0; i < allDocs.length; i += CHUNK) {
    const batch = writeBatch(db);
    allDocs.slice(i, i + CHUNK).forEach(d => {
      batch.update(d.ref, { subjectName: name });
    });
    await batch.commit();
  }
}

export async function deleteSubjectRecord(id) {
  // 1. Hard delete the subject record
  await deleteDoc(ref('subjects', id));

  // 2. Query and update all homeworks with this subjectId to '-' and clear subjectId
  const hwSnap = await getDocs(query(col('homeworks'), where('subjectId', '==', id)));
  const hwDocs = hwSnap.docs;

  // 3. Query and update all personal tasks of current user with this subjectId to '-' and clear subjectId
  let ptDocs = [];
  const uid = auth.currentUser?.uid;
  if (uid) {
    const ptSnap = await getDocs(query(col(`personalTasks/${uid}/items`), where('subjectId', '==', id)));
    ptDocs = ptSnap.docs;
  }

  // [BUG FIX] Chunk updates to prevent Firestore 500-ops limit crash and clear subjectId
  const allDocs = [...hwDocs, ...ptDocs];
  const CHUNK = 499;
  for (let i = 0; i < allDocs.length; i += CHUNK) {
    const batch = writeBatch(db);
    allDocs.slice(i, i + CHUNK).forEach(d => {
      batch.update(d.ref, { subjectName: '-', subjectId: '' });
    });
    await batch.commit();
  }
}

// ══════════════════════════════════════════════════════════
//  HOMEWORKS
// ══════════════════════════════════════════════════════════

export function subscribeHomeworks(callback) {
  return onSnapshot(query(col('homeworks'), orderBy('createdAt', 'asc')), snap => {
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Client-sort: dueDate ASC (null last), then createdAt ASC
    data.sort((a, b) => {
      const aD = a.dueDate, bD = b.dueDate;
      if (aD && !bD) return -1;
      if (!aD && bD) return 1;
      if (aD && bD) { const diff = aD.toDate() - bD.toDate(); if (diff) return diff; }
      return (a.createdAt?.toDate()?.getTime() ?? 0) - (b.createdAt?.toDate()?.getTime() ?? 0);
    });
    callback(data);
  });
}

export async function addHomework({ description, subjectId, subjectName, dueDate, assignedTo, attachments, createdBy, priority }) {
  if (!description?.trim()) throw new Error('กรุณาใส่รายละเอียดการบ้าน');
  if (!subjectId)           throw new Error('กรุณาเลือกวิชา');
  const docRef = await addDoc(col('homeworks'), {
    description: description.trim(), subjectId, subjectName,
    dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate)) : null,
    assignedTo: assignedTo ?? 'all',
    attachments: attachments ?? [],
    createdBy: createdBy ?? '',
    priority: priority || 'normal',
    createdAt: serverTimestamp()
  });

  // สร้างการแจ้งเตือนสำหรับการบ้านใหม่
  try {
    await addDoc(col('notifications'), {
      title: `📚 มีการบ้านใหม่วิชา: ${subjectName}`,
      body: description.trim().length > 80 ? description.trim().substring(0, 80) + '...' : description.trim(),
      createdAt: serverTimestamp(),
      assignedTo: assignedTo ?? 'all',
      type: 'new_homework',
      hwId: docRef.id
    });
  } catch (err) {
    console.error('ไม่สามารถสร้างการแจ้งเตือนการบ้านใหม่ได้:', err);
  }

  return docRef;
}

export async function updateHomework(id, updates) {
  if (!updates.description?.trim()) throw new Error('กรุณาใส่รายละเอียดการบ้าน');
  if (!updates.subjectId)           throw new Error('กรุณาเลือกวิชา');
  const payload = {
    description: updates.description.trim(),
    subjectId: updates.subjectId,
    subjectName: updates.subjectName,
    dueDate: updates.dueDate ? Timestamp.fromDate(new Date(updates.dueDate)) : null,
    assignedTo: updates.assignedTo ?? 'all',
    priority: updates.priority || 'normal'
  };
  if (updates.attachments !== undefined) payload.attachments = updates.attachments;
  await updateDoc(ref('homeworks', id), payload);

  // สร้างการแจ้งเตือนเมื่อมีการอัปเดตการบ้าน
  try {
    await addDoc(col('notifications'), {
      title: `✏️ แก้ไขการบ้านวิชา: ${updates.subjectName}`,
      body: updates.description.trim().length > 80 ? updates.description.trim().substring(0, 80) + '...' : updates.description.trim(),
      createdAt: serverTimestamp(),
      assignedTo: updates.assignedTo ?? 'all',
      type: 'update_homework',
      hwId: id
    });
  } catch (err) {
    console.error('ไม่สามารถสร้างการแจ้งเตือนการแก้ไขการบ้านได้:', err);
  }
}

export async function deleteHomework(id) {
  await deleteDoc(ref('homeworks', id));
}

/** Admin: batch-delete homeworks where dueDate < cutoff */
export async function cleanupOldHomeworks(weeksBefore = 2) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeksBefore * 7);
  const snap = await getDocs(
    query(col('homeworks'), where('dueDate', '<', Timestamp.fromDate(cutoff)), limit(400))
  );
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.docs.length;
}

/** 1. ลบการบ้านที่ทุกคน (ที่ถูกมอบหมาย) ทำเสร็จแล้ว */
export async function cleanupCompletedHomeworks() {
  const usersSnap = await getDocs(col('users'));
  const usersList = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (usersList.length === 0) return 0;

  const hwSnap = await getDocs(col('homeworks'));
  const hwList = hwSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (hwList.length === 0) return 0;

  const completionsMap = {}; // hwId -> Set of userIds who completed it

  await Promise.all(usersList.map(async (u) => {
    const cSnap = await getDocs(query(col(`completions/${u.id}/items`), where('isDone', '==', true)));
    cSnap.docs.forEach(d => {
      const hwId = d.id;
      if (!completionsMap[hwId]) completionsMap[hwId] = new Set();
      completionsMap[hwId].add(u.id);
    });
  }));

  // [BUG FIX #1] เฉพาะนักเรียน (role === 'user') ที่ลิงค์ student record แล้วเท่านั้น
  // ไม่รวม admin/superadmin ซึ่งไม่มี completion record → จะทำให้ everyoneCompleted เป็น false ตลอด
  const studentUsers = usersList.filter(u => u.role === 'user' && u.linkedStudentId);

  const toDelete = [];
  hwList.forEach(hw => {
    let assignedUsers = [];
    if (hw.assignedTo === 'all') {
      assignedUsers = studentUsers.map(u => u.id);
    } else if (Array.isArray(hw.assignedTo)) {
      assignedUsers = hw.assignedTo;
    } else if (hw.assignedTo) {
      assignedUsers = [hw.assignedTo];
    }

    // [BUG FIX #2] ถ้าไม่มีนักเรียน active เลย อย่าลบงาน (ป้องกันลบผิดพลาด)
    if (assignedUsers.length === 0) return;

    // ตรวจสอบว่าทุกคนที่ได้รับมอบหมายได้ทำเสร็จแล้ว
    const completedSet = completionsMap[hw.id] || new Set();
    const everyoneCompleted = assignedUsers.every(uid => completedSet.has(uid));

    if (everyoneCompleted) {
      toDelete.push(hw.id);
    }
  });

  if (toDelete.length === 0) return 0;

  // [BUG FIX #3] แบ่ง batch เป็น chunk ≤499 เพราะ Firestore มีลิมิต 500 ops/batch
  const CHUNK = 499;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const batch = writeBatch(db);
    toDelete.slice(i, i + CHUNK).forEach(id => batch.delete(ref('homeworks', id)));
    await batch.commit();
  }
  return toDelete.length;
}

/** Fetch completion stats for Admin dashboard progress bars */
export async function getAdminCompletionStats() {
  const usersSnap = await getDocs(col('users'));
  const studentUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.role === 'user' && u.linkedStudentId);
  const activeStudentIds = studentUsers.map(u => u.id);
  const totalStudents = activeStudentIds.length;

  const hwSnap = await getDocs(col('homeworks'));
  const totalHomeworks = hwSnap.docs.length;
  
  const completedCounts = {}; // hwId -> count
  const studentStats = {}; // uid -> { name, completedCount }
  
  const hwIds = new Set(hwSnap.docs.map(d => d.id));
  
  await Promise.all(studentUsers.map(async (u) => {
    const cSnap = await getDocs(query(col(`completions/${u.id}/items`), where('isDone', '==', true)));
    // [BUG FIX] users collection เก็บ displayName ไม่ใช่ firstName/lastName (field เหล่านั้นอยู่ใน students collection)
    let validCompletions = 0;
    
    cSnap.docs.forEach(d => {
      const hwId = d.id;
      // Only count if the homework still exists
      if (hwIds.has(hwId)) {
        validCompletions++;
        if (!completedCounts[hwId]) completedCounts[hwId] = 0;
        completedCounts[hwId]++;
      }
    });
    
    studentStats[u.id] = { name: u.displayName || u.email || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(), completedCount: validCompletions };
  }));

  return { totalStudents, totalHomeworks, completedCounts, activeStudentIds, studentStats };
}

/** 2. ลบการบ้านทั้งหมดที่เลยวันกำหนดส่ง (แม้บางคนจะยังทำไม่เสร็จ) */
export async function cleanupOverdueHomeworks() {
  const now = new Date();
  const snap = await getDocs(
    query(col('homeworks'), where('dueDate', '<', Timestamp.fromDate(now)), limit(400))
  );
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.docs.length;
}

/** 3. ลบการบ้านที่มีอยู่ทั้งหมดในระบบ */
export async function cleanupAllHomeworks() {
  const snap = await getDocs(col('homeworks'));
  if (snap.empty) return 0;

  // [BUG FIX #4] แบ่ง batch เป็น chunk ≤499 เพราะถ้ามีการบ้าน >500 จะ crash ทันที
  const CHUNK = 499;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return docs.length;
}

/** 4. แนะนำเพิ่ม: ล้างประวัติพุชแจ้งเตือนเก่า (เกิน 30 วัน) */
export async function cleanupOldNotifications(daysBefore = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBefore);
  const snap = await getDocs(
    query(col('notifications'), where('createdAt', '<', Timestamp.fromDate(cutoff)), limit(400))
  );
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.docs.length;
}

/** 5. แนะนำเพิ่ม: ล้างงานส่วนตัว (Personal Tasks) ของทุกคนที่ทำเสร็จแล้ว */
export async function cleanupCompletedPersonalTasks() {
  const usersSnap = await getDocs(col('users'));
  const usersList = usersSnap.docs.map(d => d.id);
  if (usersList.length === 0) return 0;

  let totalDeleted = 0;
  // [BUG FIX #5] แบ่ง batch เป็น chunk ≤499 ต่อคน กันกรณีคนเดียวมี task >500 รายการ
  const CHUNK = 499;
  for (const uid of usersList) {
    const snap = await getDocs(
      query(col(`personalTasks/${uid}/items`), where('isDone', '==', true))
    );
    if (!snap.empty) {
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      totalDeleted += docs.length;
    }
  }
  return totalDeleted;
}

// ══════════════════════════════════════════════════════════
//  COMPLETIONS  completions/{uid}/items/{homeworkId}
// ══════════════════════════════════════════════════════════

export function subscribeUserCompletions(uid, callback) {
  return onSnapshot(col(`completions/${uid}/items`), snap => {
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    callback(map);
  });
}

export async function setCompletion(uid, homeworkId, done) {
  await setDoc(ref(`completions/${uid}/items/${homeworkId}`), {
    isDone: done,
    completedAt: done ? serverTimestamp() : null
  }, { merge: true });
}

export async function savePersonalNote(uid, homeworkId, noteText) {
  await setDoc(ref(`completions/${uid}/items/${homeworkId}`), {
    note: noteText
  }, { merge: true });
}

export async function togglePinHomework(uid, homeworkId, currentPinned) {
  await setDoc(ref(`completions/${uid}/items/${homeworkId}`), {
    isPinned: !currentPinned
  }, { merge: true });
}

// ══════════════════════════════════════════════════════════
//  COMMENTS  homeworks/{hwId}/comments/{commentId}
// ══════════════════════════════════════════════════════════

export function subscribeComments(hwId, callback) {
  return onSnapshot(query(col(`homeworks/${hwId}/comments`), orderBy('createdAt', 'asc')), snap =>
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function addComment(hwId, uid, displayName, text) {
  if (!text?.trim()) throw new Error('กรุณาพิมพ์ข้อความ');
  return addDoc(col(`homeworks/${hwId}/comments`), {
    uid,
    displayName: displayName || 'ไม่ระบุชื่อ',
    text: text.trim(),
    createdAt: serverTimestamp()
  });
}

export async function deleteComment(hwId, commentId) {
  await deleteDoc(ref(`homeworks/${hwId}/comments`, commentId));
}

export async function deleteAllComments(hwId) {
  const q = query(col(`homeworks/${hwId}/comments`));
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// ══════════════════════════════════════════════════════════
//  PERSONAL TASKS  personalTasks/{uid}/items/{taskId}
// ══════════════════════════════════════════════════════════

export function subscribePersonalTasks(uid, callback) {
  return onSnapshot(query(col(`personalTasks/${uid}/items`), orderBy('createdAt', 'asc')), snap =>
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function addPersonalTask(uid, { description, subjectId, subjectName, dueDate }) {
  if (!description?.trim()) throw new Error('กรุณาใส่รายละเอียด');
  return addDoc(col(`personalTasks/${uid}/items`), {
    description: description.trim(),
    subjectId: subjectId ?? '',
    subjectName: subjectName ?? 'ส่วนตัว',
    dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate)) : null,
    isDone: false, completedAt: null,
    createdAt: serverTimestamp()
  });
}

export async function updatePersonalTask(uid, taskId, { description, subjectId, subjectName, dueDate, note } = {}) {
  // [BUG FIX] แก้ไขให้รองรับการอัปเดต field note โดยไม่เขียนทับ field อื่นที่ไม่ได้ระบุ
  const updates = {};
  if (description !== undefined) updates.description = description.trim();
  if (subjectId  !== undefined) updates.subjectId   = subjectId ?? '';
  if (subjectName !== undefined) updates.subjectName = subjectName ?? 'ส่วนตัว';
  if (dueDate    !== undefined) updates.dueDate     = dueDate ? Timestamp.fromDate(new Date(dueDate)) : null;
  if (note       !== undefined) updates.note        = note;
  if (Object.keys(updates).length > 0) {
    await updateDoc(ref(`personalTasks/${uid}/items/${taskId}`), updates);
  }
}

export async function togglePersonalTask(uid, taskId, currentDone) {
  await updateDoc(ref(`personalTasks/${uid}/items/${taskId}`), {
    isDone: !currentDone,
    completedAt: !currentDone ? serverTimestamp() : null
  });
}

export async function togglePinPersonalTask(uid, taskId, currentPinned) {
  await updateDoc(ref(`personalTasks/${uid}/items/${taskId}`), {
    isPinned: !currentPinned
  });
}

export async function deletePersonalTask(uid, taskId) {
  await deleteDoc(ref(`personalTasks/${uid}/items/${taskId}`));
}

// ══════════════════════════════════════════════════════════
//  USERS  users/{uid}
// ══════════════════════════════════════════════════════════

export async function getUserData(uid) {
  const snap = await getDoc(ref('users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createUserDoc(uid, { email, displayName, photoURL, role }) {
  await setDoc(ref('users', uid), {
    email, displayName: displayName ?? '', photoURL: photoURL ?? '',
    role, studentId: '', linkedStudentId: null,
    isActive: true, createdAt: serverTimestamp(), lastLoginAt: serverTimestamp()
  });
}

export async function touchUserLogin(uid) {
  await updateDoc(ref('users', uid), { lastLoginAt: serverTimestamp(), isActive: true });
}

export async function updateUserStudentLink(uid, studentId, { displayName, email }) {
  await updateDoc(ref('users', uid), { studentId, linkedStudentId: studentId, displayName });
  // Mark student record as active + linked
  await updateDoc(ref('students', studentId.toString()), {
    linkedUid: uid, linkedEmail: email, isActive: true
  });
}

/**
 * Unlink a user account from their student ID.
 * Resets the user doc and the student record so another account can link.
 */
export async function unlinkUserStudent(uid, studentId) {
  const batch = writeBatch(db);
  // Reset user document
  batch.update(ref('users', uid), {
    studentId: '',
    linkedStudentId: null,
    isActive: false
  });
  // Reset student record if we know the studentId
  if (studentId) {
    batch.update(ref('students', studentId.toString()), {
      linkedUid: null,
      linkedEmail: null,
      isActive: false
    });
  }
  await batch.commit();
}

export async function updateUserProfile(uid, updates) {
  const allowed = {};
  if (updates.photoURL   !== undefined) allowed.photoURL   = updates.photoURL;
  if (updates.displayName !== undefined) allowed.displayName = updates.displayName;
  if (Object.keys(allowed).length) await updateDoc(ref('users', uid), allowed);
}

export async function updateUserRole(uid, role) {
  await updateDoc(ref('users', uid), { role });
}

export function subscribeUsers(callback) {
  return onSnapshot(query(col('users'), orderBy('createdAt', 'asc')), snap =>
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ══════════════════════════════════════════════════════════
//  STUDENTS  students/{studentId}
// ══════════════════════════════════════════════════════════

export function subscribeStudents(callback) {
  return onSnapshot(query(col('students'), orderBy('studentId', 'asc')), snap =>
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function getStudentById(studentId) {
  const snap = await getDoc(ref('students', studentId.toString().trim()));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function addStudent({ studentId, firstName, lastName, nickname = '' }) {
  const id = studentId.toString().trim();
  if (!id) throw new Error('กรุณาใส่เลขประจำตัว');
  const existing = await getDoc(ref('students', id));
  if (existing.exists()) throw new Error(`เลขประจำตัว ${id} มีอยู่แล้วในระบบ`);
  await setDoc(ref('students', id), {
    studentId: id, firstName: firstName.trim(), lastName: lastName.trim(),
    nickname: nickname.trim(),
    linkedUid: null, linkedEmail: null, isActive: false,
    createdAt: serverTimestamp()
  });
}

export async function updateStudent(studentId, { firstName, lastName, nickname = '' }) {
  await updateDoc(ref('students', studentId.toString()), {
    firstName: firstName.trim(), lastName: lastName.trim(), nickname: nickname.trim()
  });
}

export async function deleteStudentRecord(studentId) {
  await deleteDoc(ref('students', studentId.toString()));
}

/**
 * Batch import from parsed Excel data
 * @param {Array} rows - [{studentId, firstName, lastName, nickname}]
 * @param {Array} overwriteIds - studentIds to overwrite on duplicate
 * @returns {{ added, overwritten, skipped }}
 */
export async function batchImportStudents(rows, overwriteIds = []) {
  const overwriteSet = new Set(overwriteIds.map(String));
  let added = 0, overwritten = 0, skipped = 0;
  // Firestore batch max 500 ops — chunk if needed
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = writeBatch(db);
    const chunk = rows.slice(i, i + CHUNK);
    for (const s of chunk) {
      const id  = s.studentId.toString().trim();
      const docRef = ref('students', id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        if (overwriteSet.has(id)) {
          batch.update(docRef, {
            firstName: s.firstName.trim(), lastName: s.lastName.trim(),
            nickname: (s.nickname ?? '').trim()
          });
          overwritten++;
        } else { skipped++; }
      } else {
        batch.set(docRef, {
          studentId: id, firstName: s.firstName.trim(), lastName: s.lastName.trim(),
          nickname: (s.nickname ?? '').trim(),
          linkedUid: null, linkedEmail: null, isActive: false,
          createdAt: serverTimestamp()
        });
        added++;
      }
    }
    await batch.commit();
  }
  return { added, overwritten, skipped };
}

// ══════════════════════════════════════════════════════════
//  FILE UPLOAD  via Google Apps Script → Google Drive
// ══════════════════════════════════════════════════════════

/**
 * Extract Google Drive file ID from any Drive URL and return
 * the embeddable lh3 API URL (lh3.googleusercontent.com/d/FILE_ID).
 * Works for: /file/d/FILE_ID/view, ?id=FILE_ID, or raw FILE_ID
 */
function buildDriveThumbnailUrl(fileIdOrUrl) {
  if (!fileIdOrUrl) return '';
  let fileId = fileIdOrUrl;
  // Extract from /file/d/FILE_ID/view
  const m1 = fileIdOrUrl.match(/\/file\/d\/([^/?\s]+)/);
  if (m1) fileId = m1[1];
  // Extract from ?id=FILE_ID or &id=FILE_ID
  else {
    const m2 = fileIdOrUrl.match(/[?&]id=([^&\s]+)/);
    if (m2) fileId = m2[1];
  }
  // Remove any trailing params (e.g. /view?usp=...)
  fileId = fileId.split(/[?#/]/)[0];
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

export async function uploadFileToDrive(file, folder = 'Homework_Files') {
  if (!GAS_ENDPOINT) throw new Error('ยังไม่ได้ตั้งค่า GAS URL กรุณาแจ้ง Admin');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const base64 = e.target.result.split(',')[1];
        const res = await fetch(GAS_ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({ action: 'upload', fileName: file.name, mimeType: file.type || 'application/octet-stream', data: base64, folder })
        });
        if (!res.ok) throw new Error(`GAS error ${res.status}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Upload failed');
        // thumbnailUrl is the embeddable image URL (Drive Thumbnail API)
        // url is the standard shareable view URL
        const thumbnailUrl = json.thumbnailUrl || buildDriveThumbnailUrl(json.fileId);
        resolve({ name: file.name, url: json.url, thumbnailUrl, driveFileId: json.fileId });
      } catch (err) { 
        console.error('❌ [Drive Upload Error]:', err);
        reject(err); 
      }
    };
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
    reader.readAsDataURL(file);
  });
}

/** Revert/clean up simulation completions & personal tasks */
export async function clearSimulationData(studentId) {
  const simUid = `sim_${studentId}`;
  
  // 1. Delete completions
  const completionsSnap = await getDocs(col(`completions/${simUid}/items`));
  if (!completionsSnap.empty) {
    const batch = writeBatch(db);
    completionsSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 2. Delete personal tasks
  const tasksSnap = await getDocs(col(`personalTasks/${simUid}/items`));
  if (!tasksSnap.empty) {
    const batch = writeBatch(db);
    tasksSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// ══════════════════════════════════════════════════════════
//  FIREBASE CLOUD MESSAGING (FCM)
// ══════════════════════════════════════════════════════════

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
    
    // ลงทะเบียน Service Worker แบบระบุตำแหน่งไฟล์สัมพันธ์ (Relative Path) เพื่อรองรับโฟลเดอร์ย่อย
    let registration;
    if ('serviceWorker' in navigator) {
      try {
        registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
        // Force update the service worker to ensure the latest fixes are applied
        if (registration) {
          registration.update();
        }
      } catch (swErr) {
        console.error('❌ ไม่สามารถลงทะเบียน Service Worker ได้:', swErr);
      }
    }
    
    // ดึง token เพื่อระบุเครื่องรับการแจ้งเตือน
    const fcmToken = await getToken(messaging, {
      serviceWorkerRegistration: registration || undefined,
      vapidKey: 'BJSwFeC7oWT9Krfd-tcyVQzAZlYPBmReljBf9Nf3_ndbSQ797N_zQHOAUmDabZM0UEVDzss8UcU_18uROuP2lYI'
    });
    
    if (!fcmToken) {
      console.warn('❌ บราวเซอร์ไม่สามารถดึง FCM Token ออกมาได้สำเร็จ');
      return null;
    }
    
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
    }
    
    return fcmToken;
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาดในการลงทะเบียนรับพุชแจ้งเตือน:', error);
    return null;
  }
}

/**
 * ฟังก์ชันส่งผ่านข้อมูลแจ้งเตือนไปยังผู้ใช้กลุ่มหลัก
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

// 🔔 ดักจับข้อความพุชในขณะเปิดเว็บทิ้งไว้ (Foreground Message)
onMessage(messaging, (payload) => {
  console.log('📬 ได้รับพุชแจ้งเตือนขณะอยู่ใน Foreground:', payload);
  
  if (Notification.permission === 'granted') {
    const title = payload.notification?.title || payload.data?.title || 'แจ้งเตือนใหม่ 🔔';
    const options = {
      body: payload.notification?.body || payload.data?.body || '',
      icon: payload.notification?.icon || payload.data?.icon || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128',
      data: {
        click_action: payload.notification?.click_action || 
                      payload.notification?.clickAction || 
                      payload.data?.click_action || 
                      payload.data?.clickAction || 
                      payload.fcmOptions?.link || 
                      '/'
      }
    };

    // ใช้ Service Worker ในการโชว์แจ้งเตือนเพื่อให้ระบบจัดการคลิกเหมือนตอนปิดเว็บ
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.showNotification(title, options);
      }).catch((err) => {
        console.error('Service worker not ready:', err);
        new Notification(title, options);
      });
    } else {
      new Notification(title, options);
    }
  }
});

/**
 * อัปเดตการตั้งค่าการแจ้งเตือนงานค้างของผู้ใช้ลงใน Firestore
 */
export async function updateNotificationSettings(uid, { enabled, days, time }) {
  await updateDoc(ref('users', uid), {
    notificationsEnabled: enabled,
    notificationDays: days,
    notificationTime: time
  });
}

// ══════════════════════════════════════════════════════════
//  IN-APP NOTIFICATIONS (YouTube-style)
// ══════════════════════════════════════════════════════════

/**
 * บันทึกการแจ้งเตือนแบบกำหนดเองลง Firestore เพื่อแสดงผลในกระดิ่งของแอป
 */
export async function addCustomNotification({ title, body, assignedTo }) {
  return addDoc(col('notifications'), {
    title: title,
    body: body,
    createdAt: serverTimestamp(),
    assignedTo: assignedTo ?? 'all',
    type: 'custom_push',
    hwId: null
  });
}

/**
 * ดึงข้อมูลเอกสารแจ้งเตือนรายชิ้น
 */
export async function getNotificationDoc(notifId) {
  const snap = await getDoc(ref('notifications', notifId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeNotifications(callback) {
  return onSnapshot(query(col('notifications'), orderBy('createdAt', 'desc'), limit(50)), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeReadNotifications(uid, callback) {
  return onSnapshot(col(`users/${uid}/readNotifications`), snap => {
    const readIds = new Set();
    snap.docs.forEach(d => {
      if (d.data().read) readIds.add(d.id);
    });
    callback(readIds);
  });
}

export async function markNotificationAsRead(uid, notifId) {
  await setDoc(ref(`users/${uid}/readNotifications/${notifId}`), {
    read: true,
    readAt: serverTimestamp()
  });
}

export async function markAllNotificationsAsRead(uid, notifIds) {
  if (!notifIds || notifIds.length === 0) return;
  // [BUG FIX] แบ่ง chunk ≤499 ป้องกัน Firestore 500-ops limit
  const CHUNK = 499;
  for (let i = 0; i < notifIds.length; i += CHUNK) {
    const batch = writeBatch(db);
    notifIds.slice(i, i + CHUNK).forEach(id => {
      batch.set(ref(`users/${uid}/readNotifications/${id}`), {
        read: true,
        readAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
}

export async function deleteNotification(id) {
  await deleteDoc(ref('notifications', id));
}

export async function deleteMultipleNotifications(ids) {
  if (!ids || ids.length === 0) return;
  const CHUNK = 499;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = writeBatch(db);
    ids.slice(i, i + CHUNK).forEach(id => {
      batch.delete(ref('notifications', id));
    });
    await batch.commit();
  }
}

// ══════════════════════════════════════════════════════════
//  SYSTEM BACKUP / RESTORE
// ══════════════════════════════════════════════════════════

export async function exportSystemData() {
  const data = {
    subjects: [],
    homeworks: [],
    exportedAt: new Date().toISOString()
  };
  
  const subSnap = await getDocs(col('subjects'));
  subSnap.forEach(d => { data.subjects.push({ id: d.id, ...d.data() }); });
  
  const hwSnap = await getDocs(col('homeworks'));
  hwSnap.forEach(d => {
    const hw = { id: d.id, ...d.data() };
    if (hw.createdAt?.toDate) hw.createdAt = hw.createdAt.toDate().toISOString();
    if (hw.dueDate?.toDate) hw.dueDate = hw.dueDate.toDate().toISOString();
    data.homeworks.push(hw);
  });
  
  return data;
}

export async function importSystemData(data) {
  if (!data || !data.subjects || !data.homeworks) {
    throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
  }

  // [BUG FIX] แบ่ง batch เป็น chunk ≤499 เพื่อป้องกัน Firestore 500-ops limit crash
  const CHUNK = 499;

  // Prepare all write operations
  const ops = [];

  data.subjects.forEach(sub => {
    const { id, ...subData } = sub;
    ops.push({ ref: ref('subjects', id), data: subData });
  });

  data.homeworks.forEach(hw => {
    const { id, ...hwData } = hw;
    if (hwData.createdAt) hwData.createdAt = Timestamp.fromDate(new Date(hwData.createdAt));
    if (hwData.dueDate) hwData.dueDate = Timestamp.fromDate(new Date(hwData.dueDate));
    ops.push({ ref: ref('homeworks', id), data: hwData });
  });

  // Execute in batches
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db);
    ops.slice(i, i + CHUNK).forEach(op => batch.set(op.ref, op.data));
    await batch.commit();
  }
}
