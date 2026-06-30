// ==================== GLOBAL HOLAT ====================
const state = {
    currentUser: null,
    isAdmin: false,
    ws: null,
    messages: [],
    onlineUsers: [],
    username: '',
    token: null
};

// ==================== DOM REFERENSLAR ====================
const DOM = {
    loginPage: document.getElementById('loginPage'),
    chatPage: document.getElementById('chatPage'),
    
    // Login
    adminLoginForm: document.getElementById('adminLoginForm'),
    userLoginForm: document.getElementById('userLoginForm'),
    adminPassword: document.getElementById('adminPassword'),
    userUsername: document.getElementById('userUsername'),
    faceImage: document.getElementById('faceImage'),
    facePreview: document.getElementById('facePreview'),
    adminError: document.getElementById('adminError'),
    userError: document.getElementById('userError'),
    
    // Chat
    messagesContainer: document.getElementById('messagesContainer'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    attachBtn: document.getElementById('attachBtn'),
    mediaInput: document.getElementById('mediaInput'),
    logoutBtn: document.getElementById('logoutBtn'),
    
    // User Info
    currentUserAvatar: document.getElementById('currentUserAvatar'),
    currentUserName: document.getElementById('currentUserName'),
    currentUserRole: document.getElementById('currentUserRole'),
    
    // Online Users
    onlineUsersList: document.getElementById('onlineUsersList'),
    onlineCount: document.getElementById('onlineCount'),
    
    // Admin
    adminPanel: document.getElementById('adminPanel'),
    registerFaceForm: document.getElementById('registerFaceForm'),
    newUsername: document.getElementById('newUsername'),
    newFaceImage: document.getElementById('newFaceImage'),
    totalUsers: document.getElementById('totalUsers'),
    totalMessages: document.getElementById('totalMessages'),
    
    // Tabs
    loginTabs: document.querySelectorAll('.login-tab'),
    loginForms: document.querySelectorAll('.login-form')
};

// ==================== UTILITY FUNKSIYALAR ====================
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== LOGIN LOGIKA ====================

// Tab switcher
DOM.loginTabs.forEach(tab => {
    tab.addEventListener('click', function() {
        DOM.loginTabs.forEach(t => t.classList.remove('active'));
        DOM.loginForms.forEach(f => f.classList.remove('active'));
        
        this.classList.add('active');
        const tabName = this.dataset.tab;
        document.getElementById(`${tabName}LoginForm`).classList.add('active');
    });
});

// Face image preview
DOM.faceImage.addEventListener('change', function(e) {
    if (this.files && this.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            DOM.facePreview.style.display = 'block';
            DOM.facePreview.innerHTML = `<img src="${e.target.result}" alt="Face preview">`;
        };
        reader.readAsDataURL(this.files[0]);
    }
});

// Admin Login
DOM.adminLoginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    DOM.adminError.style.display = 'none';
    
    const password = DOM.adminPassword.value;
    if (!password) {
        DOM.adminError.textContent = 'Iltimos, parolni kiriting!';
        DOM.adminError.style.display = 'block';
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('username', 'admin');
        formData.append('password', password);
        
        const response = await fetch('/api/login', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            state.currentUser = data;
            state.isAdmin = true;
            state.username = 'admin';
            initializeChat(data);
        } else {
            DOM.adminError.textContent = data.message || 'Xatolik yuz berdi!';
            DOM.adminError.style.display = 'block';
        }
    } catch (error) {
        DOM.adminError.textContent = 'Server bilan aloqa o\'rnatishda xatolik!';
        DOM.adminError.style.display = 'block';
    }
});

// User Login (Face Recognition)
DOM.userLoginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    DOM.userError.style.display = 'none';
    
    const username = DOM.userUsername.value.trim();
    const faceFile = DOM.faceImage.files[0];
    
    if (!username) {
        DOM.userError.textContent = 'Iltimos, ismingizni kiriting!';
        DOM.userError.style.display = 'block';
        return;
    }
    
    if (!faceFile) {
        DOM.userError.textContent = 'Iltimos, yuz rasmingizni yuklang!';
        DOM.userError.style.display = 'block';
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('face_image', faceFile);
        
        const response = await fetch('/api/login', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            state.currentUser = data;
            state.isAdmin = false;
            state.username = username;
            initializeChat(data);
        } else {
            DOM.userError.textContent = data.message || 'Yuz tasdiqlanmadi!';
            DOM.userError.style.display = 'block';
        }
    } catch (error) {
        DOM.userError.textContent = 'Server bilan aloqa o\'rnatishda xatolik!';
        DOM.userError.style.display = 'block';
    }
});

// ==================== CHAT FUNKSIYALARI ====================

