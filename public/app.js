// Global Application State
let state = {
    trackedChannels: [],
    schedulerList: [],
    settings: {
        neglectThreshold: 24, // in hours
        audioEnabled: true,
        browserNotifEnabled: true
    },
    history: {},
    activeStatsFilter: 'all' // Current active platform stats filter ('all', 'youtube', 'instagram', or specific channel 'platform_handle')
};

// Helper to proxy external images through our backend to bypass Google's strict browser caching/referrer checks
function getSafeImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('/')) return url;
    return '/api/proxy-image?url=' + encodeURIComponent(url);
}

// Helper to get local date in YYYY-MM-DD format avoiding UTC shifts
window.getLocalISODate = function(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// Chart.js Instances
let viewPerformanceChartInstance = null;
let viewsShareChartInstance = null;
let recentPerformanceChartInstance = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    
    loadStateFromServer()
        .then(() => {
            try {
                initFormHandlers();
                initSyncButtons();
                initSettingsSliders();
                initDemoButton();
                initSchedulerUI();
                renderSchedulerAccounts();
                requestNotificationPermission();
            } catch (err) {
                console.error("Error during sub-initialization modules:", err);
            } finally {
                // Render initial elements safely
                renderAll();
                updateSyncTimestamp(true);
            }
        })
        .catch(err => {
            console.error("Critical error during initial load:", err);
            renderAll();
            updateSyncTimestamp(true);
        });
    
    // Start background checks (every 5 seconds)
    setInterval(backgroundChecks, 5000);
});

function updateSyncTimestamp(isNewSync = false) {
    const syncText = document.getElementById('sync-text');
    if (!syncText) return;
    
    let latestSync = 0;
    if (state.trackedChannels && state.trackedChannels.length > 0) {
        state.trackedChannels.forEach(c => {
            if (c.lastSyncTime) {
                const t = new Date(c.lastSyncTime).getTime();
                if (t > latestSync) latestSync = t;
            }
        });
    }

    if (latestSync === 0) {
        syncText.textContent = 'No data synced';
        return;
    }

    const diffMs = Date.now() - latestSync;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) {
        syncText.textContent = `Updated just now`;
    } else if (diffMins < 60) {
        syncText.textContent = `Updated ${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    } else if (diffMins < 1440) {
        const diffHrs = Math.floor(diffMins / 60);
        syncText.textContent = `Updated ${diffHrs} hr${diffHrs > 1 ? 's' : ''} ago`;
    } else {
        const diffDays = Math.floor(diffMins / 1440);
        syncText.textContent = `Updated ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
}

// --- STATE PERSISTENCE (SERVER DATABASE) ---
async function loadStateFromServer() {
    try {
        const res = await fetch('/api/db');
        if (!res.ok) throw new Error("DB server returned error status");
        const data = await res.json();
        
        state.trackedChannels = (data.trackedChannels || []).map(c => ({...c, videos: c.videos || []}));
        state.schedulerList = data.schedulerList || [];
        state.settings = {
            neglectThreshold: 24,
            audioEnabled: true,
            browserNotifEnabled: true,
            ...(data.settings || {})
        };
        state.history = data.history || {};
    } catch (e) {
        console.warn("Could not fetch state from server backend. Falling back to LocalStorage...", e.message);
        const savedState = localStorage.getItem('clipper_tracker_state');
        if (savedState) {
            try {
                const data = JSON.parse(savedState);
                state.trackedChannels = (data.trackedChannels || []).map(c => ({...c, videos: c.videos || []}));
                state.schedulerList = data.schedulerList || [];
                state.settings = {
                    neglectThreshold: 24,
                    audioEnabled: true,
                    browserNotifEnabled: true,
                    ...(data.settings || {})
                };
                state.history = data.history || {};
            } catch (err) {
                console.error("Corrupted local state:", err);
            }
        }
    }
}

async function saveStateToServer(key) {
    localStorage.setItem('clipper_tracker_state', JSON.stringify(state));
    
    try {
        let endpoint = '/api/db/settings';
        let bodyContent = state.settings;
        
        if (key === 'channels') {
            endpoint = '/api/db/channels';
            bodyContent = state.trackedChannels;
        } else if (key === 'schedules') {
            endpoint = '/api/db/schedules';
            bodyContent = state.schedulerList;
        } else if (key === 'history') {
            // Include history in settings endpoint for now since there's no dedicated history endpoint in server.js
            // Or wait, is there an endpoint for history? server.js doesn't have a POST /api/db/history.
            // But we can bundle it into settings if needed, or simply send a POST to update the history.
            // Oh, look at demo loading in app.js: body: JSON.stringify({ history: demoHistory }) to /api/db/settings
            endpoint = '/api/db/settings';
            bodyContent = { history: state.history };
        }
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyContent)
        });
        
        if (!res.ok) console.warn("Failed to persist save state to server.");
    } catch (e) {
        console.error("Network error saving database state to server:", e.message);
    }
}

// --- NAVIGATION ---
function initNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = item.getAttribute('data-tab');

            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            tabPanes.forEach(pane => {
                pane.classList.remove('active');
                if (pane.id === `tab-${targetTab}`) {
                    pane.classList.add('active');
                }
            });

            const title = item.querySelector('span').textContent;
            document.getElementById('tab-title').textContent = title;

            // Reset Accounts Tab View when switching to it
            if (targetTab === 'accounts') {
                document.getElementById('accounts-list-view').style.display = 'block';
                document.getElementById('account-detail-view').style.display = 'none';
            }

            let subtitle = "Dashboard overview & recent activity logs";
            if (targetTab === 'platforms') subtitle = "Platform-specific analytics & clip listings";
            if (targetTab === 'accounts') subtitle = "Detailed performance grid across linked accounts";
            if (targetTab === 'scheduler') subtitle = "Manage upcoming upload reminders";
            if (targetTab === 'settings') subtitle = "Linked pages & configuration parameters";
            
            document.getElementById('tab-subtitle').textContent = subtitle;
            
            if (targetTab === 'platforms') {
                setTimeout(() => {
                    renderPlatformFilters();
                    renderCharts();
                }, 100);
            }
        });
    });

    const btnBack = document.getElementById('btn-back-accounts');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            document.getElementById('account-detail-view').style.display = 'none';
            document.getElementById('accounts-list-view').style.display = 'block';
        });
    }
}

// --- ALERT TOAST SYSTEM ---
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'warn') icon = 'fa-triangle-exclamation';
    if (type === 'danger') icon = 'fa-bell';
    
    toast.innerHTML = `
        <div class="toast-icon-side">
            <i class="fa-solid ${icon}"></i>
        </div>
        <div class="toast-body">
            <h4>${title}</h4>
            <p>${message}</p>
        </div>
    `;
    
    container.appendChild(toast);
    
    if (type === 'danger' && state.settings.audioEnabled) {
        const chime = document.getElementById('alert-chime');
        if (chime) {
            chime.currentTime = 0;
            chime.play().catch(() => console.log("Audio play blocked by browser settings"));
        }
    }
    
    if (state.settings.browserNotifEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body: message });
    }
    
    setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s reverse forwards';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 5000);
}

function requestNotificationPermission() {
    if (state.settings.browserNotifEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// --- FORM HANDLERS & MODALS ---
function initFormHandlers() {
    let activeLinkPlatform = 'youtube';
    
    // Unified Connect Channel handler
    const saveChannelBtn = document.getElementById('save-channel-btn');
    if (saveChannelBtn) {
        saveChannelBtn.addEventListener('click', () => {
            const handleInput = document.getElementById('setting-channel-handle');
            if (!handleInput) return;
            
            const handle = handleInput.value.trim().replace(/^@/, '');
            if (handle) {
                const exists = state.trackedChannels.some(c => c.platform === activeLinkPlatform && c.handle.toLowerCase() === handle.toLowerCase());
                if (exists) {
                    showToast('Already connected', `@${handle} is already connected on ${activeLinkPlatform}.`, 'warn');
                    return;
                }
                syncChannelData(activeLinkPlatform, handle);
                handleInput.value = '';
            } else {
                showToast('Warning', `Please enter a valid ${activeLinkPlatform === 'youtube' ? 'YouTube handle' : 'Instagram username'}`, 'warn');
            }
        });
    }


    window.renderSchedulerAccounts = function() {
        const container = document.getElementById('schedule-accounts-wrapper');
        
        if (container) {
            if (state.trackedChannels.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding: 10px; font-size: 12px; width: 100%;">No accounts linked.</div>';
            } else {
                let html = '';
                
                const ytChannels = state.trackedChannels.filter(c => c.platform === 'youtube');
                if (ytChannels.length > 0) {
                    html += `
                    <div>
                        <h4 style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;"><i class="fa-brands fa-youtube" style="color: #ff0000;"></i> YouTube Shorts</h4>
                        <div class="avatar-chip-list">
                    `;
                    ytChannels.forEach(c => {
                        html += `
                        <div class="avatar-chip platform-youtube" data-platform="${c.platform}" data-handle="${c.handle}" onclick="this.classList.toggle('selected')">
                            <img src="${getSafeImageUrl(c.avatar)}" title="@${c.handle}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1384/1384060.png'">
                            <div class="check-badge"><i class="fa-solid fa-check"></i></div>
                        </div>
                        `;
                    });
                    html += `</div></div>`;
                }

                const igChannels = state.trackedChannels.filter(c => c.platform === 'instagram');
                if (igChannels.length > 0) {
                    html += `
                    <div>
                        <h4 style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;"><i class="fa-brands fa-instagram" style="color: #E1306C;"></i> Instagram Reels</h4>
                        <div class="avatar-chip-list">
                    `;
                    igChannels.forEach(c => {
                        html += `
                        <div class="avatar-chip platform-instagram" data-platform="${c.platform}" data-handle="${c.handle}" onclick="this.classList.toggle('selected')">
                            <img src="${getSafeImageUrl(c.avatar)}" title="@${c.handle}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1384/1384060.png'">
                            <div class="check-badge"><i class="fa-solid fa-check"></i></div>
                        </div>
                        `;
                    });
                    html += `</div></div>`;
                }

                container.innerHTML = html;
            }
        }
    }

// Dynamic Scheduler UI Initialization
window.initSchedulerUI = function() {
    const pillToggles = document.querySelectorAll('#schedule-freq-toggles .pill-toggle');
    const freqHidden = document.getElementById('schedule-frequency');
    const dateLabel = document.getElementById('schedule-date-label');
    
    if (pillToggles.length > 0 && freqHidden) {
        pillToggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                pillToggles.forEach(t => t.classList.remove('active'));
                const el = e.target;
                el.classList.add('active');
                
                const val = el.getAttribute('data-val');
                freqHidden.value = val;
                
                if (dateLabel) {
                    dateLabel.textContent = val === 'one-time' ? 'Post Date' : 'Start Date';
                }
                
                const customGroup = document.getElementById('schedule-custom-days-group');
                if (customGroup) customGroup.style.display = val === 'custom' ? 'block' : 'none';
                
                const intervalGroup = document.getElementById('schedule-interval-group');
                if (intervalGroup) intervalGroup.style.display = val === 'interval' ? 'block' : 'none';
            });
        });
    }

    const dateInput = document.getElementById('schedule-date');
    if (dateInput) {
        if (!dateInput.value) dateInput.value = getLocalISODate();
        flatpickr(dateInput, {
            dateFormat: "Y-m-d",
            defaultDate: dateInput.value,
            altInput: true,
            altFormat: "F j, Y"
        });
    }

    initCustomTimePicker();
}

window.initCustomTimePicker = function() {
    const hrSelect = document.getElementById('time-hr');
    const minSelect = document.getElementById('time-min');
    const ampmSelect = document.getElementById('time-ampm');
    const hiddenTime = document.getElementById('schedule-time');

    if (!hrSelect || !minSelect || !ampmSelect || !hiddenTime) return;

    if (hrSelect.options.length === 0) {
        let hrHtml = '';
        for (let i = 1; i <= 12; i++) {
            const v = String(i).padStart(2, '0');
            hrHtml += `<option value="${v}">${v}</option>`;
        }
        hrSelect.innerHTML = hrHtml;

        let minHtml = '';
        for (let i = 0; i < 60; i += 5) {
            const v = String(i).padStart(2, '0');
            minHtml += `<option value="${v}">${v}</option>`;
        }
        minSelect.innerHTML = minHtml;
        
        const updateHidden = () => {
            let hr = parseInt(hrSelect.value, 10);
            if (ampmSelect.value === 'PM' && hr !== 12) hr += 12;
            if (ampmSelect.value === 'AM' && hr === 12) hr = 0;
            hiddenTime.value = `${String(hr).padStart(2, '0')}:${minSelect.value}`;
        };
        
        hrSelect.addEventListener('change', updateHidden);
        minSelect.addEventListener('change', updateHidden);
        ampmSelect.addEventListener('change', updateHidden);
    }
    
    // Set to current time safely
    const now = new Date();
    let h = now.getHours();
    let m = Math.ceil(now.getMinutes() / 5) * 5;
    if (m === 60) { m = 0; h += 1; }
    
    ampmSelect.value = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    hrSelect.value = String(h12).padStart(2, '0');
    minSelect.value = String(m).padStart(2, '0');
    
    // Trigger update explicitly to sync hidden input
    hrSelect.dispatchEvent(new Event('change'));
}

