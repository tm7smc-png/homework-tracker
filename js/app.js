// ============================================================
// js/app.js — Main Application Orchestrator
// ============================================================

import {
  subscribeSubjects, subscribeHomeworks, subscribeUserCompletions,
  subscribePersonalTasks, subscribeUsers, addHomework, updateHomework, deleteHomework,
  addSubject, softDeleteSubject, restoreSubject, updateSubject, deleteSubjectRecord,
  setCompletion, savePersonalNote, addPersonalTask, updatePersonalTask,
  togglePersonalTask, deletePersonalTask, uploadFileToDrive,
  subscribeComments, addComment, deleteComment,
  requestAndSaveNotificationPermission, triggerPushNotification,
  subscribeNotifications, subscribeReadNotifications,
  markNotificationAsRead, markAllNotificationsAsRead,
  getNotificationDoc, togglePinHomework, togglePinPersonalTask,
  getAdminCompletionStats, deleteNotification, deleteAllComments
} from "./firebase.js";
import {
  initAuth, signInWithGoogle, signOut,
  getCurrentUser, getCurrentUserData, getUid,
  isAdmin, isSuperAdmin, isRegularUser,
  renderHeaderUser, populateProfileModal,
  initOnboardingModal, initProfilePhotoUpload, completeOnboarding,
  startSimulation, stopSimulation, isSimulating, getSimulatedStudent, canImpersonate,
  initNotificationSettings
} from "./auth.js?v=2";
import {
  initAdminPanel, destroyAdminPanel, initUserFilter,
  initStudentTableSearch
} from "./admin.js";
import {
  showToast, showConfirm, showAlert, openModal, closeModal,
  formatDate, formatDateInput, daysRemaining, getStatus, getDeadlineLabel,
  setButtonLoading, renderAvatarHTML, getRoleLabel,
  escapeHtml, _releaseScrollLock, debounce
} from "./utils.js?v=2";

// Expose utils for auth.js backward compat
window._utils = { getRoleLabel };

// [BUG FIX] Clipboard fallback for non-HTTPS / unsupported browsers
function _fallbackCopyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      showToast('คัดลอกลิงก์การบ้านเรียบร้อยแล้ว');
    } else {
      showToast('ไม่สามารถคัดลอกลิงก์ได้', 'error');
    }
  } catch (err) {
    showToast('ไม่สามารถคัดลอกลิงก์ได้', 'error');
  }
}


// ══════════════════════════════════════════════════════════
//  PWA SERVICE WORKER
// ══════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}

// ══════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════

let subjects       = [];
let homeworks      = [];
let completions    = {};   // { homeworkId: { isDone, completedAt } }
let personalTasks  = [];
let users          = [];   // for admin assignment
let _unsubs        = [];
let editingHwId    = null;
let editingPersonalTaskId = null;
let pendingAttachments = [];  // Files selected but not yet uploaded
let notifications  = [];
let readNotificationIds = new Set();
let currentFilterId = 'all';
let _searchQuery = localStorage.getItem('hw_search_query') || '';
let _filterStatus = localStorage.getItem('hw_filter_status') || 'all'; // 'all', 'pending', 'done', 'overdue'
let _sortBy = localStorage.getItem('hw_sort_by') || 'date_asc';  // 'date_asc', 'date_desc', 'subject_asc'
let _adminStats = null;

// ══════════════════════════════════════════════════════════
//  BOOTSTRAP & SW MESSAGING
// ══════════════════════════════════════════════════════════

// ดักจับข้อความจาก Service Worker (เมื่อคลิกการแจ้งเตือนขณะเปิดแท็บค้างอยู่)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'OPEN_NOTIFICATION') {
      const targetUrl = event.data.url;
      try {
        const urlObj = new URL(targetUrl);
        const urlParams = urlObj.searchParams;
        const notifId = urlParams.get('notifId');
        if (notifId) {
          const uid = getUid();
          if (!uid) return;
          
          const notifDoc = await getNotificationDoc(notifId);
          if (notifDoc) {
            // มาร์คว่าอ่านแล้ว
            await markNotificationAsRead(uid, notifId);
            
            // แสดง Modal รายละเอียดทันที
            const timeStr = formatTimeElapsed(notifDoc.createdAt);
            showNotificationDetailModal(notifDoc, timeStr);
            
            // นำทางไปไฮไลต์การบ้าน (เฉพาะกรณีที่มี hwId)
            if (notifDoc.hwId) {
              switchView('dashboard');
              setTimeout(() => {
                const card = document.querySelector(`.hw-card[data-id="${notifDoc.hwId}"]`);
                if (card) {
                  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  card.classList.add('highlight-notif-target');
                  setTimeout(() => card.classList.remove('highlight-notif-target'), 2000);
                }
              }, 250);
            }
          }
        }
      } catch (err) {
        console.error('❌ ไม่สามารถเปิดรายละเอียดแจ้งเตือนแบบเรียลไทม์ได้:', err);
      }
    }
  });
}

initOnboardingModal();

// Onboarding complete callback
window._onOnboardingComplete = (userData) => {
  bootApp(userData);
};

function initDashboardControls() {
  const searchInput = document.getElementById('global-search-input');
  const filterSelect = document.getElementById('filter-status-select');
  const sortSelect = document.getElementById('sort-by-select');

  // [BUG FIX] Restore saved search/filter/sort state into the input elements
  if (searchInput && _searchQuery) searchInput.value = _searchQuery;
  if (filterSelect) filterSelect.value = _filterStatus;
  if (sortSelect) sortSelect.value = _sortBy;

  searchInput?.addEventListener('input', debounce((e) => {
    _searchQuery = e.target.value.trim();
    localStorage.setItem('hw_search_query', _searchQuery);
    renderDashboard();
  }, 300));

  filterSelect?.addEventListener('change', (e) => {
    _filterStatus = e.target.value;
    localStorage.setItem('hw_filter_status', _filterStatus);
    renderDashboard();
  });

  sortSelect?.addEventListener('change', (e) => {
    _sortBy = e.target.value;
    localStorage.setItem('hw_sort_by', _sortBy);
    renderDashboard();
  });
}

function initThemeToggle() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  const lightIcon = document.getElementById('theme-toggle-light-icon');
  const darkIcon = document.getElementById('theme-toggle-dark-icon');
  
  if (!toggleBtn) return;

  function updateThemeUI() {
    if (document.documentElement.classList.contains('dark')) {
      lightIcon.classList.remove('hidden');
      darkIcon.classList.add('hidden');
    } else {
      lightIcon.classList.add('hidden');
      darkIcon.classList.remove('hidden');
    }
  }

  // Set initial icon state
  updateThemeUI();

  toggleBtn.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    if (document.documentElement.classList.contains('dark')) {
      localStorage.setItem('theme', 'dark');
    } else {
      localStorage.setItem('theme', 'light');
    }
    updateThemeUI();
  });
}

// Initialize Controls before Auth
initDashboardControls();
initThemeToggle();

initAuth(
  (userData) => { bootApp(userData); },           // signed in
  (userData) => { showOnboardingModal(userData); }, // needs onboarding
  ()         => { showLoginScreen(); }             // signed out
);

// ══════════════════════════════════════════════════════════
//  AUTH SCREENS
// ══════════════════════════════════════════════════════════

function showLoginScreen() {
  // Close any open modals to prevent overlay blocking the login screen
  document.querySelectorAll('.modal-overlay.open').forEach(m => {
    m.classList.remove('open');
  });
  document.body.style.overflow = '';

  // [BUG FIX] Cleanup comment subscription on logout to prevent orphaned Firestore listeners
  if (currentCommentUnsub) { currentCommentUnsub(); currentCommentUnsub = null; }

  document.getElementById('loading-overlay').style.display = 'none';
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
  document.getElementById('floating-notif-bell-container')?.classList.add('hidden');
}

function showOnboardingModal(userData) {
  document.getElementById('loading-overlay').style.display = 'none';
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-container').classList.add('hidden');
  document.getElementById('onboarding-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Pre-fill name from Google
  const nameEl = document.getElementById('onboarding-google-name');
  if (nameEl) nameEl.textContent = userData.displayName || userData.email;
  const photoEl = document.getElementById('onboarding-avatar');
  if (photoEl) photoEl.innerHTML = renderAvatarHTML(userData.photoURL, userData.displayName, 60);
}

// 🔔 ตรวจจับและเปิดอ่านแจ้งเตือนทันทีเมื่อเข้าเว็บผ่านลิงก์ Deep Link (?notifId=xxx)
async function checkUrlForNotification() {
  const urlParams = new URLSearchParams(window.location.search);
  const notifId = urlParams.get('notifId');
  if (notifId) {
    // ล้างพารามิเตอร์ออกจาก URL เพื่อไม่ให้แสดงซ้ำเมื่อผู้ใช้กดรีเฟรชหน้าเว็บภายหลัง
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);

    const uid = getUid();
    if (!uid) return;

    try {
      // ดึงเอกสารแจ้งเตือนตรงๆ จาก Firestore
      const notifDoc = await getNotificationDoc(notifId);
      if (notifDoc) {
        // มาร์คว่าอ่านแล้ว
        await markNotificationAsRead(uid, notifId);
        
        // แสดง Modal รายละเอียดทันที
        const timeStr = formatTimeElapsed(notifDoc.createdAt);
        showNotificationDetailModal(notifDoc, timeStr);

        // นำทางไปไฮไลต์การบ้าน (เฉพาะกรณีที่มี hwId)
        if (notifDoc.hwId) {
          switchView('dashboard');
          setTimeout(() => {
            const card = document.querySelector(`.hw-card[data-id="${notifDoc.hwId}"]`);
            if (card) {
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              card.classList.add('highlight-notif-target');
              setTimeout(() => card.classList.remove('highlight-notif-target'), 2000);
            }
          }, 250);
        }
      }
    } catch (err) {
      console.error('❌ โหลดข้อมูล Deep Link Notification ล้มเหลว:', err);
    }
  }
}

