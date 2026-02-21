require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// ---- Middleware ----
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
        'https://primelift-app.netlify.app',
        'http://localhost:5500',
        'http://localhost:5000',
        'http://127.0.0.1:5500',
        'http://localhost:3000'
    ];

    console.log(`${new Date().toISOString()} [${req.method}] ${req.url} - Origin: ${origin}`);

    // If matches specific list or ends with .netlify.app
    if (origin && (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app') || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (origin) {
        // Fallback for debug if needed
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    res.header('Vary', 'Origin');

    // Handle preflight
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
