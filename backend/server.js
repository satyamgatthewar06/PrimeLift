require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// ---- Middleware ----
app.use(cors({
    origin: '*', // Allow all for now to ensure it works, then we can restrict if needed
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.options('*', cors()); // Enable pre-flight for all routes
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
    res.json({ success: true, message: '🚗 RideBooking API is running!', time: new Date() });
});

// ---- Catch-all: serve frontend ----
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ---- Start Server ----
const PORT = process.env.PORT || 5000;
const initDatabase = require('./config/initdb');

initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚗 ================================`);
        console.log(`   RideBooking Server Running`);
        console.log(`   http://localhost:${PORT}`);
        console.log(`🚗 ================================\n`);
    });
}).catch(err => {
    console.error('❌ Database setup failed:', err.message);
    process.exit(1);
});