function bootApp(userData) {
  document.getElementById('loading-overlay').style.display = 'none';
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('onboarding-modal')?.classList.remove('open');
  document.body.style.overflow = '';
  document.getElementById('app-container').classList.remove('hidden');
  document.getElementById('floating-notif-bell-container')?.classList.remove('hidden');

  // Handle Simulation Banner
  const banner = document.getElementById('simulation-banner');
  const info = document.getElementById('simulation-info');
  if (banner && info) {
    if (isSimulating()) {
      const student = getSimulatedStudent();
      info.textContent = `${student.firstName} ${student.lastName} (รหัส: ${student.studentId})`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  // [BUG FIX] Destroy admin subscriptions ก่อน re-init เพื่อป้องกัน memory leak
  // (subscribeToData จะ unsub ส่วน app แล้ว แต่ admin subscriptions ต้อง destroy แยก)
  try { destroyAdminPanel(); } catch (e) { /* ignore if not initialized */ }

  // [BUG FIX] Cleanup comment subscription ก่อน re-boot เพื่อป้องกัน orphaned Firestore listener
  if (currentCommentUnsub) { currentCommentUnsub(); currentCommentUnsub = null; }

  renderHeaderUser();
  setupRoleUI();
  subscribeToData();
  initProfilePhotoUpload();
  initNotificationSettings();
  checkUrlForNotification(); // 🔔 ตรวจจับ Deep Link เปิดอ่านพุชทันทีเมื่อเข้าเว็บ

  // Fetch Admin Stats for Class Progress Bar if Admin
  if (isAdmin()) {
    getAdminCompletionStats().then(stats => {
      _adminStats = stats;
      renderDashboard(); // Re-render to show progress bars
    }).catch(err => console.error("Failed to load admin stats:", err));
  }
  // ขออนุญาตรับการแจ้งเตือนหลังจากเปิดหน้าเว็บไปแล้ว 3 วินาที
  setTimeout(async () => {
    try {
      await requestAndSaveNotificationPermission(userData.id);
    } catch (err) {
      console.error('เรียกขอเปิดสิทธิ์แจ้งเตือนล้มเหลว:', err);
    }
  }, 3000);

  // เช็ค Deep Link ของการบ้าน (?hw=ID)
  setTimeout(() => checkUrlForSharedHomework(), 500);
}

function checkUrlForSharedHomework() {
  const urlParams = new URLSearchParams(window.location.search);
  const hwId = urlParams.get('hw');
  if (hwId) {
    const card = document.querySelector(`.hw-card[data-id="${hwId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlight-notif-target');
      setTimeout(() => card.classList.remove('highlight-notif-target'), 2000);
      
      // ลบ parameter ออกเพื่อไม่ให้ทำซ้ำถ้ารีเฟรช
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }
}

// ── Login Button ─────────────────────────────────────────
document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('google-signin-btn');
  setButtonLoading(btn, true);
  try { await signInWithGoogle(); }
  catch (err) { showToast(err.message, 'error'); }
  finally { setButtonLoading(btn, false); }
});

// ══════════════════════════════════════════════════════════
//  ROLE-BASED UI SETUP
// ══════════════════════════════════════════════════════════

function setupRoleUI() {
  const admin = isAdmin();
  // Show/hide admin controls
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !admin);
    // [BUG FIX] .header-admin-actions ต้องการ display:flex เมื่อแสดง
    // Tailwind `.hidden` = `display:none !important` ทับ `.flex` ได้
    // ดังนั้นต้อง toggle flex ด้วยเพื่อให้ layout ถูกต้อง
    if (el.classList.contains('header-admin-actions')) {
      el.classList.toggle('flex', admin);
    }
  });
  document.querySelectorAll('.user-only').forEach(el => {
    el.classList.toggle('hidden', admin);
  });
  // Nav tab
  document.getElementById('nav-admin-btn')?.classList.toggle('hidden', !admin);

  // Show/hide admin impersonation input panel if main admin is logged in
  const simPanel = document.getElementById('admin-simulation-panel');
  if (simPanel) {
    simPanel.classList.toggle('hidden', !canImpersonate() || isSimulating());
  }

  if (admin) {
    initAdminPanel();
    initUserFilter();
    initStudentTableSearch();
  }
}

// ══════════════════════════════════════════════════════════
//  NAV TABS
// ══════════════════════════════════════════════════════════

document.getElementById('nav-dashboard-btn')?.addEventListener('click', () => switchView('dashboard'));
document.getElementById('nav-calendar-btn')?.addEventListener('click', () => {
  switchView('calendar');
  renderCalendar();
});
document.getElementById('nav-admin-btn')?.addEventListener('click', () => switchView('admin'));

// Mobile Nav Buttons click handlers
document.getElementById('mobile-nav-dashboard-btn')?.addEventListener('click', () => {
  switchView('dashboard');
  toggleMobileSidebar(false);
});
document.getElementById('mobile-nav-calendar-btn')?.addEventListener('click', () => {
  switchView('calendar');
  renderCalendar();
  toggleMobileSidebar(false);
});
document.getElementById('mobile-nav-admin-btn')?.addEventListener('click', () => {
  switchView('admin');
  toggleMobileSidebar(false);
});

// Mobile Sidebar Admin Quick Action buttons
document.getElementById('mobile-open-subject-btn')?.addEventListener('click', () => {
  toggleMobileSidebar(false);
  renderSubjectList();
  openModal('subject-modal');
});
document.getElementById('mobile-open-add-hw-btn')?.addEventListener('click', () => {
  toggleMobileSidebar(false);
  openAddHwModal();
});

// Mobile Sidebar Profile & Signout buttons
document.getElementById('mobile-sidebar-profile-btn')?.addEventListener('click', () => {
  toggleMobileSidebar(false);
  populateProfileModal();
  updatePersonalStatsUI();
  openModal('profile-modal');
});
document.getElementById('mobile-sidebar-signout-btn')?.addEventListener('click', () => {
  toggleMobileSidebar(false);
  document.getElementById('signout-btn')?.click();
});

// Mobile Sidebar Toggle
document.getElementById('mobile-menu-toggle-btn')?.addEventListener('click', () => {
  toggleMobileSidebar(true);
});
document.getElementById('mobile-sidebar-close-btn')?.addEventListener('click', () => {
  toggleMobileSidebar(false);
});
document.getElementById('mobile-sidebar-backdrop')?.addEventListener('click', () => {
  toggleMobileSidebar(false);
});

// Interactive Bento Stat Hover Glow effect (Optimized)
let isBentoHoverScheduled = false;
document.addEventListener('mousemove', (e) => {
  if (isBentoHoverScheduled) return;
  const card = e.target.closest('.bento-stat');
  if (!card) return;
  
  isBentoHoverScheduled = true;
  requestAnimationFrame(() => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty('--glow-x', `${x}px`);
    card.style.setProperty('--glow-y', `${y}px`);
    isBentoHoverScheduled = false;
  });
}, { passive: true });

function toggleMobileSidebar(open) {
  const sidebar = document.getElementById('mobile-sidebar');
  const backdrop = document.getElementById('mobile-sidebar-backdrop');
  if (!sidebar || !backdrop) return;
  
  if (open) {
    backdrop.classList.remove('hidden');
    // For transition timing, add opacity in next frame
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      sidebar.classList.add('open');
    });
    document.body.style.overflow = 'hidden';
  } else {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
    // Hide backdrop after transition completes (300ms)
    setTimeout(() => {
      if (!sidebar.classList.contains('open')) {
        backdrop.classList.add('hidden');
      }
    }, 300);
    document.body.style.overflow = '';
  }
}

function switchView(view) {
  document.querySelectorAll('.main-view').forEach(el => el.classList.add('hidden'));
  document.getElementById(`view-${view}`)?.classList.remove('hidden');
  
  // Desktop navigation
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${view}-btn`)?.classList.add('active');

  // Mobile navigation
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`mobile-nav-${view}-btn`)?.classList.add('active');
}

// ══════════════════════════════════════════════════════════
//  DATA SUBSCRIPTIONS
// ══════════════════════════════════════════════════════════

function subscribeToData() {
  _unsubs.forEach(u => u());
  _unsubs = [];
  const uid = getUid();

  _unsubs.push(subscribeSubjects(data => {
    subjects = data;
    renderSubjectDropdown();
    renderSubjectList();
  }));

  _unsubs.push(subscribeHomeworks(data => {
    homeworks = data;
    renderDashboard();
    if (!document.getElementById('view-calendar').classList.contains('hidden')) {
      renderCalendar();
    }
  }));

  _unsubs.push(subscribeUserCompletions(uid, data => {
    completions = data;
    renderDashboard();
    if (!document.getElementById('view-calendar').classList.contains('hidden')) {
      renderCalendar();
    }
  }));

  _unsubs.push(subscribePersonalTasks(uid, data => {
    personalTasks = data;
    renderDashboard();
    if (!document.getElementById('view-calendar').classList.contains('hidden')) {
      renderCalendar();
    }
  }));

  _unsubs.push(subscribeUsers(data => {
    users = data;
    const panel = document.getElementById('hw-assign-dropdown-panel');
    let currentActive = ['all'];
    if (panel) {
      const active = [...panel.querySelectorAll('.hw-assign-checkbox:checked')].map(cb => cb.dataset.uid);
      if (active.length > 0) currentActive = active;
    }
    renderAssignDropdown(currentActive);
  }));

  _unsubs.push(subscribeNotifications(data => {
    notifications = data;
    renderNotifications();
  }));

  _unsubs.push(subscribeReadNotifications(uid, data => {
    readNotificationIds = data;
    renderNotifications();
  }));
}

// ══════════════════════════════════════════════════════════
//  CALENDAR VIEW
// ══════════════════════════════════════════════════════════

let currentCalDate = new Date();

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const title = document.getElementById('cal-month-year');
  if (!grid || !title) return;

  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  
  const monthNames = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  title.textContent = `${monthNames[month]} ${year}`;

  grid.innerHTML = '';

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const activeHws = [
    ...homeworks.map(h => ({...h, isPersonal: false})),
    ...personalTasks.map(t => ({...t, isPersonal: true}))
  ].filter(t => {
    if (t.isPersonal) return !t.isDone;
    return !completions[t.id]?.isDone;
  }).filter(t => t.dueDate);

  // blank days before 1st
  for (let i = 0; i < firstDay; i++) {
    const div = document.createElement('div');
    div.className = 'cal-cell cal-cell-empty';
    grid.appendChild(div);
  }

  const today = new Date();
  const nowTime = today.getTime();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const cell = document.createElement('div');
    cell.className = `cal-cell${isToday ? ' cal-cell-today' : ''}`;
    
    // Day number
    const dayNum = document.createElement('div');
    dayNum.className = `cal-day-num${isToday ? ' cal-day-num-today' : ''}`;
    dayNum.textContent = day;
    cell.appendChild(dayNum);
    
    // find tasks due on this day
    const dayTasks = activeHws.filter(t => {
      const d = t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year;
    });

    // Limit visible chips to avoid overflow, show +N more
    const maxVisible = 3;
    const visible = dayTasks.slice(0, maxVisible);
    const overflow = dayTasks.length - maxVisible;

    visible.forEach(t => {
      const dueDate = t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      const msLeft = dueDate.getTime() - nowTime;
      const daysLeft = Math.ceil(msLeft / 86400000);
      
      let chipClass = 'cal-chip';
      if (daysLeft < 0) chipClass += ' cal-chip-overdue';
      else if (daysLeft <= 3) chipClass += ' cal-chip-soon';
      else if (t.isPersonal) chipClass += ' cal-chip-personal';
      else chipClass += ' cal-chip-normal';

      const el = document.createElement('div');
      el.className = chipClass;
      el.textContent = t.subjectName || 'งาน';
      el.title = `${t.subjectName || 'งาน'}: ${t.description}`;
      el.addEventListener('click', () => {
        switchView('dashboard');
        setTimeout(() => {
          const card = document.querySelector(`.hw-card[data-id="${t.id}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('highlight-notif-target');
            setTimeout(() => card.classList.remove('highlight-notif-target'), 2000);
          }
        }, 100);
      });
      cell.appendChild(el);
    });

    if (overflow > 0) {
      const more = document.createElement('div');
      more.className = 'cal-chip-more';
      more.textContent = `+${overflow} อื่นๆ`;
      cell.appendChild(more);
    }

    grid.appendChild(cell);
  }
}

document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById('cal-next-btn')?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() + 1);
  renderCalendar();
});

// ══════════════════════════════════════════════════════════
//  HOMEWORK FILTERING (Data Retention)
// ══════════════════════════════════════════════════════════

function getVisibleHomeworks() {
  const uid = getUid();
  const admin = isAdmin();
  const now = new Date();
  const twoWeeksAgo = new Date(now - 14 * 86400000);
  const oneWeekAgo  = new Date(now - 7  * 86400000);

  return homeworks.filter(hw => {
    // Admins see all
    if (admin) return true;

    // Assignment filter
    const assigned = hw.assignedTo === 'all' ||
      (Array.isArray(hw.assignedTo) && hw.assignedTo.includes(uid));
    if (!assigned) return false;

    // Data retention: hide if dueDate older than 2 weeks
    if (hw.dueDate && hw.dueDate.toDate() < twoWeeksAgo) return false;

    // Hide completed tasks completed > 1 week ago
    const comp = completions[hw.id];
    if (comp?.isDone && comp?.completedAt) {
      const completedAt = comp.completedAt?.toDate?.() ?? new Date(0);
      if (completedAt < oneWeekAgo) return false;
    }

    return true;
  });
}

// ══════════════════════════════════════════════════════════
//  DASHBOARD RENDER
// ══════════════════════════════════════════════════════════

function renderDashboard() {
  const visibleHw = getVisibleHomeworks();
  const ptList = personalTasks.map(t => ({
    ...t,
    isPersonal: true
  }));

  const allTasks = [...visibleHw, ...ptList];

  // 1. Search Filter
  let filteredTasks = allTasks;
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filteredTasks = filteredTasks.filter(t => 
      (t.subjectName && t.subjectName.toLowerCase().includes(q)) || 
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  // 2. Status Filter
  const now = new Date();
  if (_filterStatus !== 'all') {
    filteredTasks = filteredTasks.filter(t => {
      const isDone = t.isPersonal ? t.isDone : completions[t.id]?.isDone;
      if (_filterStatus === 'pending') return !isDone;
      if (_filterStatus === 'done') return isDone;
      if (_filterStatus === 'overdue') {
        if (isDone) return false;
        if (!t.dueDate) return false;
        const dueTime = t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
        return dueTime < now;
      }
      return true;
    });
  }

  // 3. Sort (Pin first, then by selected sort)
  filteredTasks.sort((a, b) => {
    // Pin sorting
    const isAPinned = a.isPersonal ? a.isPinned : completions[a.id]?.isPinned;
    const isBPinned = b.isPersonal ? b.isPinned : completions[b.id]?.isPinned;
    if (isAPinned && !isBPinned) return -1;
    if (!isAPinned && isBPinned) return 1;

    if (_sortBy === 'subject_asc') {
      const sA = a.subjectName || '';
      const sB = b.subjectName || '';
      return sA.localeCompare(sB, 'th');
    }
    
    // Default: date sorting
    const aD = a.dueDate, bD = b.dueDate;
    let diff = 0;
    if (aD && !bD) diff = -1;
    else if (!aD && bD) diff = 1;
    else if (aD && bD) {
      diff = (aD.toDate ? aD.toDate() : new Date(aD)) - (bD.toDate ? bD.toDate() : new Date(bD));
    } else {
      const aC = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bC = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      diff = aC - bC;
    }

    return _sortBy === 'date_desc' ? -diff : diff;
  });

  const active    = filteredTasks.filter(t => t.isPersonal ? !t.isDone : !completions[t.id]?.isDone);
  const completed = filteredTasks.filter(t => t.isPersonal ? t.isDone : completions[t.id]?.isDone);

  // Stats
  document.getElementById('stat-total').textContent   = filteredTasks.length;
  document.getElementById('stat-pending').textContent = active.length;
  document.getElementById('stat-done').textContent    = completed.length;

  // Update floating bell notifications
  renderNotifications();

  // Empty state & Sections visibility
  const activeSection    = document.getElementById('active-section');
  const completedSection = document.getElementById('completed-section');

  if (activeSection) activeSection.style.display = 'block';
  if (completedSection) completedSection.style.display = completed.length ? 'block' : 'none';

  // Render cards
  const activeList = document.getElementById('active-homework-list');
  if (activeList) {
    activeList.innerHTML = '';
    if (active.length === 0) {
      activeList.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-state-icon-wrapper">
            <span class="empty-state-icon">🎉</span>
          </div>
          <h3 class="empty-state-title">ไม่มีงานค้างในขณะนี้</h3>
          <p class="empty-state-desc">คุณทำการบ้านและบันทึกงานส่วนตัวเสร็จสิ้นครบถ้วนแล้ว!</p>
        </div>
      `;
    } else {
      const fragment = document.createDocumentFragment();
      active.forEach((hw, i) => {
        const isPinned = hw.isPersonal ? hw.isPinned : completions[hw.id]?.isPinned;
        const card = createHwCard(hw, false, isPinned);
        card.style.animationDelay = `${i * 40}ms`;
        fragment.appendChild(card);
      });
      activeList.appendChild(fragment);
    }
  }

  const completedList = document.getElementById('completed-homework-list');
  if (completedList) {
    completedList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    completed
      .slice().sort((a, b) => {
        const getCompTime = (t) => {
          if (t.isPersonal) {
            return t.completedAt?.toDate ? t.completedAt.toDate().getTime() : 0;
          } else {
            return completions[t.id]?.completedAt?.toDate?.()?.getTime() ?? 0;
          }
        };
        return getCompTime(b) - getCompTime(a);
      })
      .forEach((hw, i) => {
        const isPinned = hw.isPersonal ? hw.isPinned : completions[hw.id]?.isPinned;
        const card = createHwCard(hw, true, isPinned);
        card.style.animationDelay = `${i * 40}ms`;
        fragment.appendChild(card);
      });
    completedList.appendChild(fragment);
  }
}

// ══════════════════════════════════════════════════════════
//  HOMEWORK CARD
// ══════════════════════════════════════════════════════════

function createHwCard(hw, isDone, isPinned = false) {
  const admin   = isAdmin();
  const status  = getStatus(hw, isDone);
  const label   = getDeadlineLabel(hw.dueDate, status);

  let tagsHTML = '';
  
  // Priority Badge
  let priorityBadge = '';
  if (!hw.isPersonal && hw.priority) {
    const pStr = escapeHtml(hw.priority);
    if (pStr === 'high') priorityBadge = '<span class="hw-assign-badge bg-rose-100 text-rose-700 border-rose-200">ด่วนมาก</span>';
    else if (pStr === 'low') priorityBadge = '<span class="hw-assign-badge bg-emerald-100 text-emerald-700 border-emerald-200">ไม่เร่งด่วน</span>';
  }

  // Admin Progress Bar
  let progressHTML = '';
  if (admin && !hw.isPersonal && _adminStats) {
    let assignedCount = _adminStats.totalStudents;
    if (hw.assignedTo && hw.assignedTo !== 'all') {
      assignedCount = Array.isArray(hw.assignedTo) ? hw.assignedTo.length : 1;
    }
    const completedCount = _adminStats.completedCounts[hw.id] || 0;
    const pct = assignedCount > 0 ? Math.round((completedCount / assignedCount) * 100) : 0;
    
    // Determine color based on pct
    let barColor = 'bg-slate-300';
    if (pct >= 80) barColor = 'bg-emerald-500';
    else if (pct >= 50) barColor = 'bg-amber-500';
    else if (pct > 0) barColor = 'bg-primary';

    progressHTML = `
      <div class="mt-2 w-full">
        <div class="flex justify-between text-[10px] text-slate-500 mb-1 font-medium px-0.5">
          <span>ส่งแล้ว ${completedCount}/${assignedCount} คน</span>
          <span>${pct}%</span>
        </div>
        <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden border border-slate-200 dark:border-slate-700">
          <div class="${barColor} h-1.5 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }

  if (hw.isPersonal) {
    tagsHTML = `<span class="hw-subject-tag hw-subject-personal">${hw.subjectName}</span>
                <span class="hw-assign-badge">ส่วนตัว</span>`;
  } else {
    const assignLabel = hw.assignedTo === 'all'
      ? '' : `<span class="hw-assign-badge">เฉพาะบุคคล</span>`;
    tagsHTML = `<span class="hw-subject-tag">${hw.subjectName}</span>${assignLabel}${priorityBadge}`;
  }

  const card = document.createElement('div');
  card.className = `hw-card status-${status}${isDone ? ' is-done' : ''}${hw.isPersonal ? ' hw-card-personal' : ''}${isPinned ? ' hw-card-pinned' : ''}`;
  card.dataset.id = hw.id;

  const attachHTML = (!hw.isPersonal && hw.attachments?.length)
    ? `<div class="hw-attachments">${hw.attachments.map(a =>
        `<a href="${a.url}" target="_blank" class="hw-attach-link">📎 ${a.name}</a>`
      ).join('')}</div>` : '';

  // Can edit/delete:
  // Personal tasks: owner can edit (if not done) / delete (always).
  // Homeworks: admin can always edit/delete regardless of isDone status
  //   (isDone is per-user completion, admin manages the global homework record).
  const canEdit = hw.isPersonal ? !isDone : admin;
  const canDelete = hw.isPersonal ? true : admin;

  card.innerHTML = `
    <div class="hw-card-left">
      <button class="check-btn ${isDone ? 'checked' : ''}"
        data-hw-id="${hw.id}" data-is-done="${isDone}"
        title="${isDone ? 'ยกเลิกสถานะเสร็จ' : 'ทำเสร็จแล้ว'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </button>
    </div>
    <div class="hw-card-body relative">
      <div class="hw-card-tags">
        ${tagsHTML}
      </div>
      <p class="hw-description">${escapeHtml(hw.description)}</p>
      ${attachHTML}
      ${progressHTML}
      <div class="hw-meta mt-1">
        <span class="hw-deadline deadline-${status}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          ${label}
        </span>
      </div>
    </div>
    <div class="hw-card-actions">
      ${!hw.isPersonal ? `<button class="action-btn text-slate-300 hover:text-indigo-500 transition-colors" data-comment-btn title="แชท/คอมเมนต์">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>` : ''}
      <button class="action-btn text-slate-300 hover:text-emerald-500 transition-colors" data-note-btn title="หมายเหตุส่วนตัว">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      </button>
      <button class="action-btn text-slate-300 hover:text-primary transition-colors" data-share-btn title="คัดลอกลิงก์">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      </button>
      <button class="action-btn pin-btn ${isPinned ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500'}" data-pin-btn title="${isPinned ? 'เลิกปักหมุด' : 'ปักหมุด'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
      </button>
      ${canEdit ? `<button class="action-btn edit-btn" data-edit-btn title="แก้ไข">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>` : ''}
      ${canDelete ? `<button class="action-btn delete-btn" data-delete-btn title="ลบ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>` : ''}
    </div>`;

  // Checkbox handler
  card.querySelector('.check-btn')?.addEventListener('click', () => {
    if (hw.isPersonal) {
      handleTogglePersonalDone(hw.id, isDone);
    } else {
      handleToggleDone(hw, isDone);
    }
  });

  // Pin handler
  card.querySelector('[data-pin-btn]')?.addEventListener('click', () => {
    const uid = getUid();
    if (!uid) return;
    if (hw.isPersonal) {
      togglePinPersonalTask(uid, hw.id, isPinned);
    } else {
      togglePinHomework(uid, hw.id, isPinned);
    }
  });

  // Share handler — with HTTP fallback for non-secure contexts
  card.querySelector('[data-share-btn]')?.addEventListener('click', () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?hw=${hw.id}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('คัดลอกลิงก์การบ้านเรียบร้อยแล้ว');
      }).catch(() => {
        _fallbackCopyText(shareUrl);
      });
    } else {
      _fallbackCopyText(shareUrl);
    }
  });

  // Note handler
  card.querySelector('[data-note-btn]')?.addEventListener('click', () => {
    openNoteModal(hw);
  });

  // Comment handler
  card.querySelector('[data-comment-btn]')?.addEventListener('click', () => {
    openCommentModal(hw);
  });

  // Edit handler
  card.querySelector(`[data-edit-btn]`)?.addEventListener('click', () => {
    if (hw.isPersonal) {
      openEditPersonalTaskModal(hw);
    } else {
      openEditHwModal(hw);
    }
  });

  // Delete handler
  card.querySelector(`[data-delete-btn]`)?.addEventListener('click', () => {
    if (hw.isPersonal) {
      handleDeletePersonalTask(hw.id);
    } else {
      handleDeleteHw(hw.id);
    }
  });

  return card;
}

// ══════════════════════════════════════════════════════════
//  COMPLETION HANDLERS
// ══════════════════════════════════════════════════════════

async function handleToggleDone(hw, currentDone) {
  if (!currentDone) {
    // Marking as done — show confirmation
    const ok = await showConfirm({
      title: 'ยืนยันว่าทำเสร็จแล้ว?',
      message: `<strong>${hw.description}</strong>`,
      detail: `วิชา: ${hw.subjectName} ${hw.dueDate ? '• กำหนดส่ง: ' + formatDate(hw.dueDate) : ''}`,
      confirmText: '✓ ยืนยัน', cancelText: 'ยกเลิก'
    });
    if (!ok) return;
  }
  try {
    await setCompletion(getUid(), hw.id, !currentDone);
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function handleDeleteHw(id) {
  const ok = await showConfirm({ title: 'ลบการบ้าน', message: 'ต้องการลบการบ้านนี้หรือไม่?', danger: true, confirmText: 'ลบ' });
  if (!ok) return;
  try {
    await deleteHomework(id);
    showToast('ลบการบ้านเรียบร้อยแล้ว');
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function handleTogglePersonalDone(id, currentDone) {
  if (!currentDone) {
    const task = personalTasks.find(t => t.id === id);
    const ok = await showConfirm({
      title: 'ยืนยันว่าทำเสร็จแล้ว?',
      message: `<strong>${task?.description ?? ''}</strong>`,
      detail: `วิชา: ${task?.subjectName ?? 'ส่วนตัว'} ${task?.dueDate ? '• กำหนดส่ง: ' + formatDate(task.dueDate) : ''}`,
      confirmText: '✓ ยืนยัน', cancelText: 'ยกเลิก'
    });
    if (!ok) return;
  }
  try {
    await togglePersonalTask(getUid(), id, currentDone);
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function handleDeletePersonalTask(id) {
  const ok = await showConfirm({ title: 'ลบงานส่วนตัว', message: 'ต้องการลบงานนี้หรือไม่?', danger: true, confirmText: 'ลบ' });
  if (!ok) return;
  try {
    await deletePersonalTask(getUid(), id);
    showToast('ลบงานเรียบร้อยแล้ว');
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function openEditPersonalTaskModal(task) {
  editingPersonalTaskId = task.id;
  document.getElementById('pt-description').value = task.description;
  
  const subjectId = task.subjectId || '';
  document.getElementById('pt-subject').value = subjectId;
  const customInput = document.getElementById('pt-subject-custom');
  if (customInput) {
    if (subjectId === 'other') {
      customInput.classList.remove('hidden');
      customInput.required = true;
      customInput.value = task.subjectName || '';
    } else {
      customInput.classList.add('hidden');
      customInput.required = false;
      customInput.value = '';
    }
  }

  if (task.dueDate) {
    document.getElementById('pt-due-date').value = formatDateInput(task.dueDate);
  } else {
    document.getElementById('pt-due-date').value = '';
  }
  document.getElementById('pt-modal-title').textContent = 'แก้ไขงานส่วนตัว';
  document.getElementById('pt-save-btn').textContent    = 'บันทึก';
  openModal('personal-task-modal');
}

// ══════════════════════════════════════════════════════════
//  HOMEWORK MODAL (Add / Edit — Admin)
// ══════════════════════════════════════════════════════════

function openAddHwModal() {
  editingHwId = null;
  pendingAttachments = [];
  document.getElementById('hw-form').reset();
  
  const customInput = document.getElementById('hw-subject-custom');
  if (customInput) {
    customInput.classList.add('hidden');
    customInput.required = false;
    customInput.value = '';
  }

  document.getElementById('hw-modal-title').textContent = 'เพิ่มการบ้านใหม่';
  document.getElementById('hw-save-btn').textContent    = 'บันทึก';
  document.getElementById('hw-no-due-date').checked = false;
  document.getElementById('hw-due-date').disabled   = false;
  document.getElementById('hw-priority').value      = 'normal';
  renderAssignDropdown(['all']);
  const panel = document.getElementById('hw-assign-dropdown-panel');
  if (panel) {
    panel.classList.add('hidden');
    document.getElementById('hw-assign-dropdown-chevron')?.classList.remove('rotate-180');
  }
  renderAttachmentList([]);
  openModal('homework-modal');
  setTimeout(() => document.getElementById('hw-description').focus(), 100);
}

function openEditHwModal(hw) {
  editingHwId = hw.id;
  pendingAttachments = [];
  document.getElementById('hw-form').reset();
  document.getElementById('hw-modal-title').textContent = 'แก้ไขการบ้าน';
  document.getElementById('hw-save-btn').textContent    = 'อัปเดต';
  document.getElementById('hw-description').value       = hw.description;
  
  document.getElementById('hw-subject').value = hw.subjectId;
  const customInput = document.getElementById('hw-subject-custom');
  if (customInput) {
    if (hw.subjectId === 'other') {
      customInput.classList.remove('hidden');
      customInput.required = true;
      customInput.value = hw.subjectName || '';
    } else {
      customInput.classList.add('hidden');
      customInput.required = false;
      customInput.value = '';
    }
  }

  const noDue = !hw.dueDate;
  document.getElementById('hw-no-due-date').checked = noDue;
  document.getElementById('hw-due-date').disabled   = noDue;
  if (hw.dueDate) document.getElementById('hw-due-date').value = formatDateInput(hw.dueDate);

  document.getElementById('hw-priority').value = hw.priority || 'normal';

  // Assignment
  renderAssignDropdown(hw.assignedTo || 'all');
  const panel = document.getElementById('hw-assign-dropdown-panel');
  if (panel) {
    panel.classList.add('hidden');
    document.getElementById('hw-assign-dropdown-chevron')?.classList.remove('rotate-180');
  }

  renderAttachmentList(hw.attachments || []);
  openModal('homework-modal');
}

// No due date checkbox
document.getElementById('hw-no-due-date')?.addEventListener('change', e => {
  document.getElementById('hw-due-date').disabled = e.target.checked;
  if (e.target.checked) document.getElementById('hw-due-date').value = '';
});

// ดักจับการเลือกวิชา "อื่น ๆ"
document.getElementById('hw-subject')?.addEventListener('change', e => {
  const customInput = document.getElementById('hw-subject-custom');
  if (customInput) {
    if (e.target.value === 'other') {
      customInput.classList.remove('hidden');
      customInput.required = true;
      customInput.focus();
    } else {
      customInput.classList.add('hidden');
      customInput.required = false;
      customInput.value = '';
    }
  }
});

document.getElementById('pt-subject')?.addEventListener('change', e => {
  const customInput = document.getElementById('pt-subject-custom');
  if (customInput) {
    if (e.target.value === 'other') {
      customInput.classList.remove('hidden');
      customInput.required = true;
      customInput.focus();
    } else {
      customInput.classList.add('hidden');
      customInput.required = false;
      customInput.value = '';
    }
  }
});

// Cancel/open buttons
document.getElementById('open-add-hw-btn')?.addEventListener('click', openAddHwModal);
document.getElementById('hw-cancel-btn')?.addEventListener('click', () => closeModal('homework-modal'));
document.getElementById('homework-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('homework-modal')) closeModal('homework-modal');
});

// Homework Assignment Custom Dropdown Toggle
const dropdownBtn = document.getElementById('hw-assign-dropdown-btn');
const dropdownPanel = document.getElementById('hw-assign-dropdown-panel');
const dropdownChevron = document.getElementById('hw-assign-dropdown-chevron');

dropdownBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = !dropdownPanel.classList.contains('hidden');
  if (isOpen) {
    dropdownPanel.classList.add('hidden');
    dropdownChevron?.classList.remove('rotate-180');
  } else {
    dropdownPanel.classList.remove('hidden');
    dropdownChevron?.classList.add('rotate-180');
  }
});

// Close custom dropdown when clicking outside (handle SVG child clicks via closest)
document.addEventListener('click', e => {
  if (dropdownPanel && !dropdownPanel.contains(e.target) && !e.target.closest('#hw-assign-dropdown-btn')) {
    dropdownPanel.classList.add('hidden');
    dropdownChevron?.classList.remove('rotate-180');
  }
});

// File attachment input
document.getElementById('hw-file-input')?.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  files.forEach(f => {
    if (!pendingAttachments.find(p => p.name === f.name)) pendingAttachments.push(f);
  });
  renderPendingAttachments();
  e.target.value = '';
});

function renderPendingAttachments() {
  const list = document.getElementById('hw-pending-attachments');
  if (!list) return;
  list.innerHTML = pendingAttachments.map((f, i) =>
    `<div class="attach-pending">📎 ${f.name} <button type="button" class="attach-remove-btn" data-idx="${i}">×</button></div>`
  ).join('');
  list.querySelectorAll('.attach-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingAttachments.splice(+btn.dataset.idx, 1);
      renderPendingAttachments();
    });
  });
}

function renderAttachmentList(attachments) {
  const list = document.getElementById('hw-existing-attachments');
  if (!list) return;
  list.innerHTML = attachments.map(a =>
    `<div class="attach-existing">📎 <a href="${a.url}" target="_blank">${a.name}</a></div>`
  ).join('');
  pendingAttachments = [];
  renderPendingAttachments();
}

// Form submit
document.getElementById('hw-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('hw-save-btn');
  // Capture isEditing before any async ops (state may change after closeModal)
  const isEditing = !!editingHwId;
  const savedEditId = editingHwId;
  setButtonLoading(btn, true);

  try {
    const description = document.getElementById('hw-description').value.trim();
    let subjectId     = document.getElementById('hw-subject').value;
    if (!description) throw new Error('กรุณาใส่รายละเอียดการบ้าน');
    if (!subjectId)   throw new Error('กรุณาเลือกวิชา');
    let subjectName   = '';
    if (subjectId === 'other') {
      subjectName = document.getElementById('hw-subject-custom').value.trim();
      if (!subjectName) throw new Error('กรุณากรอกชื่อวิชา');
      subjectId = 'other';
    } else {
      subjectName = subjects.find(s => s.id === subjectId)?.name ?? '';
    }
    const noDue       = document.getElementById('hw-no-due-date').checked;
    const dueDate     = noDue ? null : document.getElementById('hw-due-date').value || null;
    const panel = document.getElementById('hw-assign-dropdown-panel');
    const checkedCbs = panel
      ? [...panel.querySelectorAll('.hw-assign-checkbox:checked')].map(cb => cb.dataset.uid)
      : ['all'];
    let assignedTo = 'all';
    if (checkedCbs.length > 0 && !checkedCbs.includes('all')) {
      assignedTo = checkedCbs;
    }
    const priority = document.getElementById('hw-priority').value;

    // Upload pending files
    let uploadedFiles = [];
    for (const file of pendingAttachments) {
      try {
        const result = await uploadFileToDrive(file);
        uploadedFiles.push(result);
      } catch (uploadErr) {
        showToast(`อัปโหลด ${file.name} ไม่สำเร็จ: ${uploadErr.message}`, 'error');
      }
    }

    if (isEditing) {
      const existingHw = homeworks.find(h => h.id === savedEditId);
      const existingAttachments = existingHw?.attachments ?? [];
      await updateHomework(savedEditId, {
        description, subjectId, subjectName, dueDate, assignedTo, priority,
        attachments: [...existingAttachments, ...uploadedFiles]
      });
      showToast('อัปเดตการบ้านเรียบร้อยแล้ว');
    } else {
      await addHomework({ description, subjectId, subjectName, dueDate, assignedTo, priority, attachments: uploadedFiles, createdBy: getUid() });
      showToast('เพิ่มการบ้านเรียบร้อยแล้ว');

      // 🔥 ส่งพุชแจ้งเตือนนักเรียนทุกคนผ่าน GAS
      try {
        await triggerPushNotification({
          title: `📚 มีการบ้านใหม่วิชา: ${subjectName}`,
          body: description.length > 50 ? description.substring(0, 50) + "..." : description,
          topic: 'all_users',
          clickAction: window.location.origin
        });
      } catch (pushErr) {
        console.error('ไม่สามารถส่งพุชแจ้งเตือนได้:', pushErr);
      }
    }
    closeModal('homework-modal');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  } finally {
    setButtonLoading(btn, false, isEditing ? 'อัปเดต' : 'บันทึก');
  }
});

// ══════════════════════════════════════════════════════════
//  ASSIGN USER DROPDOWN
// ══════════════════════════════════════════════════════════

function renderAssignDropdown(selectedUids = ['all']) {
  const panel = document.getElementById('hw-assign-dropdown-panel');
  if (!panel) return;

  const registeredUsers = users.filter(u => u.linkedStudentId && u.role === 'user');

  let uidsSet;
  if (selectedUids === 'all') {
    uidsSet = new Set(['all']);
  } else if (Array.isArray(selectedUids)) {
    uidsSet = new Set(selectedUids);
  } else {
    uidsSet = new Set([selectedUids]);
  }

  if (uidsSet.size === 0) {
    uidsSet.add('all');
  }

  // Generate HTML
  let html = `
    <label class="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-50 cursor-pointer text-sm transition-colors select-none">
      <input type="checkbox" class="hw-assign-checkbox accent-primary rounded w-4 h-4 border-slate-300" data-uid="all" ${uidsSet.has('all') ? 'checked' : ''} />
      <span class="font-medium text-slate-700">ทุกคน</span>
    </label>
  `;

  html += registeredUsers.map(u => {
    const isChecked = uidsSet.has(u.id);
    return `
      <label class="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-50 cursor-pointer text-sm transition-colors select-none">
        <input type="checkbox" class="hw-assign-checkbox accent-primary rounded w-4 h-4 border-slate-300" data-uid="${u.id}" ${isChecked ? 'checked' : ''} />
        <span class="font-medium text-slate-700">${u.displayName || u.email} (${u.linkedStudentId})</span>
      </label>
    `;
  }).join('');

  panel.innerHTML = html;

  // Add event listener to each checkbox
  const checkboxes = panel.querySelectorAll('.hw-assign-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => handleAssignCheckboxChange(cb, panel));
  });

  // Update dropdown label text
  updateAssignDropdownLabel(panel);
}

function handleAssignCheckboxChange(changedCb, panel) {
  const uid = changedCb.dataset.uid;
  const checkboxes = panel.querySelectorAll('.hw-assign-checkbox');
  const allCb = panel.querySelector('.hw-assign-checkbox[data-uid="all"]');

  if (uid === 'all') {
    if (changedCb.checked) {
      checkboxes.forEach(cb => {
        if (cb.dataset.uid !== 'all') cb.checked = false;
      });
    } else {
      changedCb.checked = true;
    }
  } else {
    if (changedCb.checked) {
      if (allCb) allCb.checked = false;
    } else {
      const anyChecked = [...checkboxes].some(cb => cb.dataset.uid !== 'all' && cb.checked);
      if (!anyChecked && allCb) {
        allCb.checked = true;
      }
    }
  }

  updateAssignDropdownLabel(panel);
}

function updateAssignDropdownLabel(panel) {
  const label = document.getElementById('hw-assign-dropdown-label');
  if (!label) return;

  const checkboxes = panel.querySelectorAll('.hw-assign-checkbox');
  const allCb = panel.querySelector('.hw-assign-checkbox[data-uid="all"]');

  if (allCb && allCb.checked) {
    label.textContent = 'ทุกคน';
    label.classList.remove('text-primary');
    label.classList.add('text-slate-700');
  } else {
    const checkedCbs = [...checkboxes].filter(cb => cb.dataset.uid !== 'all' && cb.checked);
    const count = checkedCbs.length;
    if (count === 0) {
      label.textContent = 'ทุกคน';
      label.classList.remove('text-primary', 'font-semibold');
      label.classList.add('text-slate-700');
    } else {
      // Safe: nextElementSibling should be the <span> with the name
      const names = checkedCbs.map(cb => cb.nextElementSibling?.textContent?.trim() ?? '');
      label.textContent = `เลือก ${count} คน: ${names.filter(Boolean).join(', ')}`;
      label.classList.remove('text-slate-700');
      label.classList.add('text-primary', 'font-semibold');
    }
  }
}

// ══════════════════════════════════════════════════════════
//  SUBJECT MODAL (Admin)
// ══════════════════════════════════════════════════════════

document.getElementById('open-subject-btn')?.addEventListener('click', () => {
  renderSubjectList();
  openModal('subject-modal');
});
document.getElementById('close-subject-modal-btn')?.addEventListener('click', () => closeModal('subject-modal'));
document.getElementById('subject-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('subject-modal')) closeModal('subject-modal');
});

document.getElementById('add-subject-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('new-subject-input');
  const name  = input.value.trim();
  if (!name) return input.focus();
  try {
    await addSubject(name);
    input.value = '';
    input.focus();
    showToast(`เพิ่มวิชา "${name}" เรียบร้อยแล้ว`);
  } catch (err) { showToast(err.message, 'error'); }
});

document.getElementById('new-subject-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-subject-btn').click(); }
});

function renderSubjectDropdown() {
  const select = document.getElementById('hw-subject');
  const ptSelect = document.getElementById('pt-subject');
  const activeSubjects = subjects.filter(s => !s.isDeleted);
  
  if (select) {
    select.innerHTML = `<option value="">-- เลือกวิชา --</option>` +
      activeSubjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('') +
      `<option value="other">อื่น ๆ (ระบุเอง)</option>`;
  }
  
  if (ptSelect) {
    ptSelect.innerHTML = `<option value="">-- ไม่ระบุวิชา --</option>` +
      activeSubjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('') +
      `<option value="other">อื่น ๆ (ระบุเอง)</option>`;
  }
}

function renderSubjectList() {
  const list = document.getElementById('subject-list');
  if (!list) return;
  if (subjects.length === 0) {
    list.innerHTML = `<div class="text-center py-6 text-slate-400 text-sm">ยังไม่มีวิชา</div>`;
    return;
  }
  list.innerHTML = subjects.map(s => `
    <div class="subject-item ${s.isDeleted ? 'is-deleted' : ''}">
      <span class="text-sm font-medium">${s.name}</span>
      <div class="flex items-center gap-1.5">
        ${s.isDeleted
          ? `<span class="badge badge-pending text-xs">ซ่อนอยู่</span>
             <button class="btn-xs" onclick="window._restoreSubject('${s.id}')" title="กู้คืนวิชา">↩ กู้คืน</button>`
          : `<button class="btn-xs" onclick="window._softDeleteSubject('${s.id}')" title="ซ่อนวิชา">ซ่อน</button>`
        }
        <button class="btn-xs btn-xs-edit" onclick="window._editSubjectName('${s.id}')" title="แก้ไขชื่อวิชา">✏️ แก้ไข</button>
        <button class="btn-xs btn-xs-danger" onclick="window._deleteSubjectRecord('${s.id}')" title="ลบวิชาถาวร">✕ ลบ</button>
      </div>
    </div>`).join('');
}

window._softDeleteSubject = async (id) => {
  const ok = await showConfirm({
    title: 'ซ่อนวิชา', message: 'วิชานี้จะถูกซ่อนจาก Dropdown แต่การบ้านเดิมจะยังคงแสดงชื่อวิชาตามปกติ',
    confirmText: 'ซ่อนวิชา'
  });
  if (!ok) return;
  try { await softDeleteSubject(id); showToast('ซ่อนวิชาเรียบร้อยแล้ว'); }
  catch (err) { showToast(err.message, 'error'); }
};

window._restoreSubject = async (id) => {
  try { await restoreSubject(id); showToast('กู้คืนวิชาเรียบร้อยแล้ว'); }
  catch (err) { showToast(err.message, 'error'); }
};

window._editSubjectName = async (id) => {
  const subject = subjects.find(s => s.id === id);
  if (!subject) return;

  const newName = prompt('แก้ไขชื่อวิชา:', subject.name);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: 'ชื่อวิชาต้องไม่ว่างเปล่า', type: 'error' });
    return;
  }
  
  try {
    await updateSubject(id, trimmed);
    showToast(`แก้ไขชื่อวิชาเรียบร้อยแล้ว`);
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  }
};

window._deleteSubjectRecord = async (id) => {
  const subject = subjects.find(s => s.id === id);
  if (!subject) return;

  const ok = await showConfirm({
    title: 'ลบวิชาเรียนถาวร',
    message: `ต้องการลบวิชา <strong>${subject.name}</strong> หรือไม่?`,
    detail: 'การบ้าน/งานที่มีวิชานี้อยู่จะถูกแสดงเป็นขีด (-) การดำเนินการนี้ไม่สามารถยกเลิกได้',
    danger: true,
    confirmText: 'ลบวิชาถาวร',
    cancelText: 'ยกเลิก'
  });
  if (!ok) return;

  try {
    await deleteSubjectRecord(id);
    showToast(`ลบวิชาถาวรเรียบร้อยแล้ว`);
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  }
};

// ══════════════════════════════════════════════════════════
//  PERSONAL TASKS (User only)
// ══════════════════════════════════════════════════════════

// Personal task modal
document.getElementById('add-personal-task-btn')?.addEventListener('click', () => {
  editingPersonalTaskId = null;
  document.getElementById('pt-form').reset();
  
  const customInput = document.getElementById('pt-subject-custom');
  if (customInput) {
    customInput.classList.add('hidden');
    customInput.required = false;
    customInput.value = '';
  }

  document.getElementById('pt-modal-title').textContent = 'เพิ่มงานส่วนตัว';
  document.getElementById('pt-save-btn').textContent    = 'บันทึก';
  openModal('personal-task-modal');
  setTimeout(() => document.getElementById('pt-description').focus(), 100);
});

document.getElementById('pt-cancel-btn')?.addEventListener('click', () => closeModal('personal-task-modal'));
document.getElementById('personal-task-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('personal-task-modal')) closeModal('personal-task-modal');
});

document.getElementById('pt-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('pt-save-btn');
  const isEditingPt = !!editingPersonalTaskId;
  setButtonLoading(btn, true);
  const uid = getUid();
  if (!uid) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: 'กรุณาเข้าสู่ระบบก่อน', type: 'error' });
    setButtonLoading(btn, false, 'บันทึก');
    return;
  }
  try {
    const desc      = document.getElementById('pt-description').value.trim();
    if (!desc) throw new Error('กรุณาใส่รายละเอียดงาน');
    let subjectId   = document.getElementById('pt-subject').value;
    let subjectName = 'ส่วนตัว';
    if (subjectId === 'other') {
      subjectName = document.getElementById('pt-subject-custom').value.trim();
      if (!subjectName) throw new Error('กรุณากรอกชื่อวิชา');
      subjectId = 'other';
    } else {
      subjectName = subjects.find(s => s.id === subjectId)?.name ?? 'ส่วนตัว';
    }
    const dueDate   = document.getElementById('pt-due-date').value || null;
    if (isEditingPt) {
      await updatePersonalTask(uid, editingPersonalTaskId, { description: desc, subjectId, subjectName, dueDate });
      showToast('แก้ไขงานส่วนตัวเรียบร้อยแล้ว');
    } else {
      await addPersonalTask(uid, { description: desc, subjectId, subjectName, dueDate });
      showToast('เพิ่มงานส่วนตัวเรียบร้อยแล้ว');
    }
    closeModal('personal-task-modal');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  } finally {
    setButtonLoading(btn, false, 'บันทึก');
  }
});


// ══════════════════════════════════════════════════════════
//  PERSONAL NOTE MODAL
// ══════════════════════════════════════════════════════════

window.openNoteModal = (hw) => {
  document.getElementById('note-hw-id').value = hw.id;
  const currentNote = hw.isPersonal ? hw.note : completions[hw.id]?.note;
  document.getElementById('note-text').value = currentNote || '';
  openModal('personal-note-modal');
};

document.getElementById('close-note-modal-btn')?.addEventListener('click', () => {
  closeModal('personal-note-modal');
});

document.getElementById('note-cancel-btn')?.addEventListener('click', () => {
  closeModal('personal-note-modal');
});

document.getElementById('personal-note-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('note-save-btn');
  setButtonLoading(btn, true, 'กำลังบันทึก...');
  try {
    const hwId = document.getElementById('note-hw-id').value;
    const text = document.getElementById('note-text').value.trim();
    
    // Check if it's a personal task or global homework
    const hw = homeworks.find(h => h.id === hwId) || personalTasks.find(t => t.id === hwId);
    if (!hw) throw new Error('ไม่พบงานที่อ้างอิง');
    
    if (hw.isPersonal) {
      // For personal tasks, save note directly to the task document
      await updatePersonalTask(getUid(), hwId, { note: text });
    } else {
      // For global homework, save to completions collection
      await savePersonalNote(getUid(), hwId, text);
    }
    
    showToast('บันทึกหมายเหตุส่วนตัวเรียบร้อยแล้ว');
    closeModal('personal-note-modal');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  } finally {
    setButtonLoading(btn, false, 'บันทึกหมายเหตุ');
  }
});


// ══════════════════════════════════════════════════════════
//  COMMENT MODAL
// ══════════════════════════════════════════════════════════

let currentCommentUnsub = null;

window.openCommentModal = (hw) => {
  document.getElementById('comment-hw-id').value = hw.id;
  const list = document.getElementById('comment-list');
  list.innerHTML = `<div class="flex items-center justify-center py-10"><div class="loading-spinner"></div></div>`;
  
  openModal('comment-modal');
  
  const hwId = document.getElementById('comment-hw-id').value;
  const clearBtn = document.getElementById('clear-all-comments-btn');
  if (clearBtn) {
    if (isAdmin()) {
      clearBtn.classList.remove('hidden');
      clearBtn.onclick = async () => {
        if (!confirm('ยืนยันการล้างคอมเมนต์ทั้งหมดของงานนี้? (ไม่สามารถกู้คืนได้)')) return;
        try {
          await deleteAllComments(hwId);
          showToast('ล้างคอมเมนต์เรียบร้อยแล้ว');
        } catch (err) {
          showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
        }
      };
    } else {
      clearBtn.classList.add('hidden');
    }
  }

  currentCommentUnsub = subscribeComments(hw.id, (comments) => {
    if (comments.length === 0) {
      list.innerHTML = `<div class="text-center text-sm text-slate-400 py-6">ยังไม่มีคอมเมนต์ เริ่มคุยกันได้เลย!</div>`;
    } else {
      list.innerHTML = '';
      const uid = getUid();
      comments.forEach((c, i) => {
        const isMe = c.uid === uid;
        const div = document.createElement('div');
        div.className = `flex flex-col max-w-[85%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`;
        const timeStr = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'}) : '';
        const animDelay = Math.min(i * 0.05, 0.5); // Staggered animation
        div.style.animationDelay = `${animDelay}s`;
        
        div.innerHTML = `
          ${!isMe ? `<span class="text-[10px] text-slate-500 mb-0.5 ml-1">${c.displayName}</span>` : ''}
          <div class="px-4 py-2.5 rounded-2xl text-sm chat-bubble ${isMe ? 'chat-bubble-me' : 'chat-bubble-other'} relative group">
            ${c.text}
            ${isAdmin() ? `<button data-delete-comment="${c.id}" class="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-rose-600 hover:scale-110 transform duration-200"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
          </div>
          <span class="text-[9px] text-slate-400 mt-1 ${isMe ? 'mr-1' : 'ml-1'}">${timeStr}</span>
        `;
        list.appendChild(div);
      });
      // Scroll to bottom
      list.scrollTop = list.scrollHeight;
    }
  });
};

// Global listener for deleting comments
document.getElementById('comment-list')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-comment]');
  if (btn) {
    if (!confirm('ยืนยันการลบคอมเมนต์นี้?')) return;
    const commentId = btn.dataset.deleteComment;
    const hwId = document.getElementById('comment-hw-id').value;
    try {
      await deleteComment(hwId, commentId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

document.getElementById('close-comment-modal-btn')?.addEventListener('click', () => {
  if (currentCommentUnsub) { currentCommentUnsub(); currentCommentUnsub = null; }
  closeModal('comment-modal');
});

// [BUG FIX] Unsubscribe เมื่อปิด modal ผ่านการคลิก overlay (backdrop) ด้วย
// ไม่เช่นนั้น Firestore listener จะยังทำงานอยู่หลังปิด modal
document.getElementById('comment-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    if (currentCommentUnsub) { currentCommentUnsub(); currentCommentUnsub = null; }
    closeModal('comment-modal');
  }
});

document.getElementById('comment-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  const hwId = document.getElementById('comment-hw-id').value;
  if (!text || !hwId) return;
  
  const btn = document.getElementById('comment-send-btn');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  
  try {
    // [BUG FIX] ใช้ getCurrentUserData() แทน window._userData ซึ่งไม่ได้ expose ไว้และอาจเป็น undefined เสมอ
    const data = getCurrentUserData();
    await addComment(hwId, getUid(), data?.displayName, text);
    input.value = '';
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    input.focus();
  }
});


// ══════════════════════════════════════════════════════════
//  PROFILE MODAL & PERSONAL STATS
// ══════════════════════════════════════════════════════════

function updatePersonalStatsUI() {
  const row = document.getElementById('pm-stats-row');
  const rateEl = document.getElementById('pm-completion-rate');
  
  if (isAdmin()) {
    if (row) row.style.display = 'none';
    return;
  }
  
  if (row) row.style.display = 'flex';
  
  if (!rateEl) return;
  
  // Calculate stats based on assigned homeworks
  const assigned = homeworks.filter(hw => {
    if (hw.assignedTo === 'all') return true;
    if (Array.isArray(hw.assignedTo)) return hw.assignedTo.includes(getUid());
    if (hw.assignedTo) return hw.assignedTo === getUid();
    return true;
  });
  
  if (assigned.length === 0) {
    rateEl.textContent = 'ยังไม่มีงานที่ได้รับมอบหมาย';
    rateEl.className = 'font-medium text-slate-500';
    return;
  }
  
  let doneCount = 0;
  assigned.forEach(hw => {
    if (completions[hw.id]?.isDone) doneCount++;
  });
  
  const pct = Math.round((doneCount / assigned.length) * 100);
  rateEl.textContent = `${doneCount}/${assigned.length} (${pct}%)`;
  
  if (pct >= 80) rateEl.className = 'font-medium text-emerald-600';
  else if (pct >= 50) rateEl.className = 'font-medium text-amber-600';
  else rateEl.className = 'font-medium text-rose-600';
}

document.getElementById('header-profile-btn')?.addEventListener('click', () => {
  populateProfileModal();
  updatePersonalStatsUI();
  openModal('profile-modal');
});
document.getElementById('close-profile-modal-btn')?.addEventListener('click', () => closeModal('profile-modal'));
document.getElementById('profile-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('profile-modal')) closeModal('profile-modal');
});
document.getElementById('signout-btn')?.addEventListener('click', async () => {
  try {
    const ok = await showConfirm({ title: 'ออกจากระบบ', message: 'ต้องการออกจากระบบหรือไม่?', confirmText: 'ออกจากระบบ' });
    if (!ok) return;
    
    // Stop simulation first if running
    if (isSimulating()) {
      await stopSimulation();
    }
    
    closeModal('profile-modal');
    
    // Safely unsubscribe
    _unsubs.forEach(u => {
      if (typeof u === 'function') {
        try { u(); } catch (e) { console.error('Error unsubscribing:', e); }
      }
    });
    _unsubs = [];

    // Safely destroy admin panel
    try {
      destroyAdminPanel();
    } catch (e) {
      console.error('Error destroying admin panel:', e);
    }

    await signOut();
  } catch (err) {
    console.error('Signout error:', err);
    showAlert({ title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถออกจากระบบได้: ' + err.message, type: 'error' });
  }
});

// ══════════════════════════════════════════════════════════
//  GLOBAL KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // Close assign dropdown panel if open
    const assignPanel = document.getElementById('hw-assign-dropdown-panel');
    if (assignPanel && !assignPanel.classList.contains('hidden')) {
      assignPanel.classList.add('hidden');
      document.getElementById('hw-assign-dropdown-chevron')?.classList.remove('rotate-180');
      return; // Let Escape first close dropdown before closing whole modal
    }
    document.querySelectorAll('.modal-overlay.open').forEach(m => {
      // [BUG FIX] Unsub การแจ้งเตือน comment เมื่อปิด comment-modal ด้วยปุ่ม Escape
      if (m.id === 'comment-modal' && currentCommentUnsub) {
        currentCommentUnsub();
        currentCommentUnsub = null;
      }
      m.classList.remove('open');
    });
    // [BUG FIX] ใช้ _releaseScrollLock แทนการ reset โดยตรง เพื่อรองรับ nested modals
    _releaseScrollLock();
  }
});


// ══════════════════════════════════════════════════════════
//  STUDENT IMPERSONATION / TESTING SIMULATION
// ══════════════════════════════════════════════════════════

// Global simulation starter trigger (called by admin student table buttons)
window._simulateStudent = async (studentId) => {
  const ok = await showConfirm({
    title: 'จำลองการเข้าใช้งาน',
    message: `จำลองมุมมองของนักเรียนเลขประจำตัว <strong>${studentId}</strong>?`,
    confirmText: 'เริ่มจำลอง',
    cancelText: 'ยกเลิก'
  });
  if (!ok) return;

  const overlay = document.getElementById('loading-overlay');
  if (overlay) { overlay.style.display = 'flex'; overlay.style.opacity = '1'; }
  try {
    await startSimulation(studentId);
    showToast(`จำลองการเข้าใช้งานนักเรียนรหัส ${studentId} สำเร็จ`, 'success');
    bootApp(getCurrentUserData());
    // Auto switch to student dashboard
    switchView('dashboard');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  } finally {
    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.style.display = 'none', 400); }
  }
};

