// ============================================================
// js/auth.js — Google Sign-in & Session Management
// ============================================================

import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signOut as _signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  auth, getUserData, createUserDoc, touchUserLogin,
  updateUserStudentLink, getStudentById, updateUserProfile, uploadFileToDrive,
  clearSimulationData
} from "./firebase.js";
import { SUPER_ADMIN_EMAIL } from "../config/firebase.config.js";
import { showToast, showAlert, setButtonLoading, renderAvatarHTML } from "./utils.js?v=2";

// ── Module State ─────────────────────────────────────────
let _user = null;   // Firebase Auth user
let _userData = null;   // Firestore user document
let _unsubscribeAuth = null;

// Impersonation state
let _simulatingStudent = null;
let _simulatingUid = null;
let _simulatingUserData = null;

export const getCurrentUser = () => _user;
export const getCurrentUserData = () => {
  if (_simulatingStudent) return _simulatingUserData;
  return _userData;
};
export const getUid = () => {
  if (_simulatingStudent) return _simulatingUid;
  return _user?.uid ?? null;
};
export const isAdmin = () => {
  const data = _simulatingStudent ? _simulatingUserData : _userData;
  return ['admin', 'superadmin'].includes(data?.role);
};
export const isSuperAdmin = () => {
  const data = _simulatingStudent ? _simulatingUserData : _userData;
  return data?.role === 'superadmin';
};
export const isRegularUser = () => {
  const data = _simulatingStudent ? _simulatingUserData : _userData;
  return data?.role === 'user';
};

export const isSimulating = () => !!_simulatingStudent;
export const getSimulatedStudent = () => _simulatingStudent;
export const canImpersonate = () => _user && _user.email === SUPER_ADMIN_EMAIL;

export async function startSimulation(studentId) {
  if (!canImpersonate()) throw new Error('สิทธิ์การจำลองการใช้งานเฉพาะผู้ดูแลหลักเท่านั้น');
  const student = await getStudentById(studentId);
  if (!student) throw new Error(`ไม่พบข้อมูลนักเรียนรหัส ${studentId}`);

  _simulatingStudent = student;
  if (student.linkedUid) {
    _simulatingUid = student.linkedUid;
    const realUserData = await getUserData(student.linkedUid);
    _simulatingUserData = realUserData || {
      role: 'user',
      studentId: student.studentId,
      linkedStudentId: student.studentId,
      displayName: `${student.firstName} ${student.lastName}`,
      email: student.linkedEmail || '',
      photoURL: ''
    };
  } else {
    _simulatingUid = `sim_${student.studentId}`;
    _simulatingUserData = {
      role: 'user',
      studentId: student.studentId,
      linkedStudentId: student.studentId,
      displayName: `${student.firstName} ${student.lastName} (จำลอง)`,
      email: `${student.studentId}@simulation.local`,
      photoURL: ''
    };
  }
}

export async function stopSimulation() {
  if (!_simulatingStudent) return;
  const studentId = _simulatingStudent.studentId;
  const wasLinked = !!_simulatingStudent.linkedUid;

  _simulatingStudent = null;
  _simulatingUid = null;
  _simulatingUserData = null;

  if (!wasLinked) {
    await clearSimulationData(studentId);
  }
}

// ── Google Sign-in ────────────────────────────────────────

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    // Use redirect for all devices to prevent COOP (Cross-Origin-Opener-Policy) errors
    // and popup blocking issues in strict environments (like Vercel).
    await signInWithRedirect(auth, provider);
  } catch (err) {
    throw err;
  }
}

export async function signOut() {
  await _signOut(auth);
  _user = null; _userData = null;
  // [BUG FIX] Reset init guard so re-login reinitializes notification settings
  _notifSettingsInit = false;
}

// ── Auth State Listener ───────────────────────────────────

/**
 * @param {function} onSignedIn  - called with userData
 * @param {function} onNeedsOnboarding - called for new users who need student ID
 * @param {function} onSignedOut
 */
