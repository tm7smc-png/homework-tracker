// ============================================================
// js/admin.js — Admin Panel: User Management & Excel Import
// ============================================================

import {
  subscribeUsers, subscribeStudents, updateUserRole,
  addStudent, updateStudent, deleteStudentRecord,
  batchImportStudents, unlinkUserStudent,
  triggerPushNotification, addCustomNotification,
  cleanupCompletedHomeworks, cleanupOverdueHomeworks,
  cleanupAllHomeworks, cleanupOldNotifications,
  cleanupCompletedPersonalTasks, getAdminCompletionStats,
  exportSystemData, importSystemData,
  subscribeNotifications, deleteNotification, deleteMultipleNotifications
} from "./firebase.js";
import { isSuperAdmin, getUid, canImpersonate } from "./auth.js?v=4";
import {
  showToast, showConfirm, showAlert, setButtonLoading,
  getRoleLabel, getRoleBadgeClass, formatDate, renderAvatarHTML, debounce
} from "./utils.js?v=2";

// ── State ────────────────────────────────────────────────
let _users = [];
let _students = [];
let _notifications = [];
let _unsubs = [];
let _currentStudentFilter = 'all';  // 'all' | 'active' | 'pending'
let _userFilter = 'all';

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

// [BUG FIX] Guard flag: ป้องกัน initAdminPanel() ถูกเรียกซ้ำจาก bootApp()
let _adminInitialized = false;
let _userFilterInitialized = false;
let _studentSearchInitialized = false;

export function initAdminPanel() {
  if (_adminInitialized) {
    // เรียกซ้ำ: destroy subscriptions เก่าแล้ว re-subscribe เท่านั้น ไม่ bind event ซ้ำ
    _unsubs.forEach(u => u());
    _unsubs = [];
    _unsubs.push(subscribeUsers(users => { _users = users; renderUsersTable(); renderPushNotificationsUsers(); }));
    _unsubs.push(subscribeStudents(students => { _students = students; renderStudentsTable(); }));
    _unsubs.push(subscribeNotifications(notifications => { _notifications = notifications; renderSentAnnouncementsTable(); }));
    return;
  }
  _adminInitialized = true;
  initAdminTabs();
  initStudentForm();
  initExcelImport();
  initExcelExport();
  initDataCleanup();
  initBackupRestore();
  initPushNotificationsTab();

  // Export PDF Button
  document.getElementById('admin-export-pdf-btn')?.addEventListener('click', () => {
    window.print();
  });

  // Subscribe
  _unsubs.push(subscribeUsers(users => { _users = users; renderUsersTable(); renderPushNotificationsUsers(); }));
  _unsubs.push(subscribeStudents(students => { _students = students; renderStudentsTable(); }));
  _unsubs.push(subscribeNotifications(notifications => { _notifications = notifications; renderSentAnnouncementsTable(); }));
}

export function destroyAdminPanel() {
  _unsubs.forEach(u => u());
  _unsubs = [];
}

// ══════════════════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════════════════

