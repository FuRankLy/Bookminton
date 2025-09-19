/**
 * AKL Badminton Booker - Popup Script
 * Handles user interactions in the extension popup
 */

// DOM elements
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const datetimeInput = document.getElementById('datetime');
const testBtn = document.getElementById('testBtn');
const scheduleBtn = document.getElementById('scheduleBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');

// Initialize popup
document.addEventListener('DOMContentLoaded', initializePopup);

/**
 * Initialize the popup by loading saved data and setting up event listeners
 */
async function initializePopup() {
    // Load saved form data from Chrome storage
    await loadSavedData();
    
    // Set up event listeners
    testBtn.addEventListener('click', handleTest);
    scheduleBtn.addEventListener('click', handleSchedule);
    clearBtn.addEventListener('click', handleClear);
    
    // Auto-save form data when user types
    [emailInput, passwordInput, datetimeInput].forEach(input => {
        input.addEventListener('input', saveFormData);
    });
    
    // Set default datetime to next hour if not set
    if (!datetimeInput.value) {
        setDefaultDateTime();
    }
}

/**
 * Load saved form data from Chrome storage
 */
async function loadSavedData() {
    try {
        const data = await chrome.storage.local.get(['email', 'datetime']);
        if (data.email) emailInput.value = data.email;
        if (data.datetime) datetimeInput.value = data.datetime;
    } catch (error) {
        console.error('Error loading saved data:', error);
    }
}

/**
 * Save form data to Chrome storage
 */
async function saveFormData() {
    try {
        await chrome.storage.local.set({
            email: emailInput.value,
            datetime: datetimeInput.value
        });
    } catch (error) {
        console.error('Error saving form data:', error);
    }
}

/**
 * Set default datetime to next hour
 */
function setDefaultDateTime() {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
    now.setSeconds(0);
    
    // Format for datetime-local input
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    datetimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Handle Test button click - test connection to ABA website
 */
async function handleTest() {
    showStatus('Testing connection to ABA website...', 'info');
    
    try {
        // Get current active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Check if we're on ABA website
        if (!tab.url.includes('aucklandbadminton.co.nz')) {
            showStatus('Please navigate to aucklandbadminton.co.nz first', 'error');
            return;
        }
        
        // Send test message to content script
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'test',
            data: {
                email: emailInput.value,
                password: passwordInput.value
            }
        });
        
        if (response.success) {
            showStatus('✅ Connection test successful!', 'success');
        } else {
            showStatus(`❌ Test failed: ${response.error}`, 'error');
        }
    } catch (error) {
        console.error('Test error:', error);
        showStatus('❌ Test failed. Make sure you\'re on the ABA website.', 'error');
    }
}

/**
 * Handle Schedule button click - schedule a booking
 */
async function handleSchedule() {
    // Validate required fields
    if (!datetimeInput.value) {
        showStatus('Please select a date and time', 'error');
        return;
    }
    
    const bookingData = {
        email: emailInput.value,
        password: passwordInput.value,
        datetime: datetimeInput.value
    };
    
    try {
        showStatus('Scheduling booking...', 'info');
        
        // Save the booking data and create alarm
        await chrome.storage.local.set({ bookingData });
        
        // Create alarm for the scheduled time
        const scheduledTime = new Date(datetimeInput.value);
        const alarmTime = scheduledTime.getTime();
        
        // TODO: Add logic to schedule booking attempt before the actual time
        // For now, we'll schedule it 5 minutes before
        const alarmTimeAdjusted = alarmTime - (5 * 60 * 1000); // 5 minutes before
        
        await chrome.alarms.create('bookingAlarm', {
            when: alarmTimeAdjusted
        });
        
        showStatus(`✅ Booking scheduled for ${scheduledTime.toLocaleString()}`, 'success');
        
        // TODO: Add background script communication
        chrome.runtime.sendMessage({
            action: 'scheduleBooking',
            data: bookingData
        });
        
    } catch (error) {
        console.error('Schedule error:', error);
        showStatus('❌ Failed to schedule booking', 'error');
    }
}

/**
 * Handle Clear button click - clear all form data and scheduled bookings
 */
async function handleClear() {
    try {
        // Clear form inputs
        emailInput.value = '';
        passwordInput.value = '';
        datetimeInput.value = '';
        
        // Clear saved data
        await chrome.storage.local.clear();
        
        // Clear any alarms
        await chrome.alarms.clearAll();
        
        // Reset to default datetime
        setDefaultDateTime();
        
        showStatus('✅ All data cleared', 'success');
        
        // TODO: Notify background script
        chrome.runtime.sendMessage({
            action: 'clearBookings'
        });
        
    } catch (error) {
        console.error('Clear error:', error);
        showStatus('❌ Failed to clear data', 'error');
    }
}

/**
 * Show status message to user
 * @param {string} message - Message to display
 * @param {string} type - Type of message (success, error, info)
 */
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    // Auto-hide after 5 seconds for success/info messages
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

/**
 * TODO: Add functionality for:
 * - Better error handling and user feedback
 * - Validation for email format
 * - Settings page for advanced options
 * - Export/import booking schedules
 * - Multiple court preferences
 * - Recurring bookings
 */