function autoCompleteScheduledTasks() {
    let changed = false;
    
    state.schedulerList.forEach(item => {
        if (item.completed) return;
        
        const schedTime = new Date(`${item.date}T${item.time || '12:00'}`).getTime();
        
        const accounts = item.targetAccounts || [];
        if (!item.targetAccounts) {
            if (item.platformYt) accounts.push({platform: 'youtube', handle: 'unknown'});
            if (item.platformIg) accounts.push({platform: 'instagram', handle: 'unknown'});
        }
        
        let allMatched = true;
        let matchVideo = null;
        
        for (const acc of accounts) {
            let accMatchFound = false;
            const channel = state.trackedChannels.find(c => c.platform === acc.platform && c.handle.toLowerCase() === acc.handle.toLowerCase());
            if (channel && channel.videos) {
                for (const v of channel.videos) {
                    if (v.publishedAt) {
                        const pubTime = new Date(v.publishedAt).getTime();
                        // Within +/- 1 hour
                        if (Math.abs(pubTime - schedTime) <= 3600000) {
                            accMatchFound = true;
                            if (!matchVideo) matchVideo = v;
                            break;
                        }
                    }
                }
            }
            if (!accMatchFound) {
                allMatched = false;
                break;
            }
        }
        
        if (allMatched && accounts.length > 0) {
            item.completed = true;
            item.actualPublishTime = matchVideo.publishedAt;
            item.postLink = matchVideo.url || '';
            changed = true;
            
            // Generate next recurrence if applicable
            if (item.frequency && item.frequency !== 'one-time') {
                const current = new Date(`${item.date}T00:00:00`);
                const next = new Date(current);
                
                if (item.customDays && item.customDays.length > 0) {
                    let nextDateObj = new Date(next);
                    nextDateObj.setDate(nextDateObj.getDate() + 1);
                    let loopGuard = 0;
                    while (!item.customDays.includes(nextDateObj.getDay())) {
                        nextDateObj.setDate(nextDateObj.getDate() + 1);
                        if (loopGuard++ > 8) break;
                    }
                    next.setTime(nextDateObj.getTime());
                } else if (item.frequency === 'daily') next.setDate(next.getDate() + 1);
                else if (item.frequency === 'weekly') next.setDate(next.getDate() + 7);
                else if (item.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
                
                const newItem = JSON.parse(JSON.stringify(item));
                newItem.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
                newItem.completed = false;
                newItem.alarmed = false;
                newItem.date = getLocalISODate(next);
                delete newItem.actualPublishTime;
                delete newItem.postLink;
                state.schedulerList.push(newItem);
            }
            
            showToast('Auto-Completed', `Detected live video for scheduled post: ${item.title}`);
        }
    });
    
    if (changed) {
        saveStateToServer('schedules');
        renderAll();
    }
}

// Post Scheduler Form Submission
document.getElementById('scheduler-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const title = document.getElementById('schedule-title').value.trim() || 'Scheduled Upload';
    const frequency = document.getElementById('schedule-frequency').value;
    const date = document.getElementById('schedule-date').value;
    const time = document.getElementById('schedule-time').value;
    const notes = document.getElementById('schedule-notes').value.trim();
    
    // Gather selected accounts from chips
    const selectedAccounts = [];
    document.querySelectorAll('.avatar-chip.selected').forEach(chip => {
        selectedAccounts.push({
            platform: chip.getAttribute('data-platform'),
            handle: chip.getAttribute('data-handle')
        });
    });

    if (selectedAccounts.length === 0) {
        showToast('Warning', 'Please select at least one target account.', 'warn');
        return;
    }

    let interval = null;
    let customDays = [];

    if (frequency === 'interval') {
        interval = parseInt(document.getElementById('schedule-interval').value, 10) || 2;
    } else if (frequency === 'custom') {
        document.querySelectorAll('.custom-day-cb:checked').forEach(cb => {
            customDays.push(parseInt(cb.value, 10));
        });
        if (customDays.length === 0) {
            showToast('Warning', 'Please select at least one day of the week.', 'warn');
            return;
        }
    }

    let actualStartDate = date;
    // For custom days, if the start date doesn't match a selected day, advance it to the first matching day
    if (frequency === 'custom') {
        const d = new Date(date + 'T00:00:00');
        let daysAdded = 0;
        while (!customDays.includes(d.getDay()) && daysAdded < 7) {
            d.setDate(d.getDate() + 1);
            daysAdded++;
        }
        actualStartDate = getLocalISODate(d);
    }

    const newReminder = {
        id: 'sched_' + Date.now(),
        title,
        frequency,
        date: actualStartDate,
        time,
        interval,
        customDays,
        targetAccounts: selectedAccounts,
        notes,
        completed: false,
        alarmed: false
    };

    state.schedulerList.push(newReminder);
    saveStateToServer('schedules');
    renderAll();

    document.getElementById('scheduler-form').reset();
    const dateInp = document.getElementById('schedule-date');
    if (dateInp && dateInp._flatpickr) {
        dateInp._flatpickr.setDate(getLocalISODate());
    }
    
    // Reset custom time picker
    if (typeof initCustomTimePicker === 'function') {
        initCustomTimePicker();
    }
    document.querySelectorAll('.avatar-chip.selected').forEach(chip => chip.classList.remove('selected'));
    document.querySelectorAll('#schedule-freq-toggles .pill-toggle').forEach(t => t.classList.remove('active'));
    const oneTimePill = document.querySelector('#schedule-freq-toggles .pill-toggle[data-val="one-time"]');
    if (oneTimePill) oneTimePill.classList.add('active');
    document.getElementById('schedule-frequency').value = 'one-time';
    
    // Reset display
    document.getElementById('schedule-date-label').textContent = 'Post Date';
    const customGroup = document.getElementById('schedule-custom-days-group');
    if (customGroup) customGroup.style.display = 'none';
    const intervalGroup = document.getElementById('schedule-interval-group');
    if (intervalGroup) intervalGroup.style.display = 'none';

    showToast('Schedule Saved', `Reminder set for ${selectedAccounts.length} account(s)`);
});

    // Sort filter event listener
    document.getElementById('video-sort-filter').addEventListener('change', () => {
        renderTimelineFeed();
    });

    // Checklist tab filters
    document.getElementById('filter-upcoming').addEventListener('click', (e) => {
        document.getElementById('filter-completed').classList.remove('active');
        e.target.classList.add('active');
        renderRemindersChecklist();
    });
    document.getElementById('filter-completed').addEventListener('click', (e) => {
        document.getElementById('filter-upcoming').classList.remove('active');
        e.target.classList.add('active');
        renderRemindersChecklist();
    });
    
    // Copy bookmarklet code helper
    const copyCodeBtn = document.getElementById('copy-bookmarklet-code-btn');
    if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', () => {
            const anchor = document.querySelector('.bookmarklet-box a');
            if (anchor) {
                const code = anchor.getAttribute('href');
                navigator.clipboard.writeText(code).then(() => {
                    showToast('Code Copied', 'Bookmarklet code copied! Paste it in the URL/Address field of your Microsoft Edge favorite.');
                }).catch(() => {
                    showToast('Copy Failed', 'Please copy it manually from the button properties.', 'warn');
                });
            }
        });
    }
}

function initSyncButtons() {
    const btn = document.getElementById('global-sync-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        if (state.trackedChannels.length === 0) {
            showToast('Link Required', 'No channels linked. Link accounts in Settings.', 'warn');
            return;
        }
        
        for (const c of state.trackedChannels) {
            await syncChannelData(c.platform, c.handle);
        }
    });
}

function initSettingsSliders() {
    const thresholdSlider = document.getElementById('setting-neglect-threshold');
    const thresholdVal = document.getElementById('neglect-threshold-value');
    
    thresholdSlider.value = state.settings.neglectThreshold;
    thresholdVal.textContent = `${state.settings.neglectThreshold} Hours`;
    
    thresholdSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        thresholdVal.textContent = `${val} Hours`;
        state.settings.neglectThreshold = parseInt(val, 10);
        saveStateToServer('settings');
        renderNeglectWarning();
    });

    const audioToggle = document.getElementById('setting-enable-audio');
    audioToggle.checked = state.settings.audioEnabled;
    audioToggle.addEventListener('change', (e) => {
        state.settings.audioEnabled = e.target.checked;
        saveStateToServer('settings');
    });

    const browserToggle = document.getElementById('setting-enable-browser-notif');
    browserToggle.checked = state.settings.browserNotifEnabled;
    browserToggle.addEventListener('change', (e) => {
        state.settings.browserNotifEnabled = e.target.checked;
        saveStateToServer('settings');
        requestNotificationPermission();
    });

    const fetchChannelsBtn = document.getElementById('buffer-fetch-channels-btn');
    if (fetchChannelsBtn) {
        fetchChannelsBtn.addEventListener('click', async () => {
            const tokenInput = document.getElementById('buffer-token-input').value;
            if (!tokenInput && !state.settings.bufferToken) {
                showToast('Error', 'Please enter your Buffer Personal Access Token.', 'danger');
                return;
            }

            const token = tokenInput || state.settings.bufferToken;
            
            try {
                fetchChannelsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
                fetchChannelsBtn.disabled = true;

                const res = await fetch('/api/buffer/channels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });

                let data;
                try {
                    data = await res.json();
                } catch (e) {
                    throw new Error("Server returned an invalid response.");
                }

                if (res.ok && data.success) {
                    showToast('Success', `Loaded ${data.channels.length} channels from Buffer.`, 'success');
                    // Save token in state
                    state.settings.bufferToken = token;
                    state.settings.bufferOrgId = data.organizationId;
                    saveStateToServer('settings');
                    
                    const listContainer = document.getElementById('buffer-channels-list');
                    listContainer.style.display = 'flex';
                    listContainer.innerHTML = ''; // clear

                    data.channels.forEach(channel => {
                        const div = document.createElement('div');
                        div.style = 'display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px;';
                        
                        let icon = 'fa-link';
                        if (channel.service === 'instagram') icon = 'fa-instagram';
                        else if (channel.service === 'youtube') icon = 'fa-youtube';
                        else if (channel.service === 'tiktok') icon = 'fa-tiktok';

                        div.innerHTML = `
                            <div style="display:flex; align-items:center; gap:10px;">
                                <i class="fa-brands ${icon}" style="font-size:18px;"></i>
                                <div>
                                    <div style="font-weight:600; font-size:14px;">${channel.name || 'Unnamed'}</div>
                                    <div style="font-size:11px; opacity:0.6; text-transform:capitalize;">${channel.service}</div>
                                </div>
                            </div>
                            <button class="btn btn-primary btn-sm btn-link-buffer" data-id="${channel.id}" data-service="${channel.service}" data-name="${channel.name}" data-org="${data.organizationId}">Link to Tracker</button>
                        `;
                        listContainer.appendChild(div);
                    });

                    // Add listeners to new buttons
                    document.querySelectorAll('.btn-link-buffer').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            const btnEl = e.currentTarget;
                            const channelId = btnEl.getAttribute('data-id');
                            const service = btnEl.getAttribute('data-service');
                            const name = btnEl.getAttribute('data-name');
                            const orgId = btnEl.getAttribute('data-org');

                            btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                            
                            try {
                                const syncRes = await fetch('/api/buffer/sync', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        channelId,
                                        organizationId: orgId,
                                        platform: service,
                                        handle: name,
                                        authorName: name
                                    })
                                });
                                let syncData;
                                try {
                                    syncData = await syncRes.json();
                                } catch (e) {
                                    throw new Error("Invalid response from server.");
                                }
                                if (syncData.success) {
                                    showToast('Linked!', `Channel linked and ${syncData.videosCount} posts synced.`, 'success');
                                    btnEl.innerHTML = '<i class="fa-solid fa-check"></i> Linked';
                                    btnEl.disabled = true;
                                    loadStateFromServer().then(() => renderAll());
                                } else {
                                    showToast('Error', syncData.error || 'Failed to sync posts.', 'danger');
                                    btnEl.innerHTML = 'Retry';
                                }
                            } catch (err) {
                                showToast('Error', err.message, 'danger');
                                btnEl.innerHTML = 'Retry';
                            }
                        });
                    });
                } else {
                    showToast('Error', data.error || 'Failed to fetch channels.', 'danger');
                }
            } catch (err) {
                showToast('Error', err.message, 'danger');
            } finally {
                fetchChannelsBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Load Available Channels';
                fetchChannelsBtn.disabled = false;
            }
        });

        // Pre-fill token if it exists in state
        if (state.settings.bufferToken) {
            document.getElementById('buffer-token-input').value = state.settings.bufferToken;
        }
    }

    document.getElementById('test-alert-btn').addEventListener('click', () => {
        showToast('Test Alarm', 'This is how scheduled alarms and chimes will alert you.', 'danger');
    });
}

