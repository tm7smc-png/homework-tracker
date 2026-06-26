// ============================================================
// js/utils.js — Shared Utilities (No Firebase dependencies)
// ============================================================

// ══════════════════════════════════════════════════════════
//  XSS PREVENTION
// ══════════════════════════════════════════════════════════

/**
 * Escape HTML special characters to prevent XSS.
 * Use this whenever rendering user-supplied text via innerHTML.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ══════════════════════════════════════════════════════════
//  PERFORMANCE UTILITIES
// ══════════════════════════════════════════════════════════

export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ══════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════

export function showToast(message, type = 'success', duration = 3500) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '•'}</span><span>${message}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ══════════════════════════════════════════════════════════
//  CUSTOM CONFIRM MODAL (replaces window.confirm)
// ══════════════════════════════════════════════════════════

export function showConfirm({
  title   = 'ยืนยันการดำเนินการ',
  message = '',
  confirmText = 'ยืนยัน',
  cancelText  = 'ยกเลิก',
  danger  = false,
  detail  = ''
} = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('util-confirm-modal');
    document.getElementById('ucm-title').textContent   = title;
    document.getElementById('ucm-message').innerHTML   = message;
    document.getElementById('ucm-detail').innerHTML    = detail;
    document.getElementById('ucm-detail').style.display = detail ? 'block' : 'none';
    const confirmBtn = document.getElementById('ucm-confirm');
    const cancelBtn  = document.getElementById('ucm-cancel');
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent  = cancelText;
    confirmBtn.className   = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;

    function cleanup(result) {
      modal.classList.remove('open');
      _releaseScrollLock();
      resolve(result);
    }
    confirmBtn.onclick = () => cleanup(true);
    cancelBtn.onclick  = () => cleanup(false);
    // Allow clicking overlay backdrop to cancel
    modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

// ══════════════════════════════════════════════════════════
//  CUSTOM ALERT MODAL (replaces window.alert)
// ══════════════════════════════════════════════════════════

export function showAlert({ title = 'แจ้งเตือน', message = '', type = 'info' } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('util-alert-modal');
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    document.getElementById('uam-icon').textContent    = icons[type] || 'ℹ️';
    document.getElementById('uam-title').textContent   = title;
    document.getElementById('uam-message').innerHTML   = message;
    const closeBtn = document.getElementById('uam-close');
    const doClose = () => {
      modal.classList.remove('open');
      _releaseScrollLock();
      resolve();
    };
    closeBtn.onclick = doClose;
    // Allow clicking overlay to close
    modal.onclick = (e) => { if (e.target === modal) doClose(); };
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

// ══════════════════════════════════════════════════════════
//  MODAL HELPERS
// ══════════════════════════════════════════════════════════

// [BUG FIX] Track open modal count to avoid unlocking scroll while other modals are open
function _countOpenModals() {
  return document.querySelectorAll('.modal-overlay.open').length;
}
export function _releaseScrollLock() {
  if (_countOpenModals() === 0) {
    document.body.style.overflow = '';
  }
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    _releaseScrollLock();
  }
}

// ══════════════════════════════════════════════════════════
//  DATE UTILITIES
// ══════════════════════════════════════════════════════════

export function formatDate(ts) {
  if (!ts) return 'ไม่มีกำหนดส่ง';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateInput(ts) {
  if (!ts) return '';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().split('T')[0];
}

export function daysRemaining(ts) {
  if (!ts) return Infinity;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = ts?.toDate ? ts.toDate() : new Date(ts);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / 86400000);
}

export function getStatus(hw, isDone = false) {
  if (isDone) return 'done';
  if (!hw.dueDate) return 'normal';
  const days = daysRemaining(hw.dueDate);
  if (days < 0)  return 'overdue';
  if (days <= 3) return 'soon';
  return 'normal';
}

export function getDeadlineLabel(dueDate, status) {
  if (!dueDate) return 'ไม่มีกำหนดส่ง';
  const days = daysRemaining(dueDate);
  if (status === 'done')    return `ส่งแล้ว • ${formatDate(dueDate)}`;
  if (days < 0)             return `เลยกำหนด ${Math.abs(days)} วัน`;
  if (days === 0)           return 'ส่งวันนี้!';
  if (days === 1)           return 'พรุ่งนี้';
  if (days <= 3)            return `อีก ${days} วัน`;
  return formatDate(dueDate);
}

// ══════════════════════════════════════════════════════════
//  BUTTON LOADING STATE
// ══════════════════════════════════════════════════════════

export function setButtonLoading(btn, loading, originalHTML = '') {
  if (loading) {
    if (!btn._origHTML) btn._origHTML = btn.innerHTML;
    btn.disabled = true;
    // Keep width roughly same, replace content with a simple spinner + text
    btn.innerHTML = `<svg class="animate-spin h-5 w-5 mr-2 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> <span class="font-medium">กำลังโหลด...</span>`;
  } else {
    btn.disabled = false;
    btn.innerHTML = originalHTML || btn._origHTML || btn.innerHTML;
  }
}

// ══════════════════════════════════════════════════════════
//  AVATAR HELPERS
// ══════════════════════════════════════════════════════════

/**
 * Convert any Google Drive URL to a directly embeddable image URL.
 * Uses the lh3.googleusercontent.com/d/FILE_ID format.
 * This avoids CORS/auth redirect issues caused by the standard uc?export=view endpoint.
 */
export function getDirectDriveUrl(url) {
  if (!url) return '';

  // Already an lh3 API URL — pass through
  if (url.includes('lh3.googleusercontent.com/d/')) return url;

  // If it's a UC or Thumbnail API URL, extract ID and convert
  if (url.includes('drive.google.com/uc') || url.includes('drive.google.com/thumbnail')) {
    const m = url.match(/[?&]id=([^&\s]+)/);
    if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
  }

  // ✅ Google profile photo (gmail/workspace avatar, not Drive file)
  if (url.includes('googleusercontent.com') && !url.includes('/d/')) return url;

  if (url.includes('drive.google.com')) {
    let fileId = null;

    // /file/d/FILE_ID/view
    const m1 = url.match(/\/file\/d\/([^/?#\s]+)/);
    if (m1) fileId = m1[1];

    // ?id=FILE_ID
    if (!fileId) {
      const m2 = url.match(/[?&]id=([^&#\s]+)/);
      if (m2) fileId = m2[1];
    }

    if (fileId) {
      fileId = fileId.split(/[/?#]/)[0];
      return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
  }

  return url;
}

export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function renderAvatarHTML(photoURL, name, size = 36) {
  const initials = getInitials(name);
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;`;
  if (photoURL) {
    const directUrl = getDirectDriveUrl(photoURL);
    return `<img src="${directUrl}" alt="${name}" class="avatar"
      style="${style}border-radius:50%;object-fit:cover;"
      onerror="this.outerHTML='<div class=\\'avatar avatar-initials\\' style=\\'${style}\\'>${initials}</div>'">`;
  }
  return `<div class="avatar avatar-initials" style="${style}">${initials}</div>`;
}

// ══════════════════════════════════════════════════════════
//  ROLE DISPLAY
// ══════════════════════════════════════════════════════════

export function getRoleLabel(role) {
  return { superadmin: 'Super Admin', admin: 'Admin', user: 'นักเรียน' }[role] || role;
}

export function getRoleBadgeClass(role) {
  return { superadmin: 'badge-superadmin', admin: 'badge-admin', user: 'badge-user' }[role] || '';
}
