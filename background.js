/**
 * AKL Badminton Booker - Background Service Worker
 * Handles alarms, tab detection, messaging, and notifications
 */

// Initialize background script
chrome.runtime.onInstalled.addListener(handleInstall);
chrome.runtime.onStartup.addListener(handleStartup);

// Handle alarms for scheduled bookings
chrome.alarms.onAlarm.addListener(handleAlarm);

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener(handleMessage);

// Handle tab updates to detect AKL website
chrome.tabs.onUpdated.addListener(handleTabUpdate);

/**
 * Handle extension installation
 */
async function handleInstall(details) {
    console.log('AKL Badminton Booker installed/updated:', details.reason);
    
    // Create default storage structure
    await chrome.storage.local.set({
        isEnabled: true,
        bookingAttempts: 0,
        lastBookingResult: null
    });
    
    // Show welcome notification
    showNotification('AKL Badminton Booker', 'Extension installed successfully! 🏸');
}

/**
 * Handle browser startup
 */
async function handleStartup() {
    console.log('AKL Badminton Booker starting up');
    
    // Check for any pending alarms
    const alarms = await chrome.alarms.getAll();
    console.log('Active alarms:', alarms.length);
}

/**
 * Handle alarms - triggered when it's time to attempt booking
 * @param {chrome.alarms.Alarm} alarm - The alarm that fired
 */
async function handleAlarm(alarm) {
    console.log('Alarm triggered:', alarm.name);
    
    if (alarm.name === 'bookingAlarm') {
        await attemptBooking();
    }
}

/**
 * Attempt to book a court at the scheduled time
 */
async function attemptBooking() {
    try {
        // Get booking data from storage
        const { bookingData } = await chrome.storage.local.get(['bookingData']);
        
        if (!bookingData) {
            console.error('No booking data found');
            showNotification('Booking Failed', 'No booking data found');
            return;
        }
        
        // Find AKL tab
        const aklTab = await findAKLTab();
        
        if (!aklTab) {
            // TODO: Open new tab to AKL website
            const newTab = await chrome.tabs.create({
                url: 'https://aucklandbadminton.co.nz',
                active: false
            });
            
            // Wait for tab to load
            await waitForTabLoad(newTab.id);
            
            // Attempt booking on new tab
            await performBooking(newTab.id, bookingData);
        } else {
            // Use existing tab
            await performBooking(aklTab.id, bookingData);
        }
        
    } catch (error) {
        console.error('Booking attempt failed:', error);
        showNotification('Booking Failed', `Error: ${error.message}`);
    }
}

/**
 * Find an existing tab with AKL website
 * @returns {chrome.tabs.Tab|null} The AKL tab or null if not found
 */
async function findAKLTab() {
    try {
        const tabs = await chrome.tabs.query({});
        
        for (const tab of tabs) {
            if (tab.url && tab.url.includes('aucklandbadminton.co.nz')) {
                console.log('Found AKL tab:', tab.id);
                return tab;
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error finding AKL tab:', error);
        return null;
    }
}

/**
 * Wait for a tab to finish loading
 * @param {number} tabId - The tab ID to wait for
 */
function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Tab load timeout'));
        }, 30000); // 30 second timeout
        
        function onUpdated(id, changeInfo, tab) {
            if (id === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(onUpdated);
                resolve(tab);
            }
        }
        
        chrome.tabs.onUpdated.addListener(onUpdated);
    });
}

/**
 * Perform the actual booking on the specified tab
 * @param {number} tabId - The tab ID to perform booking on
 * @param {Object} bookingData - The booking data
 */
