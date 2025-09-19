# 🏸 AKL Badminton Booker

A beginner-friendly Chrome extension to solve Auckland Badminton players' biggest issue: Getting a court at ABA (Auckland Badminton Association)!

## 📖 Overview

This Chrome extension automates the process of booking badminton courts at Auckland Badminton Association, making it easier for players to secure their preferred playing times. The extension runs in the background and can automatically attempt to book courts at scheduled times.

## ✨ Features

- **Easy Booking**: Simple popup interface for quick court booking
- **Scheduled Booking**: Set up automatic booking attempts at specific times
- **Smart Retry**: Automatically retries failed booking attempts up to 3 times
- **Notifications**: Get notified when bookings succeed or fail
- **Tab Detection**: Automatically detects when you're on the ABA website
- **Credential Storage**: Optionally save login credentials for automatic login
- **Test Mode**: Test your connection and settings before scheduling

## 🚀 Installation

### Method 1: Load as Unpacked Extension (Development)

1. Download or clone this repository to your local machine
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" by toggling the switch in the top right
4. Click "Load unpacked" button
5. Select the folder containing the extension files
6. The extension should now appear in your extensions list

### Method 2: From Chrome Web Store (Coming Soon)

*This extension will be available on the Chrome Web Store once reviewed and approved.*

## 🎯 How to Use

### Basic Usage

1. **Navigate to ABA Website**: Go to [aucklandbadminton.co.nz](https://aucklandbadminton.co.nz)
2. **Open Extension**: Click the extension icon in your Chrome toolbar
3. **Fill Details**: 
   - Email and password (optional, for automatic login)
   - Select your preferred date and time
4. **Test Connection**: Click "Test" to verify everything works
5. **Schedule Booking**: Click "Schedule" to set up automatic booking

### Advanced Features

- **Clear Data**: Use the "Clear" button to remove all saved data and scheduled bookings
- **Background Operation**: The extension works in the background, no need to keep the popup open
- **Multiple Attempts**: The extension will automatically retry failed bookings

## 🛠️ Technical Details

### Architecture

- **Manifest V3**: Uses the latest Chrome extension standards
- **Service Worker**: Background script handles scheduling and automation
- **Content Script**: Interacts with the ABA website
- **Popup Interface**: User-friendly booking interface

### File Structure

```
akl-badminton-booker/
├── manifest.json          # Extension configuration
├── popup.html             # Popup interface
├── popup.js               # Popup logic
├── background.js          # Background service worker
├── content.js             # Content script for ABA website
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── README.md              # This file
├── LICENSE                # MIT License
└── .gitignore            # Git ignore rules
```

### Permissions Required

- `storage`: Save user preferences and booking data
- `alarms`: Schedule automatic booking attempts
- `notifications`: Show booking status notifications
- `tabs`: Detect ABA website tabs
- `activeTab`: Interact with the current tab
- `host_permissions`: Access to aucklandbadminton.co.nz

## 🔧 Development

### Prerequisites

- Chrome browser (version 88 or higher)
- Basic understanding of JavaScript, HTML, and CSS
- Text editor or IDE

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/FuRankLy/Bookminton.git
   cd Bookminton
   ```

2. Load the extension in Chrome (see Installation section)

3. Make changes to the code

4. Reload the extension in `chrome://extensions/` to see changes

### Key Components

#### popup.js
- Handles user interactions in the popup
- Saves and loads user preferences
- Communicates with background script

#### background.js
- Service worker that runs in the background
- Handles alarms and scheduled bookings
- Manages notifications and tab detection

#### content.js
- Injected into ABA website pages
- Performs actual booking operations
- Handles retry logic and error recovery

## 🐛 Troubleshooting

### Common Issues

**Extension not loading:**
- Make sure Developer mode is enabled
- Check for any console errors in the extension details page
- Verify all files are present

**Booking not working:**
- Ensure you're on the correct ABA website
- Check that your credentials are correct
- Verify the booking form hasn't changed structure

**Notifications not showing:**
- Check Chrome notification permissions
- Ensure notifications are enabled for the extension

### Debug Mode

1. Open Chrome DevTools
2. Go to the Console tab
3. Look for messages from "AKL Badminton Booker"
4. Check for any error messages or warnings

## 📝 TODO List

### High Priority
- [ ] Implement specific ABA website form detection
- [ ] Add court preference selection
- [ ] Improve error handling and user feedback
- [ ] Add booking confirmation extraction

### Medium Priority
- [ ] Multiple booking slot support
- [ ] Recurring booking schedules
- [ ] Export/import booking data
- [ ] Settings page for advanced options

### Low Priority
- [ ] Integration with calendar apps
- [ ] Booking history and analytics
- [ ] Group booking coordination
- [ ] Smart booking suggestions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This extension is not officially affiliated with Auckland Badminton Association. Use responsibly and in accordance with ABA's terms of service. The developers are not responsible for any booking conflicts or issues that may arise from using this extension.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the troubleshooting section above
2. Search existing GitHub issues
3. Create a new issue with detailed information about the problem

## 🙏 Acknowledgments

- Auckland Badminton Association for providing the booking platform
- Chrome extension development community for resources and examples
- All contributors and users who help improve this extension

---

**Happy Badminton Playing! 🏸**
