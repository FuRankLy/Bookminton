/**
 * AKL Badminton Booker - Content Script
 * Injects into ABA website and handles booking automation
 */

// Global configuration
const CONFIG = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000, // 2 seconds
    REQUEST_TIMEOUT: 10000 // 10 seconds
};

// State management
let isInjected = false;
let retryCount = 0;

// Initialize content script
console.log('AKL Badminton Booker content script loaded');
initializeContentScript();

/**
 * Initialize the content script
 */
function initializeContentScript() {
    // Listen for messages from popup and background scripts
    chrome.runtime.onMessage.addListener(handleMessage);
    
    // Inject page script for direct DOM access
    injectPageScript();
    
    // Set up postMessage bridge for communication with injected script
    setupPostMessageBridge();
    
    // TODO: Add automatic detection of booking forms and opportunities
    detectBookingForms();
}

/**
 * Handle messages from popup and background scripts
 * @param {Object} request - The message request
 * @param {chrome.runtime.MessageSender} sender - The message sender
 * @param {Function} sendResponse - Function to send response
 */
async function handleMessage(request, sender, sendResponse) {
    console.log('Content script received message:', request);
    
    try {
        switch (request.action) {
            case 'test':
                await handleTest(request.data, sendResponse);
                break;
                
            case 'book':
                await handleBook(request.data, sendResponse);
                break;
                
            case 'loginAndBook':
                await handleLoginAndBook(request.data, sendResponse);
                break;
                
            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('Content script error:', error);
        sendResponse({ success: false, error: error.message });
    }
    
    return true; // Keep message channel open for async response
}

/**
 * Handle test action - verify connection and login status
 * @param {Object} data - Test data
 * @param {Function} sendResponse - Response function
 */
async function handleTest(data, sendResponse) {
    console.log('Testing ABA website connection...');
    
    try {
        // Check if we're on the correct website
        if (!window.location.hostname.includes('aucklandbadminton.co.nz')) {
            throw new Error('Not on ABA website');
        }
        
        // Test basic page functionality
        const pageTitle = document.title;
        const hasLoginForm = !!document.querySelector('input[type="email"], input[name="email"]');
        const hasBookingForm = !!document.querySelector('form[class*="book"], form[id*="book"]');
        
        // TODO: Add more specific tests for ABA website structure
        const testResults = {
            pageTitle,
            hasLoginForm,
            hasBookingForm,
            url: window.location.href
        };
        
        console.log('Test results:', testResults);
        
        sendResponse({
            success: true,
            data: testResults,
            message: 'Connection test successful'
        });
        
    } catch (error) {
        console.error('Test failed:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Handle book action - attempt to book a court
 * @param {Object} data - Booking data
 * @param {Function} sendResponse - Response function
 */
async function handleBook(data, sendResponse) {
    console.log('Attempting to book court...', data);
    retryCount = 0;
    
    try {
        const result = await attemptBookingWithRetry(data);
        sendResponse(result);
    } catch (error) {
        console.error('Booking failed:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Handle login and book action - login first, then book
 * @param {Object} data - Login and booking data
 * @param {Function} sendResponse - Response function
 */
async function handleLoginAndBook(data, sendResponse) {
    console.log('Attempting login and book...', data);
    
    try {
        // First attempt login if credentials provided
        if (data.email && data.password) {
            await performLogin(data.email, data.password);
            
            // Wait a moment for login to complete
            await delay(2000);
        }
        
        // Then attempt booking
        const result = await attemptBookingWithRetry(data);
        sendResponse(result);
        
    } catch (error) {
        console.error('Login and book failed:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Attempt booking with retry logic
 * @param {Object} data - Booking data
 * @returns {Object} Result object
 */
async function attemptBookingWithRetry(data) {
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            console.log(`Booking attempt ${attempt}/${CONFIG.MAX_RETRIES}`);
            
            const result = await performBooking(data);
            
            if (result.success) {
                return result;
            }
            
            // If not the last attempt, wait before retrying
            if (attempt < CONFIG.MAX_RETRIES) {
                await delay(CONFIG.RETRY_DELAY);
            }
            
        } catch (error) {
            console.error(`Booking attempt ${attempt} failed:`, error);
            
            // If this is the last attempt, throw the error
            if (attempt === CONFIG.MAX_RETRIES) {
                throw error;
            }
            
            // Wait before retrying
            await delay(CONFIG.RETRY_DELAY);
        }
    }
    
    throw new Error(`Booking failed after ${CONFIG.MAX_RETRIES} attempts`);
}

/**
 * Perform login using provided credentials
 * @param {string} email - User email
 * @param {string} password - User password
 */
async function performLogin(email, password) {
    console.log('Performing login...');
    
    // Find login form elements
    const emailInput = document.querySelector('input[type="email"], input[name="email"]');
    const passwordInput = document.querySelector('input[type="password"], input[name="password"]');
    const loginButton = document.querySelector('button[type="submit"], input[type="submit"]');
    
    if (!emailInput || !passwordInput || !loginButton) {
        throw new Error('Login form elements not found');
    }
    
    // Fill in credentials
    emailInput.value = email;
    passwordInput.value = password;
    
    // Trigger input events
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Submit login form
    loginButton.click();
    
    // TODO: Wait for login to complete and verify success
    await delay(3000);
}

/**
 * Perform the actual booking
 * @param {Object} data - Booking data
 * @returns {Object} Result object
 */
async function performBooking(data) {
    console.log('Performing booking with data:', data);
    
    // TODO: Implement actual booking logic based on ABA website structure
    // This is a placeholder implementation that needs to be customized
    // for the specific ABA booking system
    
    try {
        // Send message to injected page script to perform booking
        const result = await sendMessageToPageScript({
            action: 'performBooking',
            data: data
        });
        
        return result;
        
    } catch (error) {
        // Fallback: try direct DOM manipulation
        return await performBookingDirect(data);
    }
}

/**
 * Perform booking using direct DOM manipulation
 * @param {Object} data - Booking data
 * @returns {Object} Result object
 */
async function performBookingDirect(data) {
    console.log('Performing direct booking...');
    
    // TODO: Add specific selectors and logic for ABA booking system
    // This is a template that needs to be customized
    
    const bookingForm = document.querySelector('form[class*="book"], form[id*="book"]');
    
    if (!bookingForm) {
        throw new Error('Booking form not found');
    }
    
    // Find date/time inputs
    const dateInput = bookingForm.querySelector('input[type="date"], input[type="datetime-local"]');
    const timeInput = bookingForm.querySelector('input[type="time"]');
    
    if (dateInput) {
        const bookingDate = new Date(data.datetime);
        
        if (dateInput.type === 'datetime-local') {
            dateInput.value = data.datetime;
        } else {
            dateInput.value = bookingDate.toISOString().split('T')[0];
        }
        
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    if (timeInput) {
        const bookingDate = new Date(data.datetime);
        const timeString = bookingDate.toTimeString().slice(0, 5);
        timeInput.value = timeString;
        timeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Find and click booking button
    const bookButton = bookingForm.querySelector('button[type="submit"], input[type="submit"]');
    
    if (bookButton) {
        bookButton.click();
        
        // Wait for booking to process
        await delay(3000);
        
        // TODO: Check for success/error messages
        return {
            success: true,
            message: 'Booking submitted successfully'
        };
    } else {
        throw new Error('Booking button not found');
    }
}

/**
 * Inject page script for direct access to page context
 */
function injectPageScript() {
    if (isInjected) return;
    
    const script = document.createElement('script');
    script.textContent = `
        // Injected page script for AKL Badminton Booker
        console.log('AKL Badminton Booker page script injected');
        
        // Listen for messages from content script
        window.addEventListener('message', function(event) {
            if (event.source !== window || !event.data.from) return;
            
            if (event.data.from === 'content-script') {
                handleContentScriptMessage(event.data);
            }
        });
        
        function handleContentScriptMessage(message) {
            console.log('Page script received message:', message);
            
            try {
                switch (message.action) {
                    case 'performBooking':
                        performBookingInPageContext(message.data);
                        break;
                    default:
                        console.warn('Unknown page script action:', message.action);
                }
            } catch (error) {
                console.error('Page script error:', error);
                window.postMessage({
                    from: 'page-script',
                    id: message.id,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
        
        function performBookingInPageContext(data) {
            // TODO: Implement page-specific booking logic here
            // This runs in the page context and has access to all page variables
            
            console.log('Performing booking in page context:', data);
            
            // Placeholder implementation
            window.postMessage({
                from: 'page-script',
                id: data.id,
                success: true,
                message: 'Booking performed in page context'
            }, '*');
        }
    `;
    
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    isInjected = true;
}

/**
 * Set up postMessage bridge for communication with injected script
 */
function setupPostMessageBridge() {
    window.addEventListener('message', function(event) {
        if (event.source !== window || !event.data.from) return;
        
        if (event.data.from === 'page-script') {
            handlePageScriptMessage(event.data);
        }
    });
}

/**
 * Handle messages from injected page script
 * @param {Object} message - Message from page script
 */
function handlePageScriptMessage(message) {
    console.log('Content script received page script message:', message);
    
    // TODO: Handle responses from page script
    // Store or forward responses as needed
}

/**
 * Send message to injected page script
 * @param {Object} message - Message to send
 * @returns {Promise} Promise that resolves with response
 */
function sendMessageToPageScript(message) {
    return new Promise((resolve, reject) => {
        const messageId = generateMessageId();
        message.id = messageId;
        
        // Set up listener for response
        const responseHandler = (event) => {
            if (event.source !== window || 
                !event.data.from || 
                event.data.from !== 'page-script' ||
                event.data.id !== messageId) {
                return;
            }
            
            window.removeEventListener('message', responseHandler);
            
            if (event.data.success) {
                resolve(event.data);
            } else {
                reject(new Error(event.data.error || 'Page script error'));
            }
        };
        
        window.addEventListener('message', responseHandler);
        
        // Send message to page script
        window.postMessage({
            from: 'content-script',
            ...message
        }, '*');
        
        // Set timeout
        setTimeout(() => {
            window.removeEventListener('message', responseHandler);
            reject(new Error('Page script response timeout'));
        }, CONFIG.REQUEST_TIMEOUT);
    });
}

/**
 * Detect booking forms and opportunities on the page
 */
function detectBookingForms() {
    // TODO: Add logic to automatically detect when booking opportunities are available
    // This could watch for specific elements, changes in availability, etc.
    
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            // Check for new booking-related elements
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        checkForBookingOpportunities(node);
                    }
                });
            }
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

/**
 * Check for booking opportunities in a DOM node
 * @param {Element} node - DOM node to check
 */
function checkForBookingOpportunities(node) {
    // TODO: Implement detection logic for booking opportunities
    // Look for availability indicators, booking buttons, etc.
    
    const bookingElements = node.querySelectorAll('[class*="book"], [id*="book"], [class*="available"]');
    
    if (bookingElements.length > 0) {
        console.log('Booking opportunities detected:', bookingElements.length);
        
        // TODO: Notify background script of opportunities
        chrome.runtime.sendMessage({
            action: 'bookingOpportunityDetected',
            data: {
                count: bookingElements.length,
                url: window.location.href
            }
        });
    }
}

/**
 * Utility functions
 */

/**
 * Generate unique message ID
 * @returns {string} Unique ID
 */
function generateMessageId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Delay execution for specified time
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after delay
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make HTTP request with credentials
 * @param {string} url - Request URL
 * @param {Object} options - Request options
 * @returns {Promise} Promise that resolves with response
 */
async function fetchWithCredentials(url, options = {}) {
    const defaultOptions = {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };
    
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response;
}

/**
 * TODO: Add functionality for:
 * - More sophisticated form detection and interaction
 * - Better error handling and recovery
 * - Court preference selection
 * - Time slot optimization
 * - Captcha handling (if needed)
 * - Multi-step booking process support
 * - Integration with ABA's specific API endpoints
 * - Better success/failure detection
 * - Screenshot capture for debugging
 * - Booking confirmation extraction
 */