async function initializeChat(userData) {
    // Sahifalarni almashtirish
    DOM.loginPage.style.display = 'none';
    DOM.chatPage.style.display = 'flex';
    
    // User ma'lumotlarini ko'rsatish
    DOM.currentUserAvatar.src = userData.avatar || '/assets/icons/user_default.png';
    DOM.currentUserName.textContent = userData.username;
    DOM.currentUserRole.textContent = userData.role === 'admin' ? '👑 Admin' : '👤 Foydalanuvchi';
    
    // Admin panel
    if (userData.role === 'admin') {
        DOM.adminPanel.style.display = 'block';
        updateAdminStats();
    }
    
    // WebSocket ulanish
    connectWebSocket(userData.username);
    
    // Xabarlarni yuklash
    await loadMessages();
    
    // Event listenerlar
    setupEventListeners();
}

function connectWebSocket(username) {
    // Render xavfsiz tarmog'i uchun dinamik ravishda wss:// yoki ws:// manzilini aniqlaymiz
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${username}`;
    state.ws = new WebSocket(wsUrl);
    
    state.ws.onopen = function() {
        console.log('WebSocket connected');
        // Onlayn foydalanuvchilarni so'rash
        fetchOnlineUsers();
    };
    
    state.ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    state.ws.onclose = function() {
        console.log('WebSocket disconnected');
        // 3 sekunddan keyin qayta ulanish
        setTimeout(() => connectWebSocket(username), 3000);
    };
    
    state.ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'new_message':
            addMessageToUI(data.message);
            break;
            
        case 'update_views':
            updateMessageViews(data.msg_id, data.view_count, data.views);
            break;
            
        case 'user_status':
            updateUserStatus(data.username, data.status);
            break;
            
        case 'user_online':
            fetchOnlineUsers();
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

function addMessageToUI(message) {
    const isOwn = message.sender === state.username;
    
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
    messageWrapper.dataset.msgId = message.id;
    
    // Sender
    const senderEl = document.createElement('div');
    senderEl.className = 'message-sender';
    senderEl.textContent = isOwn ? 'Siz' : message.sender;
    
    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    // Content
    if (message.type === 'text') {
        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        textEl.textContent = message.content;
        bubble.appendChild(textEl);
    } else if (message.type === 'image' || message.type === 'video') {
        const mediaEl = document.createElement(message.type === 'image' ? 'img' : 'video');
        mediaEl.className = 'message-media';
        mediaEl.src = message.media;
        if (message.type === 'video') {
            mediaEl.controls = true;
        }
        bubble.appendChild(mediaEl);
        
        if (message.content) {
            const textEl = document.createElement('div');
            textEl.className = 'message-text';
            textEl.textContent = message.content;
            bubble.appendChild(textEl);
        }
    }
    
    // Time and views
    const footer = document.createElement('div');
    footer.className = 'message-time';
    
    const timeEl = document.createElement('span');
    timeEl.textContent = formatTime(message.timestamp);
    footer.appendChild(timeEl);
    
    const viewsEl = document.createElement('span');
    viewsEl.className = 'message-views';
    viewsEl.innerHTML = `
        <img src="/assets/icons/view_eye.png" alt="Views">
        <span>${message.view_count || 0}</span>
    `;
    footer.appendChild(viewsEl);
    
    bubble.appendChild(footer);
    messageWrapper.appendChild(senderEl);
    messageWrapper.appendChild(bubble);
    
    DOM.messagesContainer.appendChild(messageWrapper);
    scrollToBottom();
    
    // Xabarni ko'rganlik uchun signal
    if (!isOwn) {
        markMessageAsViewed(message.id);
    }
}

function updateMessageViews(msgId, viewCount, views) {
    const messages = DOM.messagesContainer.querySelectorAll('.message-wrapper');
    for (const msgEl of messages) {
        if (msgEl.dataset.msgId === msgId) {
            const viewsEl = msgEl.querySelector('.message-views span');
            if (viewsEl) {
                viewsEl.textContent = viewCount;
            }
            break;
        }
    }
}

function markMessageAsViewed(msgId) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: 'view_action',
            msg_id: msgId
        }));
    }
}

function updateUserStatus(username, status) {
    const userItems = DOM.onlineUsersList.querySelectorAll('.user-item');
    for (const item of userItems) {
        if (item.dataset.username === username) {
            const dot = item.querySelector('.status-dot');
            if (dot) {
                dot.className = `status-dot ${status}`;
            }
            break;
        }
    }
    fetchOnlineUsers();
}

async function loadMessages() {
    try {
        const response = await fetch('/api/messages');
        const data = await response.json();
        
        if (data.messages) {
            DOM.messagesContainer.innerHTML = '';
            data.messages.forEach(msg => addMessageToUI(msg));
            scrollToBottom();
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

async function fetchOnlineUsers() {
    try {
        const response = await fetch('/api/users/online');
        const data = await response.json();
        
        DOM.onlineUsersList.innerHTML = '';
        DOM.onlineCount.textContent = data.online_users.length;
        
        data.online_users.forEach(username => {
            const item = document.createElement('div');
            item.className = 'user-item';
            item.dataset.username = username;
            
            const avatar = document.createElement('img');
            avatar.className = 'avatar-small';
            avatar.src = username === 'admin' ? '/assets/icons/admin_lock.png' : '/assets/icons/user_default.png';
            avatar.alt = username;
            
            const name = document.createElement('span');
            name.className = 'username';
            name.textContent = username;
            
            const dot = document.createElement('span');
            dot.className = 'status-dot online';
            
            item.appendChild(avatar);
            item.appendChild(name);
            item.appendChild(dot);
            DOM.onlineUsersList.appendChild(item);
        });
    } catch (error) {
        console.error('Error fetching online users:', error);
    }
}

async function updateAdminStats() {
    try {
        // Foydalanuvchilar soni
        const usersResponse = await fetch('/api/users/online');
        const usersData = await usersResponse.json();
        DOM.totalUsers.textContent = usersData.online_users.length + 1; // + admin
        
        // Xabarlar soni
        const messagesResponse = await fetch('/api/messages');
        const messagesData = await messagesResponse.json();
        DOM.totalMessages.textContent = messagesData.messages.length;
    } catch (error) {
        console.error('Error updating admin stats:', error);
    }
}

function scrollToBottom() {
    DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
}

// ==================== EVENT LISTENERLAR ====================

function setupEventListeners() {
    // Xabar yuborish
    DOM.sendBtn.addEventListener('click', sendMessage);
    DOM.messageInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Auto-resize textarea
    DOM.messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    
    // Media yuklash
    DOM.attachBtn.addEventListener('click', function() {
        DOM.mediaInput.click();
    });
    
    DOM.mediaInput.addEventListener('change', function(e) {
        if (this.files && this.files[0]) {
            handleMediaUpload(this.files[0]);
        }
    });
    
    // Chiqish
    DOM.logoutBtn.addEventListener('click', function() {
        if (confirm('Haqiqatan ham chiqmoqchimisiz?')) {
            if (state.ws) {
                state.ws.close();
            }
            location.reload();
        }
    });
    
    // Admin - Foydalanuvchi ro'yxatdan o'tkazish
    if (DOM.registerFaceForm) {
        DOM.registerFaceForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = DOM.newUsername.value.trim();
            const faceFile = DOM.newFaceImage.files[0];
            
            if (!username || !faceFile) {
                alert('Iltimos, barcha maydonlarni to\'ldiring!');
                return;
            }
            
            try {
                const formData = new FormData();
                formData.append('username', username);
                formData.append('face_image', faceFile);
                
                const response = await fetch('/api/admin/register-face', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                if (data.success) {
                    alert(`✅ ${username} muvaffaqiyatli ro'yxatdan o'tkazildi!`);
                    DOM.newUsername.value = '';
                    DOM.newFaceImage.value = '';
                    updateAdminStats();
                } else {
                    alert('Xatolik: ' + data.message);
                }
            } catch (error) {
                alert('Server xatosi!');
            }
        });
    }
}

function sendMessage() {
    const content = DOM.messageInput.value.trim();
    if (!content && !state.mediaPreview) return;
    
    // Check WebSocket connection
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        alert('Server bilan aloqa uzilgan! Qayta ulanish...');
        connectWebSocket(state.username);
        return;
    }
    
    const messageData = {
        type: 'chat_message',
        content: content
    };
    
    // Media borligini tekshirish
    if (state.mediaPreview) {
        messageData.type = 'media_message';
        messageData.media_type = state.mediaType || 'image';
        messageData.media_data = state.mediaData;
    }
    
    state.ws.send(JSON.stringify(messageData));
    
    // Inputni tozalash
    DOM.messageInput.value = '';
    DOM.messageInput.style.height = 'auto';
    
    // Media previewni tozalash
    clearMediaPreview();
}

// ==================== MEDIA FUNKSIYALARI ====================

state.mediaPreview = null;
state.mediaData = null;
state.mediaType = null;

function handleMediaUpload(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Data = e.target.result;
        state.mediaData = base64Data;
        state.mediaType = file.type.startsWith('video') ? 'video' : 'image';
        
        // Preview
        const previewEl = document.createElement('div');
        previewEl.className = 'media-preview';
        
        const mediaEl = document.createElement(state.mediaType === 'image' ? 'img' : 'video');
        mediaEl.src = base64Data;
        if (state.mediaType === 'video') {
            mediaEl.controls = true;
            mediaEl.style.maxWidth = '200px';
        }
        mediaEl.style.maxWidth = '200px';
        mediaEl.style.borderRadius = '8px';
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-media';
        removeBtn.textContent = '✕';
        removeBtn.onclick = clearMediaPreview;
        
        previewEl.appendChild(mediaEl);
        previewEl.appendChild(removeBtn);
        
        // Input yoniga qo'shish
        const inputWrapper = document.querySelector('.input-wrapper');
        inputWrapper.insertBefore(previewEl, DOM.messageInput);
        
        state.mediaPreview = previewEl;
    };
    reader.readAsDataURL(file);
}

function clearMediaPreview() {
    if (state.mediaPreview) {
        state.mediaPreview.remove();
        state.mediaPreview = null;
        state.mediaData = null;
        state.mediaType = null;
    }
    DOM.mediaInput.value = '';
}

// ==================== INITIALIZATION ====================

console.log('🚀 Corporate Chat System initialized');
console.log('📋 Professional Dark-Mode UI loaded');
console.log('🔒 Security: Admin & Face Recognition enabled');