// Simulation panel form submit handler (manual student ID entry)
document.getElementById('simulation-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const inputEl = document.getElementById('simulation-student-id');
  const studentId = inputEl?.value?.trim();
  if (!studentId) return;

  const overlay = document.getElementById('loading-overlay');
  if (overlay) { overlay.style.display = 'flex'; overlay.style.opacity = '1'; }
  try {
    await startSimulation(studentId);
    if (inputEl) inputEl.value = '';
    showToast(`จำลองการเข้าใช้งานนักเรียนรหัส ${studentId} สำเร็จ`, 'success');
    bootApp(getCurrentUserData());
    // Auto switch to student dashboard
    switchView('dashboard');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  } finally {
    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.style.display = 'none', 400); }
  }
});

// Exit simulation button handler
document.getElementById('exit-simulation-btn')?.addEventListener('click', async () => {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) { overlay.style.display = 'flex'; overlay.style.opacity = '1'; }
  try {
    await stopSimulation();
    showToast('ออกจากการจำลองการเข้าใช้งานเรียบร้อยแล้ว', 'success');
    bootApp(getCurrentUserData());
    // Auto switch back to admin tab
    switchView('admin');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  } finally {
    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.style.display = 'none', 400); }
  }
});

// ══════════════════════════════════════════════════════════
//  LOADING OVERLAY
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  IN-APP NOTIFICATIONS RENDERING & INTERACTIONS
// ══════════════════════════════════════════════════════════

