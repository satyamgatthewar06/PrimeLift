require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// ---- Middleware ----
// ---- Middleware ----
app.use((req, res, next) => {
    const origin = req.headers.origin;

    // Log every request for debugging
    console.log(`${new Date().toISOString()} [${req.method}] ${req.url} - Origin: ${origin}`);

    // Reflect any origin with credentials to definitively solve CORS issues
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }

    // Comprehensive list of methods and headers
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Accept, Origin, Token, x-requested-with');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    res.setHeader('Vary', 'Origin');

    // Early exit for preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Serve Frontend Static Files ----
app.use(express.static(path.join(__dirname, '../frontend')));

// ---- API Routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/admin', require('./routes/admin'));

// ---- Health Check ----
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: '🚗 PrimeLift API is running!',
        version: '1.0.3-cors-fix',
        time: new Date()
    });
});

// ---- Catch-all: serve frontend ----
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ---- Start Server ----
const PORT = process.env.PORT || 5000;
const initDatabase = require('./config/initdb');

// Listen immediately to prevent 502 errors on Railway/Netlify
app.listen(PORT, () => {
    console.log(`🚗 ================================`);
    console.log(`   RideBooking Server Running`);
    console.log(`   Internal Port: ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`🚗 ================================\n`);

    // Run DB initialization in background
    initDatabase()
        .then(() => console.log('✅ Database initialized successfully'))
        .catch(err => console.error('❌ Database initialization failed:', err.message));
});
