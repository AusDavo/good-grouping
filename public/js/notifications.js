document.addEventListener('DOMContentLoaded', function() {
  const bell = document.getElementById('notification-bell');
  const panel = document.getElementById('notification-panel');
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notification-list');
  const clearBtn = document.getElementById('clear-all-notifications');

  if (!bell || !panel) return;

  // Toggle dropdown
  bell.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isHidden = panel.classList.contains('hidden');

    if (isHidden) {
      await loadNotifications();
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== bell) {
      panel.classList.add('hidden');
    }
  });

  async function loadNotifications() {
    try {
      const res = await fetch('/notifications/api/recent');
      const data = await res.json();

      renderNotifications(data.notifications);
      updateBadge(data.unreadCount);
    } catch (error) {
      console.error('Failed to load notifications:', error);
      list.innerHTML = '<div class="p-4 text-center text-slate-500">Failed to load</div>';
    }
  }

  function renderNotifications(notifications) {
    if (notifications.length === 0) {
      list.innerHTML = '<div class="p-4 text-center text-slate-500">No notifications</div>';
      return;
    }

    list.innerHTML = notifications.map(n => `
      <a href="/games/${n.reference_id}"
         class="block p-4 hover:bg-slate-700/50 border-b border-slate-700/50 ${n.read_at ? 'opacity-60' : ''}"
         onclick="markAsRead('${n.id}')">
        <div class="flex items-start gap-3">
          <div class="w-2 h-2 mt-2 rounded-full flex-shrink-0 ${n.read_at ? 'bg-slate-600' : 'bg-blue-400'}"></div>
          <div class="flex-1 min-w-0">
            <p class="text-sm text-slate-200 line-clamp-2">${escapeHtml(n.message)}</p>
            <p class="text-xs text-slate-500 mt-1">${formatRelativeTime(n.created_at)}</p>
          </div>
        </div>
      </a>
    `).join('');
  }

  function updateBadge(count) {
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : count;
      badge.classList.remove('hidden');
      if (clearBtn) clearBtn.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
      if (clearBtn) clearBtn.classList.add('hidden');
    }
  }

  // Clear all notifications
  if (clearBtn) {
    clearBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await fetch('/notifications/mark-all-read', { method: 'POST' });
        await loadNotifications();
        updateBadge(0);
      } catch (error) {
        console.error('Failed to clear notifications:', error);
      }
    });
  }

  function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Global function for marking as read
  window.markAsRead = async function(id) {
    try {
      await fetch(`/notifications/${id}/read`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Poll for new notifications every 60 seconds
  setInterval(async () => {
    try {
      const res = await fetch('/notifications/api/unread-count');
      const data = await res.json();
      updateBadge(data.count);
    } catch (error) {
      // Silently fail
    }
  }, 60000);
});
