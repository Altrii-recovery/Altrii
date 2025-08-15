// Altrii Recovery Frontend Application - Enhanced with Supervision & Accountability
class AltriiApp {
    constructor() {
        // Use sessionStorage instead of localStorage for compatibility
        this.token = sessionStorage.getItem('authToken') || this.getCookieValue('authToken');
        this.user = null;
        this.currentSection = 'dashboard';
        this.baseUrl = window.location.origin;
        this.supervisionEnabled = false;
        this.init();
    }

    init() {
        console.log('🚀 Altrii Recovery App Starting...');
        
        // Check if user is logged in
        if (this.token) {
            this.loadUserData();
            this.showMainDashboard();
        } else {
            this.showLogin();
        }
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Start timer update interval
        this.startTimerUpdates();
    }

    setupEventListeners() {
        console.log('🔧 Setting up event listeners...');
        
        // Navigation buttons
        document.querySelectorAll('.nav-link').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const section = button.getAttribute('data-section');
                console.log('Nav clicked:', section);
                
                // Handle external pages for supervision and accountability
                if (section === 'supervision') {
                    window.location.href = '/supervision';
                    return;
                }
                if (section === 'accountability') {
                    window.location.href = '/accountability';
                    return;
                }
                
                this.showSection(section);
            });
        });

        // User menu button
        const userMenuButton = document.getElementById('user-menu-button');
        if (userMenuButton) {
            userMenuButton.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('User menu clicked');
                this.toggleUserMenu();
            });
        }

        // Logout button
        const logoutButton = document.getElementById('logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Logout clicked');
                this.logout();
            });
        }

        // Dashboard quick action buttons
        const startTimerBtn = document.getElementById('start-timer-btn');
        if (startTimerBtn) {
            startTimerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Start timer clicked');
                this.createQuickTimer();
            });
        }

        const downloadProfileBtn = document.getElementById('download-profile-btn');
        if (downloadProfileBtn) {
            downloadProfileBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Download profile clicked');
                this.downloadProfile();
            });
        }

        // Add device button (in devices section)
        const addDeviceBtn = document.getElementById('add-device-btn');
        if (addDeviceBtn) {
            addDeviceBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Add device clicked');
                this.showAddDeviceModal();
            });
        }

        // Cancel add device button
        const cancelAddDeviceBtn = document.getElementById('cancel-add-device-btn');
        if (cancelAddDeviceBtn) {
            cancelAddDeviceBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Cancel add device clicked');
                this.closeAddDeviceModal();
            });
        }

        // Login form
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }

        // Add device form
        const addDeviceForm = document.getElementById('add-device-form');
        if (addDeviceForm) {
            addDeviceForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addDevice();
            });
        }

        // Blocking settings form
        const blockingForm = document.getElementById('blocking-form');
        if (blockingForm) {
            blockingForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveBlockingSettings();
            });
        }

        // Timer form
        const timerForm = document.getElementById('timer-form');
        if (timerForm) {
            timerForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createTimer();
            });
        }
        
        // Close modal on outside click
        document.addEventListener('click', (e) => {
            if (e.target.id === 'add-device-modal') {
                this.closeAddDeviceModal();
            }
        });
        
        console.log('✅ Event listeners setup complete');
    }

    // Enhanced API Helper Method with better error handling
    async apiCall(endpoint, options = {}) {
        console.log('🔍 API Call:', {
            endpoint: endpoint,
            method: options.method || 'GET',
            hasToken: !!this.token
        });

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(this.token && { 'Authorization': `Bearer ${this.token}` })
            },
            ...options
        };

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, config);
            
            console.log('📡 API Response:', {
                endpoint: endpoint,
                status: response.status,
                ok: response.ok
            });
            
            // Handle different response types
            let data;
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = { message: await response.text() };
            }
            
            if (response.status === 401) {
                console.warn('🔐 Authentication failed, logging out...');
                this.logout();
                throw new Error('Authentication required');
            }
            
            if (!response.ok) {
                const errorMessage = data?.message || data?.error || `HTTP ${response.status}`;
                console.error('❌ API Error:', errorMessage);
                throw new Error(errorMessage);
            }
            
            console.log('✅ API Success:', endpoint);
            return data;
            
        } catch (error) {
            console.error('❌ API Call Failed:', {
                endpoint,
                error: error.message,
                stack: error.stack
            });
            
            // Re-throw with context
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Network error. Please check your connection.');
            }
            
            throw error;
        }
    }

    // Authentication Methods
    async login() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        this.showLoading('login');
        
        try {
            const response = await fetch(`${this.baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.token = data.token;
                this.user = data.user;
                this.setAuthToken(this.token);
                
                // Update user email immediately
                const userEmailElement = document.getElementById('user-email');
                if (userEmailElement) {
                    userEmailElement.textContent = data.user?.email || email;
                }
                
                this.showMainDashboard();
                this.loadDashboardData();
                this.checkSupervisionFeatures(); // Check supervision on login
                this.showSuccess('Welcome back!');
            } else {
                this.showError('login-error', data.message || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showError('login-error', 'Network error. Please try again.');
        } finally {
            this.hideLoading('login');
        }
    }

    logout() {
        this.token = null;
        this.user = null;
        this.clearAuthToken();
        
        this.showLogin();
        this.showSuccess('Logged out successfully');
    }

    async loadUserData() {
        try {
            if (this.token && !this.user) {
                // Update UI with stored token info
                const userEmailElement = document.getElementById('user-email');
                if (userEmailElement && userEmailElement.textContent === 'Loading...') {
                    userEmailElement.textContent = 'User';
                }
                
                // Check supervision features
                await this.checkSupervisionFeatures();
            }
        } catch (error) {
            console.error('Failed to load user data:', error);
            this.logout();
        }
    }

    // NEW: Check supervision features availability
    async checkSupervisionFeatures() {
        try {
            const response = await this.apiCall('/api/subscriptions/features');
            
            if (response.supervision && response.supervision.enabled) {
                this.supervisionEnabled = true;
                
                // Show supervision menu items
                document.querySelectorAll('[data-section="supervision"], [data-section="accountability"]').forEach(el => {
                    el.classList.remove('hidden');
                });
                
                // Show supervision cards on dashboard
                const supervisionCards = document.getElementById('supervision-cards');
                if (supervisionCards) {
                    supervisionCards.style.display = 'grid';
                }
                
                // Load supervision status
                this.loadSupervisionStatus();
                this.loadAccountabilityStatus();
                
                console.log('✅ Supervision features enabled');
            } else {
                // Hide supervision features for free users
                document.querySelectorAll('[data-section="supervision"], [data-section="accountability"]').forEach(el => {
                    el.classList.add('hidden');
                });
                
                const supervisionCards = document.getElementById('supervision-cards');
                if (supervisionCards) {
                    supervisionCards.style.display = 'none';
                }
                
                console.log('ℹ️ Supervision features not available for this user');
            }
        } catch (error) {
            console.error('Failed to check supervision features:', error);
        }
    }

    // NEW: Load supervision status for dashboard
    async loadSupervisionStatus() {
        try {
            const response = await this.apiCall('/api/supervision/status');
            const statusDiv = document.getElementById('supervision-status');
            
            if (!statusDiv) return;
            
            const supervisedDevices = response.devices.filter(d => d.supervision_level > 0);
            
            if (supervisedDevices.length > 0) {
                statusDiv.innerHTML = `
                    <p class="text-sm font-medium text-green-600">
                        <i class="fas fa-check-circle mr-1"></i>
                        ${supervisedDevices.length} device(s) supervised
                    </p>
                `;
            } else {
                statusDiv.innerHTML = `
                    <p class="text-sm text-gray-600">
                        No devices supervised yet
                    </p>
                `;
            }
        } catch (error) {
            console.error('Failed to load supervision status:', error);
        }
    }

    // NEW: Load accountability status
    async loadAccountabilityStatus() {
        try {
            const response = await this.apiCall('/api/accountability/partners');
            const countDiv = document.getElementById('partners-count');
            
            if (!countDiv) return;
            
            const activePartners = response.filter(p => p.status === 'active');
            
            if (activePartners.length > 0) {
                countDiv.innerHTML = `
                    <p class="text-sm font-medium text-green-600">
                        <i class="fas fa-check-circle mr-1"></i>
                        ${activePartners.length} active partner(s)
                    </p>
                `;
            } else {
                countDiv.innerHTML = `
                    <p class="text-sm text-gray-600">
                        No accountability partners yet
                    </p>
                `;
            }
        } catch (error) {
            console.error('Failed to load accountability status:', error);
        }
    }

    // Token management methods
    setAuthToken(token) {
        sessionStorage.setItem('authToken', token);
        // Also set as cookie as fallback
        document.cookie = `authToken=${token}; path=/; max-age=86400; SameSite=Strict`;
    }

    clearAuthToken() {
        sessionStorage.removeItem('authToken');
        document.cookie = 'authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    }

    getCookieValue(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    // UI Navigation Methods
    showLogin() {
        // Hide the entire main dashboard (including navigation)
        document.getElementById('main-dashboard').classList.add('hidden');
        // Show the full-screen login section
        document.getElementById('login-section').classList.remove('hidden');
        // Clear any error messages
        const loginError = document.getElementById('login-error');
        if (loginError) {
            loginError.classList.add('hidden');
        }
        // Reset user email
        const userEmailElement = document.getElementById('user-email');
        if (userEmailElement) {
            userEmailElement.textContent = 'Loading...';
        }
    }

    showMainDashboard() {
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('main-dashboard').classList.remove('hidden');
        this.showSection('dashboard');
    }

    showSection(sectionName) {
        console.log('Showing section:', sectionName);
        
        // Hide all sections
        const sections = ['dashboard', 'devices', 'blocking', 'timers', 'subscription'];
        sections.forEach(section => {
            const element = document.getElementById(`${section}-section`);
            if (element) {
                element.classList.add('hidden');
            }
        });
        
        // Show selected section
        const targetSection = document.getElementById(`${sectionName}-section`);
        if (targetSection) {
            targetSection.classList.remove('hidden');
            this.currentSection = sectionName;
            console.log('✅ Section switched to:', sectionName);
        } else {
            console.error('❌ Section not found:', sectionName);
        }
        
        // Update navigation styling
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('bg-white', 'bg-opacity-20');
        });
        
        // Highlight current nav item
        const currentNav = Array.from(document.querySelectorAll('.nav-link')).find(
            nav => nav.getAttribute('data-section') === sectionName
        );
        if (currentNav) {
            currentNav.classList.add('bg-white', 'bg-opacity-20');
        }
        
        // Load section data
        this.loadSectionData(sectionName);
    }

    async loadSectionData(section) {
        try {
            switch (section) {
                case 'dashboard':
                    await this.loadDashboardData();
                    break;
                case 'devices':
                    await this.loadDevices();
                    break;
                case 'blocking':
                    await this.loadBlockingSettings();
                    break;
                case 'timers':
                    await this.loadTimers();
                    break;
                case 'subscription':
                    await this.loadSubscription();
                    break;
            }
        } catch (error) {
            console.error(`Failed to load ${section} data:`, error);
            this.showNotification(`Failed to load ${section} data`, 'error');
        }
    }

    async loadDashboardData() {
        try {
            // Load basic dashboard data with fallbacks
            const timerStatus = await this.safeApiCall('/api/timers/status');
            const devicesData = await this.safeApiCall('/api/devices');
            const subscriptionData = await this.safeApiCall('/api/subscriptions/status');

            // Update timer status
            const timerElement = document.getElementById('timer-status');
            if (timerElement) {
                if (timerStatus?.hasActiveTimer) {
                    const timeRemaining = this.formatTimeRemaining(timerStatus.activeTimer.timeRemaining);
                    timerElement.textContent = timeRemaining;
                    timerElement.classList.add('text-red-600', 'font-bold');
                } else {
                    timerElement.textContent = 'No active timer';
                    timerElement.classList.remove('text-red-600', 'font-bold');
                }
            }

            // Update devices count
            const devicesElement = document.getElementById('devices-count');
            if (devicesElement) {
                const deviceCount = devicesData?.devices?.length || 0;
                const deviceLimit = devicesData?.summary?.deviceLimit || 1;
                devicesElement.textContent = `${deviceCount}/${deviceLimit} devices`;
                
                // Populate device selectors
                if (devicesData?.devices) {
                    this.populateDeviceSelectors(devicesData.devices);
                }
            }

            // Update subscription plan
            const planElement = document.getElementById('subscription-plan');
            if (planElement) {
                const planName = this.formatPlanName(subscriptionData?.subscription?.plan || 'inactive');
                planElement.textContent = planName;
            }
            
            // Reload supervision status if enabled
            if (this.supervisionEnabled) {
                this.loadSupervisionStatus();
                this.loadAccountabilityStatus();
            }

        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        }
    }

    // Safe API call with fallback
    async safeApiCall(endpoint) {
        try {
            return await this.apiCall(endpoint);
        } catch (error) {
            console.warn(`API call failed for ${endpoint}:`, error.message);
            return null;
        }
    }

    // ENHANCED Device Management Methods with supervision status
    async loadDevices() {
        try {
            const response = await this.safeApiCall('/api/devices');
            if (response?.devices) {
                this.renderDevices(response.devices);
            } else {
                this.renderDevices([]);
            }
        } catch (error) {
            console.error('Failed to load devices:', error);
            this.renderDevices([]);
        }
    }

    async renderDevices(devices) {
        const container = document.getElementById('devices-list');
        if (!container) return;
        
        if (devices.length === 0) {
            container.innerHTML = `
                <div class="col-span-full text-center py-12">
                    <i class="fas fa-mobile-alt text-gray-400 text-4xl mb-4"></i>
                    <h3 class="text-lg font-medium text-gray-900 mb-2">No devices registered</h3>
                    <p class="text-gray-600 mb-4">Add your first iOS device to get started</p>
                    <button id="empty-add-device-btn" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
                        Add Device
                    </button>
                </div>
            `;
            
            const emptyAddBtn = document.getElementById('empty-add-device-btn');
            if (emptyAddBtn) {
                emptyAddBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showAddDeviceModal();
                });
            }
            return;
        }

        // Enhanced device cards with supervision status
        const deviceCards = await Promise.all(devices.map(async device => {
            let supervisionBadge = '';
            
            // Check supervision status if enabled
            if (this.supervisionEnabled) {
                try {
                    const supervisionResponse = await this.safeApiCall(`/api/devices/${device.id}/supervision`);
                    if (supervisionResponse?.supervision?.supervision_level > 0) {
                        supervisionBadge = `
                            <span class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                                <i class="fas fa-shield-alt mr-1"></i>Level ${supervisionResponse.supervision.supervision_level}
                            </span>
                        `;
                    }
                } catch (error) {
                    console.error('Failed to load device supervision status:', error);
                }
            }
            
            return `
                <div class="card rounded-lg shadow p-6" data-device-id="${device.id}">
                    <div class="flex items-center justify-between mb-4">
                        <div>
                            <h3 class="text-lg font-semibold text-gray-900 device-name">${device.deviceName}</h3>
                            ${supervisionBadge}
                        </div>
                        <div class="status-indicator ${device.profileInstalled ? 'bg-green-500' : 'bg-yellow-500'}" 
                             title="${device.profileInstalled ? 'Profile installed' : 'Profile not installed'}"></div>
                    </div>
                    
                    <div class="space-y-2 text-sm text-gray-600 mb-4">
                        <p><strong>Type:</strong> ${device.deviceType || 'iOS Device'}</p>
                        <p><strong>Model:</strong> ${device.deviceModel || 'Unknown'}</p>
                        <p><strong>Status:</strong> ${device.profileInstalled ? 'Protected' : 'Unprotected'}</p>
                        <p><strong>Added:</strong> ${new Date(device.createdAt).toLocaleDateString()}</p>
                    </div>
                    
                    <div class="flex space-x-2">
                        <button class="device-download-btn flex-1 bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700" 
                                data-device-id="${device.id}">
                            <i class="fas fa-download mr-1"></i>Download Profile
                        </button>
                        ${this.supervisionEnabled && !supervisionBadge ? `
                            <button class="device-supervise-btn bg-purple-600 text-white px-3 py-2 rounded text-sm hover:bg-purple-700" 
                                    data-device-id="${device.id}"
                                    onclick="window.location.href='/supervision?device=${device.id}'">
                                <i class="fas fa-shield-alt"></i>
                            </button>
                        ` : ''}
                        <button class="device-remove-btn bg-red-600 text-white px-3 py-2 rounded text-sm hover:bg-red-700" 
                                data-device-id="${device.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }));
        
        container.innerHTML = deviceCards.join('');
        
        // Add event listeners for device buttons
        document.querySelectorAll('.device-download-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const deviceId = btn.getAttribute('data-device-id');
                this.downloadProfile(deviceId);
            });
        });
        
        document.querySelectorAll('.device-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const deviceId = btn.getAttribute('data-device-id');
                this.removeDevice(deviceId);
            });
        });
    }

    async addDevice() {
        const deviceName = document.getElementById('device-name').value;
        const deviceModel = document.getElementById('device-model').value;
        
        if (!deviceName.trim()) {
            this.showNotification('Device name is required', 'error');
            return;
        }
        
        try {
            const response = await this.apiCall('/api/devices', {
                method: 'POST',
                body: JSON.stringify({
                    deviceName: deviceName.trim(),
                    deviceModel: deviceModel.trim() || undefined,
                    deviceType: 'iOS'
                })
            });
            
            this.closeAddDeviceModal();
            this.showSuccess('Device added successfully!');
            
            if (this.currentSection === 'devices') {
                this.loadDevices();
            }
            this.loadDashboardData();
            
        } catch (error) {
            console.error('Failed to add device:', error);
            this.showNotification(error.message || 'Failed to add device', 'error');
        }
    }

    async removeDevice(deviceId) {
        if (!confirm('Are you sure you want to remove this device?')) {
            return;
        }
        
        try {
            await this.apiCall(`/api/devices/${deviceId}`, {
                method: 'DELETE'
            });
            
            this.showSuccess('Device removed successfully!');
            this.loadDevices();
            this.loadDashboardData();
            
        } catch (error) {
            console.error('Failed to remove device:', error);
            this.showNotification(error.message || 'Failed to remove device', 'error');
        }
    }

    // Blocking Settings Methods - ENHANCED VERSION
    async loadBlockingSettings() {
        try {
            // Check if settings are locked due to active timer
            const timerStatus = await this.safeApiCall('/api/timers/status');
            const isLocked = timerStatus?.hasActiveTimer || false;
            
            const categoriesData = await this.safeApiCall('/api/blocking/categories');
            const settingsData = await this.safeApiCall('/api/blocking');
            
            if (categoriesData?.categories) {
                this.renderBlockingCategories(categoriesData.categories, isLocked);
            } else {
                this.renderDefaultCategories(isLocked);
            }
            
            if (settingsData?.settings) {
                this.populateBlockingForm(settingsData.settings);
            }
            
            // Show lock status to user
            this.updateBlockingFormStatus(isLocked, timerStatus);
            
        } catch (error) {
            console.error('Failed to load blocking settings:', error);
            this.renderDefaultCategories(false);
        }
    }

    // Enhanced renderBlockingCategories with lock status
    renderBlockingCategories(categories, isLocked = false) {
        const container = document.getElementById('blocking-categories');
        if (!container) return;
        
        console.log('Rendering categories:', categories, 'Locked:', isLocked);
        
        container.innerHTML = `
            ${isLocked ? `
                <div class="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
                    <div class="flex items-center">
                        <i class="fas fa-lock text-yellow-600 mr-2"></i>
                        <div>
                            <h4 class="text-sm font-medium text-yellow-800">Settings Locked</h4>
                            <p class="text-sm text-yellow-700">Your blocking settings are locked while a commitment timer is active. You can use emergency unlock if needed.</p>
                        </div>
                    </div>
                </div>
            ` : ''}
            
            <h3 class="text-lg font-semibold mb-4">Content Categories</h3>
            ${categories.map(category => `
                <div class="flex items-center justify-between p-3 border border-gray-200 rounded-md mb-3 ${isLocked ? 'opacity-60' : ''}">
                    <div class="flex-1">
                        <h4 class="font-medium text-gray-900">${category.name}</h4>
                        <p class="text-sm text-gray-600">${category.description}</p>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" 
                               id="category-${category.key}" 
                               name="categories" 
                               value="${category.key}"
                               ${category.defaultEnabled ? 'checked' : ''}
                               ${isLocked ? 'disabled' : ''}
                               class="toggle-checkbox">
                        <span class="toggle-slider ${category.defaultEnabled ? 'toggle-active' : 'toggle-inactive'} ${isLocked ? 'toggle-disabled' : ''}"></span>
                    </label>
                </div>
            `).join('')}
        `;
        
        // Add CSS styles for custom toggles
        if (!document.getElementById('toggle-styles')) {
            const style = document.createElement('style');
            style.id = 'toggle-styles';
            style.textContent = `
                .toggle-checkbox {
                    position: absolute;
                    opacity: 0;
                    cursor: pointer;
                    height: 0;
                    width: 0;
                }
                
                .toggle-slider {
                    position: relative;
                    display: inline-block;
                    width: 44px;
                    height: 24px;
                    border-radius: 12px;
                    transition: all 0.3s ease;
                    cursor: pointer;
                }
                
                .toggle-inactive {
                    background-color: #d1d5db;
                }
                
                .toggle-active {
                    background-color: #2563eb;
                }
                
                .toggle-disabled {
                    cursor: not-allowed !important;
                    opacity: 0.5;
                }
                
                .toggle-disabled::after {
                    background-color: #f3f4f6 !important;
                }
                
                .toggle-slider::after {
                    content: '';
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background-color: white;
                    transition: all 0.3s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                
                .toggle-active::after {
                    transform: translateX(20px);
                }
                
                .toggle-checkbox:focus + .toggle-slider {
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
                }
            `;
            document.head.appendChild(style);
        }
        
        // Add event listeners (only if not locked)
        if (!isLocked) {
            const toggles = container.querySelectorAll('.toggle-checkbox');
            toggles.forEach(toggle => {
                const slider = toggle.nextElementSibling;
                
                // Set initial state
                if (toggle.checked) {
                    slider.classList.remove('toggle-inactive');
                    slider.classList.add('toggle-active');
                }
                
                toggle.addEventListener('change', (e) => {
                    const categoryKey = e.target.value;
                    const isChecked = e.target.checked;
                    console.log(`🔄 Toggle changed: ${categoryKey} = ${isChecked}`);
                    
                    // Update visual state
                    if (isChecked) {
                        slider.classList.remove('toggle-inactive');
                        slider.classList.add('toggle-active');
                    } else {
                        slider.classList.remove('toggle-active');
                        slider.classList.add('toggle-inactive');
                    }
                });
                
                // Also handle clicking on the slider itself
                slider.addEventListener('click', (e) => {
                    e.preventDefault();
                    toggle.checked = !toggle.checked;
                    toggle.dispatchEvent(new Event('change'));
                });
            });
            
            console.log('✅ Toggle event listeners added to', toggles.length, 'switches');
        }
    }

    renderDefaultCategories(isLocked = false) {
        const container = document.getElementById('blocking-categories');
        if (!container) return;
        
        const defaultCategories = [
            { key: 'adult', name: 'Adult Content', description: 'Block adult and explicit content', defaultEnabled: true },
            { key: 'gambling', name: 'Gambling', description: 'Block gambling and betting sites', defaultEnabled: true },
            { key: 'social', name: 'Social Media', description: 'Block social media platforms', defaultEnabled: false },
            { key: 'gaming', name: 'Gaming', description: 'Block gaming websites and platforms', defaultEnabled: false }
        ];
        
        this.renderBlockingCategories(defaultCategories, isLocked);
    }

    // NEW: Enhanced blocking form populate with settings
    async populateBlockingForm(settings) {
        // Populate categories
        if (settings) {
            Object.keys(settings).forEach(key => {
                if (key.startsWith('block_') && key !== 'custom_blocked_domains' && key !== 'custom_allowed_domains') {
                    const categoryKey = key.replace('block_', '').replace('_content', '');
                    const checkbox = document.getElementById(`category-${categoryKey}`);
                    if (checkbox) {
                        checkbox.checked = settings[key];
                        // Update toggle visual state
                        const slider = checkbox.nextElementSibling;
                        if (settings[key]) {
                            slider?.classList.remove('toggle-inactive');
                            slider?.classList.add('toggle-active');
                        } else {
                            slider?.classList.remove('toggle-active');
                            slider?.classList.add('toggle-inactive');
                        }
                    }
                }
            });
            
            // Populate custom domains
            const customBlocked = document.getElementById('custom-blocked');
            const customAllowed = document.getElementById('custom-allowed');
            
            if (customBlocked && settings.custom_blocked_domains) {
                customBlocked.value = settings.custom_blocked_domains.join('\n');
            }
            
            if (customAllowed && settings.custom_allowed_domains) {
                customAllowed.value = settings.custom_allowed_domains.join('\n');
            }
        }
    }

    // NEW: Update blocking form status
    updateBlockingFormStatus(isLocked, timerStatus) {
        const submitButton = document.querySelector('#blocking-form button[type="submit"]');
        const customBlocked = document.getElementById('custom-blocked');
        const customAllowed = document.getElementById('custom-allowed');
        
        if (isLocked) {
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.innerHTML = '<i class="fas fa-lock mr-2"></i>Settings Locked by Timer';
            }
            if (customBlocked) customBlocked.disabled = true;
            if (customAllowed) customAllowed.disabled = true;
        } else {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = 'Save Settings';
            }
            if (customBlocked) customBlocked.disabled = false;
            if (customAllowed) customAllowed.disabled = false;
        }
    }

    // NEW: Save blocking settings
    async saveBlockingSettings() {
        try {
            // Gather form data
            const formData = {
                block_adult_content: document.getElementById('category-adult')?.checked || false,
                block_gambling: document.getElementById('category-gambling')?.checked || false,
                block_social_media: document.getElementById('category-social')?.checked || false,
                block_gaming: document.getElementById('category-gaming')?.checked || false,
                block_news: document.getElementById('category-news')?.checked || false,
                block_entertainment: document.getElementById('category-entertainment')?.checked || false,
                block_shopping: document.getElementById('category-shopping')?.checked || false,
                block_dating: document.getElementById('category-dating')?.checked || false,
                custom_blocked_domains: document.getElementById('custom-blocked')?.value.split('\n').filter(d => d.trim()) || [],
                custom_allowed_domains: document.getElementById('custom-allowed')?.value.split('\n').filter(d => d.trim()) || []
            };
            
            console.log('Saving blocking settings:', formData);
            
            await this.apiCall('/api/blocking', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            
            this.showSuccess('Blocking settings saved successfully!');
            
        } catch (error) {
            console.error('Failed to save blocking settings:', error);
            this.showNotification(error.message || 'Failed to save settings', 'error');
        }
    }

    // Timer Methods - keeping existing implementation
    async loadTimers() {
        try {
            const statusData = await this.safeApiCall('/api/timers/status');
            const historyData = await this.safeApiCall('/api/timers/history');
            
            if (statusData) {
                this.renderActiveTimer(statusData);
            }
            
            if (historyData?.timers) {
                this.renderTimerHistory(historyData.timers);
            } else {
                this.renderTimerHistory([]);
            }
            
        } catch (error) {
            console.error('Failed to load timers:', error);
        }
    }

    renderActiveTimer(timerStatus) {
        const activeTimerCard = document.getElementById('active-timer-card');
        const activeTimerContent = document.getElementById('active-timer-content');
        
        if (!activeTimerCard || !activeTimerContent) return;
        
        if (timerStatus.hasActiveTimer) {
            const timer = timerStatus.activeTimer;
            const timeRemaining = this.formatTimeRemaining(timer.timeRemaining);
            
            activeTimerContent.innerHTML = `
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Time Remaining</p>
                        <p class="text-2xl font-bold text-red-600">${timeRemaining}</p>
                        <p class="text-sm text-gray-600 mt-1">
                            Started: ${new Date(timer.startTime).toLocaleString()}
                        </p>
                    </div>
                    <div class="text-right">
                        <p class="text-sm text-gray-600">Duration</p>
                        <p class="text-lg font-semibold">${timer.duration} hours</p>
                        <button id="emergency-unlock-btn" class="mt-2 bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700">
                            Emergency Unlock
                        </button>
                    </div>
                </div>
            `;
            
            const emergencyBtn = document.getElementById('emergency-unlock-btn');
            if (emergencyBtn) {
                emergencyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showEmergencyUnlock();
                });
            }
            
            activeTimerCard.classList.remove('hidden');
        } else {
            activeTimerCard.classList.add('hidden');
        }
    }

    renderTimerHistory(timers) {
        const container = document.getElementById('timer-history');
        if (!container) return;
        
        if (timers.length === 0) {
            container.innerHTML = `<p class="text-gray-600 text-center py-4">No timer history yet</p>`;
            return;
        }
        
        container.innerHTML = timers.slice(0, 5).map(timer => `
            <div class="flex items-center justify-between p-3 border-b border-gray-200">
                <div>
                    <p class="font-medium">${timer.duration} hours</p>
                    <p class="text-sm text-gray-600">${new Date(timer.startTime).toLocaleDateString()}</p>
                </div>
                <span class="px-2 py-1 rounded text-xs font-medium ${this.getTimerStatusClass(timer.status)}">
                    ${timer.status}
                </span>
            </div>
        `).join('');
    }

    async createTimer() {
        const durationElement = document.getElementById('timer-duration');
        const deviceElement = document.getElementById('timer-device');
        
        if (!durationElement) {
            this.showNotification('Timer form not found', 'error');
            return;
        }
        
        const duration = parseInt(durationElement.value);
        const deviceId = deviceElement ? deviceElement.value || null : null;
        
        if (!confirm(`Start a ${duration} hour commitment timer? Settings will be locked until it expires.`)) {
            return;
        }
        
        try {
            await this.apiCall('/api/timers', {
                method: 'POST',
                body: JSON.stringify({ duration, deviceId })
            });
            
            this.showSuccess('Timer started successfully!');
            this.loadTimers();
            this.loadDashboardData();
            
        } catch (error) {
            console.error('Failed to create timer:', error);
            this.showNotification(error.message || 'Failed to start timer', 'error');
        }
    }

    async createQuickTimer() {
        const durationElement = document.getElementById('quick-timer-duration');
        if (!durationElement) {
            this.showNotification('Quick timer form not found', 'error');
            return;
        }
        
        const duration = parseInt(durationElement.value);
        
        if (!confirm(`Start a ${duration} hour commitment timer?`)) {
            return;
        }
        
        try {
            await this.apiCall('/api/timers', {
                method: 'POST',
                body: JSON.stringify({ duration })
            });
            
            this.showSuccess('Quick timer started!');
            this.loadDashboardData();
            
        } catch (error) {
            console.error('Failed to create quick timer:', error);
            this.showNotification(error.message || 'Failed to start timer', 'error');
        }
    }

    // ENHANCED SUBSCRIPTION METHODS - COMPLETE FIXED VERSION
    async loadSubscription() {
        try {
            console.log('📊 Loading subscription data...');
            
            const statusData = await this.safeApiCall('/api/subscriptions/status');
            const plansData = await this.safeApiCall('/api/subscriptions/plans');
            
            console.log('📊 Subscription status data:', statusData);
            console.log('📊 Plans data:', plansData);
            
            this.renderSubscriptionInfo(statusData || {}, plansData || { plans: [] });
            
        } catch (error) {
            console.error('Failed to load subscription:', error);
            this.renderSubscriptionInfo({}, { plans: [] });
        }
    }

    // COMPLETE FIXED renderSubscriptionInfo
    renderSubscriptionInfo(status, plans) {
        const container = document.getElementById('subscription-content');
        if (!container) {
            console.error('Subscription container not found');
            return;
        }
        
        console.log('📊 Rendering subscription info:', { status, plans });
        
        // Handle the actual API response structure more defensively
        const subscription = status?.subscription || {};
        const currentPlan = subscription.status ? subscription : { status: 'inactive' };
        const isActive = currentPlan.status === 'active';
        
        // Use actual plans from API or fallback to defaults
        const plansToShow = plans?.plans && Array.isArray(plans.plans) && plans.plans.length > 0 ? plans.plans : [
            { 
                id: '1-month', 
                name: '1 Month', 
                price: '10.00', 
                priceId: 'price_test_1month',
                features: ['Unlimited device profiles', 'Content blocking categories', 'Timer commitments up to 30 days', 'Email support', 'Basic supervision (Level 1)']
            },
            { 
                id: '3-months', 
                name: '3 Months', 
                price: '25.00', 
                priceId: 'price_test_3months',
                savings: '17% savings vs monthly',
                features: ['Unlimited device profiles', 'Content blocking categories', 'Timer commitments up to 90 days', 'Email support', '17% savings vs monthly billing', 'Enhanced supervision (Level 2)', 'Accountability partners']
            },
            { 
                id: '6-months', 
                name: '6 Months', 
                price: '50.00', 
                priceId: 'price_test_6months',
                savings: '17% savings vs monthly',
                recommended: true,
                features: ['Unlimited device profiles', 'Content blocking categories', 'Timer commitments up to 180 days', 'Priority email support', '17% savings vs monthly billing', 'Maximum supervision (Level 3)', 'Unlimited accountability partners', 'Most popular choice']
            },
            { 
                id: '1-year', 
                name: '1 Year', 
                price: '90.00', 
                priceId: 'price_test_1year',
                savings: '25% savings vs monthly',
                features: ['Unlimited device profiles', 'Content blocking categories', 'Timer commitments up to 365 days', 'Priority email support', '25% savings vs monthly billing', 'Maximum supervision (Level 3)', 'Unlimited accountability partners', 'Best value for long-term commitment']
            }
        ];
        
        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <!-- Current Subscription -->
                <div class="card rounded-lg shadow p-6">
                    <h3 class="text-lg font-semibold text-gray-900 mb-4">Current Subscription</h3>
                    <div class="space-y-3">
                        <div class="flex justify-between">
                            <span class="text-gray-600">Status:</span>
                            <span class="font-medium ${isActive ? 'text-green-600' : 'text-red-600'}">
                                ${(currentPlan.status || 'Inactive').charAt(0).toUpperCase() + (currentPlan.status || 'inactive').slice(1)}
                            </span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Plan:</span>
                            <span class="font-medium">${this.formatPlanName(currentPlan.plan || 'inactive')}</span>
                        </div>
                        ${isActive && currentPlan.endDate ? `
                            <div class="flex justify-between">
                                <span class="text-gray-600">Next billing:</span>
                                <span class="font-medium">${new Date(currentPlan.endDate).toLocaleDateString()}</span>
                            </div>
                        ` : ''}
                        ${currentPlan.stripeDetails ? `
                            <div class="flex justify-between">
                                <span class="text-gray-600">Current period ends:</span>
                                <span class="font-medium">${new Date(currentPlan.stripeDetails.currentPeriodEnd).toLocaleDateString()}</span>
                            </div>
                        ` : ''}
                        ${this.supervisionEnabled ? `
                            <div class="flex justify-between">
                                <span class="text-gray-600">Supervision:</span>
                                <span class="font-medium text-purple-600">
                                    <i class="fas fa-shield-alt mr-1"></i>Enabled
                                </span>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="mt-4 space-y-2">
                        ${isActive ? `
                            <button id="manage-billing-btn" class="w-full bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700">
                                Manage Billing
                            </button>
                        ` : ''}
                        
                        <!-- Development Debug Button -->
                        <button id="debug-config-btn" class="w-full bg-yellow-500 text-white py-1 px-4 rounded-md hover:bg-yellow-600 text-sm">
                            🔍 Debug Configuration
                        </button>
                    </div>
                </div>
                
                <!-- Available Plans -->
                <div class="card rounded-lg shadow p-6">
                    <h3 class="text-lg font-semibold text-gray-900 mb-4">Available Plans</h3>
                    
                    <!-- Configuration Warning -->
                    ${plansToShow.some(plan => plan.priceId && plan.priceId.includes('test')) ? `
                        <div class="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                            <p class="text-sm text-yellow-800">
                                <i class="fas fa-exclamation-triangle mr-2"></i>
                                Some plans use test configuration. Contact support for production setup.
                            </p>
                        </div>
                    ` : ''}
                    
                    <div class="space-y-3">
                        ${plansToShow.map(plan => {
                            const isTestPrice = !plan.priceId || plan.priceId.includes('test');
                            const isCurrentPlan = isActive && currentPlan.plan === plan.id;
                            const hasSupervision = plan.features && plan.features.some(f => f.toLowerCase().includes('supervision'));
                            
                            return `
                                <div class="flex items-center justify-between p-3 border border-gray-200 rounded-md ${plan.recommended ? 'border-blue-500 bg-blue-50' : ''} ${isTestPrice ? 'opacity-75' : ''}">
                                    <div class="flex-1">
                                        <div class="flex items-center">
                                            <h4 class="font-medium">${plan.name}</h4>
                                            ${plan.recommended ? '<span class="ml-2 px-2 py-1 text-xs bg-blue-500 text-white rounded">Recommended</span>' : ''}
                                            ${hasSupervision ? '<span class="ml-2 px-2 py-1 text-xs bg-purple-500 text-white rounded"><i class="fas fa-shield-alt mr-1"></i>Supervision</span>' : ''}
                                            ${isTestPrice ? '<span class="ml-2 px-2 py-1 text-xs bg-yellow-500 text-white rounded">Test Config</span>' : ''}
                                        </div>
                                        <p class="text-sm text-gray-600 mt-1">
                                            ${plan.features && plan.features[0] ? plan.features[0] : 'Premium features included'}
                                        </p>
                                        ${plan.savings ? `
                                            <p class="text-xs text-green-600 mt-1">${plan.savings}</p>
                                        ` : ''}
                                        ${isTestPrice ? `
                                            <p class="text-xs text-yellow-600 mt-1">Price ID: ${plan.priceId}</p>
                                        ` : ''}
                                    </div>
                                    <div class="text-right ml-4">
                                        <p class="font-bold text-lg">£${plan.price}</p>
                                        ${!isCurrentPlan ? `
                                            <button class="subscribe-btn mt-2 bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed" 
                                                    data-plan-id="${plan.id}"
                                                    data-price-id="${plan.priceId || ''}"
                                                    ${!plan.priceId ? 'disabled title="Price ID not configured"' : ''}>
                                                ${!plan.priceId ? 'Not Available' : (isActive ? 'Switch Plan' : 'Subscribe')}
                                            </button>
                                        ` : `
                                            <div class="mt-2">
                                                <span class="text-green-600 text-sm font-medium">✓ Current Plan</span>
                                            </div>
                                        `}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
            
            <!-- Debug Information -->
            <div class="mt-6 p-4 bg-gray-100 rounded-md text-xs">
                <details>
                    <summary class="cursor-pointer font-medium text-gray-700">Debug Info (Development)</summary>
                    <pre class="mt-2 text-gray-600 overflow-auto">${JSON.stringify({ status, plans }, null, 2)}</pre>
                </details>
            </div>
        `;
        
        // Add event listeners
        const manageBillingBtn = document.getElementById('manage-billing-btn');
        if (manageBillingBtn) {
            manageBillingBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🏢 Manage billing clicked');
                this.manageBilling();
            });
        }
        
        const debugConfigBtn = document.getElementById('debug-config-btn');
        if (debugConfigBtn) {
            debugConfigBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔍 Debug config clicked');
                this.debugSubscriptionConfig();
            });
        }
        
        document.querySelectorAll('.subscribe-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const planId = btn.getAttribute('data-plan-id');
                const priceId = btn.getAttribute('data-price-id');
                console.log('💳 Subscribe clicked:', { planId, priceId });
                
                if (!priceId) {
                    this.showNotification('This plan is not available yet. Please contact support.', 'error');
                    return;
                }
                
                this.subscribeToPlan(planId, priceId);
            });
        });
        
        console.log('✅ Subscription UI rendered successfully');
    }

    // ENHANCED subscribeToPlan method with better error handling
    async subscribeToPlan(planId, priceId) {
        try {
            console.log('💳 Creating subscription for plan:', { planId, priceId });
            
            // Validate inputs
            if (!planId || !priceId) {
                throw new Error('Plan ID and Price ID are required');
            }
            
            // Show loading state
            const buttons = document.querySelectorAll('.subscribe-btn');
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
            });
            
            console.log('📤 Sending subscription request to backend...');
            
            // Create subscription with the price ID
            const response = await this.apiCall('/api/subscriptions/create', {
                method: 'POST',
                body: JSON.stringify({ 
                    priceId: priceId 
                })
            });
            
            console.log('✅ Subscription creation response:', response);
            
            // Handle different response scenarios
            if (response.error) {
                // Backend returned an error in the response
                throw new Error(response.message || response.error);
            }
            
            if (response.clientSecret) {
                console.log('💳 Subscription created with payment required');
                this.showSuccess('Subscription created! Redirecting to payment...');
                
                // In a real implementation, you would redirect to Stripe Checkout
                // For now, simulate payment success
                this.showNotification('Payment simulation: Redirecting to Stripe Checkout...', 'info');
                
                // Simulate successful payment after 3 seconds
                setTimeout(() => {
                    this.showSuccess('Payment completed successfully!');
                    this.loadSubscription();
                    this.checkSupervisionFeatures(); // Recheck supervision after subscription
                }, 3000);
                
            } else if (response.subscriptionId) {
                console.log('✅ Subscription created without payment required');
                this.showSuccess('Subscription activated successfully!');
                setTimeout(() => {
                    this.loadSubscription();
                    this.checkSupervisionFeatures(); // Recheck supervision after subscription
                }, 1000);
            } else {
                console.warn('⚠️ Unexpected response format:', response);
                throw new Error('Unexpected response from server');
            }
            
        } catch (error) {
            console.error('❌ Failed to create subscription:', error);
            
            let errorMessage = 'Failed to start subscription process';
            
            // Handle specific error types
            if (error.message.includes('already has an active subscription')) {
                errorMessage = 'You already have an active subscription. Use "Manage Billing" to make changes.';
            } else if (error.message.includes('authentication') || error.message.includes('401')) {
                errorMessage = 'Please log in again to continue.';
                setTimeout(() => this.logout(), 1000);
            } else if (error.message.includes('Invalid price ID')) {
                errorMessage = 'This subscription plan is not properly configured. Please contact support.';
            } else if (error.message.includes('customer') || error.message.includes('Customer')) {
                errorMessage = 'There was an issue with your account. Please contact support.';
            } else if (error.message.includes('client_secret')) {
                errorMessage = 'Payment configuration error. Please contact support.';
            } else if (error.message.includes('Network error')) {
                errorMessage = 'Network connection error. Please check your internet connection and try again.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            this.showNotification(errorMessage, 'error');
            
            // Log detailed error for debugging
            console.error('🔍 Detailed error info:', {
                message: error.message,
                stack: error.stack,
                planId,
                priceId,
                hasToken: !!this.token
            });
            
        } finally {
            // Reset button states after a delay
            setTimeout(() => {
                const buttons = document.querySelectorAll('.subscribe-btn');
                buttons.forEach(btn => {
                    if (btn.hasAttribute('data-price-id')) {
                        const priceId = btn.getAttribute('data-price-id');
                        btn.disabled = !priceId;
                        
                        if (btn.disabled) {
                            btn.innerHTML = 'Not Available';
                            btn.title = 'This plan is not properly configured';
                        } else {
                            const isActive = btn.closest('.card')?.querySelector('.text-green-600');
                            btn.innerHTML = isActive ? 'Switch Plan' : 'Subscribe';
                        }
                    }
                });
            }, 1000);
        }
    }

    // ENHANCED manageBilling method with better error handling
    async manageBilling() {
        try {
            console.log('🏢 Opening billing portal...');
            
            // Show loading state
            const manageBillingBtn = document.getElementById('manage-billing-btn');
            if (manageBillingBtn) {
                manageBillingBtn.disabled = true;
                manageBillingBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Opening...';
            }
            
            const returnUrl = `${window.location.origin}${window.location.pathname}#subscription`;
            
            const response = await this.apiCall('/api/subscriptions/billing-portal', {
                method: 'POST',
                body: JSON.stringify({
                    returnUrl: returnUrl
                })
            });
            
            console.log('🏢 Billing portal response:', response);
            
            if (response.url) {
                console.log('✅ Opening billing portal at:', response.url);
                this.showSuccess('Opening billing portal...');
                
                // Open in new tab
                const newWindow = window.open(response.url, '_blank');
                if (!newWindow) {
                    // If popup blocked, show manual link
                    this.showNotification('Please allow popups or click here to manage billing', 'warning');
                }
            } else {
                throw new Error('No billing portal URL received');
            }
            
        } catch (error) {
            console.error('❌ Failed to open billing portal:', error);
            
            let errorMessage = 'Failed to open billing portal';
            if (error.message.includes('No customer found')) {
                errorMessage = 'No billing account found. Please subscribe first.';
            } else if (error.message.includes('authentication') || error.message.includes('401')) {
                errorMessage = 'Please log in again to continue.';
                this.logout();
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            this.showNotification(errorMessage, 'error');
        } finally {
            // Reset button state
            setTimeout(() => {
                const manageBillingBtn = document.getElementById('manage-billing-btn');
                if (manageBillingBtn) {
                    manageBillingBtn.disabled = false;
                    manageBillingBtn.innerHTML = 'Manage Billing';
                }
            }, 1000);
        }
    }

    // Debug method to test subscription configuration
    async debugSubscriptionConfig() {
        try {
            console.log('🔍 Testing subscription configuration...');
            
            const response = await this.apiCall('/api/subscriptions/debug/stripe-config');
            console.log('🔍 Subscription config:', response);
            
            // Show debug info to user
            if (response.config) {
                const issues = response.recommendations || [];
                
                if (issues.length > 0) {
                    this.showNotification(`Configuration issues: ${issues.join(', ')}`, 'warning');
                } else {
                    this.showNotification('Subscription configuration looks good!', 'success');
                }
                
                // Log detailed info
                console.table(response.config.priceTests);
            }
            
        } catch (error) {
            console.error('❌ Debug failed:', error);
            this.showNotification('Could not check subscription configuration', 'error');
        }
    }

    // Profile Methods
    async downloadProfile(deviceId = null) {
        const selectElement = document.getElementById('profile-device');
        const targetDeviceId = deviceId || (selectElement ? selectElement.value : null);
        
        if (!targetDeviceId) {
            this.showNotification('Please select a device', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${this.baseUrl}/api/profiles/download/${targetDeviceId}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to download profile');
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `altrii-recovery-${targetDeviceId}.mobileconfig`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            this.showSuccess('Profile downloaded! Install it on your iOS device.');
            
        } catch (error) {
            console.error('Failed to download profile:', error);
            this.showNotification('Failed to download profile', 'error');
        }
    }

    // Modal Methods
    showAddDeviceModal() {
        const modal = document.getElementById('add-device-modal');
        const nameInput = document.getElementById('device-name');
        if (modal) {
            modal.classList.remove('hidden');
            if (nameInput) nameInput.focus();
        }
    }

    closeAddDeviceModal() {
        const modal = document.getElementById('add-device-modal');
        const form = document.getElementById('add-device-form');
        if (modal) modal.classList.add('hidden');
        if (form) form.reset();
    }

    toggleUserMenu() {
        const menu = document.getElementById('user-menu');
        if (menu) {
            menu.classList.toggle('hidden');
        }
    }

    showEmergencyUnlock() {
        if (confirm('Emergency unlock will end your timer commitment early. This action will be logged. Are you sure?')) {
            this.emergencyUnlock();
        }
    }

    async emergencyUnlock() {
        try {
            await this.apiCall('/api/timers/emergency-unlock', {
                method: 'POST'
            });
            
            this.showSuccess('Timer unlocked. Settings are now editable.');
            this.loadTimers();
            this.loadDashboardData();
            
        } catch (error) {
            console.error('Failed to emergency unlock:', error);
            this.showNotification(error.message || 'Failed to unlock timer', 'error');
        }
    }

    // Timer Updates
    startTimerUpdates() {
        setInterval(() => {
            if (this.token && (this.currentSection === 'dashboard' || this.currentSection === 'timers')) {
                this.updateTimerDisplay();
            }
        }, 60000); // Update every minute
    }

    async updateTimerDisplay() {
        try {
            const response = await this.safeApiCall('/api/timers/status');
            
            if (response?.hasActiveTimer) {
                const timeRemaining = this.formatTimeRemaining(response.activeTimer.timeRemaining);
                const timerStatus = document.getElementById('timer-status');
                if (timerStatus) {
                    timerStatus.textContent = timeRemaining;
                }
                
                if (this.currentSection === 'timers') {
                    this.renderActiveTimer(response);
                }
            }
        } catch (error) {
            console.log('Timer update failed:', error.message);
        }
    }

    // Helper Methods
    populateDeviceSelectors(devices) {
        const selectors = ['profile-device', 'timer-device'];
        
        selectors.forEach(selectorId => {
            const selector = document.getElementById(selectorId);
            if (selector) {
                const currentValue = selector.value;
                selector.innerHTML = '<option value="">Select Device</option>' +
                    devices.map(device => 
                        `<option value="${device.id}" ${currentValue === device.id ? 'selected' : ''}>${device.deviceName}</option>`
                    ).join('');
            }
        });
    }

    formatTimeRemaining(hours) {
        if (hours < 1) {
            const minutes = Math.floor(hours * 60);
            return `${minutes}m`;
        } else if (hours < 24) {
            const remainingMinutes = Math.floor((hours % 1) * 60);
            return `${Math.floor(hours)}h ${remainingMinutes}m`;
        } else {
            const days = Math.floor(hours / 24);
            const remainingHours = Math.floor(hours % 24);
            return `${days}d ${remainingHours}h`;
        }
    }

    formatPlanName(planId) {
        const planNames = {
            'inactive': 'Free',
            'basic': 'Basic',
            '1-month': '1 Month',
            '3-months': '3 Months',
            '6-months': '6 Months',
            '1-year': '1 Year'
        };
        return planNames[planId] || planId;
    }

    getTimerStatusClass(status) {
        const statusClasses = {
            'active': 'bg-red-100 text-red-800',
            'completed': 'bg-green-100 text-green-800',
            'cancelled': 'bg-gray-100 text-gray-800',
            'expired': 'bg-yellow-100 text-yellow-800'
        };
        return statusClasses[status] || 'bg-gray-100 text-gray-800';
    }

    // UI State Methods
    showLoading(elementPrefix) {
        const textElement = document.getElementById(`${elementPrefix}-text`);
        const loadingElement = document.getElementById(`${elementPrefix}-loading`);
        
        if (textElement) textElement.classList.add('hidden');
        if (loadingElement) loadingElement.classList.remove('hidden');
    }

    hideLoading(elementPrefix) {
        const textElement = document.getElementById(`${elementPrefix}-text`);
        const loadingElement = document.getElementById(`${elementPrefix}-loading`);
        
        if (textElement) textElement.classList.remove('hidden');
        if (loadingElement) loadingElement.classList.add('hidden');
    }

    showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.remove('hidden');
        }
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-md shadow-lg z-50 ${this.getNotificationClass(type)}`;
        notification.innerHTML = `
            <div class="flex items-center">
                <i class="fas ${this.getNotificationIcon(type)} mr-3"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-lg">&times;</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    getNotificationClass(type) {
        const classes = {
            'success': 'bg-green-100 border border-green-400 text-green-700',
            'error': 'bg-red-100 border border-red-400 text-red-700',
            'warning': 'bg-yellow-100 border border-yellow-400 text-yellow-700',
            'info': 'bg-blue-100 border border-blue-400 text-blue-700'
        };
        return classes[type] || classes.info;
    }

    getNotificationIcon(type) {
        const icons = {
            'success': 'fa-check-circle',
            'error': 'fa-exclamation-circle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle'
        };
        return icons[type] || icons.info;
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 Initializing Altrii Recovery Frontend...');
    window.app = new AltriiApp();
});

// Handle clicks outside of user menu to close it
document.addEventListener('click', (e) => {
    const userMenu = document.getElementById('user-menu');
    const userButton = document.getElementById('user-menu-button');
    
    if (userMenu && !userMenu.contains(e.target) && !userButton?.contains(e.target)) {
        userMenu.classList.add('hidden');
    }
});