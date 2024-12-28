const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const OTP_FILE = path.join(__dirname, 'otpStorage.json');

// Initialize OTP storage file if not exists
if (!fs.existsSync(OTP_FILE)) {
    fs.writeFileSync(OTP_FILE, JSON.stringify([]));
}


// WhatsApp client setup with Puppeteer args to disable sandbox
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './data/.wa-data' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Optional: Useful in limited memory environments
            '--disable-extensions',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-software-rasterizer',
            '--no-default-browser-check',
            '--no-pings',
            '--disable-background-networking',
            '--safebrowsing-disable-auto-update'
        ]
    }
});

let latestQR = '';
// QR event handler
client.on('qr', (qr) => {
    console.log('QR RECEIVED, visit /qr to scan it with WhatsApp.');
    QRCode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Failed to generate QR code', err);
            return;
        }
        latestQR = url;
    });
});

// Ready event handler
client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    latestQR = ''; // Clear QR code once ready
});

client.initialize();

// OTP Templates
const templates = {
    default: "Your OTP is: {{otp}}. It will expire in {{expiry}} minutes. Powered by {{company}}.",
    login: "Welcome, {{name}}! Your login OTP is: {{otp}}. Use this to access your account. Powered by {{company}}.",
    verification: "Hi {{name}}, please verify your action using OTP: {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    transaction: "Dear {{name}}, to complete your transaction of {{amount}}, use OTP: {{otp}}. Expires in {{expiry}} minutes. Powered by {{company}}.",
    registration: "Thank you for registering, {{name}}! Your OTP is {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    resetPassword: "Hi {{name}}, use OTP {{otp}} to reset your password. This OTP will expire in {{expiry}} minutes. Powered by {{company}}.",
    updateDetails: "To update your details, use OTP: {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    bookingConfirmation: "Hi {{name}}, your booking for {{service}} is confirmed. Use OTP {{otp}} to view details. Powered by {{company}}.",
    delivery: "Your delivery for {{item}} is scheduled. Use OTP: {{otp}} to confirm receipt. Powered by {{company}}.",
    feedback: "We value your feedback, {{name}}! Use OTP {{otp}} to access the feedback form. Powered by {{company}}.",
    payment: "Payment of {{amount}} is requested. Use OTP {{otp}} to authorize. Expires in {{expiry}} minutes. Powered by {{company}}.",
    addressUpdate: "To update your address, {{name}}, use OTP {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    emailVerification: "Hi {{name}}, use OTP {{otp}} to verify your email address. Powered by {{company}}.",
    phoneVerification: "Hi {{name}}, use OTP {{otp}} to verify your phone number. Powered by {{company}}.",
    accountUnlock: "Hi {{name}}, use OTP {{otp}} to unlock your account. Valid for {{expiry}} minutes. Powered by {{company}}.",
    subscription: "Hi {{name}}, your subscription to {{plan}} is activated. Use OTP {{otp}} for confirmation. Powered by {{company}}.",
    withdrawal: "Your withdrawal request of {{amount}} is processing. Use OTP {{otp}} to confirm. Powered by {{company}}.",
    balanceCheck: "Hi {{name}}, check your balance with OTP {{otp}}. Expires in {{expiry}} minutes. Powered by {{company}}.",
    fundTransfer: "To transfer {{amount}} to {{recipient}}, use OTP {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    loyalty: "Redeem your {{points}} loyalty points with OTP {{otp}}. Powered by {{company}}.",
    locationAccess: "Access your location data using OTP {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    cancelService: "To cancel your {{service}} request, use OTP {{otp}}. Expires in {{expiry}} minutes. Powered by {{company}}.",
    appointment: "Your appointment on {{date}} at {{time}} is scheduled. Use OTP {{otp}} to confirm. Powered by {{company}}.",
    giftCard: "Redeem your {{value}} gift card using OTP {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    profileUpdate: "Hi {{name}}, update your profile using OTP {{otp}}. Powered by {{company}}.",
    support: "Hi {{name}}, access support with OTP {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    gaming: "Welcome to {{game}}! Use OTP {{otp}} to start your adventure. Powered by {{company}}.",
    education: "Hi {{name}}, access your course material using OTP {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}.",
    event: "Your registration for {{event}} is confirmed. Use OTP {{otp}} to check details. Powered by {{company}}.",
    custom: "{{message}} Use OTP: {{otp}}. Valid for {{expiry}} minutes. Powered by {{company}}."
};