function formatTimeElapsed(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'เมื่อครู่นี้';
  if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'เมื่อวานนี้';
  return `${diffDays} วันที่แล้ว`;
}

function showNotificationDetailModal(item, timeStr) {
  const modal = document.getElementById('notification-detail-modal');
  const iconEl = document.getElementById('ndm-icon');
  const titleEl = document.getElementById('ndm-title');
  const bodyEl = document.getElementById('ndm-body');
  const timeEl = document.getElementById('ndm-time');
  const typeEl = document.getElementById('ndm-type');

  if (!modal) return;

  let icon = 'ℹ️';
  let typeText = 'แจ้งเตือนระบบ';
  let typeClass = 'bg-slate-100 text-slate-600';
  
  if (item.type === 'new_homework') {
    icon = '📚';
    typeText = 'การบ้านใหม่';
    typeClass = 'bg-primary-light text-primary border border-primary/10';
  } else if (item.type === 'update_homework') {
    icon = '✏️';
    typeText = 'แก้ไขการบ้าน';
    typeClass = 'bg-violet-light text-violet border border-violet/10';
  } else if (item.type === 'due_warning') {
    icon = '⚠️';
    typeText = 'ใกล้กำหนดส่ง';
    typeClass = 'bg-amber-light text-amber border border-amber/10';
  } else if (item.type === 'custom_push') {
    icon = '📢';
    typeText = 'ประกาศจากห้องเรียน';
    typeClass = 'bg-rose-light text-rose border border-rose/10';
  }

  if (iconEl) iconEl.textContent = icon;
  if (titleEl) titleEl.textContent = item.title || 'การแจ้งเตือน';
  if (bodyEl) bodyEl.textContent = item.body || '';
  if (timeEl) timeEl.textContent = timeStr || '🕒 เมื่อครู่นี้';
  if (typeEl) {
    typeEl.textContent = typeText;
    typeEl.className = `px-2 py-0.5 rounded-lg font-semibold uppercase tracking-wider text-[10px] ${typeClass}`;
  }

  // เปิด Modal
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  // ผูกการปิด Modal — ใช้ named function เพื่อ removeEventListener ได้ถูกต้อง
  const closeBtn = document.getElementById('close-notification-detail-modal');
  const confirmBtn = document.getElementById('ndm-close');

  const doClose = () => {
    modal.classList.remove('open');
    _releaseScrollLock();
    // Remove all listeners after closing to prevent stacking
    closeBtn?.removeEventListener('click', doClose);
    confirmBtn?.removeEventListener('click', doClose);
    modal.removeEventListener('click', overlayClick);
  };
  const overlayClick = (e) => { if (e.target === modal) doClose(); };

  closeBtn?.addEventListener('click', doClose);
  confirmBtn?.addEventListener('click', doClose);
  modal.addEventListener('click', overlayClick);
}