export function initAuth(onSignedIn, onNeedsOnboarding, onSignedOut) {
  if (_unsubscribeAuth) _unsubscribeAuth();
  _unsubscribeAuth = onAuthStateChanged(auth, async user => {
    if (!user) {
      _user = null; _userData = null;
      onSignedOut();
      return;
    }
    _user = user;
    try {
      let data = await getUserData(user.uid);
      if (!data) {
        // First ever login → create user document
        const role = user.email === SUPER_ADMIN_EMAIL ? 'superadmin' : 'user';
        await createUserDoc(user.uid, {
          email: user.email,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
          role
        });
        data = await getUserData(user.uid);
      } else {
        await touchUserLogin(user.uid);
      }
      _userData = data;

      // Super Admin / Admin skip onboarding
      if (data.role !== 'user' || data.linkedStudentId) {
        onSignedIn(data);
      } else {
        onNeedsOnboarding(data);
      }
    } catch (err) {
      console.error('Auth state error:', err);
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    }
  });
}

// ── Onboarding ────────────────────────────────────────────

export async function completeOnboarding(studentId) {
  if (!_user) throw new Error('ไม่พบ Session');
  const student = await getStudentById(studentId);
  if (!student) throw new Error('ไม่พบเลขประจำตัวนี้ในระบบ กรุณาติดต่อผู้ดูแล');
  if (student.linkedUid && student.linkedUid !== _user.uid) {
    throw new Error('เลขประจำตัวนี้ถูกผูกกับบัญชีอื่นแล้ว กรุณาติดต่อผู้ดูแล');
  }
  const displayName = `${student.firstName} ${student.lastName}`;
  await updateUserStudentLink(_user.uid, student.studentId, { displayName, email: _user.email });
  _userData = await getUserData(_user.uid);
  return _userData;
}

// ── Profile Photo Upload ──────────────────────────────────

export async function changeProfilePhoto(file) {
  if (!_user) throw new Error('ไม่พบ Session');
  const result = await uploadFileToDrive(file, 'Profile_Pictures');
  // Use thumbnailUrl for direct embedding in <img>; fall back to regular url if not available
  const photoURL = result.thumbnailUrl || result.url;
  await updateUserProfile(_user.uid, { photoURL });
  if (_userData) _userData.photoURL = photoURL;
  return photoURL;
}

// ── Header UI Render ──────────────────────────────────────

export function renderHeaderUser() {
  // [BUG FIX] ใช้ getCurrentUserData() แทน _userData โดยตรง เพื่อรองรับ Simulation Mode
  const data = getCurrentUserData();
  if (!data) return;

  // Desktop Header
  const avatarEl = document.getElementById('header-avatar');
  const nameEl = document.getElementById('header-name');
  if (avatarEl) avatarEl.innerHTML = renderAvatarHTML(data.photoURL, data.displayName, 36);
  if (nameEl) nameEl.textContent = data.displayName || data.email;

  // Mobile Sidebar
  const mobAvatarEl = document.getElementById('mobile-sidebar-avatar');
  const mobNameEl = document.getElementById('mobile-sidebar-name');
  if (mobAvatarEl) mobAvatarEl.innerHTML = renderAvatarHTML(data.photoURL, data.displayName, 38);
  if (mobNameEl) mobNameEl.textContent = data.displayName || data.email;
}

// ── Helper functions for class preservation (Dark Mode) ──
function updateDayButtonState(btn, isActive) {
  // [BUG FIX] Use data-active attribute instead of CSS class for reliable detection
  btn.dataset.active = isActive ? '1' : '0';
  if (isActive) {
    btn.classList.remove(
      'bg-white', 'text-slate-500', 'border-slate-200', 'hover:bg-slate-50',
      'dark:bg-slate-800', 'dark:text-slate-400', 'dark:border-slate-700', 'dark:hover:bg-slate-750',
      'bell-day-btn-inactive'
    );
    btn.classList.add(
      'bg-primary', 'text-white', 'border-primary', 'shadow-sm',
      'dark:bg-primary', 'dark:text-white', 'dark:border-primary',
      'bell-day-btn-active'
    );
  } else {
    btn.classList.remove(
      'bg-primary', 'text-white', 'border-primary', 'shadow-sm',
      'dark:bg-primary', 'dark:text-white', 'dark:border-primary',
      'bell-day-btn-active'
    );
    btn.classList.add(
      'bg-white', 'text-slate-500', 'border-slate-200', 'hover:bg-slate-50',
      'dark:bg-slate-800', 'dark:text-slate-400', 'dark:border-slate-700', 'dark:hover:bg-slate-750',
      'bell-day-btn-inactive'
    );
  }
}