function initDemoButton() {
    document.getElementById('load-demo-btn').addEventListener('click', () => {
        loadDemoSandboxData();
    });
}

// --- SYNC SCRAPER LOGIC ---
async function syncChannelData(platform, handle) {
    const spinner = document.getElementById('sync-spinner');
    const syncText = document.getElementById('sync-text');

    if (spinner) spinner.classList.add('spinning');
    if (syncText) syncText.textContent = `Syncing @${handle}...`;

    try {
        const channel = state.trackedChannels.find(c => c.platform === platform && c.handle.toLowerCase() === handle.toLowerCase());
        
        let bufferSuccess = false;
        if (channel && channel.bufferChannelId) {
            // Buffer sync
            try {
                const bufRes = await fetch('/api/buffer/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channelId: channel.bufferChannelId,
                        organizationId: state.settings.bufferOrgId || '6a0d9967d3353bad434a9f3e',
                        platform: channel.platform,
                        handle: channel.handle,
                        authorName: channel.authorName,
                        avatar: channel.avatar
                    })
                });
                
                try {
                    const bufData = await bufRes.json();
                    if (bufRes.ok && bufData.success) {
                        bufferSuccess = true;
                    }
                } catch (e) {
                    console.error("Buffer sync invalid response", e);
                }
            } catch (e) {
                console.error("Buffer sync failed", e);
            }
        } 
        
        // Standard sync (to fetch subscriber counts and native videos for non-IG)
        let standardSuccess = false;
        let data = { success: false };
        const response = await fetch(`/api/${platform}/${handle}`);
        try {
            data = await response.json();
            if (response.ok && data.success) standardSuccess = true;
        } catch (e) {
            console.error("Standard sync invalid response", e);
        }

        if (standardSuccess || bufferSuccess) {
            await loadStateFromServer();
            renderAll();
            showToast('Sync Succeeded', `Statistics updated for @${handle}`);
            if (spinner) spinner.classList.remove('spinning');
            if (syncText) syncText.textContent = 'Sync Data';
            return;
        } else {
            console.error('[Sync Error Payload]:', data);
            showToast('Sync Error', `Could not fetch details for @${handle}`, 'warn');
        }
    } catch (e) {
        console.error(e);
        showToast('Connection Failed', `Network error during sync of @${handle}`, 'warn');
    } finally {
        if (spinner) spinner.classList.remove('spinning');
        updateSyncTimestamp(true);
    }
}



function parseViewsText(viewsText) {
    if (!viewsText) return 0;
    const cleanStr = viewsText.toString().toLowerCase().replace(/views/g, '').replace(/,/g, '').trim();
    if (cleanStr.includes('m')) {
        return Math.round(parseFloat(cleanStr.replace('m', '')) * 1000000);
    }
    if (cleanStr.includes('k')) {
        return Math.round(parseFloat(cleanStr.replace('k', '')) * 1000);
    }
    return parseInt(cleanStr, 10) || 0;
}

// --- RENDER LOGIC ---
function renderAll() {
    renderSettings();
    renderStatsSummary();
    renderTimelineFeed();
    renderNeglectWarning();
    renderSchedulerAccounts();
    renderRemindersChecklist();
    renderHeatmap();
    renderCharts();
    renderAccountsTab();
}

function renderAccountsTab() {
    const ytSection = document.getElementById('youtube-accounts-section');
    const igSection = document.getElementById('instagram-accounts-section');
    const ytGrid = document.getElementById('youtube-accounts-grid');
    const igGrid = document.getElementById('instagram-accounts-grid');
    const emptyMsg = document.getElementById('no-accounts-message');
    
    if (!ytGrid || !igGrid || !ytSection || !igSection || !emptyMsg) return;

    if (state.trackedChannels.length === 0) {
        ytSection.style.display = 'none';
        igSection.style.display = 'none';
        emptyMsg.style.display = 'block';
        return;
    }
    emptyMsg.style.display = 'none';

    let ytHtml = '';
    let igHtml = '';

    state.trackedChannels.forEach(c => {
        const platIcon = c.platform === 'youtube' ? 'fa-youtube' : 'fa-instagram';
        const platColor = c.platform === 'youtube' ? '#ff0000' : '#e1306c';
        const videoCount = c.videos.length;
        const cardHtml = `
            <div class="account-card" onclick="renderAccountDetails('${c.platform}', '${c.handle}')">
                <img src="${getSafeImageUrl(c.avatar) || 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png'}" class="account-card-avatar" alt="Avatar" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1384/1384060.png'" referrerpolicy="no-referrer">
                <div class="account-card-info">
                    <h3>${c.authorName}</h3>
                    <p>@${c.handle}</p>
                </div>
                <div style="margin-left: auto; text-align: right;">
                    <i class="fa-brands ${platIcon}" style="color: ${platColor}; font-size: 20px;"></i>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 5px;">${videoCount} clips</div>
                </div>
            </div>
        `;
        
        if (c.platform === 'youtube') ytHtml += cardHtml;
        else igHtml += cardHtml;
    });

    if (ytHtml) {
        ytSection.style.display = 'block';
        ytGrid.innerHTML = ytHtml;
    } else {
        ytSection.style.display = 'none';
    }

    if (igHtml) {
        igSection.style.display = 'block';
        igGrid.innerHTML = igHtml;
    } else {
        igSection.style.display = 'none';
    }
}

function renderAccountDetails(platform, handle) {
    const channel = state.trackedChannels.find(c => c.platform === platform && c.handle === handle);
    if (!channel) return;

    document.getElementById('accounts-list-view').style.display = 'none';
    document.getElementById('account-detail-view').style.display = 'block';

    const titleEl = document.getElementById('account-detail-title');
    const platIcon = platform === 'youtube' ? 'fa-youtube' : 'fa-instagram';
    const platColor = platform === 'youtube' ? '#ff0000' : '#e1306c';
    titleEl.innerHTML = `<i class="fa-brands ${platIcon}" style="color: ${platColor}; margin-right:8px;"></i> @${escapeHTML(channel.handle)}`;

    const alertEl = document.getElementById('account-schedule-alert');
    if (alertEl) {
        const upcomingTasks = state.schedulerList.filter(t => {
            if (t.completed) return false;
            if (t.targetAccounts) {
                return t.targetAccounts.some(acc => acc.platform === platform && acc.handle.toLowerCase() === handle.toLowerCase());
            }
            return false;
        });
        if (upcomingTasks.length > 0) {
            upcomingTasks.sort((a, b) => {
                const dateA = new Date(a.date + 'T' + a.time);
                const dateB = new Date(b.date + 'T' + b.time);
                return dateA - dateB;
            });
            const nextTask = upcomingTasks[0];
            const nextDate = new Date(nextTask.date + 'T' + nextTask.time);
            const now = new Date();
            const diffMs = nextDate - now;
            
            let timeStr = "";
            if (diffMs <= 0) {
                timeStr = "is overdue";
            } else {
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                
                if (diffDays > 0) {
                    timeStr = `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
                } else if (diffHours > 0) {
                    timeStr = `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
                } else {
                    timeStr = `in less than an hour`;
                }
            }
            
            alertEl.innerHTML = `<i class="fa-solid fa-calendar-check"></i> <span>Next post scheduled: <b>${escapeHTML(nextTask.title)}</b> (${timeStr})</span>`;
            alertEl.style.display = 'flex';
        } else {
            alertEl.style.display = 'none';
        }
    }

    const videosGrid = document.getElementById('account-detail-videos');
    
    // Sort videos by date descending
    const sortedVideos = [...channel.videos].sort((a, b) => {
        const dateA = getClipPublishDate(a);
        const dateB = getClipPublishDate(b);
        return dateB - dateA;
    });

    const avatarEl = document.getElementById('account-avatar');
    if (avatarEl) {
        avatarEl.src = channel.avatar ? getSafeImageUrl(channel.avatar) : 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png';
    }

    const statsContainer = document.getElementById('account-stats-boxes');
    if (statsContainer) {
        const totalVideos = sortedVideos.length;
        let totalViews = 0;
        let parsedViews = [];
        sortedVideos.forEach(v => {
            const num = parseViewsText(v.views);
            totalViews += num;
            if (num > 0 || (v.views && String(v.views).toLowerCase().includes('view'))) parsedViews.push(num);
        });
        const avgViews = parsedViews.length > 0 ? Math.floor(totalViews / parsedViews.length) : 0;
        
        let avgGapStr = "N/A";
        if (sortedVideos.length >= 2) {
            let totalGap = 0;
            let gapCount = 0;
            for (let i = 0; i < sortedVideos.length - 1; i++) {
                const d1 = getClipPublishDate(sortedVideos[i]);
                const d2 = getClipPublishDate(sortedVideos[i+1]);
                if (d1.getTime() > 0 && d2.getTime() > 0) {
                    totalGap += Math.abs(d1 - d2);
                    gapCount++;
                }
            }
            if (gapCount > 0) {
                const avgGapHours = totalGap / gapCount / (1000 * 60 * 60);
                if (avgGapHours >= 24) {
                    avgGapStr = `Every ${(avgGapHours/24).toFixed(1)} days`;
                } else {
                    avgGapStr = `Every ${avgGapHours.toFixed(1)} hours`;
                }
            }
        }
        
        // --- NEW METRICS ---
        
        // 2. Current Streak
        let currentStreak = 0;
        if (sortedVideos.length > 0) {
            const now = new Date();
            const normalizeDay = (d) => {
                // Adjust by timezone offset so local days match
                const offsetMs = d.getTimezoneOffset() * 60 * 1000;
                return Math.floor((d.getTime() - offsetMs) / (1000 * 60 * 60 * 24));
            };
            const currentDay = normalizeDay(now);
            
            let lastValidDay = null;
            for (let i = 0; i < sortedVideos.length; i++) {
                const pd = getClipPublishDate(sortedVideos[i]);
                if (pd.getTime() === 0) continue;
                
                const pdDay = normalizeDay(pd);
                if (lastValidDay === null) {
                    if (currentDay - pdDay <= 1) {
                        currentStreak = 1;
                        lastValidDay = pdDay;
                    } else {
                        break;
                    }
                } else {
                    if (lastValidDay - pdDay === 1) {
                        currentStreak++;
                        lastValidDay = pdDay;
                    } else if (lastValidDay === pdDay) {
                        // Same day, streak continues but count doesn't increase
                    } else {
                        break;
                    }
                }
            }
        }
        const streakStr = currentStreak > 0 ? `${currentStreak} Days` : 'None';

        // 3. Recent Momentum
        let recentMomentum = 0;
        const recentVids = sortedVideos.slice(0, 3);
        recentVids.forEach(v => {
            recentMomentum += parseViewsText(v.views);
        });

        // 4. Recent Daily Frequency
        let recentFreq = 0;
        if (sortedVideos.length > 0) {
            const mostRecentDate = getClipPublishDate(sortedVideos[0]);
            if (mostRecentDate.getTime() > 0) {
                const mostRecentDayString = mostRecentDate.toDateString();
                for (let i = 0; i < sortedVideos.length; i++) {
                    const d = getClipPublishDate(sortedVideos[i]);
                    if (d.toDateString() === mostRecentDayString) {
                        recentFreq++;
                    } else {
                        break; // Videos are sorted descending, so we stop when the date changes
                    }
                }
            }
        }
        const freqStr = recentFreq > 0 ? `${recentFreq} / Day` : 'N/A';

        const formatNumber = (num) => {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toLocaleString();
        };

        // Clean, minimal, premium transparent box design
        const boxStyle = "background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 16px 24px; border-radius: 12px; min-width: 140px; display: flex; flex-direction: column; justify-content: center; flex: 1;";
        const valStyle = "font-size: 24px; font-weight: 800; color: #fff; margin-bottom: 4px; letter-spacing: -0.5px;";
        const labelStyle = "font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 1px;";

        statsContainer.innerHTML = `
            <div style="display: flex; gap: 20px; width: 100%; flex-wrap: wrap;">
                <div style="${boxStyle}">
                    <div style="${valStyle}">${totalVideos}</div>
                    <div style="${labelStyle}">Videos</div>
                </div>
                <div style="${boxStyle}">
                    <div style="${valStyle}">${formatNumber(totalViews)}</div>
                    <div style="${labelStyle}">Total Views</div>
                </div>
                <div style="${boxStyle}">
                    <div style="${valStyle}">${formatNumber(avgViews)}</div>
                    <div style="${labelStyle}">Avg Views</div>
                </div>
                <div style="${boxStyle}">
                    <div style="${valStyle}">${avgGapStr}</div>
                    <div style="${labelStyle}">Posting Gap</div>
                </div>
            </div>
            <div style="display: flex; gap: 20px; width: 100%; flex-wrap: wrap;">
                <div style="${boxStyle}">
                    <div style="${valStyle}">${streakStr}</div>
                    <div style="${labelStyle}">Current Streak</div>
                </div>
                <div style="${boxStyle}">
                    <div style="${valStyle}">${formatNumber(recentMomentum)}</div>
                    <div style="${labelStyle}">Recent Momentum</div>
                </div>
                <div style="${boxStyle}">
                    <div style="${valStyle}">${freqStr}</div>
                    <div style="${labelStyle}">Recent Frequency</div>
                </div>
            </div>
        `;
    }

    if (sortedVideos.length === 0) {
        videosGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1; padding: 40px;">
                <i class="fa-solid fa-video-slash" style="font-size: 24px; color: var(--text-muted); margin-bottom: 8px;"></i>
                <p style="font-size: 14px; color: var(--text-muted); margin: 0;">No clips found for this account.</p>
            </div>
        `;
        document.getElementById('account-last-upload-bar').style.display = 'none';
        return;
    }

    document.getElementById('account-last-upload-bar').style.display = 'flex';
    const lastVideo = sortedVideos[0];
    const lastDate = getClipPublishDate(lastVideo);
    const postType = platform === 'youtube' ? 'short' : 'reel';
    
    if (lastDate.getTime() === 0) {
        document.getElementById('account-last-upload-text').textContent = `The last ${postType}'s upload date is unknown.`;
    } else {
        const now = new Date();
        const diffMs = now - lastDate;
        const timeStr = lastDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        
        let resultStr = "";
        if (diffMs < 1000 * 60) {
            resultStr = `just now`;
        } else if (diffMs < 1000 * 60 * 60) {
            const mins = Math.floor(diffMs / (1000 * 60));
            resultStr = `${mins} minute${mins === 1 ? '' : 's'} ago`;
        } else if (diffMs < 1000 * 60 * 60 * 24) {
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            resultStr = `${hours} hour${hours === 1 ? '' : 's'} ago`;
        } else {
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            if (lastDate.toDateString() === yesterday.toDateString()) {
                resultStr = `yesterday at ${timeStr}`;
            } else {
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                resultStr = `${diffDays} days ago at ${timeStr}`;
            }
        }
        
        document.getElementById('account-last-upload-text').textContent = `The last ${postType} was uploaded ${resultStr}`;
    }

    let html = '';
    sortedVideos.forEach(v => {
        const thumbSrc = v.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&auto=format&fit=crop&q=60';
        const publishDate = getClipPublishDate(v);
        const dateStr = publishDate.getTime() === 0 ? 'Date Unknown' : publishDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        html += `
            <div class="video-card">
                <a href="${v.url || '#'}" target="_blank">
                    <img src="${thumbSrc}" class="video-card-thumb" alt="thumbnail" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&auto=format&fit=crop&q=60'">
                </a>
                <div class="video-card-body">
                    <h4 class="video-card-title" title="${escapeHTML(v.title)}">${escapeHTML(v.title)}</h4>
                    <div class="video-card-meta">
                        <span><i class="fa-solid fa-eye"></i> ${v.views}</span>
                        <span><i class="fa-regular fa-clock"></i> ${dateStr}</span>
                    </div>
                </div>
            </div>
        `;
    });
    videosGrid.innerHTML = html;

    // Handle notes
    const noteInput = document.getElementById('account-notes-input');
    const noteBtn = document.getElementById('btn-save-note');
    const noteDisplay = document.getElementById('account-notes-display');
    const noteEditor = document.getElementById('account-notes-editor');
    const btnEditNote = document.getElementById('btn-edit-note');
    const btnCancelNote = document.getElementById('btn-cancel-note');
    
    if (noteInput && noteBtn && noteDisplay) {
        const savedNote = channel.note || '';
        noteInput.value = savedNote;
        
        const showDisplayMode = () => {
            const currentNote = channel.note || '';
            if (currentNote.trim() === '') {
                noteDisplay.style.display = 'none';
                noteEditor.style.display = 'block';
                btnEditNote.style.display = 'none';
                btnCancelNote.style.display = 'none';
            } else {
                noteDisplay.textContent = currentNote;
                noteDisplay.style.display = 'block';
                noteEditor.style.display = 'none';
                btnEditNote.style.display = 'inline-block';
                btnCancelNote.style.display = 'inline-block';
            }
        };

        btnEditNote.onclick = () => {
            noteInput.value = channel.note || '';
            noteDisplay.style.display = 'none';
            noteEditor.style.display = 'block';
            btnEditNote.style.display = 'none';
        };

        btnCancelNote.onclick = () => {
            showDisplayMode();
        };

        showDisplayMode();

        noteBtn.onclick = async () => {
            const newNote = noteInput.value;
            const originalText = noteBtn.innerText;
            noteBtn.innerText = 'Saving...';
            noteBtn.disabled = true;
            try {
                const res = await fetch(`/api/db/channels/${platform}/${handle}/note`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: newNote })
                });
                if (res.ok) {
                    noteBtn.innerText = 'Saved!';
                    // Update local state
                    const idx = state.trackedChannels.findIndex(c => c.platform === platform && c.handle === handle);
                    if (idx !== -1) {
                        state.trackedChannels[idx].note = newNote;
                        channel.note = newNote; // Update the reference used in this scope too
                    }
                    setTimeout(() => {
                        showDisplayMode();
                    }, 500); // Wait a half second before collapsing so they see "Saved!"
                } else {
                    noteBtn.innerText = 'Error';
                }
            } catch (e) {
                noteBtn.innerText = 'Error';
            }
            if (window.noteSaveTimeout) clearTimeout(window.noteSaveTimeout);
            window.noteSaveTimeout = setTimeout(() => {
                noteBtn.innerText = originalText;
                noteBtn.disabled = false;
            }, 2000);
        };
    }
}