function renderNotifications() {
  const uid = getUid();
  if (!uid) return;

  const listContainer = document.getElementById('bell-notif-list');
  if (!listContainer) return;

  // 1. สร้างการแจ้งเตือนงานค้างใกล้ส่งเสมือน (Dynamic Warning)
  const warnings = [];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const visibleHw = getVisibleHomeworks();
  const activeHws = visibleHw.filter(hw => !completions[hw.id]?.isDone);

  activeHws.forEach(hw => {
    if (hw.dueDate) {
      const dueTime = hw.dueDate.toDate ? hw.dueDate.toDate() : new Date(hw.dueDate);
      if (dueTime > now && dueTime <= tomorrow) {
        warnings.push({
          id: `warning_${hw.id}_${dueTime.toDateString()}`,
          title: `⚠️ ใกล้กำหนดส่งวิชา: ${hw.subjectName}`,
          body: `งาน "${hw.description}" จะครบกำหนดส่งใน ${daysRemaining(hw.dueDate)}`,
          createdAt: hw.dueDate,
          type: 'due_warning',
          hwId: hw.id,
          isVirtual: true
        });
      }
    }
  });

  // 2. กรองการแจ้งเตือนจาก DB (รองรับ 'all', uid ตรงกัน, หรือ uid อยู่ในอาร์เรย์)
  const filteredDbNotifs = notifications.filter(n => {
    return n.assignedTo === 'all' || 
           n.assignedTo === uid || 
           (Array.isArray(n.assignedTo) && n.assignedTo.includes(uid));
  });

  // 3. รวมรายการทั้งหมดและจัดเรียงลำดับเวลา (ใหม่ล่าสุดขึ้นก่อน)
  const allNotifs = [...warnings, ...filteredDbNotifs];
  allNotifs.sort((a, b) => {
    const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
    const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  // 4. อัปเดตตัวนับและแสดงผล Badge สีแดงบนกระดิ่ง
  const unreadCount = allNotifs.filter(n => !readNotificationIds.has(n.id)).length;
  const badgeCount = document.getElementById('bell-badge-count');
  if (badgeCount) {
    if (unreadCount > 0) {
      badgeCount.textContent = unreadCount;
      badgeCount.classList.remove('hidden');
    } else {
      badgeCount.classList.add('hidden');
    }
  }

  // 5. แสดงผลรายการการแจ้งเตือน
  if (allNotifs.length === 0) {
    listContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-slate-400 text-center">
        <span class="text-3xl mb-2">🔔</span>
        <p class="text-xs">ไม่มีการแจ้งเตือนในขณะนี้</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = '';
  allNotifs.forEach(item => {
    const isUnread = !readNotificationIds.has(item.id);
    const timeStr = formatTimeElapsed(item.createdAt);
    
    let iconHTML = '';
    if (item.type === 'new_homework') iconHTML = '📚';
    else if (item.type === 'update_homework') iconHTML = '✏️';
    else if (item.type === 'due_warning') iconHTML = '⚠️';
    else if (item.type === 'custom_push') iconHTML = '📢';
    else iconHTML = 'ℹ️';

    const admin = isAdmin();
    const canDelete = admin && !item.isVirtual;

    const itemEl = document.createElement('div');
    itemEl.className = `notif-item ${isUnread ? 'unread' : ''} relative group flex items-start gap-3 p-3 rounded-2xl transition-all duration-200`;
    itemEl.dataset.id = item.id;
    itemEl.dataset.hwId = item.hwId || '';

    itemEl.innerHTML = `
      <div class="notif-icon-box notif-icon-${item.type} shrink-0">
        ${iconHTML}
      </div>
      <div class="notif-body flex-1 min-w-0 pr-6">
        <div class="notif-title font-semibold text-slate-800 dark:text-white text-xs truncate">${item.title}</div>
        <div class="notif-desc text-slate-500 dark:text-slate-400 text-[11px] line-clamp-2 mt-0.5">${item.body}</div>
        <div class="notif-time text-slate-400 dark:text-slate-500 text-[10px] mt-1">${timeStr}</div>
      </div>
      <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10">
        ${isUnread ? '<div class="notif-unread-dot w-2 h-2 rounded-full bg-primary shrink-0"></div>' : ''}
        ${canDelete ? `
          <button class="notif-delete-btn p-1.5 rounded-lg text-slate-400 hover:text-rose hover:bg-rose-light dark:hover:bg-rose/10 transition-colors cursor-pointer border border-transparent hover:border-rose/25" title="ลบประกาศนี้สำหรับทุกคน">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        ` : ''}
      </div>
    `;

    // คลิกแจ้งเตือน
    itemEl.addEventListener('click', async (e) => {
      // ป้องกันการทำงานหากกดโดนปุ่มลบ
      if (e.target.closest('.notif-delete-btn')) return;

      if (isUnread) {
        try {
          await markNotificationAsRead(uid, item.id);
        } catch (err) {
          console.error('ไม่สามารถบันทึกสถานะอ่านแล้วได้:', err);
        }
      }

      // ปิด Popover
      document.getElementById('bell-popover-panel')?.classList.add('hidden');

      // แสดงรายละเอียดแจ้งเตือนเต็มจอ (In-App Modal)
      showNotificationDetailModal(item, timeStr);

      // เปิดดูการบ้านบน Dashboard และทำเอฟเฟกต์ไฮไลต์
      if (item.hwId) {
        switchView('dashboard');
        setTimeout(() => {
          const card = document.querySelector(`.hw-card[data-id="${item.hwId}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('highlight-notif-target');
            setTimeout(() => card.classList.remove('highlight-notif-target'), 2000);
          } else {
            showToast('ไม่พบการบ้านชิ้นนี้ (อาจถูกลบหรือเสร็จสิ้นไปแล้ว)', 'warning');
          }
        }, 250);
      }
    });

    if (canDelete) {
      const delBtn = itemEl.querySelector('.notif-delete-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // ห้ามเปิดดูแจ้งเตือน
        const ok = await showConfirm({
          title: 'ลบประกาศสำหรับทุกคน',
          message: `ลบประกาศ "<strong>${item.title}</strong>"?`,
          detail: 'ข้อมูลประกาศจะถูกลบออกจากกระดิ่งแจ้งเตือนของทุกคนทันที',
          danger: true,
          confirmText: 'ลบประกาศ',
          cancelText: 'ยกเลิก'
        });
        if (!ok) return;
        try {
          await deleteNotification(item.id);
          showToast('ลบประกาศสำเร็จแล้ว', 'success');
        } catch (err) {
          showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
        }
      });
    }

    listContainer.appendChild(itemEl);
  });
}

// ผูกเหตุการณ์ปุ่ม "อ่านทั้งหมด"
document.getElementById('bell-mark-all-read-btn')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  const uid = getUid();
  if (!uid) return;

  const listContainer = document.getElementById('bell-notif-list');
  if (!listContainer) return;

  // ค้นหารายการแจ้งเตือนทั้งหมดที่ยังไม่อ่าน
  // [BUG FIX] กรอง Virtual Warning IDs ออก เพราะไม่มีใน Firestore → setDoc จะ error
  const unreadIds = [];
  const items = listContainer.querySelectorAll('.notif-item.unread');
  items.forEach(el => {
    const id = el.dataset.id;
    if (id && !id.startsWith('warning_')) unreadIds.push(id);
  });

  if (unreadIds.length > 0) {
    try {
      await markAllNotificationsAsRead(uid, unreadIds);
      showToast('อ่านการแจ้งเตือนทั้งหมดแล้ว');
    } catch (err) {
      console.error('เกิดข้อผิดพลาดในการตั้งค่าสถานะอ่านทั้งหมด:', err);
      showToast('ล้มเหลวในการอ่านแจ้งเตือนทั้งหมด', 'error');
    }
  }
});

window.addEventListener('load', () => {
  setTimeout(() => {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.style.display = 'none', 400); }
  }, 600);
});