// Utility Functions
const loadStorage = () => JSON.parse(fs.readFileSync(OTP_FILE, 'utf8'));
const saveStorage = (data) => fs.writeFileSync(OTP_FILE, JSON.stringify(data, null, 2));
const generateOTP = (length = 6) => {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
};
const removeExpiredOTPs = (storage) => {
    const now = Date.now();
    return storage.filter((entry) => entry.expiryTime > now);
};
const removeOldOTPForNumber = (storage, phoneNumber) =>
    storage.filter((entry) => entry.phoneNumber !== phoneNumber);

// Generate dynamic message with placeholders
const generateMessage = (templateKey, otp, expiry, company = "Your Company", customData = {}) => {
    let template = templates[templateKey] || templates.default;

    // Replace standard placeholders with bold formatting
    template = template
        .replace("{{otp}}", `*${otp}*`)
        .replace("{{expiry}}", `*${expiry}*`)
        .replace("{{company}}", `*${company}*`);

    // Replace custom placeholders with bold formatting
    for (const [key, value] of Object.entries(customData)) {
        template = template.replace(`{{${key}}}`, value ? `*${value}*` : '');
    }

    return template;
};

// Send OTP Endpoint
app.get('/send-otp', async (req, res) => {
    const { phone, length, expiry, template, company, image, ...customData } = req.query;

    if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    if (image && !/^https?:\/\/.+\.(jpg|jpeg|png|gif)$/i.test(image)) {
        return res.status(400).json({ error: 'Invalid image URL. Only valid HTTP URLs for images are supported (jpg, jpeg, png, gif).' });
    }

    try {
        const otp = generateOTP(Number(length) || 6); // Generate OTP
        const otpExpiry = Number(expiry) || 5; // Expiry in minutes
        const message = generateMessage(template || 'default', otp, otpExpiry, company || "Your Company", customData);

        let storage = loadStorage();

        // Remove old OTP for the phone number
        storage = removeOldOTPForNumber(storage, phone);

        // Add to storage
        const expiryTime = Date.now() + otpExpiry * 60 * 1000;
        if (storage.length >= 10) {
            storage.shift(); // Remove the oldest entry if limit exceeded
        }
        storage.push({ phoneNumber: phone, otp, expiryTime });
        saveStorage(storage);

        // Send OTP via WhatsApp
        if (image) {

            let m = await MessageMedia.fromUrl(image)
            // Send a message with an image
            await client.sendMessage(`${phone}@c.us`,m,{ caption: message });
            console.log(`OTP with image sent to ${phone}`);
        } else {
            // Send a text-only message
            await client.sendMessage(`${phone}@c.us`, message);
            console.log(`OTP sent to ${phone} with template "${template || 'default'}"`);
        }

        res.json({ success: true, message: 'OTP sent successfully!', otp });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send OTP', details: err.message });
    }
});

app.get('/qr', (req, res) => {
    if (latestQR) {
        res.send(`
            <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <style>
                        body {
                            display: flex;
                            flex-direction: column;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            background-color: #f0f0f0;
                            font-family: Arial, sans-serif;
                        }
                        img {
                            width: 300px;
                            height: 300px;
                        }
                        p {
                            margin-top: 20px;
                            font-size: 18px;
                        }
                    </style>
                </head>
                <body>
                    <img src="${latestQR}" alt="QR Code" />
                    <p>Scan this QR code with your WhatsApp to log in.</p>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <head>
                    <title>WhatsApp QR Code</title>
                </head>
                <body style="display:flex; justify-content:center; align-items:center; height:100vh;">
                    <p>QR Code not available or already scanned.</p>
                </body>
            </html>
        `);
    }
});

// Verify OTP Endpoint
app.get('/verify-otp', (req, res) => {
    const { phone, otp } = req.query;

    if (!phone || !otp) {
        return res.status(400).json({ error: 'Phone and OTP are required' });
    }

    let storage = loadStorage();
    storage = removeExpiredOTPs(storage);

    const otpEntry = storage.find(
        (entry) => entry.phoneNumber === phone && entry.otp === otp
    );

    if (otpEntry) {
        // Remove OTP after verification
        storage = removeOldOTPForNumber(storage, phone);
        saveStorage(storage);

        return res.json({ success: true, message: 'OTP verified successfully!' });
    }

    res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
});

// Active OTPs (Debugging)
app.get('/active-otps', (req, res) => {
    const storage = removeExpiredOTPs(loadStorage());
    res.json({ success: true, otps: storage });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