// Render dynamic lists of multiple YouTube and Instagram profiles
function renderSettings() {
    const accountsList = document.getElementById('connected-accounts-list');
    const igSyncBox = document.getElementById('ig-html-sync-box');
    const igSelect = document.getElementById('ig-html-sync-select');
    
    if (!accountsList) return;
    
    if (state.trackedChannels.length === 0) {
        accountsList.innerHTML = `
            <div class="empty-state" style="padding: 20px 0; text-align:center;">
                <i class="fa-solid fa-link-slash" style="font-size: 24px; margin-bottom: 8px; color: var(--text-muted);"></i>
                <p style="font-size:12px; color:var(--text-muted); margin:0;">No channels or profiles linked yet. Connect one below!</p>
            </div>
        `;
    } else {
        const ytChannels = state.trackedChannels.filter(c => c.platform === 'youtube');
        const igChannels = state.trackedChannels.filter(c => c.platform === 'instagram');
        
        let html = '';
        
        const renderChannelItem = (c) => {
            const isYT = c.platform === 'youtube';
            const platName = isYT ? 'YouTube Shorts' : 'Instagram Reels';
            const platClass = isYT ? 'badge-yt' : 'badge-ig';
            const platIcon = isYT ? 'fa-brands fa-youtube' : 'fa-brands fa-instagram';
            const statText = c.subscriberCount || 'N/A';
            const initials = c.handle.slice(0, 2).toUpperCase();
            
            // Format colors for display
            const statColor = isYT ? '#10b981' : '#e11d48';
            const badgeBg = isYT ? 'rgba(239, 68, 68, 0.15)' : 'rgba(236, 72, 153, 0.15)';
            const badgeColor = isYT ? '#ef4444' : '#ec4899';
            const badgeBorder = isYT ? 'rgba(239, 68, 68, 0.3)' : 'rgba(236, 72, 153, 0.3)';
            
            return `
            <div class="linked-profile-box mt-1" style="background: rgba(255,255,255,0.02); padding: 12px; border-radius: 10px; border: 1px solid var(--border-glass); display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="position: relative; width:40px; height:40px;">
                        <img src="${getSafeImageUrl(c.avatar)}" class="profile-avatar" alt="Avatar" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border: 1px solid var(--border-glass);">
                        <div class="avatar-fallback" style="display:none; width:40px; height:40px; border-radius:50%; background: linear-gradient(135deg, var(--color-primary), var(--color-accent)); color:#fff; font-weight:bold; font-size:12px; align-items:center; justify-content:center; border: 1px solid var(--border-glass);">${initials}</div>
                        <div style="position:absolute; bottom:-3px; right:-3px; width:18px; height:18px; border-radius:50%; background: ${isYT ? '#ff0000' : 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'}; display:flex; align-items:center; justify-content:center; border: 2.5px solid #121212; font-size: 8px; color: #fff;">
                            <i class="${platIcon}"></i>
                        </div>
                    </div>
                    <div>
                        <h4 style="font-size:13px; font-weight:700; margin:0; color:#fff;">${escapeHTML(c.authorName)}</h4>
                        <p class="text-xs text-muted" style="margin:2px 0 0 0; font-size: 11px;">@${escapeHTML(c.handle)}</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="text-align: right;">
                        <span class="badge" style="font-size: 9px; padding: 2px 6px; border-radius: 4px; display:inline-block; margin-bottom: 2px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-weight: 600;">${platName}</span>
                        <p style="margin:0; font-size: 11px; font-weight: 600; color: ${statColor};">${statText}</p>
                    </div>
                    <button class="btn btn-danger btn-circle btn-sm" onclick="event.stopPropagation(); unlinkChannel('${c.platform}', '${c.handle}')" title="Unlink Channel" style="padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%;"><i class="fa-solid fa-unlink" style="font-size:11px;"></i></button>
                </div>
            </div>
            `;
        };

        if (ytChannels.length > 0) {
            html += `
            <div style="margin-bottom: 24px;">
                <h3 style="font-size: 14px; font-weight: 600; color: #fff; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-brands fa-youtube" style="color: #ff0000;"></i> YouTube Accounts
                </h3>
                ${ytChannels.map(renderChannelItem).join('')}
            </div>
            `;
        }

        if (igChannels.length > 0) {
            html += `
            <div>
                <h3 style="font-size: 14px; font-weight: 600; color: #fff; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-brands fa-instagram" style="color: #E1306C;"></i> Instagram Accounts
                </h3>
                ${igChannels.map(renderChannelItem).join('')}
            </div>
            `;
        }

        accountsList.innerHTML = html;
    }
    
    // Render Instagram Chrome Extension Status
    const icon = document.getElementById('ig-extension-status-icon');
    const text = document.getElementById('ig-extension-status-text');
    if (icon && text) {
        const hasExtension = document.documentElement.getAttribute('data-ig-extension-active') === 'true';
        if (hasExtension) {
            icon.style.background = 'var(--color-success)';
            text.textContent = 'Extension Connected and Active!';
        } else {
            icon.style.background = 'var(--color-danger)';
            text.textContent = 'Extension Not Detected';
        }
    }
}

window.unlinkChannel = function(platform, handle) {
    state.trackedChannels = state.trackedChannels.filter(c => !(c.platform === platform && c.handle.toLowerCase() === handle.toLowerCase()));
    saveStateToServer('channels');
    renderAll();
    showToast('Success', `Unlinked @${handle} successfully`);
};