function initAdminTabs() {
  const labelEl = document.getElementById('admin-current-tab-label');

  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`)?.classList.remove('hidden');

      // Update current tab label on mobile
      if (labelEl) {
        labelEl.innerHTML = btn.innerHTML; // keeps icon/emoji and text
      }

      // Close drawer on mobile
      const container = document.querySelector('.admin-tab-container');
      const backdrop = document.getElementById('admin-drawer-backdrop');
      if (container && container.classList.contains('open')) {
        container.classList.remove('open');
        backdrop?.classList.add('hidden');
      }

      if (tab === 'analytics') {
        renderAnalyticsTab();
      } else if (tab === 'push-notifications') {
        renderSentAnnouncementsTable();
      }
    });
  });

  // Mobile Drawer Toggle Listeners using robust event delegation on document level to ensure it always works
  if (!window._adminDrawerDelegationBound) {
    document.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('#admin-drawer-toggle-btn');
      const closeBtn = e.target.closest('#admin-drawer-close-btn');
      const backdropClick = e.target.closest('#admin-drawer-backdrop');

      const container = document.querySelector('.admin-tab-container');
      const backdrop = document.getElementById('admin-drawer-backdrop');

      if (toggleBtn) {
        container?.classList.add('open');
        backdrop?.classList.remove('hidden');
      } else if (closeBtn || backdropClick) {
        container?.classList.remove('open');
        backdrop?.classList.add('hidden');
      }
    });
    window._adminDrawerDelegationBound = true;
  }
}

document.getElementById('refresh-analytics-btn')?.addEventListener('click', () => {
  renderAnalyticsTab(true);
});

// ══════════════════════════════════════════════════════════
//  ANALYTICS TAB
// ══════════════════════════════════════════════════════════

let _cachedAnalytics = null;
let _lastAnalyticsFetch = 0;

async function renderAnalyticsTab(forceRefresh = false) {
  const tbody = document.getElementById('top-students-tbody');
  
  if (!forceRefresh && _cachedAnalytics && (Date.now() - _lastAnalyticsFetch < 2 * 60 * 1000)) {
    // Use cached data if within 2 minutes
    renderAnalyticsUI(_cachedAnalytics, tbody);
    return;
  }

  if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-500"><div class="flex justify-center items-center gap-2"><div class="loader-sm"></div> กำลังโหลดข้อมูล (อาจใช้เวลาสักครู่)...</div></td></tr>`;

  try {
    const stats = await getAdminCompletionStats();
    _cachedAnalytics = stats;
    _lastAnalyticsFetch = Date.now();
    renderAnalyticsUI(stats, tbody);
  } catch (err) {
    console.error("Failed to load analytics", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-rose">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>`;
  }
}

function renderAnalyticsUI(stats, tbody) {
    
    // Update summary cards
    document.getElementById('stat-admin-students').textContent = stats.totalStudents;
    document.getElementById('stat-admin-hw-total').textContent = stats.totalHomeworks;
    
    // Calculate total completions across all users and homeworks
    let totalCompletions = 0;
    Object.values(stats.completedCounts).forEach(count => totalCompletions += count);
    document.getElementById('stat-admin-hw-done').textContent = totalCompletions;

    // Overall rate
    const maxPossibleCompletions = stats.totalStudents * stats.totalHomeworks;
    const rate = maxPossibleCompletions > 0 ? Math.round((totalCompletions / maxPossibleCompletions) * 100) : 0;
    document.getElementById('stat-admin-hw-rate').textContent = `${rate}%`;

    // Top 10 Students
    if (tbody) {
      const studentArray = Object.entries(stats.studentStats).map(([uid, data]) => ({
        uid,
        name: data.name,
        count: data.completedCount
      }));

      studentArray.sort((a, b) => b.count - a.count); // sort descending
      const top10 = studentArray.slice(0, 10);

      if (top10.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-500">ยังไม่มีข้อมูล</td></tr>`;
      } else {
        tbody.innerHTML = top10.map((s, idx) => {
          const pct = stats.totalHomeworks > 0 ? Math.round((s.count / stats.totalHomeworks) * 100) : 0;
          return `
            <tr>
              <td class="text-center font-bold text-slate-500">#${idx + 1}</td>
              <td class="font-medium text-slate-800">${s.name}</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div class="bg-primary h-1.5 rounded-full" style="width: ${pct}%"></div>
                  </div>
                  <span class="text-xs text-slate-500 whitespace-nowrap">${s.count} งาน</span>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
}

// ══════════════════════════════════════════════════════════
//  USERS TABLE  (Accounts tab)
// ══════════════════════════════════════════════════════════

function isSelf(uid) { return uid === getUid(); }

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  // Update filter counters dynamically
  const allBtn = document.querySelector('[data-user-filter="all"]');
  const activeBtn = document.querySelector('[data-user-filter="active"]');
  const pendingBtn = document.querySelector('[data-user-filter="pending"]');
  if (allBtn) {
    allBtn.innerHTML = `ทั้งหมด <span class="ml-1 px-1.5 py-0.5 text-[10px] bg-slate-200 text-slate-600 rounded-full font-bold">${_users.length}</span>`;
  }
  if (activeBtn) {
    const activeCount = _users.filter(u => u.isActive && u.linkedStudentId).length;
    activeBtn.innerHTML = `Active <span class="ml-1 px-1.5 py-0.5 text-[10px] bg-emerald-light text-emerald rounded-full font-bold">${activeCount}</span>`;
  }
  if (pendingBtn) {
    const pendingCount = _users.filter(u => !u.linkedStudentId).length;
    pendingBtn.innerHTML = `Pending <span class="ml-1 px-1.5 py-0.5 text-[10px] bg-amber-light text-amber rounded-full font-bold">${pendingCount}</span>`;
  }

  let filtered = _users;
  if (_userFilter === 'active')  filtered = _users.filter(u => u.isActive && u.linkedStudentId);
  if (_userFilter === 'pending') filtered = _users.filter(u => !u.linkedStudentId);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><span class="table-empty-icon">👤</span>ไม่พบรายการ</td></tr>`;
    return;
  }

  const canManage = isSuperAdmin();
  const selfUid   = getUid();

  // SVG Icons
  const promoteSvg = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg><span>แต่งตั้ง</span>`;
  const demoteSvg = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><span>ถอดสิทธิ์</span>`;
  const unlinkSvg = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg><span>Unlink</span>`;

  tbody.innerHTML = filtered.map(u => {
    const roleLabel   = getRoleLabel(u.role);
    const roleClass   = getRoleBadgeClass(u.role);
    const statusLabel = u.linkedStudentId ? 'Active' : 'Pending';
    const statusClass = u.linkedStudentId ? 'status-active' : 'status-pending';
    const canPromote  = canManage && u.role === 'user';
    const canDemote   = canManage && u.role === 'admin';
    const canUnlink   = !!(u.linkedStudentId && u.id !== selfUid);
    const avatarHtml  = renderAvatarHTML(u.photoURL || '', u.displayName || u.email, 38);
    const isSelfRow   = u.id === selfUid;
    // Escape special chars for inline onclick attributes
    const sidAttr     = (u.studentId || '').replace(/'/g, "\\'");
    const nameAttr    = (u.displayName || u.email).replace(/'/g, "\\'");

    return `<tr class="${isSelfRow ? 'is-self-row' : ''}">
      <td>
        <div class="user-row">
          <div class="user-avatar-photo">${avatarHtml}</div>
          <div class="user-info">
            <div class="user-name">${u.displayName || '(ไม่ระบุ)'}${isSelfRow ? ' <span class="self-tag">คุณ</span>' : ''}</div>
            <div class="user-email">${u.email}</div>
          </div>
        </div>
      </td>
      <td class="td-mono">${u.studentId || '<span class="text-slate-300">—</span>'}</td>
      <td><span class="badge ${roleClass}">${roleLabel}</span></td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td class="hidden md:table-cell">
        <span class="user-date">${u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</span>
      </td>
      <td>
        <div class="td-actions">
          ${canPromote && !isSelfRow ? `<button class="btn-xs btn-xs-edit" onclick="window._adminPromote('${u.id}','admin')">${promoteSvg}</button>` : ''}
          ${canDemote  && !isSelfRow ? `<button class="btn-xs btn-xs-danger" onclick="window._adminPromote('${u.id}','user')">${demoteSvg}</button>` : ''}
          ${canUnlink ? `<button class="btn-xs btn-xs-unlink" onclick="window._adminUnlinkUser('${u.id}','${sidAttr}','${nameAttr}')" title="ยกเลิกการเชื่อมโยงเลขประจำตัว">${unlinkSvg}</button>` : ''}
          ${isSelfRow ? '<span class="self-indicator">—</span>' : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// User role filter buttons
export function initUserFilter() {
  if (_userFilterInitialized) return; // [BUG FIX] guard against duplicate listeners
  _userFilterInitialized = true;
  document.querySelectorAll('[data-user-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-user-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _userFilter = btn.dataset.userFilter;
      renderUsersTable();
    });
  });
}

// Global handler for promote/demote
window._adminPromote = async (uid, newRole) => {
  const label = newRole === 'admin' ? 'แต่งตั้งเป็น Admin' : 'ถอดออกจาก Admin';
  const ok = await showConfirm({ title: label, message: 'ยืนยันการเปลี่ยนบทบาทผู้ใช้นี้?', danger: newRole === 'user' });
  if (!ok) return;
  try {
    await updateUserRole(uid, newRole);
    showToast('เปลี่ยนบทบาทเรียบร้อยแล้ว');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  }
};

// Global handler for unlink student ID
window._adminUnlinkUser = async (uid, studentId, displayName) => {
  const ok = await showConfirm({
    title: 'ยกเลิกการเชื่อมโยงเลขประจำตัว',
    message: `ยกเลิกการเชื่อมโยงเลขประจำตัว <strong>${studentId}</strong> ออกจากบัญชี <strong>${displayName}</strong>?`,
    detail: 'ผู้ใช้จะต้องกรอกเลขประจำตัวใหม่เพื่อเข้าสู่ระบบอีกครั้ง และเลขนี้จะพร้อมให้บัญชีอื่นเชื่อมโยงได้ทันที',
    danger: true,
    confirmText: '🔓 ยกเลิกการเชื่อมโยง',
    cancelText: 'ยกเลิก'
  });
  if (!ok) return;
  try {
    await unlinkUserStudent(uid, studentId);
    showToast(`ยกเลิกการเชื่อมโยงเลข ${studentId} เรียบร้อยแล้ว`, 'success');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  }
};

// ══════════════════════════════════════════════════════════
//  STUDENTS TABLE
// ══════════════════════════════════════════════════════════

function renderStudentsTable() {
  const tbody = document.getElementById('students-tbody');
  if (!tbody) return;

  // Update filter counters dynamically
  const allBtn = document.querySelector('[data-student-filter="all"]');
  const activeBtn = document.querySelector('[data-student-filter="active"]');
  const pendingBtn = document.querySelector('[data-student-filter="pending"]');
  if (allBtn) {
    allBtn.innerHTML = `ทั้งหมด <span class="ml-1 px-1.5 py-0.5 text-[10px] bg-slate-200 text-slate-600 rounded-full font-bold">${_students.length}</span>`;
  }
  if (activeBtn) {
    const activeCount = _students.filter(s => s.isActive).length;
    activeBtn.innerHTML = `Active <span class="ml-1 px-1.5 py-0.5 text-[10px] bg-emerald-light text-emerald rounded-full font-bold">${activeCount}</span>`;
  }
  if (pendingBtn) {
    const pendingCount = _students.filter(s => !s.isActive).length;
    pendingBtn.innerHTML = `Pending <span class="ml-1 px-1.5 py-0.5 text-[10px] bg-amber-light text-amber rounded-full font-bold">${pendingCount}</span>`;
  }

  let filtered = _students;
  if (_currentStudentFilter === 'active') filtered = _students.filter(s => s.isActive);
  if (_currentStudentFilter === 'pending') filtered = _students.filter(s => !s.isActive);

  const searchVal = document.getElementById('student-search')?.value?.toLowerCase() ?? '';
  if (searchVal) {
    filtered = filtered.filter(s =>
      s.studentId.includes(searchVal) ||
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchVal) ||
      (s.nickname ?? '').toLowerCase().includes(searchVal)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><span class="table-empty-icon">📋</span>ไม่พบรายการ</td></tr>`;
    return;
  }

  // SVG Icons
  const editSvg = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg><span>แก้ไข</span>`;
  const deleteSvg = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>ลบ</span>`;

  const allowSim = canImpersonate();

  tbody.innerHTML = filtered.map(s => {
    const status = s.isActive ? 'Active' : 'Pending';
    const cls = s.isActive ? 'status-active' : 'status-pending';
    // [BUG FIX] Use data-* attributes instead of inline onclick with escaped strings
    // to prevent attribute injection for names/IDs with special characters.
    return `<tr
      data-student-id="${s.studentId}"
      class="student-row">
      <td class="td-mono">${s.studentId}</td>
      <td class="font-semibold text-slate-800">${s.firstName} ${s.lastName}</td>
      <td class="hidden sm:table-cell text-slate-500">${s.nickname || '-'}</td>
      <td class="text-slate-400 text-xs td-truncate" style="max-width:180px">${s.linkedEmail || '-'}</td>
      <td><span class="status-badge ${cls}">${status}</span></td>
      <td>
        <div class="td-actions">
          ${allowSim ? `<button class="btn-xs btn-xs-edit student-sim-btn" style="background:#FFF9E6; color:#D97706; border-color:#FDE68A" data-student-id="${s.studentId}">🔑 จำลอง</button>` : ''}
          <button class="btn-xs btn-xs-edit student-edit-btn" data-student-id="${s.studentId}">${editSvg}</button>
          <button class="btn-xs btn-xs-danger student-delete-btn" data-student-id="${s.studentId}">${deleteSvg}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // [BUG FIX] Attach event listeners using data-attributes instead of inline onclick
  tbody.querySelectorAll('.student-sim-btn').forEach(btn => {
    btn.addEventListener('click', () => window._simulateStudent(btn.dataset.studentId));
  });
  tbody.querySelectorAll('.student-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => window._editStudent(btn.dataset.studentId));
  });
  tbody.querySelectorAll('.student-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => window._deleteStudent(btn.dataset.studentId));
  });
}

export function initStudentTableSearch() {
  if (_studentSearchInitialized) return; // [BUG FIX] guard against duplicate listeners
  _studentSearchInitialized = true;
  document.getElementById('student-search')?.addEventListener('input', debounce(renderStudentsTable, 300));
  document.querySelectorAll('[data-student-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-student-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _currentStudentFilter = btn.dataset.studentFilter;
      renderStudentsTable();
    });
  });
}

