const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/auth');

// GET /api/admin/stats
router.get('/stats', auth('admin'), async (req, res) => {
    try {
        const [[{ totalUsers }]] = await db.query(`SELECT COUNT(*) AS totalUsers FROM users WHERE role != 'admin'`);
        const [[{ totalDrivers }]] = await db.query(`SELECT COUNT(*) AS totalDrivers FROM drivers`);
        const [[{ totalRides }]] = await db.query(`SELECT COUNT(*) AS totalRides FROM rides`);
        const [[{ totalRevenue }]] = await db.query(`SELECT IFNULL(SUM(fare),0) AS totalRevenue FROM rides WHERE status='completed'`);
        const [[{ todayRides }]] = await db.query(`SELECT COUNT(*) AS todayRides FROM rides WHERE DATE(created_at)=CURDATE()`);
        const [[{ activeRides }]] = await db.query(`SELECT COUNT(*) AS activeRides FROM rides WHERE status IN ('requested','accepted','ongoing')`);
        const [[{ availDrivers }]] = await db.query(`SELECT COUNT(*) AS availDrivers FROM drivers WHERE status='available'`);
        const [[{ pendingKyc }]] = await db.query(`SELECT COUNT(*) AS pendingKyc FROM drivers WHERE kyc_status='pending'`);

        const [dailyRides] = await db.query(
            `SELECT DATE(created_at) AS date, COUNT(*) AS count, IFNULL(SUM(fare),0) AS revenue
       FROM rides WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`
        );

        const [vehicleBreakdown] = await db.query(
            `SELECT vehicle_type, COUNT(*) AS count FROM rides GROUP BY vehicle_type`
        );

        res.json({
            success: true,
            stats: { totalUsers, totalDrivers, totalRides, totalRevenue, todayRides, activeRides, availDrivers, pendingKyc },
            dailyRides,
            vehicleBreakdown
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/admin/users
router.get('/users', auth('admin'), async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.created_at,
              d.vehicle_type, d.vehicle_no, d.rating, d.total_rides, d.total_earnings, d.status AS driver_status,
              d.kyc_status, d.is_verified, d.id AS driver_id
       FROM users u
       LEFT JOIN drivers d ON d.user_id = u.id
       WHERE u.role != 'admin'
       ORDER BY u.created_at DESC`
        );
        res.json({ success: true, users });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/admin/rides
router.get('/rides', auth('admin'), async (req, res) => {
    try {
        const [rides] = await db.query(
            `SELECT r.*, rider.name AS rider_name, driver_u.name AS driver_name,
              d.vehicle_no, d.vehicle_type AS driver_vehicle
       FROM rides r
       JOIN users rider ON r.rider_id = rider.id
       LEFT JOIN drivers d ON r.driver_id = d.id
       LEFT JOIN users driver_u ON d.user_id = driver_u.id
       ORDER BY r.created_at DESC LIMIT 100`
        );
        res.json({ success: true, rides });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/admin/users/:id/status
router.put('/users/:id/status', auth('admin'), async (req, res) => {
    try {
        const { is_active } = req.body;
        await db.query(`UPDATE users SET is_active = ? WHERE id = ?`, [is_active ? 1 : 0, req.params.id]);
        res.json({ success: true, message: `User ${is_active ? 'enabled' : 'disabled'}.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// KYC MANAGEMENT
// ============================================================

// GET /api/admin/kyc-pending — List drivers with pending KYC
router.get('/kyc-pending', auth('admin'), async (req, res) => {
    try {
        const [drivers] = await db.query(
            `SELECT d.id AS driver_id, u.id AS user_id, u.name, u.email, u.phone,
                    d.vehicle_type, d.vehicle_no, d.vehicle_model, d.kyc_status, d.is_verified,
                    u.created_at AS driver_since
             FROM drivers d JOIN users u ON d.user_id = u.id
             WHERE d.kyc_status IN ('pending', 'not_submitted')
             ORDER BY d.kyc_status DESC, u.created_at ASC`
        );

        // Get KYC docs for each driver
        for (const driver of drivers) {
            const [kycDocs] = await db.query(
                'SELECT id, doc_type, doc_number, doc_front, doc_back, status, admin_remarks, created_at FROM driver_kyc WHERE driver_id = ?',
                [driver.driver_id]
            );
            const [vehDocs] = await db.query(
                'SELECT id, doc_type, doc_number, doc_file, expiry_date, status, admin_remarks FROM vehicle_documents WHERE driver_id = ?',
                [driver.driver_id]
            );
            driver.kyc_documents = kycDocs;
            driver.vehicle_documents = vehDocs;
        }

        res.json({ success: true, drivers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/admin/kyc/:driverId/approve
router.put('/kyc/:driverId/approve', auth('admin'), async (req, res) => {
    try {
        const driverId = req.params.driverId;

        // Approve all pending KYC docs
        await db.query(
            `UPDATE driver_kyc SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE driver_id = ? AND status = 'pending'`,
            [req.user.id, driverId]
        );
        await db.query(
            `UPDATE vehicle_documents SET status = 'approved', reviewed_at = NOW() WHERE driver_id = ? AND status = 'pending'`,
            [driverId]
        );

        // Update driver verification status
        await db.query(
            `UPDATE drivers SET kyc_status = 'approved', is_verified = 1 WHERE id = ?`,
            [driverId]
        );

        // Notify driver
        const [drows] = await db.query('SELECT user_id FROM drivers WHERE id = ?', [driverId]);
        if (drows.length > 0) {
            await db.query(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)',
                [drows[0].user_id, '✅ Profile Verified!', 'Your KYC documents have been approved. You can now go online and accept rides!', 'system']
            );
        }

        res.json({ success: true, message: 'Driver KYC approved and verified!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/admin/kyc/:driverId/reject
router.put('/kyc/:driverId/reject', auth('admin'), async (req, res) => {
    try {
        const driverId = req.params.driverId;
        const { reason } = req.body;

        await db.query(
            `UPDATE driver_kyc SET status = 'rejected', admin_remarks = ?, reviewed_by = ?, reviewed_at = NOW() WHERE driver_id = ? AND status = 'pending'`,
            [reason || 'Documents not clear. Please re-upload.', req.user.id, driverId]
        );
        await db.query(
            `UPDATE vehicle_documents SET status = 'rejected', admin_remarks = ? WHERE driver_id = ? AND status = 'pending'`,
            [reason || 'Documents not clear.', driverId]
        );

        await db.query(
            `UPDATE drivers SET kyc_status = 'rejected', is_verified = 0 WHERE id = ?`,
            [driverId]
        );

        const [drows] = await db.query('SELECT user_id FROM drivers WHERE id = ?', [driverId]);
        if (drows.length > 0) {
            await db.query(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)',
                [drows[0].user_id, '❌ KYC Rejected', `Your KYC was rejected. Reason: ${reason || 'Documents not clear'}. Please re-upload.`, 'system']
            );
        }

        res.json({ success: true, message: 'Driver KYC rejected.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// SETTLEMENTS
// ============================================================

// POST /api/admin/settlements/process — Process weekly settlements for all drivers
router.post('/settlements/process', auth('admin'), async (req, res) => {
    try {
        const platformRate = 0.20;
        const periodEnd = new Date().toISOString().split('T')[0];
        const periodStart = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

        const [drivers] = await db.query(`SELECT id FROM drivers`);
        let processed = 0;

        for (const driver of drivers) {
            // Check if settlement already exists for this period
            const [existing] = await db.query(
                `SELECT id FROM driver_settlements WHERE driver_id = ? AND period_start = ? AND period_end = ?`,
                [driver.id, periodStart, periodEnd]
            );
            if (existing.length > 0) continue;

            const [earnings] = await db.query(
                `SELECT COUNT(*) as rides, IFNULL(SUM(fare),0) as gross
                 FROM rides WHERE driver_id = ? AND completed_at BETWEEN ? AND ? AND status = 'completed'`,
                [driver.id, periodStart, periodEnd]
            );

            if (earnings[0].rides === 0) continue;

            const gross = parseFloat(earnings[0].gross);
            const platformFee = Math.round(gross * platformRate);

            // Get incentive bonuses
            const [incentives] = await db.query(
                `SELECT IFNULL(SUM(amount),0) as bonus FROM driver_incentives
                 WHERE driver_id = ? AND is_claimed = 1 AND valid_from >= ? AND valid_until <= ?`,
                [driver.id, periodStart, periodEnd]
            );
            const bonus = parseFloat(incentives[0].bonus);
            const net = gross - platformFee + bonus;

            await db.query(
                `INSERT INTO driver_settlements (driver_id, period_start, period_end, total_rides, gross_earnings, platform_fee, incentive_bonus, net_payout, status)
                 VALUES (?,?,?,?,?,?,?,?,'paid')`,
                [driver.id, periodStart, periodEnd, earnings[0].rides, gross, platformFee, bonus, net]
            );
            processed++;
        }

        res.json({ success: true, message: `Settlements processed for ${processed} drivers.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