async function performBooking(tabId, bookingData) {
    try {
        console.log('Performing booking on tab:', tabId);
        
        // Send message to content script to perform booking
        const response = await chrome.tabs.sendMessage(tabId, {
            action: 'book',
            data: bookingData
        });
        
        if (response.success) {
            showNotification('Booking Successful! 🎉', `Court booked for ${bookingData.datetime}`);
            
            // Update storage with success
            await chrome.storage.local.set({
                lastBookingResult: {
                    success: true,
                    timestamp: Date.now(),
                    message: 'Booking successful'
                }
            });
        } else {
            throw new Error(response.error || 'Booking failed');
        }
        
    } catch (error) {
        console.error('Booking performance failed:', error);
        
        // Update storage with failure
        await chrome.storage.local.set({
            lastBookingResult: {
                success: false,
                timestamp: Date.now(),
                message: error.message
            }
        });
        
        showNotification('Booking Failed ❌', error.message);
    }
}

/**
 * Handle messages from popup and content scripts
 * @param {Object} request - The message request
 * @param {chrome.runtime.MessageSender} sender - The message sender
 * @param {Function} sendResponse - Function to send response
 */
function handleMessage(request, sender, sendResponse) {
    console.log('Background received message:', request);
    
    switch (request.action) {
        case 'scheduleBooking':
            handleScheduleBooking(request.data);
            sendResponse({ success: true });
            break;
            
        case 'clearBookings':
            handleClearBookings();
            sendResponse({ success: true });
            break;
            
        case 'getStatus':
            handleGetStatus(sendResponse);
            return true; // Keep message channel open for async response
            
        default:
            console.warn('Unknown message action:', request.action);
            sendResponse({ success: false, error: 'Unknown action' });
    }
}

/**
 * Handle booking scheduling from popup
 * @param {Object} bookingData - The booking data
 */
async function handleScheduleBooking(bookingData) {
    console.log('Scheduling booking:', bookingData);
    
    try {
        // Store booking data
        await chrome.storage.local.set({ bookingData });
        
        // TODO: Add more sophisticated scheduling logic
        // For example, schedule multiple attempts or handle different time zones
        
        showNotification('Booking Scheduled 📅', `Will attempt booking at ${bookingData.datetime}`);
        
    } catch (error) {
        console.error('Error scheduling booking:', error);
        showNotification('Schedule Failed', error.message);
    }
}

/**
 * Handle clearing all bookings
 */
async function handleClearBookings() {
    console.log('Clearing all bookings');
    
    try {
        // Clear all alarms
        await chrome.alarms.clearAll();
        
        showNotification('Bookings Cleared', 'All scheduled bookings have been cleared');
        
    } catch (error) {
        console.error('Error clearing bookings:', error);
    }
}

/**
 * Handle status request from popup
 * @param {Function} sendResponse - Function to send response
 */
async function handleGetStatus(sendResponse) {
    try {
        const alarms = await chrome.alarms.getAll();
        const { lastBookingResult } = await chrome.storage.local.get(['lastBookingResult']);
        
        sendResponse({
            success: true,
            data: {
                activeAlarms: alarms.length,
                lastResult: lastBookingResult
            }
        });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle tab updates - detect when user navigates to AKL website
 * @param {number} tabId - The tab ID
 * @param {Object} changeInfo - Information about the change
 * @param {chrome.tabs.Tab} tab - The tab object
 */
function handleTabUpdate(tabId, changeInfo, tab) {
    // Only process complete page loads
    if (changeInfo.status !== 'complete' || !tab.url) return;
    
    // Check if this is the AKL website
    if (tab.url.includes('aucklandbadminton.co.nz')) {
        console.log('AKL website detected in tab:', tabId);
        
        // TODO: Add logic to automatically inject helpful UI elements
        // or show extension badge
        chrome.action.setBadgeText({
            text: '🏸',
            tabId: tabId
        });
    } else {
        // Clear badge for non-AKL tabs
        chrome.action.setBadgeText({
            text: '',
            tabId: tabId
        });
    }
}

/**
 * Show notification to user
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
function showNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: title,
        message: message
    });
}

/**
 * TODO: Add functionality for:
 * - More sophisticated scheduling (multiple attempts, retry logic)
 * - Court preference handling
 * - Time zone management
 * - Booking history and analytics
 * - Integration with calendar apps
 * - Smart booking suggestions based on availability patterns
 * - Backup booking slots
 * - Group booking coordination
 */