// Edit student inline
window._editStudent = (studentId) => {
  const student = _students.find(s => s.studentId === studentId);
  if (!student) return;
  document.getElementById('edit-student-id').value = student.studentId;
  document.getElementById('edit-student-first').value = student.firstName;
  document.getElementById('edit-student-last').value = student.lastName;
  document.getElementById('edit-student-nickname').value = student.nickname || '';
  document.getElementById('edit-student-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
};

window._deleteStudent = async (studentId) => {
  const ok = await showConfirm({
    title: 'ลบรายชื่อ', message: `ลบเลขประจำตัว <strong>${studentId}</strong> ออกจากระบบ?`, danger: true,
    confirmText: 'ลบ', cancelText: 'ยกเลิก'
  });
  if (!ok) return;
  try {
    await deleteStudentRecord(studentId);
    showToast('ลบรายชื่อเรียบร้อยแล้ว');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  }
};

// ══════════════════════════════════════════════════════════
//  ADD STUDENT FORM
// ══════════════════════════════════════════════════════════

function initStudentForm() {
  const form = document.getElementById('add-student-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    setButtonLoading(btn, true);
    try {
      await addStudent({
        studentId: document.getElementById('add-student-id').value,
        firstName: document.getElementById('add-student-first').value,
        lastName: document.getElementById('add-student-last').value,
        nickname: document.getElementById('add-student-nickname').value
      });
      form.reset();
      showToast('เพิ่มรายชื่อเรียบร้อยแล้ว');
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(btn, false, 'เพิ่ม');
    }
  });

  // Edit student form
  const editForm = document.getElementById('edit-student-form');
  editForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('edit-student-id').value;
    const btn = editForm.querySelector('button[type=submit]');
    setButtonLoading(btn, true);
    try {
      await updateStudent(id, {
        firstName: document.getElementById('edit-student-first').value,
        lastName: document.getElementById('edit-student-last').value,
        nickname: document.getElementById('edit-student-nickname').value
      });
      document.getElementById('edit-student-modal').classList.remove('open');
      document.body.style.overflow = '';
      showToast('แก้ไขข้อมูลเรียบร้อยแล้ว');
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(btn, false, 'บันทึก');
    }
  });

  document.getElementById('close-edit-student-modal')?.addEventListener('click', () => {
    document.getElementById('edit-student-modal').classList.remove('open');
    document.body.style.overflow = '';
  });
}

