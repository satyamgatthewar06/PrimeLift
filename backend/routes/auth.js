const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('../config/db');
const auth = require('../middleware/auth');

// Store OTPs in memory (use Redis in production)
const otpStore = {};

// Gmail SMTP transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

async function sendOtpEmail(toEmail, otp) {
    await transporter.sendMail({
        from: `"PrimeLift" <${process.env.GMAIL_USER}>`,
        to: toEmail,
        subject: '🚗 Your PrimeLift OTP Code',
        html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0f172a;color:#fff;border-radius:16px;padding:32px;">
        <h2 style="color:#6366f1;margin:0 0 8px">🚗 PrimeLift</h2>
        <p style="color:#94a3b8;margin:0 0 24px">Your One-Time Password</p>
        <div style="background:#1e293b;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#6366f1">${otp}</span>
        </div>
        <p style="color:#94a3b8;font-size:13px;">This OTP is valid for <strong style="color:#fff">5 minutes</strong>. Do not share it with anyone.</p>
        <hr style="border-color:#1e293b;margin:24px 0">
        <p style="color:#475569;font-size:12px;text-align:center">© ${new Date().getFullYear()} PrimeLift — Ride Smart</p>
      </div>
    `
    });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, phone, role, vehicle_type, vehicle_no, vehicle_model, gender } = req.body;

        if (!name || !email || !password || !phone) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Email already registered.' });
        }

        // Check phone uniqueness
        const [phoneCheck] = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
        if (phoneCheck.length > 0) {
            return res.status(409).json({ success: false, message: 'Phone number already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userRole = role || 'rider';

        const [result] = await db.query(
            'INSERT INTO users (name, email, password, phone, role, gender) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, hashedPassword, phone, userRole, gender || '']
        );

        const userId = result.insertId;

        if (userRole === 'driver') {
            if (!vehicle_type || !vehicle_no) {
                return res.status(400).json({ success: false, message: 'Vehicle details required for driver.' });
            }
            await db.query(
                'INSERT INTO drivers (user_id, vehicle_type, vehicle_no, vehicle_model) VALUES (?, ?, ?, ?)',
                [userId, vehicle_type, vehicle_no, vehicle_model || '']
            );
        }

        const token = jwt.sign(
            { id: userId, name, email, role: userRole },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        // Create welcome notification
        await db.query(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
            [userId, 'Welcome to PrimeLift! 🚗', 'Your account has been created successfully. Start booking rides now!', 'system']
        );

        res.status(201).json({
            success: true, message: 'Registration successful!', token,
            user: { id: userId, name, email, phone, role: userRole, gender: gender || '' }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// POST /api/auth/login (email + password)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const user = users[0];
        if (!user.is_active) {
            return res.status(403).json({ success: false, message: 'Account disabled. Contact admin.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const token = jwt.sign(
            { id: user.id, name: user.name, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        let driverInfo = null;
        if (user.role === 'driver') {
            const [drows] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [user.id]);
            if (drows.length > 0) driverInfo = drows[0];
        }

        res.json({
            success: true, message: 'Login successful!', token,
            user: {
                id: user.id, name: user.name, email: user.email,
                phone: user.phone, role: user.role, gender: user.gender,
                profile_photo: user.profile_photo, driver: driverInfo
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// POST /api/auth/send-otp  (email OTP login — free via Gmail)
router.post('/send-otp', async (req, res) => {
    try {
        const { phone, email } = req.body;

        // Accept either phone number or email
        let targetEmail = email;
        if (!targetEmail && phone) {
            // Look up the registered email for this phone number
            const [users] = await db.query('SELECT email FROM users WHERE phone = ?', [phone]);
            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'No account found with this phone. Please register first.' });
            }
            targetEmail = users[0].email;
        }

        if (!targetEmail) {
            return res.status(400).json({ success: false, message: 'Email or phone number is required.' });
        }

        // Generate 6-digit OTP
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const key = phone || targetEmail;
        otpStore[key] = { otp, email: targetEmail, expires: Date.now() + 5 * 60 * 1000 };

        // Send real OTP email via Gmail (free)
        await sendOtpEmail(targetEmail, otp);
        console.log(`📧 OTP sent to ${targetEmail}`);

        res.json({
            success: true,
            message: `OTP sent to your email (${targetEmail.replace(/(.{2}).+(@.+)/, '$1***$2')})!`
        });

    } catch (err) {
        console.error('OTP send error:', err);
        res.status(500).json({ success: false, message: 'Failed to send OTP. Check email config.' });
    }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, email, otp } = req.body;
        const key = phone || email;
        if (!key || !otp) {
            return res.status(400).json({ success: false, message: 'Phone/email and OTP required.' });
        }

        const stored = otpStore[key];
        if (!stored || stored.otp !== otp) {
            return res.status(401).json({ success: false, message: 'Invalid OTP. Please try again.' });
        }
        if (Date.now() > stored.expires) {
            delete otpStore[key];
            return res.status(401).json({ success: false, message: 'OTP expired. Request a new one.' });
        }

        delete otpStore[key]; // clear used OTP

        // Find user by phone or email
        const lookupField = phone ? 'phone' : 'email';
        const lookupValue = phone || email;
        let [users] = await db.query(`SELECT * FROM users WHERE ${lookupField} = ?`, [lookupValue]);
        let user;

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'No account found. Please register first.' });
        } else {
            user = users[0];
            if (!user.is_active) {
                return res.status(403).json({ success: false, message: 'Account disabled. Contact support.' });
            }
        }

        const token = jwt.sign(
            { id: user.id, name: user.name, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        let driverInfo = null;
        if (user.role === 'driver') {
            const [drows] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [user.id]);
            if (drows.length > 0) driverInfo = drows[0];
        }

        res.json({
            success: true, message: 'Login successful!', token,
            user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, driver: driverInfo }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/auth/me
router.get('/me', auth(), async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT id, name, email, phone, role, gender, profile_photo, address, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        if (users.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });

        let driverInfo = null;
        if (users[0].role === 'driver') {
            const [drows] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [req.user.id]);
            if (drows.length > 0) driverInfo = drows[0];
        }

        // Get unread notification count
        const [notifCount] = await db.query(
            'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]
        );

        res.json({
            success: true,
            user: { ...users[0], driver: driverInfo },
            unread_notifications: notifCount[0].cnt
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/auth/profile (update profile)
router.put('/profile', auth(), async (req, res) => {
    try {
        const { name, email, phone, gender, address, profile_photo } = req.body;
        const updates = [];
        const vals = [];

        if (name) { updates.push('name = ?'); vals.push(name); }
        if (email) { updates.push('email = ?'); vals.push(email); }
        if (phone) { updates.push('phone = ?'); vals.push(phone); }
        if (gender) { updates.push('gender = ?'); vals.push(gender); }
        if (address !== undefined) { updates.push('address = ?'); vals.push(address); }
        if (profile_photo !== undefined) { updates.push('profile_photo = ?'); vals.push(profile_photo); }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        vals.push(req.user.id);
        await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, vals);

        const [users] = await db.query('SELECT id, name, email, phone, role, gender, profile_photo, address FROM users WHERE id = ?', [req.user.id]);

        res.json({ success: true, message: 'Profile updated!', user: users[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/auth/notifications
router.get('/notifications', auth(), async (req, res) => {
    try {
        const [notifs] = await db.query(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
            [req.user.id]
        );
        // Mark as read
        await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
        res.json({ success: true, notifications: notifs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