function renderStatsSummary() {
    let combinedViews = 0;
    let ytSubsCount = 0;
    let igFollowersCount = 0;
    let ytHasData = false;
    let igHasData = false;
    let lastPostDate = null;
    const postCountsByDay = {};

    state.trackedChannels.forEach(c => {
        c.videos.forEach(v => {
            combinedViews += parseViewsText(v.views);

            const clipObj = { ...v, platform: c.platform, channelHandle: c.handle };
            const pDate = getClipPublishDate(clipObj);
            
            if (pDate && pDate.getTime() !== 0) {
                if (!lastPostDate || pDate > lastPostDate) {
                    lastPostDate = pDate;
                }
                const dayKey = getLocalISODate(pDate);
                postCountsByDay[dayKey] = (postCountsByDay[dayKey] || 0) + 1;
            }
        });

        if (c.platform === 'youtube') {
            if (c.subscriberCount && c.subscriberCount !== 'N/A') {
                ytHasData = true;
                const num = parseInt(c.subscriberCount.replace(/[^0-9]/g, ''), 10) || 0;
                if (c.subscriberCount.toLowerCase().includes('m')) {
                    ytSubsCount += (parseFloat(c.subscriberCount) * 1000000) || 0;
                } else if (c.subscriberCount.toLowerCase().includes('k')) {
                    ytSubsCount += (parseFloat(c.subscriberCount) * 1000) || 0;
                } else {
                    ytSubsCount += num;
                }
            }
        }
        if (c.platform === 'instagram') {
            if (c.subscriberCount && c.subscriberCount !== 'N/A') {
                igHasData = true;
                if (c.subscriberCount.toLowerCase().includes('m')) {
                    igFollowersCount += (parseFloat(c.subscriberCount) * 1000000) || 0;
                } else if (c.subscriberCount.toLowerCase().includes('k')) {
                    igFollowersCount += (parseFloat(c.subscriberCount) * 1000) || 0;
                } else {
                    igFollowersCount += parseInt(c.subscriberCount.replace(/[^0-9]/g, ''), 10) || 0;
                }
            }
        }
    });

    // Formatting totals for multiple pages summary
    const combinedEl = document.getElementById('stat-combined-views');
    if (combinedEl) combinedEl.textContent = formatViews(combinedViews);
    
    let uploadFrequency = 0;
    if (lastPostDate) {
        const lastDayKey = getLocalISODate(lastPostDate);
        uploadFrequency = postCountsByDay[lastDayKey] || 0;
    }
    const velEl = document.getElementById('stat-velocity');
    if (velEl) velEl.textContent = `${uploadFrequency}/day`;
    
    // Only show 0 if they linked an account with 0 followers, otherwise show N/A
    const ytCount = state.trackedChannels.filter(c => c.platform === 'youtube').length;
    const igCount = state.trackedChannels.filter(c => c.platform === 'instagram').length;
    
    const ytSubsEl = document.getElementById('stat-yt-subs');
    if (ytSubsEl) ytSubsEl.textContent = ytCount > 0 && !ytHasData ? 'N/A' : formatViews(ytSubsCount);
    
    const igFolEl = document.getElementById('stat-ig-followers');
    if (igFolEl) igFolEl.textContent = igCount > 0 && !igHasData ? 'N/A' : formatViews(igFollowersCount);
    
    document.getElementById('stat-yt-handle').textContent = `${ytCount} Channels Linked`;
    document.getElementById('stat-ig-handle').textContent = `${igCount} Accounts Linked`;
    
    const lastPostEl = document.getElementById('stat-last-post');
    if (lastPostDate) {
        const diffHours = Math.floor((new Date() - lastPostDate) / (1000 * 60 * 60));
        if (diffHours < 1) {
            lastPostEl.textContent = "Last: < 1 hr ago";
        } else if (diffHours < 24) {
            lastPostEl.textContent = `Last: ${diffHours} hr ago`;
        } else {
            lastPostEl.textContent = `Last: ${Math.floor(diffHours/24)} days ago`;
        }
    } else {
        lastPostEl.textContent = "Last: Never";
    }
}

function getClipPublishDate(clip) {
    const now = new Date();
    
    // For YouTube clips, publishedAt is always real
    if (clip.platform === 'youtube' && clip.publishedAt) {
        return new Date(clip.publishedAt);
    }
    
    // For Instagram, check if publishedAt looks real or is a fake "now" fallback
    if (clip.publishedAt) {
        const pubDate = new Date(clip.publishedAt);
        const diffMs = Math.abs(now - pubDate);
        
        // If the date is NOT suspiciously close to "right now" (>5 min old), trust it
        if (diffMs > 5 * 60 * 1000) {
            return pubDate;
        }
    }
    
    // Fallback: use history first-seen date (when the tracker first logged this clip)
    const historyKey = `${clip.platform}_${clip.channelHandle}_${clip.videoId}`;
    const snapshots = state.history[historyKey];
    if (snapshots && snapshots.length > 0) {
        return new Date(snapshots[0].date + 'T00:00:00');
    }
    
    // If we have a publishedAt at all, use it even if suspicious
    if (clip.publishedAt) return new Date(clip.publishedAt);
    
    return new Date(0); // absolute fallback
}

function renderTimelineFeed() {
    const timelineFeed = document.getElementById('timeline-feed');
    const timelineCount = document.getElementById('timeline-count');
    const tableBody = document.getElementById('video-table-body');
    
    if (!timelineFeed || !timelineCount || !tableBody) return;
    
    let allClips = [];
    state.trackedChannels.forEach(c => {
        c.videos.forEach(v => {
            allClips.push({
                ...v,
                platform: c.platform,
                channelHandle: c.handle
            });
        });
    });
    
    allClips.sort((a, b) => {
        const dateA = getClipPublishDate(a);
        const dateB = getClipPublishDate(b);
        return dateB - dateA;
    });

    // Filter to uploads in the past 2 days
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(0, 0, 0, 0);
    
    const recentClips = allClips.filter(clip => {
        const publishDate = getClipPublishDate(clip);
        return publishDate >= twoDaysAgo;
    });

    timelineCount.textContent = `${recentClips.length} Clips`;
    
    if (recentClips.length === 0) {
        timelineFeed.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-calendar-minus" style="font-size: 24px; color: var(--text-muted); margin-bottom: 8px;"></i>
                <p style="font-size: 12px; color: var(--text-muted); margin: 0;">No uploads in the past 2 days across all platforms.</p>
            </div>
        `;
    } else {
        // Render Timeline listing (shows handle names) split by platform
        const ytClips = recentClips.filter(c => c.platform === 'youtube');
        const igClips = recentClips.filter(c => c.platform === 'instagram');
        
        let timelineHTML = '';
        
        const renderClipItem = (clip) => {
            const platIcon = clip.platform === 'youtube' ? 'fa-brands fa-youtube yt' : 'fa-brands fa-instagram ig';
            const publishDate = getClipPublishDate(clip);
            const dateStr = publishDate.getTime() === 0 ? 'Date Unknown' : formatFriendlyDate(publishDate.toISOString());
            const thumbSrc = clip.thumbnail || 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png';
            return `
            <div class="timeline-item">
                <div class="timeline-thumb-wrapper">
                    <img src="${thumbSrc}" class="timeline-thumb" alt="thumbnail" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://cdn-icons-png.flaticon.com/512/1384/1384060.png'">
                    <div class="timeline-platform-icon ${clip.platform === 'youtube' ? 'yt' : 'ig'}">
                        <i class="${platIcon}"></i>
                    </div>
                </div>
                <div class="timeline-details">
                    <h4>${escapeHTML(clip.title)}</h4>
                    <div class="timeline-meta" style="margin-bottom:8px;">
                        <span class="text-accent" style="font-weight:600;">@${escapeHTML(clip.channelHandle)}</span>
                        <span><i class="fa-solid fa-eye"></i> ${clip.views}</span>
                        <span><i class="fa-regular fa-clock"></i> ${dateStr}</span>
                    </div>
                </div>
            </div>
            `;
        };

        if (ytClips.length > 0) {
            timelineHTML += `
            <div style="margin-bottom: 24px;">
                <h3 style="font-size: 14px; font-weight: 600; color: #fff; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-brands fa-youtube" style="color: #ff0000;"></i> YouTube Recent
                </h3>
                ${ytClips.map(renderClipItem).join('')}
            </div>
            `;
        }

        if (igClips.length > 0) {
            timelineHTML += `
            <div>
                <h3 style="font-size: 14px; font-weight: 600; color: #fff; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-brands fa-instagram" style="color: #E1306C;"></i> Instagram Recent
                </h3>
                ${igClips.map(renderClipItem).join('')}
            </div>
            `;
        }

        timelineFeed.innerHTML = timelineHTML;
    }
    
    // Default empty state for Clips Table if allClips is empty
    if (allClips.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="table-empty">
                    <i class="fa-solid fa-video-slash"></i> No clips loaded. Link channels and sync to view individual clip performances.
                </td>
            </tr>
        `;
        return;
    }

    // Filter table clips based on active filters
    let filteredClips = allClips;
    if (state.activeStatsFilter === 'youtube') {
        filteredClips = allClips.filter(c => c.platform === 'youtube');
    } else if (state.activeStatsFilter === 'instagram') {
        filteredClips = allClips.filter(c => c.platform === 'instagram');
    } else if (state.activeStatsFilter.includes('_')) {
        const parts = state.activeStatsFilter.split('_');
        const plat = parts[0];
        const hand = parts.slice(1).join('_');
        filteredClips = allClips.filter(c => c.platform === plat && c.channelHandle.toLowerCase() === hand.toLowerCase());
    }

    // Apply sorting
    const sortVal = document.getElementById('video-sort-filter').value;
    filteredClips.sort((a, b) => {
        if (sortVal === 'date-desc') {
            return (b.publishedAt ? new Date(b.publishedAt) : 0) - (a.publishedAt ? new Date(a.publishedAt) : 0);
        } else if (sortVal === 'date-asc') {
            return (a.publishedAt ? new Date(a.publishedAt) : 0) - (b.publishedAt ? new Date(b.publishedAt) : 0);
        } else if (sortVal === 'views-desc') {
            return parseViewsText(b.views) - parseViewsText(a.views);
        } else if (sortVal === 'views-asc') {
            return parseViewsText(a.views) - parseViewsText(b.views);
        }
        return 0;
    });

    let tableHTML = '';
    filteredClips.forEach(clip => {
        const platClass = clip.platform === 'youtube' ? 'color-yt' : 'color-ig';
        const platName = clip.platform === 'youtube' ? 'YT Shorts' : 'IG Reel';
        const dateStr = clip.publishedAt ? formatDetailedDate(clip.publishedAt) : 'Date Unknown';
        const viewsCount = parseViewsText(clip.views);
        
        tableHTML += `
            <tr>
                <td>
                    <div class="table-clip-cell">
                        <img src="${clip.thumbnail}" class="table-clip-thumb" alt="thumb" referrerpolicy="no-referrer">
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <span class="table-clip-title" title="${escapeHTML(clip.title)}">${escapeHTML(clip.title)}</span>
                            <span class="text-xs text-muted">Account: @${escapeHTML(clip.channelHandle)}</span>
                        </div>
                    </div>
                </td>
                <td class="${platClass} font-weight-bold">
                    <i class="${clip.platform === 'youtube' ? 'fa-brands fa-youtube' : 'fa-brands fa-instagram'}"></i> ${platName}
                </td>
                <td class="font-weight-bold">${viewsCount.toLocaleString()}</td>
                <td class="text-muted">${dateStr}</td>
                <td>
                    <a href="${clip.url || '#'}" target="_blank" class="btn btn-control-sm btn-secondary"><i class="fa-solid fa-square-arrow-up-right"></i></a>
                </td>
            </tr>
        `;
    });
    tableBody.innerHTML = tableHTML || '<tr><td colspan="5" class="table-empty"><i class="fa-solid fa-video-slash"></i> No matching clips found for this filter.</td></tr>';
}

function renderNeglectWarning() {
    const banner = document.getElementById('neglect-alert-banner');
    const bannerText = document.getElementById('neglect-banner-text');
    
    let latestUploadDate = null;
    state.trackedChannels.forEach(c => {
        c.videos.forEach(v => {
            if (v.publishedAt) {
                const date = new Date(v.publishedAt);
                if (!latestUploadDate || date > latestUploadDate) {
                    latestUploadDate = date;
                }
            }
        });
    });

    if (!latestUploadDate) {
        if (banner) banner.classList.remove('active');
        return;
    }

    const elapsedMs = new Date() - latestUploadDate;
    const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
    
    if (elapsedHours >= state.settings.neglectThreshold) {
        if (banner) {
            banner.classList.add('active');
            if (bannerText) bannerText.innerHTML = `It has been <strong>${elapsedHours} hours</strong> since your last video release across all accounts. Keep your pages hot by uploading a new clip! (Your Alert Target is ${state.settings.neglectThreshold} hours).`;
        }
    } else {
        if (banner) banner.classList.remove('active');
    }
    
    calculateStreak();
}