// ══════════════════════════════════════════════════════════
//  EXCEL EXPORT & IMPORT (SheetJS)
// ══════════════════════════════════════════════════════════

function initExcelExport() {
  const exportBtn = document.getElementById('excel-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportStudentsToExcel);
  }
}

function exportStudentsToExcel() {
  if (!_students || _students.length === 0) {
    showToast('ไม่มีข้อมูลนักเรียนที่จะส่งออก', 'warning');
    return;
  }
  const data = _students.map((s, idx) => ({
    'เลขที่': idx + 1,
    'เลขประจำตัว': s.studentId,
    'ชื่อ-นามสกุล': `${s.firstName} ${s.lastName}`,
    'อีเมล': s.linkedEmail || '-'
  }));
  try {
    if (!window.XLSX) throw new Error('SheetJS ยังไม่ได้โหลด');
    const worksheet = window.XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 8 },
      { wch: 15 },
      { wch: 25 },
      { wch: 30 }
    ];
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, 'รายชื่อนักเรียน');
    window.XLSX.writeFile(workbook, 'รายชื่อนักเรียน.xlsx');
    showToast('ส่งออกไฟล์ Excel สำเร็จ', 'success');
  } catch (err) {
    showAlert({ title: 'ส่งออกไม่สำเร็จ', message: err.message, type: 'error' });
  }
}

// Expected columns for import: เลขที่, เลขประจำตัว, ชื่อสกุล, ชื่อเล่น
function initExcelImport() {
  const fileInput = document.getElementById('excel-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await parseAndPreviewExcel(file);
    } catch (err) {
      showAlert({ title: 'ไม่สามารถอ่านไฟล์ได้', message: err.message, type: 'error' });
    } finally {
      e.target.value = '';
    }
  });
}