function updateBellButtonState(bellBtn, notifEnabled) {
  if (notifEnabled) {
    bellBtn.classList.remove(
      'text-slate-400', 'dark:text-slate-400', 'border-slate-200', 'dark:border-slate-800', 
      'text-slate-600', 'hover:text-primary', 'dark:hover:text-primary'
    );
    bellBtn.classList.add(
      'text-primary', 'border-primary', 'dark:text-primary', 'dark:border-primary'
    );
  } else {
    bellBtn.classList.remove(
      'text-primary', 'border-primary', 'dark:text-primary', 'dark:border-primary',
      'hover:text-primary', 'dark:hover:text-primary'
    );
    bellBtn.classList.add(
      'text-slate-400', 'dark:text-slate-400', 'border-slate-200', 'dark:border-slate-800'
    );
  }
}

const INACTIVE_HOUR_MIN_CLASSES = [
  'w-full', 'py-2', 'text-sm', 'font-semibold', 
  'text-slate-600', 'hover:bg-slate-100', 'hover:text-primary', 
  'rounded-lg', 'transition-colors', 'cursor-pointer', 'text-center',
  'dark:text-slate-400', 'dark:hover:bg-slate-800/85', 'dark:hover:text-primary'
];

const ACTIVE_HOUR_MIN_CLASSES = [
  'w-full', 'py-2', 'text-sm', 'font-bold', 
  'text-white', 'bg-primary', 
  'rounded-lg', 'cursor-pointer', 'text-center',
  'dark:text-white', 'dark:bg-primary'
];

// ── Save Notification Settings ───────────────────────────
async function saveSettings(customEnabled) {
  const uid = getUid();
  if (!uid || isSimulating()) return;

  const bellIndicator = document.getElementById('bell-saving-indicator');
  const bellToggle = document.getElementById('bell-notif-toggle');
  const bellDayButtons = document.querySelectorAll('#bell-notif-days-container .bell-day-btn');
  const timeDisplay = document.getElementById('bell-time-display-badge');

  const showLoading = () => {
    if (bellIndicator) { bellIndicator.textContent = '⏳ บันทึก...'; bellIndicator.classList.remove('opacity-0'); }
  };
  const showSuccess = () => {
    if (bellIndicator) { bellIndicator.textContent = '✅ บันทึกแล้ว'; setTimeout(() => bellIndicator.classList.add('opacity-0'), 1500); }
  };
  const showError = () => {
    if (bellIndicator) { bellIndicator.textContent = '❌ ล้มเหลว'; setTimeout(() => bellIndicator.classList.add('opacity-0'), 2000); }
  };

  showLoading();

  try {
    const enabled = customEnabled !== undefined ? customEnabled : (bellToggle ? bellToggle.checked : true);

    const activeDays = [];
    bellDayButtons.forEach(btn => {
      // [BUG FIX] Use data-active attribute instead of CSS class for reliability
      if (btn.dataset.active === '1') {
        activeDays.push(parseInt(btn.dataset.day, 10));
      }
    });

    const time = timeDisplay ? timeDisplay.textContent.trim() : '18:00';

    const { updateNotificationSettings } = await import('./firebase.js');
    await updateNotificationSettings(uid, { enabled, days: activeDays, time });

    // อัปเดตข้อมูลแคชผู้ใช้งาน
    if (_userData && _userData.id === uid) {
      _userData.notificationsEnabled = enabled;
      _userData.notificationDays = activeDays;
      _userData.notificationTime = time;
    }

    // รีเฟรชข้อมูลในโมดอลโปรไฟล์และป๊อปอัพกระดิ่ง
    populateProfileModal();
    showSuccess();
  } catch (err) {
    console.error('Failed to save notification settings:', err);
    showError();
  }
}

// ── Profile Modal ─────────────────────────────────────────