function calculateStreak() {
    const counterEl = document.getElementById('streak-counter');
    if (!counterEl) return;
    
    const uploadDays = new Set();
    state.trackedChannels.forEach(c => {
        c.videos.forEach(v => {
            if (v.publishedAt) {
                const d = new Date(v.publishedAt);
                uploadDays.add(d.toDateString());
            }
        });
    });
    
    let streak = 0;
    let checkDate = new Date();
    
    while (true) {
        if (uploadDays.has(checkDate.toDateString())) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            if (streak === 0) {
                checkDate.setDate(checkDate.getDate() - 1);
                if (uploadDays.has(checkDate.toDateString())) {
                    streak = 1;
                    checkDate.setDate(checkDate.getDate() - 1);
                    continue;
                }
            }
            break;
        }
    }
    
    counterEl.textContent = `${streak} Day Post Streak`;
    
    if (streak > 0) {
        counterEl.style.borderColor = 'var(--color-orange)';
        counterEl.style.boxShadow = '0 0 10px rgba(255, 149, 0, 0.2)';
    } else {
        counterEl.style.borderColor = 'var(--border-glass)';
        counterEl.style.boxShadow = 'none';
    }
}

function renderRemindersChecklist() {
    const container = document.getElementById('scheduler-timeline');
    const badge = document.getElementById('schedule-badge');
    const widgetList = document.getElementById('dashboard-reminders-list');
    
    if (!container || !badge || !widgetList) return;
    
    const showCompleted = document.getElementById('filter-completed').classList.contains('active');
    let filteredList = state.schedulerList.filter(item => item.completed === showCompleted);
    
    filteredList.sort((a, b) => {
        const timeA = new Date(`${a.date}T${a.time}`);
        const timeB = new Date(`${b.date}T${b.time}`);
        return showCompleted ? timeB - timeA : timeA - timeB;
    });

    const dueCount = state.schedulerList.filter(item => {
        if (item.completed) return false;
        const schedTime = new Date(`${item.date}T${item.time}`);
        return new Date() >= schedTime;
    }).length;
    
    badge.textContent = dueCount;
    badge.style.display = dueCount > 0 ? 'inline-block' : 'none';

    if (filteredList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-calendar-xmark"></i>
                <p>No ${showCompleted ? 'completed' : 'upcoming'} post reminders on the timeline.</p>
            </div>
        `;
    } else {
        let html = '';
        const now = new Date();

        filteredList.forEach(r => {
            const itemTime = new Date(`${r.date}T${r.time}`);
            const isDue = !r.completed && now >= itemTime;
            
            let badgeHtml = '';
            
            if (r.completed) {
                badgeHtml = '<div class="time-badge completed">Completed</div>';
            } else if (isDue) {
                badgeHtml = '<div class="time-badge due">Due Now</div>';
            } else {
                const diffHrs = Math.ceil((itemTime - now) / (1000 * 60 * 60));
                const diffDays = Math.ceil(diffHrs / 24);
                if (diffDays > 1) {
                    badgeHtml = `<div class="time-badge upcoming">In ${diffDays} days</div>`;
                } else {
                    badgeHtml = `<div class="time-badge upcoming">In ${diffHrs} hr${diffHrs > 1 ? 's' : ''}</div>`;
                }
            }
            
            let avatarsHtml = '';
            
            const accounts = r.targetAccounts || [];
            if (!r.targetAccounts) {
                if (r.platformYt) accounts.push({platform: 'youtube', handle: 'unknown'});
                if (r.platformIg) accounts.push({platform: 'instagram', handle: 'unknown'});
            }
            
            accounts.forEach(acc => {
                const channel = state.trackedChannels.find(c => c.platform === acc.platform && c.handle.toLowerCase() === acc.handle.toLowerCase());
                let imgSrc = '';
                if (channel && channel.avatar) {
                    imgSrc = getSafeImageUrl(channel.avatar);
                } else {
                    imgSrc = acc.platform === 'youtube' ? 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Youtube_logo_2005.svg' : 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg';
                }
                
                const platColor = acc.platform === 'youtube' ? '#ff0000' : '#E1306C';
                
                avatarsHtml += `
                    <div style="display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.05); padding: 6px 14px 6px 6px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.1); margin-right: 12px;">
                        <img src="${imgSrc}" style="width: 32px !important; height: 32px !important; border-radius: 50%; object-fit: cover; background: white; margin: 0 !important; border: none !important;" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1384/1384060.png'">
                        <span style="font-size: 14px; font-weight: 600; color: #fff;">@${acc.handle}</span>
                        <i class="fa-brands fa-${acc.platform}" style="color: ${platColor}; font-size: 14px; margin-left: 2px;"></i>
                    </div>
                `;
            });
            
            let typeBadge = '';
            if (r.frequency === 'daily') typeBadge = '<i class="fa-solid fa-rotate-right" style="font-size:10px;"></i> Daily';
            else if (r.frequency === 'interval') typeBadge = `<i class="fa-solid fa-clock" style="font-size:10px;"></i> Every ${r.interval} Days`;
            else if (r.frequency === 'custom') typeBadge = '<i class="fa-solid fa-calendar-days" style="font-size:10px;"></i> Custom';

            html += `
            <div class="timeline-event ${r.completed ? 'completed' : ''}">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                    <div class="timeline-info">
                        <h4>${escapeHTML(r.title) || 'Scheduled Post'}</h4>
                        <div class="timeline-meta">
                            ${r.completed && r.actualPublishTime ? `<span><i class="fa-solid fa-check"></i> Published: ${formatDetailedDate(r.actualPublishTime)}</span>` : `<span><i class="fa-regular fa-clock"></i> ${new Date(r.date + 'T00:00:00').toLocaleDateString()} at ${formatTimeLabel(itemTime)}</span>`}
                            ${typeBadge ? `<span style="opacity:0.6; margin: 0 4px;">|</span> <span style="color:var(--color-primary); font-weight:600;">${typeBadge}</span>` : ''}
                        </div>
                        <div class="timeline-avatars">
                            ${avatarsHtml}
                        </div>
                        ${r.notes ? `<p style="font-size: 11px; color: var(--text-muted); margin-top: 8px; max-width: 300px; white-space: pre-wrap;">${escapeHTML(r.notes)}</p>` : ''}
                    </div>
                    <div class="timeline-actions">
                        ${badgeHtml}
                        <div style="display: flex; gap: 8px;">
                            ${r.completed && r.postLink ? `<a href="${r.postLink}" target="_blank" class="btn-done" style="background: rgba(14,165,233,0.1); color: #38bdf8; text-decoration: none; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-arrow-up-right-from-square"></i> View Post</a>` : ''}
                            ${!r.completed ? `<button class="btn-done" onclick="toggleReminderCompleted('${r.id}')"><i class="fa-solid fa-check"></i> Mark Done</button>` : ''}
                            <button class="btn-delete-task" style="${!r.completed ? 'background: rgba(255,59,48,0.1); color: #ff3b30; border: none; padding: 6px 12px; border-radius: 20px; font-weight: 600; cursor: pointer; transition: 0.2s;' : ''}" onclick="deleteReminder('${r.id}')"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </div>
                </div>
            </div>
            `;
        });

        container.innerHTML = html;
    }

    const upcomingMini = state.schedulerList.filter(item => !item.completed);
    upcomingMini.sort((a,b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
    
    if (upcomingMini.length === 0) {
        widgetList.innerHTML = `
            <div class="empty-state-mini">
                <i class="fa-regular fa-bell-slash"></i>
                <p>No reminders set.</p>
            </div>
        `;
    } else {
        let miniHTML = '';
        upcomingMini.slice(0, 3).forEach(item => {
            const itemTime = new Date(`${item.date}T${item.time}`);
            const isDue = new Date() >= itemTime;
            
            miniHTML += `
                <div class="reminder-mini-item">
                    <div class="reminder-mini-details">
                        <span class="reminder-mini-title">${escapeHTML(item.title)}</span>
                        <div class="reminder-mini-meta">
                            <span><i class="fa-regular fa-clock"></i> ${formatTimeLabel(itemTime)}</span>
                            <div class="reminder-mini-platforms">
${item.targetAccounts ? item.targetAccounts.map(acc => `<span class="plat-badge-sm ${acc.platform === 'youtube' ? 'yt' : 'ig'}">@${acc.handle}</span>`).join('') : `
    ${item.platformYt ? '<span class="plat-badge-sm yt">Shorts</span>' : ''}
    ${item.platformIg ? '<span class="plat-badge-sm ig">Reels</span>' : ''}
`}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 4px; align-items: center;">
                        <button class="reminder-mini-btn ${isDue ? 'btn-due' : 'btn-pending'}" onclick="toggleReminderCompleted('${item.id}')">
                            ${isDue ? '<i class="fa-solid fa-upload"></i> Post' : 'Pending'}
                        </button>
                        <button class="reminder-mini-btn" style="background:transparent; color:#ff3b30; padding:4px;" onclick="deleteReminder('${item.id}')" title="Delete">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        widgetList.innerHTML = miniHTML;
    }
}

window.toggleReminderCompleted = function(id) {
    const item = state.schedulerList.find(i => i.id === id);
    if (item) {
        if (!item.completed) {
            // Open modal to confirm
            document.getElementById('completion-task-id').value = id;
            
            // Pre-fill datetime-local (format: YYYY-MM-DDThh:mm)
            const dateStr = item.date;
            const timeStr = item.time || '12:00';
            document.getElementById('completion-actual-time').value = `${dateStr}T${timeStr}`;
            document.getElementById('completion-link').value = '';
            
            document.getElementById('confirm-completion-modal').style.display = 'flex';
        } else {
            item.completed = false; // unchecking
            saveStateToServer('schedules');
            renderAll();
            showToast('Task Update', `Reminder marked as active`);
        }
    }
};

window.openUploadDetailsModal = function(id) {
    const item = state.schedulerList.find(i => i.id === id);
    if (item) {
        document.getElementById('completion-task-id').value = id;
        
        const dateStr = item.actualPublishTime ? new Date(item.actualPublishTime).toISOString().split('T')[0] : item.date;
        let timeStr = item.time || '12:00';
        if (item.actualPublishTime) {
            const t = new Date(item.actualPublishTime);
            timeStr = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        }
        
        document.getElementById('completion-actual-time').value = `${dateStr}T${timeStr}`;
        document.getElementById('completion-link').value = item.postLink || '';
        
        document.getElementById('confirm-completion-modal').style.display = 'flex';
    }
};

window.confirmTaskCompletion = function() {
    const id = document.getElementById('completion-task-id').value;
    const actualTime = document.getElementById('completion-actual-time').value;
    const link = document.getElementById('completion-link').value;
    
    if (!actualTime) return alert("Actual publish time is required.");
    
    const item = state.schedulerList.find(i => i.id === id);
    if (item) {
        const wasCompleted = item.completed;
        item.completed = true;
        item.actualPublishTime = new Date(actualTime).toISOString();
        item.postLink = link;
        
        // Generate next recurrence if applicable
        if (!wasCompleted && item.frequency && item.frequency !== 'one-time') {
            const current = new Date(`${item.date}T00:00:00`);
            const next = new Date(current);
            
            if (item.frequency === 'daily') {
                next.setDate(next.getDate() + 1);
            } else if (item.frequency === 'weekly') {
                next.setDate(next.getDate() + 7);
            } else if (item.frequency === 'monthly') {
                next.setMonth(next.getMonth() + 1);
            } else if (item.frequency === 'interval') {
                next.setDate(next.getDate() + (item.interval || 2));
            } else if (item.frequency === 'custom') {
                let daysToAdd = 1;
                while(daysToAdd <= 7) {
                    const checkDate = new Date(next);
                    checkDate.setDate(checkDate.getDate() + daysToAdd);
                    if (item.customDays.includes(checkDate.getDay())) {
                        next.setDate(next.getDate() + daysToAdd);
                        break;
                    }
                    daysToAdd++;
                }
            }
            
            const nextDateStr = getLocalISODate(next);
            
            const newItem = JSON.parse(JSON.stringify(item));
            newItem.id = 'sched_' + Date.now();
            newItem.date = nextDateStr;
            newItem.completed = false;
            newItem.alarmed = false;
            delete newItem.actualPublishTime;
            delete newItem.postLink;
            
            state.schedulerList.push(newItem);
        }
        
        document.getElementById('confirm-completion-modal').style.display = 'none';
        saveStateToServer('schedules');
        renderAll();
        showToast('Task Update', `Reminder marked as completed`);
    }
};

window.deleteReminder = function(id) {
    state.schedulerList = state.schedulerList.filter(i => i.id !== id);
    saveStateToServer('schedules');
    renderAll();
    showToast('Task Deleted', 'Reminder removed');
};

function populateMatchupDropdowns() {
    const ytSelect = document.getElementById('matchup-yt-video');
    if (!ytSelect) return;
    ytSelect.innerHTML = '<option value="">-- Choose from Synced Shorts --</option>';
    
    const ytChannels = state.trackedChannels.filter(c => c.platform === 'youtube');
    ytChannels.forEach(chan => {
        if (chan.videos) {
            chan.videos.forEach(v => {
                const opt = document.createElement('option');
                opt.value = `${chan.handle}/${v.videoId}`;
                opt.textContent = `[@${chan.handle}] ${v.title.slice(0, 35)}... (${v.views})`;
                ytSelect.appendChild(opt);
            });
        }
    });
}