async function parseAndPreviewExcel(file) {
  // Load XLSX dynamically
  if (!window.XLSX) throw new Error('SheetJS ยังไม่ได้โหลด');

  const arrayBuffer = await file.arrayBuffer();
  const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

  if (rawRows.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล');

  // Auto-detect columns: เลขประจำตัว, ชื่อสกุล (full name), ชื่อเล่น
  const headers = rawRows[0].map(h => (h ?? '').toString().trim());
  const idIdx = headers.findIndex(h => h.includes('เลขประจำตัว') || h.toLowerCase() === 'id');
  const nameIdx = headers.findIndex(h => h.includes('ชื่อสกุล') || h.includes('ชื่อ-สกุล') || h.includes('fullname') || h.toLowerCase().includes('name'));
  const nickIdx = headers.findIndex(h => h.includes('ชื่อเล่น') || h.toLowerCase().includes('nick'));

  if (idIdx === -1) throw new Error('ไม่พบคอลัมน์ "เลขประจำตัว" ในไฟล์ Excel');
  if (nameIdx === -1) throw new Error('ไม่พบคอลัมน์ "ชื่อสกุล" ในไฟล์ Excel');

  const parsed = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rawId = (row[idIdx] ?? '').toString().trim();
    const rawName = (row[nameIdx] ?? '').toString().trim();
    const rawNick = nickIdx >= 0 ? (row[nickIdx] ?? '').toString().trim() : '';
    if (!rawId || !rawName) continue;

    // Split "นาย/นางสาว ชื่อ นามสกุล" or "ชื่อ นามสกุล"
    let firstName = '', lastName = '';
    const nameParts = rawName.replace(/^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง)\s+/, '').trim().split(/\s+/);
    if (nameParts.length >= 2) {
      lastName = nameParts.pop();
      firstName = nameParts.join(' ');
    } else {
      firstName = nameParts[0] || rawName;
    }

    parsed.push({ studentId: rawId, firstName, lastName, nickname: rawNick, _rawName: rawName });
  }

  if (parsed.length === 0) throw new Error('ไม่พบข้อมูลในไฟล์');

  // Find duplicates
  const existingIds = new Set(_students.map(s => s.studentId));
  const duplicates = parsed.filter(p => existingIds.has(p.studentId));
  const newOnes = parsed.filter(p => !existingIds.has(p.studentId));

  if (duplicates.length === 0) {
    // No duplicates — import all directly
    const ok = await showConfirm({
      title: `นำเข้ารายชื่อ ${parsed.length} คน`,
      message: `พบข้อมูลใหม่ <strong>${parsed.length}</strong> รายการ ต้องการนำเข้าทั้งหมด?`,
      confirmText: 'นำเข้า'
    });
    if (!ok) return;
    await doImport(parsed, []);
  } else {
    // Show duplicate preview modal
    showImportPreviewModal(duplicates, newOnes, parsed);
  }
}