export function populateProfileModal() {
  const data = _userData;
  if (!data) return;
  const { getRoleLabel } = window._utils || {};
  document.getElementById('pm-avatar').innerHTML = renderAvatarHTML(data.photoURL, data.displayName, 72);
  document.getElementById('pm-name').textContent = data.displayName || '(ไม่ระบุชื่อ)';
  document.getElementById('pm-student-id').textContent = data.studentId || '-';
  document.getElementById('pm-email').textContent = data.email;
  document.getElementById('pm-role').textContent = { superadmin: 'Super Admin', admin: 'Admin', user: 'นักเรียน' }[data.role] || data.role;

  // 🔔 ตั้งค่าการแจ้งเตือนงานค้าง (แสดงผลที่กระดิ่งลอยตัวเท่านั้น)
  const notifEnabled = data.notificationsEnabled !== false; // Default to true if undefined
  const notifDays = data.notificationDays || [0, 1, 2, 3, 4, 5, 6]; // Default to all 7 days
  const notifTime = data.notificationTime || '18:00'; // Default to 18:00

  // ซิงค์กับกล่อง Popover ของกระดิ่งลอยตัว
  const bellToggle = document.getElementById('bell-notif-toggle');
  if (bellToggle) bellToggle.checked = notifEnabled;

  const bellSettingsGroup = document.getElementById('bell-notif-settings-group');
  if (bellSettingsGroup) bellSettingsGroup.style.display = notifEnabled ? 'flex' : 'none';

  const timeDisplay = document.getElementById('bell-time-display-badge');
  if (timeDisplay) {
    timeDisplay.textContent = notifTime;
  }

  const bellDayButtons = document.querySelectorAll('#bell-notif-days-container .bell-day-btn');
  bellDayButtons.forEach(btn => {
    const dayVal = parseInt(btn.dataset.day, 10);
    const isActive = notifDays.includes(dayVal);
    updateDayButtonState(btn, isActive);
  });

  // ซิงค์ปุ่มกระดิ่ง: ถ้าเปิดการแจ้งเตือนจะเป็นกระดิ่งปกติ ถ้าปิดจะเป็นการเอฟเฟกต์สีเทา
  const bellBtn = document.getElementById('floating-bell-btn');
  const bellSvg = document.getElementById('bell-icon-svg');
  if (bellBtn && bellSvg) {
    if (notifEnabled) {
      updateBellButtonState(bellBtn, true);
      bellSvg.setAttribute('fill', 'currentColor');
    } else {
      updateBellButtonState(bellBtn, false);
      bellSvg.removeAttribute('fill');
    }
  }
}