function renderHeatmap() {
    const grid = document.getElementById('heatmap-squares');
    if (!grid) return;
    grid.innerHTML = '';
    
    const postTallies = {};
    state.trackedChannels.forEach(c => {
        c.videos.forEach(v => {
            if (v.publishedAt) {
                const dateStr = new Date(v.publishedAt).toDateString();
                postTallies[dateStr] = (postTallies[dateStr] || 0) + 1;
            }
        });
    });

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    
    // Align to the nearest Sunday
    const startDay = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDay);
    
    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Round up to complete the final week's column
    const totalSquares = Math.ceil(diffDays / 7) * 7;
    
    for (let i = 0; i < totalSquares; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        
        const count = postTallies[currentDate.toDateString()] || 0;
        let lvl = 'lvl-0';
        if (count === 1) lvl = 'lvl-1';
        if (count === 2) lvl = 'lvl-2';
        if (count >= 3) lvl = 'lvl-3';
        
        const square = document.createElement('div');
        square.className = `heatmap-square ${lvl}`;
        square.title = `${count} uploads on ${currentDate.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}`;
        
        const dateStr = currentDate.toDateString();
        square.style.cursor = 'pointer';
        square.onclick = () => openDailyActivityModal(dateStr);
        
        grid.appendChild(square);
    }
}

window.openDailyActivityModal = function(dateStr) {
    document.getElementById('daily-activity-date-title').textContent = new Date(dateStr).toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'});
    
    const targetDateStr = new Date(dateStr).toDateString();
    
    // Aggregation arrays
    const published = [];
    const scheduled = [];
    
    // 1. Scraped Live Posts
    if (state.trackedChannels) {
        state.trackedChannels.forEach(c => {
            if (c.videos) {
                c.videos.forEach(v => {
                    if (v.publishedAt && new Date(v.publishedAt).toDateString() === targetDateStr) {
                        published.push({
                            type: 'live',
                            title: v.title || 'Live Upload',
                            platform: c.platform,
                            handle: c.handle,
                            link: v.url,
                            time: new Date(v.publishedAt)
                        });
                    }
                });
            }
        });
    }
    
    // 2. Scheduled Posts
    if (state.schedulerList) {
        state.schedulerList.forEach(item => {
            const itemDateStr = new Date(item.actualPublishTime || (item.date + 'T00:00:00')).toDateString();
            
            if (itemDateStr === targetDateStr) {
                const accounts = item.targetAccounts || [];
                if (!item.targetAccounts) {
                    if (item.platformYt) accounts.push({platform: 'youtube', handle: 'unknown'});
                    if (item.platformIg) accounts.push({platform: 'instagram', handle: 'unknown'});
                }
                
                accounts.forEach(acc => {
                    const entry = {
                        id: item.id,
                        type: item.completed ? 'completed' : 'scheduled',
                        title: item.title || 'Scheduled Post',
                        platform: acc.platform,
                        handle: acc.handle,
                        link: item.postLink,
                        time: new Date(`${item.date}T${item.time || '12:00'}`)
                    };
                    if (item.completed) {
                        if (item.actualPublishTime) entry.time = new Date(item.actualPublishTime);
                        published.push(entry);
                    } else if (entry.time < new Date()) {
                        published.push(entry);
                    } else {
                        scheduled.push(entry);
                    }
                });
            }
        });
    }
    
    // Helper to generate HTML
    function generateHtml(list) {
        // Deduplicate list (merge live and completed tasks within 1 hour)
        const uniqueList = [];
        list.forEach(item => {
            const existingIndex = uniqueList.findIndex(u => 
                u.platform === item.platform && 
                u.handle.toLowerCase() === item.handle.toLowerCase() && 
                Math.abs(u.time.getTime() - item.time.getTime()) <= 3600000
            );
            
            if (existingIndex !== -1) {
                // Prefer live data over scheduled/completed
                if (item.type === 'live' && uniqueList[existingIndex].type !== 'live') {
                    uniqueList[existingIndex] = item;
                }
            } else {
                uniqueList.push(item);
            }
        });
        
        list = uniqueList;
        
        if (list.length === 0) {
            return `<div style="font-size: 13px; color: var(--text-muted); font-style: italic; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px;">No activity found for this day.</div>`;
        }
        
        list.sort((a,b) => a.time - b.time); // Chronological
        
        return list.map(item => {
            const platColor = item.platform === 'youtube' ? '#ff0000' : '#E1306C';
            const icon = item.platform === 'youtube' ? 'fa-youtube' : 'fa-instagram';
            const timeStr = item.time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const isMissed = item.type !== 'live' && !item.link && item.time < new Date();
            const missedBadge = isMissed ? `<span style="font-size: 11px; font-weight: 700; color: #f43f5e; background: rgba(244, 63, 94, 0.1); padding: 4px 8px; border-radius: 6px; margin-left: auto; text-transform: uppercase; letter-spacing: 0.5px;">Not yet posted</span>` : '';
            
            return `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid ${isMissed ? 'rgba(244, 63, 94, 0.3)' : 'rgba(255,255,255,0.05)'}; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; transition: 0.2s;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="font-size: 14px; font-weight: 600; color: #fff; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;">
                            ${escapeHTML(item.title)}
                            ${missedBadge}
                        </div>
                        <div style="font-size: 12px; color: ${isMissed ? '#f43f5e' : 'var(--text-muted)'}; white-space: nowrap; margin-left: 12px;"><i class="fa-regular fa-clock"></i> ${timeStr}</div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <i class="fa-brands ${icon}" style="color: ${platColor}; font-size: 16px;"></i>
                            <span style="font-size: 13px; color: var(--text-secondary);">@${item.handle}</span>
                        </div>
                        ${item.link ? `<a href="${item.link}" target="_blank" style="font-size: 12px; background: rgba(14,165,233,0.1); color: #38bdf8; text-decoration: none; padding: 4px 10px; border-radius: 20px; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-arrow-up-right-from-square"></i> View</a>` : (isMissed && item.id ? `<button onclick="document.getElementById('daily-activity-modal').style.display='none'; openUploadDetailsModal('${item.id}')" style="font-size: 12px; background: rgba(14,165,233,0.1); color: #38bdf8; border: 1px solid rgba(14,165,233,0.3); cursor: pointer; text-decoration: none; padding: 4px 10px; border-radius: 20px; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-check"></i> Mark Done</button>` : '')}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    document.getElementById('daily-activity-published-list').innerHTML = generateHtml(published);
    document.getElementById('daily-activity-scheduled-list').innerHTML = generateHtml(scheduled);
    
    document.getElementById('daily-activity-modal').style.display = 'flex';
};

// Generate dynamic filter buttons under the analytics panel for multiple handles
function renderPlatformFilters() {
    const container = document.getElementById('platform-filter-bar');
    if (!container) return;
    
    let html = `
        <button class="btn-tab-sm ${state.activeStatsFilter === 'all' ? 'active' : ''}" onclick="setStatsFilter('all')">All Accounts</button>
        
        <div style="width:1px; background:rgba(255,255,255,0.1); margin: 0 4px;"></div>
        
        <button class="btn-tab-sm ${state.activeStatsFilter === 'youtube' ? 'active' : ''}" onclick="setStatsFilter('youtube')"><i class="fa-brands fa-youtube" style="color:var(--color-yt);"></i> YouTube (All)</button>
    `;
    
    const ytChannels = state.trackedChannels.filter(c => c.platform === 'youtube');
    ytChannels.forEach(c => {
        const filterKey = escapeHTML(`youtube_${c.handle}`);
        const activeClass = state.activeStatsFilter === `youtube_${c.handle}` ? 'active' : '';
        html += `<button class="btn-tab-sm ${activeClass}" onclick="setStatsFilter('${filterKey.replace(/'/g, "\\'")}')"><i class="fa-brands fa-youtube" style="color:var(--color-yt);"></i> @${escapeHTML(c.handle)}</button>`;
    });

    html += `
        <div style="width:1px; background:rgba(255,255,255,0.1); margin: 0 4px;"></div>
        <button class="btn-tab-sm ${state.activeStatsFilter === 'instagram' ? 'active' : ''}" onclick="setStatsFilter('instagram')"><i class="fa-brands fa-instagram" style="color:var(--color-ig);"></i> Instagram (All)</button>
    `;

    const igChannels = state.trackedChannels.filter(c => c.platform === 'instagram');
    igChannels.forEach(c => {
        const filterKey = escapeHTML(`instagram_${c.handle}`);
        const activeClass = state.activeStatsFilter === `instagram_${c.handle}` ? 'active' : '';
        html += `<button class="btn-tab-sm ${activeClass}" onclick="setStatsFilter('${filterKey.replace(/'/g, "\\'")}')"><i class="fa-brands fa-instagram" style="color:var(--color-ig);"></i> @${escapeHTML(c.handle)}</button>`;
    });
    
    container.innerHTML = html;
}

window.setStatsFilter = function(filterValue) {
    state.activeStatsFilter = filterValue;
    renderPlatformFilters();
    renderTimelineFeed(); // will filter list and update it
    renderCharts();       // will segment graph details
};