function showImportPreviewModal(duplicates, newOnes, allRows) {
  const modal = document.getElementById('import-preview-modal');
  const listEl = document.getElementById('import-duplicate-list');
  let overwriteSet = new Set();

  listEl.innerHTML = duplicates.map(d => `
    <label class="import-dup-row">
      <input type="checkbox" class="import-dup-check" value="${d.studentId}" checked>
      <span class="import-dup-id">${d.studentId}</span>
      <span class="import-dup-name">${d._rawName || d.firstName + ' ' + d.lastName}</span>
      <span class="import-dup-nick">${d.nickname || ''}</span>
    </label>
  `).join('');

  document.getElementById('import-new-count').textContent = newOnes.length;
  document.getElementById('import-duplicate-count').textContent = duplicates.length;

  const confirmBtn = document.getElementById('import-preview-confirm');
  confirmBtn.onclick = async () => {
    overwriteSet = new Set(
      [...document.querySelectorAll('.import-dup-check:checked')].map(cb => cb.value)
    );
    modal.classList.remove('open');
    document.body.style.overflow = '';
    await doImport(allRows, [...overwriteSet]);
  };

  document.getElementById('import-preview-cancel').onclick = () => {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  };

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function doImport(rows, overwriteIds) {
  const btn = document.getElementById('excel-import-btn');
  if (btn) setButtonLoading(btn, true);
  try {
    const result = await batchImportStudents(rows, overwriteIds);
    showToast(`นำเข้าสำเร็จ: เพิ่ม ${result.added} | แทนที่ ${result.overwritten} | ข้าม ${result.skipped}`, 'success', 5000);
  } catch (err) {
    showAlert({ title: 'นำเข้าไม่สำเร็จ', message: err.message, type: 'error' });
  } finally {
    if (btn) setButtonLoading(btn, false, 'นำเข้าจาก Excel');
  }
}

// ══════════════════════════════════════════════════════════
//  DATA CLEANUP
// ══════════════════════════════════════════════════════════

function initDataCleanup() {
  // ── Case 1: ลบการบ้านที่ทุกคนทำเสร็จแล้ว ──
  const completedBtn = document.getElementById('cleanup-completed-btn');
  completedBtn?.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: '✅ ล้างงานที่เสร็จแล้วของทุกคน',
      message: 'ลบการบ้านทุกรายการที่ <strong>ทุกคนที่ได้รับมอบหมายทำเสร็จแล้ว</strong> ออกจากระบบ?',
      detail: 'หากยังมีใครที่ยังทำไม่เสร็จ งานรายการนั้นจะไม่ถูกลบ • การดำเนินการนี้ไม่สามารถยกเลิกได้',
      danger: true,
      confirmText: '✅ ล้างงานที่เสร็จแล้ว',
      cancelText: 'ยกเลิก'
    });
    if (!ok) return;
    setButtonLoading(completedBtn, true);
    try {
      const count = await cleanupCompletedHomeworks();
      showToast(
        count > 0
          ? `✅ ลบการบ้านที่ทุกคนทำเสร็จแล้ว ${count} รายการเรียบร้อย`
          : 'ไม่มีการบ้านที่ทุกคนทำเสร็จแล้วในระบบ',
        'success'
      );
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(completedBtn, false, 'ล้างงานการบ้านที่ทำเสร็จแล้ว');
    }
  });

  // ── Case 2: ลบการบ้านที่เลยกำหนดส่ง ──
  const overdueBtn = document.getElementById('cleanup-overdue-btn');
  overdueBtn?.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: '⏰ ล้างงานที่หมดเวลาส่ง',
      message: 'ลบการบ้าน<strong>ทั้งหมดที่เลยวันกำหนดส่ง</strong>ออกจากระบบทันที?',
      detail: 'แม้บางคนจะยังทำไม่เสร็จก็ตาม ข้อมูลจะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้',
      danger: true,
      confirmText: '⏰ ลบงานที่หมดเวลา',
      cancelText: 'ยกเลิก'
    });
    if (!ok) return;
    setButtonLoading(overdueBtn, true);
    try {
      const count = await cleanupOverdueHomeworks();
      showToast(
        count > 0
          ? `⏰ ลบการบ้านที่หมดเวลาส่ง ${count} รายการเรียบร้อย`
          : 'ไม่มีการบ้านที่เลยกำหนดส่งในระบบ',
        'success'
      );
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(overdueBtn, false, 'ล้างงานการบ้านที่เลยกำหนดส่ง');
    }
  });

  // ── Case 3: ลบการบ้านทั้งหมด ──
  const allBtn = document.getElementById('cleanup-all-btn');
  allBtn?.addEventListener('click', async () => {
    // ยืนยัน 2 ชั้นสำหรับการลบทั้งหมด
    const ok = await showConfirm({
      title: '💥 ลบการบ้านทั้งหมด',
      message: 'คุณกำลังจะ<strong>ลบการบ้านทั้งหมด</strong>ออกจากระบบถาวร?',
      detail: '⚠️ ข้อมูลจะหายไปทั้งหมดและไม่สามารถกู้คืนได้ กรุณายืนยันอีกครั้งว่าต้องการดำเนินการนี้จริง ๆ',
      danger: true,
      confirmText: '💥 ลบทั้งหมดถาวร',
      cancelText: 'ยกเลิก'
    });
    if (!ok) return;
    setButtonLoading(allBtn, true);
    try {
      const count = await cleanupAllHomeworks();
      showToast(
        count > 0
          ? `💥 ลบการบ้านทั้งหมด ${count} รายการเรียบร้อยแล้ว`
          : 'ไม่มีการบ้านในระบบ',
        'success'
      );
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(allBtn, false, 'ลบการบ้านทั้งหมดออกจากระบบ');
    }
  });

  // ── Case 4 (แนะนำ): ล้างประวัติการแจ้งเตือนเก่า > 30 วัน ──
  const notifBtn = document.getElementById('cleanup-notifications-btn');
  notifBtn?.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: '📢 ล้างประวัติการแจ้งเตือนเก่า',
      message: 'ลบประวัติพุชแจ้งเตือนและประกาศทั้งหมดที่<strong>เก่ากว่า 30 วัน</strong>ออกจากระบบ?',
      detail: 'การดำเนินการนี้จะช่วยลดขนาดฐานข้อมูลและเพิ่มความเร็วในการโหลดแจ้งเตือน',
      danger: false,
      confirmText: '📢 ล้างประวัติเก่า',
      cancelText: 'ยกเลิก'
    });
    if (!ok) return;
    setButtonLoading(notifBtn, true);
    try {
      const count = await cleanupOldNotifications(30);
      showToast(
        count > 0
          ? `📢 ลบประวัติการแจ้งเตือนเก่า ${count} รายการเรียบร้อย`
          : 'ไม่มีประวัติแจ้งเตือนที่เก่ากว่า 30 วัน',
        'success'
      );
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(notifBtn, false, 'ล้างประวัติการแจ้งเตือน (>30 วัน)');
    }
  });

  // ── Case 5 (แนะนำ): ล้างงานส่วนตัวที่เสร็จแล้วของทุกคน ──
  const personalBtn = document.getElementById('cleanup-personal-completed-btn');
  personalBtn?.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: '👤 ล้างงานส่วนตัวที่เสร็จแล้ว',
      message: 'ลบงานส่วนตัว (Personal Tasks) ของ<strong>ผู้ใช้ทุกคน</strong>ที่ทำเสร็จแล้วออกจากระบบ?',
      detail: 'เฉพาะงานที่มีสถานะ "เสร็จแล้ว" เท่านั้นที่จะถูกลบ งานที่ยังค้างอยู่จะไม่ได้รับผลกระทบ',
      danger: false,
      confirmText: '👤 ล้างงานส่วนตัวที่เสร็จแล้ว',
      cancelText: 'ยกเลิก'
    });
    if (!ok) return;
    setButtonLoading(personalBtn, true);
    try {
      const count = await cleanupCompletedPersonalTasks();
      showToast(
        count > 0
          ? `👤 ลบงานส่วนตัวที่เสร็จแล้ว ${count} รายการเรียบร้อย`
          : 'ไม่มีงานส่วนตัวที่เสร็จแล้วในระบบ',
        'success'
      );
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(personalBtn, false, 'ล้างงานส่วนตัวที่เสร็จแล้ว');
    }
  });
}

// ══════════════════════════════════════════════════════════
//  BACKUP & RESTORE
// ══════════════════════════════════════════════════════════