let _notifSettingsInit = false;
export function initNotificationSettings() {
  if (_notifSettingsInit) return;

  // ตัวควบคุมกระดิ่งลอยตัว
  const bellBtn = document.getElementById('floating-bell-btn');
  const bellPopover = document.getElementById('bell-popover-panel');
  const bellToggle = document.getElementById('bell-notif-toggle');
  const bellSvg = document.getElementById('bell-icon-svg');
  const bellDayButtons = document.querySelectorAll('#bell-notif-days-container .bell-day-btn');

  if (!bellBtn) return; // ไม่พบปุ่มหรือระบบยังโหลดไม่เสร็จ
  _notifSettingsInit = true;

  // (saveSettings ถูกเลื่อนไปที่ระดับ Module Scope เพื่อให้เข้าถึงได้จากทุกที่รวมถึง dropdown เวลา)

  // 1. ปุ่มกระดิ่งลอยตัวและกล่อง Popover
  const settingsToggleBtn = document.getElementById('bell-settings-toggle-btn');
  const settingsDrawer = document.getElementById('bell-settings-drawer');
  const notifList = document.getElementById('bell-notif-list');
  const markAllReadBtn = document.getElementById('bell-mark-all-read-btn');
  const markAllReadDivider = document.getElementById('bell-mark-all-read-divider');
  const bellTitleText = document.getElementById('bell-title-text');

  const showSettingsView = () => {
    if (settingsDrawer) settingsDrawer.classList.remove('hidden');
    if (settingsToggleBtn) settingsToggleBtn.classList.add('text-primary');
    if (notifList) notifList.classList.add('hidden');
    if (markAllReadBtn) markAllReadBtn.classList.add('hidden');
    if (markAllReadDivider) markAllReadDivider.classList.add('hidden');
    if (bellTitleText) bellTitleText.innerHTML = `⚙️ ตั้งค่าการแจ้งเตือน`;
  };

  const showNotificationsView = () => {
    if (settingsDrawer) settingsDrawer.classList.add('hidden');
    if (settingsToggleBtn) settingsToggleBtn.classList.remove('text-primary');
    if (notifList) notifList.classList.remove('hidden');
    if (markAllReadBtn) markAllReadBtn.classList.remove('hidden');
    if (markAllReadDivider) markAllReadDivider.classList.remove('hidden');
    if (bellTitleText) bellTitleText.innerHTML = `🔔 การแจ้งเตือน`;
  };

  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = bellPopover.classList.contains('hidden');

    if (isHidden) {
      // รีเซ็ตมุมมองกลับไปที่การแจ้งเตือนเมื่อเปิด Popover ทุกครั้ง
      showNotificationsView();
      bellPopover.classList.remove('hidden');
      // เอฟเฟกต์กระดิ่งสั่นเมื่อเปิดกล่อง (Wiggle Effect)
      bellSvg.classList.add('animate-bounce');
      setTimeout(() => bellSvg.classList.remove('animate-bounce'), 800);
    } else {
      bellPopover.classList.add('hidden');
    }
  });

  // คลิกไปที่พื้นที่อื่นบนหน้าเว็บเพื่อปิดกล่อง Popover
  document.addEventListener('click', (e) => {
    if (bellPopover && !bellPopover.contains(e.target) && !bellBtn.contains(e.target)) {
      bellPopover.classList.add('hidden');
    }
  });

  // ปุ่มสลับการแสดงผล Drawer ตั้งค่าการแจ้งเตือนด่วนภายใน Popover
  if (settingsToggleBtn && settingsDrawer) {
    settingsToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isDrawerHidden = settingsDrawer.classList.contains('hidden');
      if (isDrawerHidden) {
        showSettingsView();
      } else {
        showNotificationsView();
      }
    });
  }

  // ลิสเนอร์สำหรับสวิตช์เปิด/ปิดบน Popover กระดิ่ง
  if (bellToggle) {
    bellToggle.addEventListener('change', async () => {
      const enabled = bellToggle.checked;

      const bellSettingsGroup = document.getElementById('bell-notif-settings-group');
      if (bellSettingsGroup) {
        bellSettingsGroup.style.display = enabled ? 'flex' : 'none';
      }

      if (enabled) {
        const { requestAndSaveNotificationPermission } = await import('./firebase.js');
        const token = await requestAndSaveNotificationPermission(getUid());
        if (!token) {
          bellToggle.checked = false;
          if (bellSettingsGroup) bellSettingsGroup.style.display = 'none';
          return;
        }
      }

      await saveSettings(enabled);
    });
  }

  // ลิสเนอร์ปุ่มวันในกระดิ่ง
  bellDayButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      // [BUG FIX] Use data-active attribute instead of CSS class
      const isActive = btn.dataset.active === '1';

      // เปลี่ยนแปลงปุ่มในกระดิ่ง
      updateDayButtonState(btn, !isActive);

      await saveSettings();
    });
  });

  // 3. จัดการการเลือกเวลาจัดส่งข้อความสรุปรายวันผ่าน Modal
  const timeTriggerRow = document.getElementById('bell-time-trigger-row');
  const timeModal = document.getElementById('bell-time-picker-modal');
  const closeTimeModalBtn = document.getElementById('close-bell-time-modal');
  const timeCancelBtn = document.getElementById('btm-cancel');
  const timeSaveBtn = document.getElementById('btm-save');
  const hourScroll = document.getElementById('btm-hour-scroll');
  const minScroll = document.getElementById('btm-min-scroll');
  const timeDisplayBadge = document.getElementById('bell-time-display-badge');
  const presetBtns = document.querySelectorAll('.bell-preset-time-btn');

  let selectedHour = '18';
  let selectedMin = '00';

  const hourInput = document.getElementById('btm-hour-input');
  const minInput = document.getElementById('btm-min-input');

  // สร้างปุ่มชั่วโมง 00-23
  if (hourScroll && hourScroll.children.length === 0) {
    for (let i = 0; i < 24; i++) {
      const val = i.toString().padStart(2, '0');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = INACTIVE_HOUR_MIN_CLASSES.join(' ') + ' btm-hour-item';
      btn.dataset.hour = val;
      btn.textContent = val;
      btn.addEventListener('click', () => selectHourItem(val));
      hourScroll.appendChild(btn);
    }
  }

  // สร้างปุ่มนาที 00-59
  if (minScroll && minScroll.children.length === 0) {
    for (let i = 0; i < 60; i++) {
      const val = i.toString().padStart(2, '0');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = INACTIVE_HOUR_MIN_CLASSES.join(' ') + ' btm-min-item';
      btn.dataset.min = val;
      btn.textContent = val;
      btn.addEventListener('click', () => selectMinItem(val));
      minScroll.appendChild(btn);
    }
  }

  function selectHourItem(hourVal) {
    selectedHour = hourVal;
    if (hourInput && document.activeElement !== hourInput) {
      hourInput.value = hourVal;
    }
    hourScroll.querySelectorAll('.btm-hour-item').forEach(btn => {
      if (btn.dataset.hour === hourVal) {
        btn.className = ACTIVE_HOUR_MIN_CLASSES.join(' ') + ' btm-hour-item';
      } else {
        btn.className = INACTIVE_HOUR_MIN_CLASSES.join(' ') + ' btm-hour-item';
      }
    });
  }

  function selectMinItem(minVal) {
    selectedMin = minVal;
    if (minInput && document.activeElement !== minInput) {
      minInput.value = minVal;
    }
    minScroll.querySelectorAll('.btm-min-item').forEach(btn => {
      if (btn.dataset.min === minVal) {
        btn.className = ACTIVE_HOUR_MIN_CLASSES.join(' ') + ' btm-min-item';
      } else {
        btn.className = INACTIVE_HOUR_MIN_CLASSES.join(' ') + ' btm-min-item';
      }
    });
  }

  // เลื่อนรายการชั่วโมง/นาทีให้ตรงกับค่าที่เลือก
  function scrollToSelected() {
    setTimeout(() => {
      const activeHour = hourScroll.querySelector(`.btm-hour-item[data-hour="${selectedHour}"]`);
      if (activeHour) {
        hourScroll.scrollTop = activeHour.offsetTop - hourScroll.offsetTop - 40;
      }
      const activeMin = minScroll.querySelector(`.btm-min-item[data-min="${selectedMin}"]`);
      if (activeMin) {
        minScroll.scrollTop = activeMin.offsetTop - minScroll.offsetTop - 40;
      }
    }, 100);
  }

  // การผูกเหตุการณ์พิมพ์ข้อมูลด้วยแป้นพิมพ์
  hourInput?.addEventListener('input', () => {
    hourInput.value = hourInput.value.replace(/[^0-9]/g, '');
    let val = hourInput.value;
    if (val.length === 2) {
      let num = parseInt(val, 10);
      if (num > 23) num = 23;
      val = num.toString().padStart(2, '0');
      hourInput.value = val;
      
      selectHourItem(val);
      scrollToSelected();
      minInput?.focus();
      minInput?.select();
    } else if (val.length === 1) {
      const num = parseInt(val, 10);
      if (num > 2) {
        // เช่น พิมพ์เลข 3, 4, 5... ให้ขึ้นเป็น 03, 04, 05 และเลื่อนโฟกัสไปนาทีเลย
        val = '0' + val;
        hourInput.value = val;
        selectHourItem(val);
        scrollToSelected();
        minInput?.focus();
        minInput?.select();
      }
    }
  });

  hourInput?.addEventListener('blur', () => {
    let val = hourInput.value.trim();
    if (!val) {
      hourInput.value = selectedHour;
      return;
    }
    let num = parseInt(val, 10);
    if (isNaN(num) || num < 0) num = 0;
    if (num > 23) num = 23;
    const formatted = num.toString().padStart(2, '0');
    hourInput.value = formatted;
    selectHourItem(formatted);
    scrollToSelected();
  });

  minInput?.addEventListener('input', () => {
    minInput.value = minInput.value.replace(/[^0-9]/g, '');
    let val = minInput.value;
    if (val.length === 2) {
      let num = parseInt(val, 10);
      if (num > 59) num = 59;
      val = num.toString().padStart(2, '0');
      minInput.value = val;
      
      selectMinItem(val);
      scrollToSelected();
    } else if (val.length === 1) {
      const num = parseInt(val, 10);
      if (num > 5) {
        val = '0' + val;
        minInput.value = val;
        selectMinItem(val);
        scrollToSelected();
      }
    }
  });

  minInput?.addEventListener('blur', () => {
    let val = minInput.value.trim();
    if (!val) {
      minInput.value = selectedMin;
      return;
    }
    let num = parseInt(val, 10);
    if (isNaN(num) || num < 0) num = 0;
    if (num > 59) num = 59;
    const formatted = num.toString().padStart(2, '0');
    minInput.value = formatted;
    selectMinItem(formatted);
    scrollToSelected();
  });

  // เมื่อเลือกช่วงเวลายอดนิยม (Preset)
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const timeVal = btn.dataset.time;
      const [h, m] = timeVal.split(':');
      selectHourItem(h);
      selectMinItem(m);
      scrollToSelected();
    });
  });

  if (timeTriggerRow && timeModal) {
    timeTriggerRow.addEventListener('click', (e) => {
      e.stopPropagation();
      const curTime = timeDisplayBadge?.textContent?.trim() || '18:00';
      const [h, m] = curTime.split(':');
      
      if (hourInput) hourInput.value = h;
      if (minInput) minInput.value = m;

      selectHourItem(h);
      selectMinItem(m);
      
      timeModal.classList.add('open');
      document.body.style.overflow = 'hidden';
      scrollToSelected();
    });
  }

  const closeTimeModal = () => {
    timeModal?.classList.remove('open');
    document.body.style.overflow = '';
  };

  closeTimeModalBtn?.addEventListener('click', closeTimeModal);
  timeCancelBtn?.addEventListener('click', closeTimeModal);

  timeSaveBtn?.addEventListener('click', async () => {
    const newTime = `${selectedHour}:${selectedMin}`;
    if (timeDisplayBadge) {
      timeDisplayBadge.textContent = newTime;
    }
    closeTimeModal();
    await saveSettings();
  });

  // ซิงค์การแสดงผลข้อมูลครั้งแรกหลังโหลดการตั้งค่า
  populateProfileModal();
}


