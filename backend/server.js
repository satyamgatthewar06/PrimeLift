require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// ---- Middleware ----
// Allow specific origins but reflect them in the header to support credentials
const allowedOrigins = [
    'https://primelift-app.netlify.app',
    'http://localhost:5500',
    'http://localhost:5000',
    'http://127.0.0.1:5500'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.netlify.app')) {
            callback(null, true);
        } else {
            // Instead of an error, just send false to deny CORS without crashing
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
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