function initBackupRestore() {
  const backupBtn = document.getElementById('sys-backup-btn');
  const restoreInput = document.getElementById('sys-restore-input');

  backupBtn?.addEventListener('click', async () => {
    setButtonLoading(backupBtn, true, 'กำลังส่งออก...');
    try {
      const data = await exportSystemData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `homework-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('ส่งออกไฟล์ Backup เรียบร้อยแล้ว', 'success');
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(backupBtn, false, 'ส่งออก Backup (JSON)');
    }
  });

  restoreInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const ok = await showConfirm({
      title: 'กู้คืนข้อมูลระบบ',
      message: 'คำเตือน: การกู้คืนข้อมูลจะเขียนทับข้อมูลการบ้านและวิชาเรียนในระบบตามไฟล์ JSON ที่อัพโหลด คุณแน่ใจหรือไม่?',
      confirmText: 'เริ่มกู้คืน',
      danger: true  // [BUG FIX] แก้จาก isDanger ที่ไม่ใช่ property ที่ถูกต้อง
    });
    
    if (!ok) {
      e.target.value = '';
      return;
    }
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importSystemData(data);
      showToast('กู้คืนข้อมูลระบบเรียบร้อยแล้ว', 'success');
    } catch (err) {
      showAlert({ title: 'การกู้คืนล้มเหลว', message: 'ไฟล์อาจไม่ถูกต้อง: ' + err.message, type: 'error' });
    } finally {
      e.target.value = '';
    }
  });
}

// ══════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ══════════════════════════════════════════════════════════

function renderPushNotificationsUsers() {
  const select = document.getElementById('push-target-user');
  if (!select) return;

  const currentVal = select.value;

  // Reset dropdown list
  select.innerHTML = `
    <option value="">-- เลือกผู้รับ --</option>
    <option value="all_users">ทุกคนในกลุ่ม (all_users)</option>
  `;

  // [BUG FIX] Use !== false to include users who have notificationsEnabled=undefined (default)
  const activeUsers = _users.filter(u => u.fcmToken && u.notificationsEnabled !== false);

  activeUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.fcmToken;
    opt.textContent = `${u.displayName || u.email} (${u.linkedStudentId || 'ไม่มีรหัส'})`;
    select.appendChild(opt);
  });

  // Restore selection if still valid
  if (currentVal && [...select.options].some(o => o.value === currentVal)) {
    select.value = currentVal;
  }
}

function initPushNotificationsTab() {
  const oldBtn = document.getElementById('send-custom-push-btn');
  if (!oldBtn) return;

  // โคลนปุ่มเพื่อล้าง Event Listener ตัวเก่าทั้งหมด ป้องกันปัญหากดส่ง 1 ครั้งแต่ยิงคำขอ 2 รอบ (Double Trigger)
  const sendBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(sendBtn, oldBtn);

  sendBtn.addEventListener('click', async () => {
    const select = document.getElementById('push-target-user');
    const titleInput = document.getElementById('push-title');
    const bodyInput = document.getElementById('push-body');

    if (!select || !titleInput || !bodyInput) return;

    const target = select.value;
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();

    if (!target) {
      showAlert({ title: 'กรุณาเลือกผู้รับ', message: 'โปรดเลือกผู้รับในการส่งข้อความแจ้งเตือน', type: 'warning' });
      return;
    }
    if (!title) {
      showAlert({ title: 'กรุณากรอกหัวข้อ', message: 'โปรดป้อนหัวข้อเรื่องแจ้งเตือน', type: 'warning' });
      return;
    }
    if (!body) {
      showAlert({ title: 'กรุณากรอกข้อความ', message: 'โปรดป้อนรายละเอียดข้อความที่จะส่ง', type: 'warning' });
      return;
    }

    setButtonLoading(sendBtn, true);

    try {
      // 1. บันทึกประวัติการแจ้งเตือนลง Firestore เพื่อให้ได้ ID ของแจ้งเตือนนั้น
      let notifRef = null;
      try {
        let assignedTo = 'all';
        if (target !== 'all_users') {
          const targetUser = _users.find(u => u.fcmToken === target);
          assignedTo = targetUser ? targetUser.id : 'all';
        }
        notifRef = await addCustomNotification({ title, body, assignedTo });
      } catch (dbErr) {
        console.error('❌ ไม่สามารถบันทึกประวัติแจ้งเตือนลง Firestore ได้:', dbErr);
      }

      // 2. สร้าง URL พร้อมแนบ ?notifId=xxx สำหรับนำทาง Deep Linking
      const clickActionUrl = window.location.origin + (notifRef ? `/?notifId=${notifRef.id}` : '');

      let result;
      if (target === 'all_users') {
        result = await triggerPushNotification({
          title,
          body,
          topic: 'all_users',
          clickAction: clickActionUrl
        });
      } else {
        result = await triggerPushNotification({
          title,
          body,
          token: target,
          clickAction: clickActionUrl
        });
      }

      if (result && result.success) {
        showToast('ส่งข้อความแจ้งเตือนสำเร็จ! 🔔', 'success');
        titleInput.value = '';
        bodyInput.value = '';
        select.value = '';
      } else {
        throw new Error(result?.error || 'เซิร์ฟเวอร์ส่งพุชไม่สำเร็จ');
      }
    } catch (err) {
      showAlert({ title: 'ส่งแจ้งเตือนล้มเหลว', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(sendBtn, false, 'ส่งข้อความแจ้งเตือน');
    }
  });

  // Bulk delete selected announcements
  const bulkBtn = document.getElementById('delete-selected-announcements-btn');
  bulkBtn?.addEventListener('click', async () => {
    const checkedCheckboxes = document.querySelectorAll('.announcement-select-checkbox:checked');
    const ids = [...checkedCheckboxes].map(cb => cb.dataset.id);
    if (ids.length === 0) return;

    const ok = await showConfirm({
      title: 'ลบประกาศที่เลือก',
      message: `ต้องการลบหรือยกเลิกการส่งประกาศทั้งหมด <strong>${ids.length} รายการ</strong> ที่เลือกไว้หรือไม่?`,
      detail: 'ผู้ใช้ทุกคนจะไม่เห็นประกาศเหล่านี้ในกระดิ่งแจ้งเตือนอีกต่อไป',
      danger: true,
      confirmText: 'ลบที่เลือก',
      cancelText: 'ยกเลิก'
    });
    if (!ok) return;

    setButtonLoading(bulkBtn, true, `กำลังลบ (${ids.length})...`);
    try {
      await deleteMultipleNotifications(ids);
      showToast(`ลบประกาศ ${ids.length} รายการเรียบร้อยแล้ว`, 'success');
    } catch (err) {
      showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
    } finally {
      setButtonLoading(bulkBtn, false, `ลบที่เลือก`);
    }
  });
}

function renderSentAnnouncementsTable() {
  const listContainer = document.getElementById('sent-announcements-list');
  if (!listContainer) return;

  const filtered = _notifications;

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 text-center bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm">
        <span class="text-3xl mb-2">📢</span>
        <p class="text-xs">ไม่พบประวัติการส่งประกาศ</p>
      </div>
    `;
    const bulkBtn = document.getElementById('delete-selected-announcements-btn');
    if (bulkBtn) bulkBtn.classList.add('hidden');
    return;
  }

  const deleteSvg = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

  listContainer.innerHTML = filtered.map(item => {
    let typeLabel = 'ประกาศ';
    let typeClass = 'bg-rose-light text-rose border-rose-200';
    let iconHTML = '📢';
    if (item.type === 'new_homework') {
      typeLabel = 'การบ้านใหม่';
      typeClass = 'bg-indigo-light text-indigo border-indigo-200';
      iconHTML = '📚';
    } else if (item.type === 'update_homework') {
      typeLabel = 'แก้ไขการบ้าน';
      typeClass = 'bg-violet-light text-violet border-violet-200';
      iconHTML = '✏️';
    } else if (item.type === 'due_warning') {
      typeLabel = 'เตือนกำหนดส่ง';
      typeClass = 'bg-amber-light text-amber border-amber-200';
      iconHTML = '⚠️';
    }

    const timeStr = item.createdAt ? formatDate(item.createdAt) : '🕒 เมื่อครู่นี้';

    return `
      <div class="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4 shadow-xs hover:shadow-md hover:scale-[1.005] hover:border-slate-350 dark:hover:border-slate-600 transition-all duration-250 flex items-start gap-3 relative group">
        <!-- Selection checkbox -->
        <div class="pt-0.5 shrink-0 z-10">
          <input type="checkbox" class="announcement-select-checkbox accent-primary cursor-pointer w-4.5 h-4.5 rounded border-slate-300 dark:border-slate-650" data-id="${item.id}" />
        </div>
        
        <!-- Icon/Badge matching type -->
        <div class="notif-icon-box notif-icon-${item.type} shrink-0 w-9 h-9 rounded-xl flex items-center justify-center border font-bold text-base">
          ${iconHTML}
        </div>

        <!-- Body -->
        <div class="flex-1 min-w-0 pr-8">
          <div class="flex flex-wrap items-center gap-2 mb-1.5">
            <span class="badge ${typeClass} text-[9px] sm:text-[10px] w-max px-2 py-0.5 rounded-lg font-bold">${typeLabel}</span>
            <span class="text-[10px] text-slate-400 dark:text-slate-500">${timeStr}</span>
          </div>
          <h4 class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm leading-snug">${item.title || 'ไม่มีหัวข้อ'}</h4>
          <p class="text-slate-600 dark:text-slate-300 text-xs leading-relaxed mt-1 break-words whitespace-pre-wrap">${item.body || '—'}</p>
        </div>

        <!-- Delete Action -->
        <div class="absolute right-3 top-3 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1.5">
          <button class="w-8 h-8 rounded-lg bg-rose-light text-rose border border-rose/10 hover:bg-rose hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-xs" 
            onclick="window._deleteAnnouncement('${item.id}')" title="ลบประกาศนี้">
            ${deleteSvg}
          </button>
        </div>
      </div>
    `;
  }).join('');

  setupAnnouncementsSelection();
}

function setupAnnouncementsSelection() {
  const selectAllCheckbox = document.getElementById('select-all-announcements');
  const checkboxes = document.querySelectorAll('.announcement-select-checkbox');
  const bulkBtn = document.getElementById('delete-selected-announcements-btn');
  const countSpan = document.getElementById('selected-announcements-count');

  if (!selectAllCheckbox || !bulkBtn || !countSpan) return;

  // Reset checkboxes on new render
  selectAllCheckbox.checked = false;
  bulkBtn.classList.add('hidden');

  function updateBulkDeleteButton() {
    const checkedCount = document.querySelectorAll('.announcement-select-checkbox:checked').length;
    if (checkedCount > 0) {
      countSpan.textContent = checkedCount;
      bulkBtn.classList.remove('hidden');
    } else {
      bulkBtn.classList.add('hidden');
    }
  }

  // Master checkbox click
  selectAllCheckbox.onchange = () => {
    checkboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
    updateBulkDeleteButton();
  };

  // Individual checkbox click
  checkboxes.forEach(cb => {
    cb.onchange = () => {
      const allChecked = [...checkboxes].every(c => c.checked);
      selectAllCheckbox.checked = allChecked;
      updateBulkDeleteButton();
    };
  });
}

window._deleteAnnouncement = async (id) => {
  const ok = await showConfirm({
    title: 'ลบ/ยกเลิกการส่งประกาศ',
    message: 'ต้องการลบหรือยกเลิกการส่งประกาศนี้หรือไม่?',
    detail: 'ผู้ใช้ทุกคนจะไม่เห็นประกาศนี้ในกระดิ่งแจ้งเตือนของระบบอีกต่อไป (ไม่สามารถยกเลิกการส่งแจ้งเตือนประเภท Push Notification ของระบบบราวเซอร์ที่ส่งไปแล้วได้)',
    danger: true,
    confirmText: 'ลบประกาศ',
    cancelText: 'ยกเลิก'
  });
  if (!ok) return;
  try {
    await deleteNotification(id);
    showToast('ลบประกาศและแจ้งเตือนเรียบร้อยแล้ว', 'success');
  } catch (err) {
    showAlert({ title: 'เกิดข้อผิดพลาด', message: err.message, type: 'error' });
  }
};

// renderUsersTable and renderStudentsTable are used internally;
// initUserFilter and initStudentTableSearch are exported above via `export function`