// ── Onboarding Modal Controller ───────────────────────────

export function initOnboardingModal() {
  const form = document.getElementById('onboarding-form');
  const input = document.getElementById('onboarding-student-id');
  const submitBtn = document.getElementById('onboarding-submit');
  const errEl = document.getElementById('onboarding-error');

  form.addEventListener('submit', async e => {
    e.preventDefault();

    // If the button is in the "Go Back" state, perform sign out and redirect to home screen
    if (submitBtn.dataset.action === 'goback') {
      submitBtn.dataset.action = '';
      submitBtn.textContent = 'เข้าสู่ระบบ';
      errEl.textContent = '';
      input.value = '';
      setButtonLoading(submitBtn, true);
      try {
        await signOut();
      } catch (err) {
        console.error('Sign out error:', err);
      } finally {
        setButtonLoading(submitBtn, false);
      }
      return;
    }

    const id = input.value.trim();
    if (!id) return;
    setButtonLoading(submitBtn, true);
    errEl.textContent = '';
    try {
      const userData = await completeOnboarding(id);
      document.getElementById('onboarding-modal').classList.remove('open');
      document.body.style.overflow = '';
      showToast(`ยินดีต้อนรับ ${userData.displayName}! 🎉`);
      // Re-trigger app init
      window._onOnboardingComplete?.(userData);
    } catch (err) {
      errEl.textContent = err.message;
      if (err.message && err.message.includes('ถูกผูกกับบัญชีอื่นแล้ว')) {
        setButtonLoading(submitBtn, false, 'กลับไปหน้าหลัก');
        submitBtn.dataset.action = 'goback';
        return; // skip finally block to keep 'กลับไปหน้าหลัก' text
      }
    } finally {
      if (submitBtn.dataset.action !== 'goback') {
        setButtonLoading(submitBtn, false, 'เข้าสู่ระบบ');
      }
    }
  });

  // Reset button state and error when user edits the input text
  input.addEventListener('input', () => {
    if (submitBtn.dataset.action === 'goback') {
      submitBtn.dataset.action = '';
      submitBtn.textContent = 'เข้าสู่ระบบ';
      errEl.textContent = '';
    }
  });
}

// ── Profile Photo Change Handler ──────────────────────────

let _profilePhotoInit = false;
export function initProfilePhotoUpload() {
  if (_profilePhotoInit) return;
  const input = document.getElementById('profile-photo-input');
  if (!input) return;
  _profilePhotoInit = true;
  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showAlert({ title: 'ไฟล์ใหญ่เกินไป', message: 'กรุณาเลือกรูปที่มีขนาดไม่เกิน 5MB', type: 'warning' });
      return;
    }
    const avatarEl = document.getElementById('pm-avatar');
    if (avatarEl) avatarEl.innerHTML = `<div class="avatar avatar-initials" style="width:72px;height:72px;">⏳</div>`;
    try {
      const url = await changeProfilePhoto(file);
      showToast('เปลี่ยนรูปโปรไฟล์เรียบร้อยแล้ว');
      populateProfileModal();
      renderHeaderUser();
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
      populateProfileModal(); // restore
    }
  });
}