// --- CHARTS SYSTEM (SEGMENTED BY LINKED HANDLE FILTERS) ---
function renderCharts() {
    const viewPerfCanvas = document.getElementById('viewPerformanceChart');
    const shareCanvas = document.getElementById('viewsShareChart');
    if (!viewPerfCanvas || !shareCanvas) return;
    
    if (typeof Chart === 'undefined') {
        viewPerfCanvas.parentElement.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-cloud-slash" style="font-size: 24px; margin-bottom: 8px;"></i><p style="font-size: 12px;">Failsafe Alert: Chart.js CDN is unreachable. Analytics graphics are disabled in offline mode.</p></div>';
        shareCanvas.parentElement.innerHTML = '';
        return;
    }
    
    try {
        let ytViewsSum = 0;
        let igViewsSum = 0;
        let totalClips = 0;
        let dailyData = {};
        
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dailyData[d.toDateString()] = { dateLabel: d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}), yt: 0, ig: 0 };
        }
        
        // Filter channels based on selected tab filter
        let filteredChannels = state.trackedChannels;
        if (state.activeStatsFilter === 'youtube') {
            filteredChannels = state.trackedChannels.filter(c => c.platform === 'youtube');
        } else if (state.activeStatsFilter === 'instagram') {
            filteredChannels = state.trackedChannels.filter(c => c.platform === 'instagram');
        } else if (state.activeStatsFilter.includes('_')) {
            const parts = state.activeStatsFilter.split('_');
            const plat = parts[0];
            const hand = parts.slice(1).join('_');
            filteredChannels = state.trackedChannels.filter(c => c.platform === plat && c.handle.toLowerCase() === hand.toLowerCase());
        }

        filteredChannels.forEach(c => {
            totalClips += c.videos.length;
            c.videos.forEach(v => {
                const views = parseViewsText(v.views);
                if (c.platform === 'youtube') ytViewsSum += views;
                if (c.platform === 'instagram') igViewsSum += views;
                
                if (v.publishedAt) {
                    const dateKey = new Date(v.publishedAt).toDateString();
                    if (dailyData[dateKey]) {
                        if (c.platform === 'youtube') dailyData[dateKey].yt += views;
                        if (c.platform === 'instagram') dailyData[dateKey].ig += views;
                    }
                }
            });
        });

        // Update KPIs
        const totalViews = ytViewsSum + igViewsSum;
        const avgViews = totalClips > 0 ? Math.round(totalViews / totalClips) : 0;
        
        const kTotalViews = document.getElementById('kpi-total-views');
        if (kTotalViews) {
            kTotalViews.innerText = totalViews.toLocaleString();
            document.getElementById('kpi-total-clips').innerText = totalClips.toLocaleString();
            document.getElementById('kpi-avg-views').innerText = avgViews.toLocaleString();
            
            let topPlatform = 'N/A';
            if (ytViewsSum > igViewsSum) topPlatform = 'YouTube';
            else if (igViewsSum > ytViewsSum) topPlatform = 'Instagram';
            else if (ytViewsSum > 0) topPlatform = 'Tied';
            document.getElementById('kpi-top-platform').innerText = topPlatform;
        }

        // Matchup view progression for chart plotting from histories
        const historyKeys = Object.keys(state.history || {});
        let historyLabels = Object.keys(dailyData).map(d => dailyData[d].dateLabel);
        let ytSeries = Object.values(dailyData).map(d => d.yt);
        let igSeries = Object.values(dailyData).map(d => d.ig);
        let usingHistoricalData = false;
        
        // Filter history keys based on filter
        let filteredHistoryKeys = historyKeys;
        if (state.activeStatsFilter === 'youtube') {
            filteredHistoryKeys = historyKeys.filter(k => k.startsWith('youtube_'));
        } else if (state.activeStatsFilter === 'instagram') {
            filteredHistoryKeys = historyKeys.filter(k => k.startsWith('instagram_'));
        } else if (state.activeStatsFilter.includes('_')) {
            filteredHistoryKeys = historyKeys.filter(k => k.startsWith(state.activeStatsFilter + '_') || k === state.activeStatsFilter);
        }

        if (filteredHistoryKeys.length > 0) {
            const aggregateHistory = {};
            filteredHistoryKeys.forEach(key => {
                const platform = key.startsWith('youtube_') ? 'yt' : 'ig';
                const snapshots = state.history[key] || [];
                
                snapshots.forEach(snap => {
                    if (!aggregateHistory[snap.date]) {
                        aggregateHistory[snap.date] = { yt: 0, ig: 0 };
                    }
                    aggregateHistory[snap.date][platform] += snap.views;
                });
            });
            
            const sortedDates = Object.keys(aggregateHistory).sort();
            if (sortedDates.length > 1) {
                historyLabels = sortedDates.map(d => {
                    const dateObj = new Date(d + 'T00:00:00');
                    return dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                });
                ytSeries = sortedDates.map(d => aggregateHistory[d].yt);
                igSeries = sortedDates.map(d => aggregateHistory[d].ig);
                usingHistoricalData = true;
            }
        }

        if (viewPerformanceChartInstance) {
            viewPerformanceChartInstance.destroy();
        }
    
    // Create gradients for Line Chart
    const ctxPerf = viewPerfCanvas.getContext('2d');
    const gradientYT = ctxPerf.createLinearGradient(0, 0, 0, 400);
    gradientYT.addColorStop(0, 'rgba(16, 185, 129, 0.6)');
    gradientYT.addColorStop(1, 'rgba(16, 185, 129, 0.05)');

    const gradientIG = ctxPerf.createLinearGradient(0, 0, 0, 400);
    gradientIG.addColorStop(0, 'rgba(139, 92, 246, 0.6)');
    gradientIG.addColorStop(1, 'rgba(139, 92, 246, 0.05)');

    const datasets = [];
    if (state.activeStatsFilter === 'all' || state.activeStatsFilter === 'youtube' || state.activeStatsFilter.startsWith('youtube_')) {
        datasets.push({
            label: 'YouTube Shorts',
            data: ytSeries,
            backgroundColor: gradientYT,
            borderColor: '#10b981',
            borderWidth: 3,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#10b981',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.4,
            fill: true,
            borderRadius: usingHistoricalData ? 0 : 8
        });
    }
    if (state.activeStatsFilter === 'all' || state.activeStatsFilter === 'instagram' || state.activeStatsFilter.startsWith('instagram_')) {
        datasets.push({
            label: 'Instagram Reels',
            data: igSeries,
            backgroundColor: gradientIG,
            borderColor: '#8b5cf6',
            borderWidth: 3,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#8b5cf6',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.4,
            fill: true,
            borderRadius: usingHistoricalData ? 0 : 8
        });
    }

    viewPerformanceChartInstance = new Chart(ctxPerf, {
        type: usingHistoricalData ? 'line' : 'bar',
        data: {
            labels: historyLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    labels: { color: '#e5e7eb', font: { family: 'Inter', weight: 500 }, usePointStyle: true, pointStyle: 'circle', padding: 20 }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#e5e7eb',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 16,
                    displayColors: true,
                    boxPadding: 6,
                    cornerRadius: 12
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { color: '#9ca3af', font: { family: 'Inter' } }
                },
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#9ca3af', font: { family: 'Inter' } }
                }
            }
        }
    });

    // 2. Share of views Chart
    if (viewsShareChartInstance) {
        viewsShareChartInstance.destroy();
    }

    const isChartEmpty = ytViewsSum === 0 && igViewsSum === 0;
    const chartYtSum = ytViewsSum || 0;
    const chartIgSum = igViewsSum || 0;

    viewsShareChartInstance = new Chart(shareCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: isChartEmpty ? ['No Data'] : ['YouTube Shorts', 'Instagram Reels'],
            datasets: [{
                data: isChartEmpty ? [1] : [chartYtSum, chartIgSum],
                backgroundColor: isChartEmpty ? ['#333'] : ['#10b981', '#8b5cf6'],
                borderWidth: 6,
                borderColor: '#111827',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '80%',
            animation: {
                animateScale: true,
                animateRotate: true,
                duration: 1200,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#e5e7eb', font: { family: 'Inter', weight: 500 }, usePointStyle: true, padding: 20 }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    padding: 16,
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    cornerRadius: 12
                }
            }
        }
    });

    // 3. Recent Clips Performance Chart
    const recentCanvas = document.getElementById('recentPerformanceChart');
    if (recentCanvas) {
        if (recentPerformanceChartInstance) {
            recentPerformanceChartInstance.destroy();
        }
        
        let allVideos = [];
        filteredChannels.forEach(c => {
            c.videos.forEach(v => {
                allVideos.push({
                    title: v.title,
                    views: parseViewsText(v.views),
                    date: getClipPublishDate(v),
                    platform: c.platform
                });
            });
        });
        
        allVideos.sort((a, b) => b.date - a.date);
        const top10 = allVideos.slice(0, 10).reverse(); // Oldest to newest left to right
        
        const recentLabels = top10.map(v => v.title.length > 20 ? v.title.substring(0, 20) + '...' : v.title);
        const recentData = top10.map(v => v.views);
        const recentColors = top10.map(v => v.platform === 'youtube' ? '#10b981' : '#8b5cf6');
        
        recentPerformanceChartInstance = new Chart(recentCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: recentLabels,
                datasets: [{
                    label: 'Views',
                    data: recentData,
                    backgroundColor: recentColors,
                    borderRadius: 6,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart',
                    delay: (context) => context.dataIndex * 50
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#e5e7eb',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 16,
                        cornerRadius: 12
                    }
                },
                scales: {
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        ticks: { color: '#9ca3af', font: { family: 'Inter' } }
                    },
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: '#9ca3af', font: { family: 'Inter' }, maxRotation: 45, minRotation: 45 }
                    }
                }
            }
        });
    }
} catch (chartErr) {
        console.error("Failsafe error loading charts:", chartErr);
    }
}

// --- BACKGROUND CHECKING SCRIPT (Alarms) ---
function backgroundChecks() {
    const now = new Date();
    let hasAlerted = false;

    const spinner = document.getElementById('sync-spinner');
    if (!spinner || !spinner.classList.contains('spinning')) {
        updateSyncTimestamp(false);
    }
    
    autoCompleteScheduledTasks();

    state.schedulerList.forEach(item => {
        if (item.completed || item.alarmed) return;
        
        const itemTime = new Date(`${item.date}T${item.time}`);
        if (now >= itemTime) {
            item.alarmed = true;
            hasAlerted = true;
            showToast('Reminder Due!', `It is time to post: ${item.title}`, 'danger');
        }
    });

    if (hasAlerted) {
        saveStateToServer('schedules');
        renderAll();
    }
}

// --- FORMATTING HELPERS ---
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function formatViews(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
}

function formatFriendlyDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) {
        return `${diffMins}m ago`;
    }
    if (diffHrs < 24) {
        return `${diffHrs}h ago`;
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
        return 'Yesterday';
    }
    
    return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

function formatDetailedDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatTimeLabel(dateObj) {
    return dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + ' ' + dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// --- DEMO SANDBOX MULTIPLE ACCOUNTS PRESETS ---
async function loadDemoSandboxData() {
    const demoChannels = [
        {
            platform: 'youtube',
            handle: 'KaiCenatClips',
            authorName: 'Kai Cenat Shorts',
            avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=60',
            subscriberCount: '1.25M subscribers',
            lastSyncTime: new Date().toISOString(),
            videos: [
                {
                    videoId: 'demo_yt1',
                    title: 'Speed challenges Kai Cenat to a 100m sprint!',
                    publishedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
                    views: '124,500 views',
                    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=60',
                    url: 'https://youtube.com'
                },
                {
                    videoId: 'demo_yt2',
                    title: 'Kai reacts to hitting 100k subs live on stream',
                    publishedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
                    views: '450,200 views',
                    thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=200&auto=format&fit=crop&q=60',
                    url: 'https://youtube.com'
                }
            ]
        },
        {
            platform: 'youtube',
            handle: 'RoganHighlights',
            authorName: 'Joe Rogan Shorts Cuts',
            avatar: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=100&auto=format&fit=crop&q=60',
            subscriberCount: '850K subscribers',
            lastSyncTime: new Date().toISOString(),
            videos: [
                {
                    videoId: 'demo_rogan1',
                    title: 'Joe Rogan discusses alien life with theoretical physicist',
                    publishedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
                    views: '98,200 views',
                    thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&auto=format&fit=crop&q=60',
                    url: 'https://youtube.com'
                },
                {
                    videoId: 'demo_rogan2',
                    title: 'The mind-bending capability of quantum computers',
                    publishedAt: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
                    views: '320,400 views',
                    thumbnail: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=200&auto=format&fit=crop&q=60',
                    url: 'https://youtube.com'
                }
            ]
        },
        {
            platform: 'instagram',
            handle: 'kai_shorts_daily',
            authorName: 'Kai Cenat Reel Cuts',
            avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=60',
            subscriberCount: '480K followers',
            lastSyncTime: new Date().toISOString(),
            videos: [
                {
                    videoId: 'demo_ig1',
                    title: 'Speed challenges Kai Cenat to a 100m sprint!',
                    publishedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
                    views: '235,900 views',
                    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=60',
                    url: 'https://instagram.com'
                },
                {
                    videoId: 'demo_ig2',
                    title: 'Kai reacts to hitting 100k subs live on stream',
                    publishedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
                    views: '540,800 views',
                    thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=200&auto=format&fit=crop&q=60',
                    url: 'https://instagram.com'
                }
            ]
        },
        {
            platform: 'instagram',
            handle: 'rogan_shorts_feed',
            authorName: 'Rogan Clips Daily',
            avatar: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=100&auto=format&fit=crop&q=60',
            subscriberCount: '320K followers',
            lastSyncTime: new Date().toISOString(),
            videos: [
                {
                    videoId: 'demo_rogan_ig1',
                    title: 'Joe Rogan discusses alien life with theoretical physicist',
                    publishedAt: new Date(Date.now() - 11 * 3600 * 1000).toISOString(),
                    views: '110,400 views',
                    thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&auto=format&fit=crop&q=60',
                    url: 'https://instagram.com'
                }
            ]
        }
    ];

    const demoSchedules = [
        {
            id: 'demo_s1',
            title: 'Upload Rogan quantum computing debate clip',
            date: getLocalISODate(new Date(Date.now() + 2 * 3600 * 1000)),
            time: new Date(Date.now() + 2 * 3600 * 1000).toTimeString().split(' ')[0].slice(0, 5),
            notes: 'Check RoganHighlights channel playlist for sound elements.',
            platformYt: true,
            platformIg: true,
            completed: false,
            alarmed: false
        }
    ];

    const today = new Date();
    today.setHours(0,0,0,0);
    const d0 = getLocalISODate(today);
    const d1 = getLocalISODate(new Date(today - 1*24*3600*1000));
    const d2 = getLocalISODate(new Date(today - 2*24*3600*1000));
    
    const demoHistory = {
        "youtube_KaiCenatClips_demo_yt1": [
            { date: d2, views: 56000 },
            { date: d1, views: 98000 },
            { date: d0, views: 124500 }
        ],
        "youtube_RoganHighlights_demo_rogan1": [
            { date: d2, views: 42000 },
            { date: d1, views: 80000 },
            { date: d0, views: 98200 }
        ],
        "instagram_kai_shorts_daily_demo_ig1": [
            { date: d2, views: 112000 },
            { date: d1, views: 187000 },
            { date: d0, views: 235900 }
        ],
        "instagram_rogan_shorts_feed_demo_rogan_ig1": [
            { date: d2, views: 30000 },
            { date: d1, views: 78000 },
            { date: d0, views: 110400 }
        ]
    };

    state.trackedChannels = demoChannels;
    state.schedulerList = demoSchedules;
    state.history = demoHistory;
    state.activeStatsFilter = 'all';

    try {
        await saveStateToServer('channels');
        await saveStateToServer('schedules');
        await fetch('/api/db/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: demoHistory })
        });
        
        await loadStateFromServer();
    } catch (e) {
        console.error("Demo load failed", e);
    }
    
    renderAll();
    showToast('Sandbox Active', 'Loaded multi-channel statistics database presets');
}
