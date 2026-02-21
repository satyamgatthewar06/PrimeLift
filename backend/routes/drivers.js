const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/auth');

// ============================================================
// KYC & DOCUMENT MANAGEMENT
// ============================================================

// POST /api/drivers/kyc/upload — Upload Aadhaar or Driving License
router.post('/kyc/upload', auth('driver'), async (req, res) => {
    try {
        const { doc_type, doc_number, doc_front, doc_back } = req.body;
        if (!doc_type || !doc_front) {
            return res.status(400).json({ success: false, message: 'Document type and front image required.' });
        }
        if (!['aadhaar', 'driving_license'].includes(doc_type)) {
            return res.status(400).json({ success: false, message: 'Invalid document type.' });
        }

        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.status(404).json({ success: false, message: 'Driver profile not found.' });
        const driverId = drows[0].id;

        // Check if document already exists
        const [existing] = await db.query(
            'SELECT id FROM driver_kyc WHERE driver_id = ? AND doc_type = ?', [driverId, doc_type]
        );

        if (existing.length > 0) {
            await db.query(
                `UPDATE driver_kyc SET doc_number = ?, doc_front = ?, doc_back = ?, status = 'pending', admin_remarks = NULL, reviewed_at = NULL WHERE id = ?`,
                [doc_number || '', doc_front, doc_back || '', existing[0].id]
            );
        } else {
            await db.query(
                `INSERT INTO driver_kyc (driver_id, doc_type, doc_number, doc_front, doc_back) VALUES (?,?,?,?,?)`,
                [driverId, doc_type, doc_number || '', doc_front, doc_back || '']
            );
        }

        // Update driver kyc_status to pending
        await db.query(`UPDATE drivers SET kyc_status = 'pending' WHERE id = ?`, [driverId]);

        res.json({ success: true, message: `${doc_type === 'aadhaar' ? 'Aadhaar' : 'Driving License'} uploaded successfully! Pending review.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/kyc/status — Get KYC status
router.get('/kyc/status', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id, kyc_status, is_verified FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.status(404).json({ success: false, message: 'Driver not found.' });
        const driverId = drows[0].id;

        const [docs] = await db.query(
            'SELECT id, doc_type, doc_number, status, admin_remarks, created_at, reviewed_at FROM driver_kyc WHERE driver_id = ? ORDER BY doc_type',
            [driverId]
        );

        const [vDocs] = await db.query(
            'SELECT id, doc_type, doc_number, expiry_date, status, admin_remarks, created_at FROM vehicle_documents WHERE driver_id = ? ORDER BY doc_type',
            [driverId]
        );

        res.json({
            success: true,
            kyc_status: drows[0].kyc_status,
            is_verified: drows[0].is_verified,
            kyc_documents: docs,
            vehicle_documents: vDocs
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// POST /api/drivers/vehicle-docs/upload — Upload vehicle documents
router.post('/vehicle-docs/upload', auth('driver'), async (req, res) => {
    try {
        const { doc_type, doc_number, doc_file, expiry_date } = req.body;
        if (!doc_type || !doc_file) {
            return res.status(400).json({ success: false, message: 'Document type and file required.' });
        }
        if (!['rc_book', 'insurance', 'permit', 'fitness_cert'].includes(doc_type)) {
            return res.status(400).json({ success: false, message: 'Invalid document type.' });
        }

        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.status(404).json({ success: false, message: 'Driver profile not found.' });
        const driverId = drows[0].id;

        const [existing] = await db.query(
            'SELECT id FROM vehicle_documents WHERE driver_id = ? AND doc_type = ?', [driverId, doc_type]
        );

        if (existing.length > 0) {
            await db.query(
                `UPDATE vehicle_documents SET doc_number = ?, doc_file = ?, expiry_date = ?, status = 'pending', admin_remarks = NULL WHERE id = ?`,
                [doc_number || '', doc_file, expiry_date || null, existing[0].id]
            );
        } else {
            await db.query(
                `INSERT INTO vehicle_documents (driver_id, doc_type, doc_number, doc_file, expiry_date) VALUES (?,?,?,?,?)`,
                [driverId, doc_type, doc_number || '', doc_file, expiry_date || null]
            );
        }

        res.json({ success: true, message: 'Vehicle document uploaded! Pending review.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/vehicle-docs
router.get('/vehicle-docs', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.status(404).json({ success: false, message: 'Driver not found.' });

        const [docs] = await db.query(
            'SELECT id, doc_type, doc_number, expiry_date, status, admin_remarks, created_at FROM vehicle_documents WHERE driver_id = ?',
            [drows[0].id]
        );
        res.json({ success: true, documents: docs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// AVAILABILITY & RIDE HANDLING
// ============================================================

// GET /api/drivers/available?vehicle_type=car
router.get('/available', async (req, res) => {
    try {
        const { vehicle_type } = req.query;
        let query = `SELECT d.id, u.name, u.phone, d.vehicle_type, d.vehicle_no, d.vehicle_model, d.rating, d.total_rides
                 FROM drivers d JOIN users u ON d.user_id = u.id
                 WHERE d.status = 'available' AND d.is_verified = 1`;
        const params = [];
        if (vehicle_type) { query += ' AND d.vehicle_type = ?'; params.push(vehicle_type); }
        query += ' ORDER BY d.rating DESC';

        const [drivers] = await db.query(query, params);
        res.json({ success: true, drivers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/incoming-rides — get unassigned ride requests matching driver's vehicle type
router.get('/incoming-rides', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id, vehicle_type, is_verified FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.json({ success: true, rides: [] });
        if (!drows[0].is_verified) return res.json({ success: true, rides: [], message: 'Profile not verified yet.' });

        const [rides] = await db.query(
            `SELECT r.*, u.name AS rider_name, u.phone AS rider_phone
             FROM rides r JOIN users u ON r.rider_id = u.id
             WHERE r.status = 'requested' AND r.driver_id IS NULL AND r.vehicle_type = ?
             ORDER BY r.created_at DESC LIMIT 10`,
            [drows[0].vehicle_type]
        );
        res.json({ success: true, rides });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/pending-ride  (driver checks for an active ride)
router.get('/pending-ride', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.json({ success: true, ride: null });

        const [rides] = await db.query(
            `SELECT r.*, u.name AS rider_name, u.phone AS rider_phone
       FROM rides r JOIN users u ON r.rider_id = u.id
       WHERE r.driver_id = ? AND r.status IN ('accepted','ongoing')
       ORDER BY r.created_at DESC LIMIT 1`,
            [drows[0].id]
        );
        res.json({ success: true, ride: rides[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/my-rides  (driver ride history)
router.get('/my-rides', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.json({ success: true, rides: [] });

        const [rides] = await db.query(
            `SELECT r.*, u.name AS rider_name
       FROM rides r JOIN users u ON r.rider_id = u.id
       WHERE r.driver_id = ? ORDER BY r.created_at DESC LIMIT 50`,
            [drows[0].id]
        );
        res.json({ success: true, rides });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/drivers/accept/:rideId
router.put('/accept/:rideId', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id, is_verified FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.status(404).json({ success: false, message: 'Driver profile not found.' });
        if (!drows[0].is_verified) return res.status(403).json({ success: false, message: 'Profile verification pending. Complete KYC to accept rides.' });

        // Check ride is still available
        const [rideCheck] = await db.query('SELECT id, status, driver_id FROM rides WHERE id = ?', [req.params.rideId]);
        if (rideCheck.length === 0) return res.status(404).json({ success: false, message: 'Ride not found.' });
        if (rideCheck[0].status !== 'requested') return res.status(400).json({ success: false, message: 'Ride no longer available.' });

        await db.query(
            `UPDATE rides SET driver_id = ?, status = 'accepted', accepted_at = NOW() WHERE id = ? AND status = 'requested'`,
            [drows[0].id, req.params.rideId]
        );
        await db.query(`UPDATE drivers SET status = 'busy' WHERE id = ?`, [drows[0].id]);

        res.json({ success: true, message: 'Ride accepted!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/drivers/reject/:rideId
router.put('/reject/:rideId', auth('driver'), async (req, res) => {
    try {
        // Simply acknowledge rejection — ride stays in 'requested' for other drivers
        res.json({ success: true, message: 'Ride declined.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/drivers/start/:rideId
router.put('/start/:rideId', auth('driver'), async (req, res) => {
    try {
        await db.query(
            `UPDATE rides SET status = 'ongoing' WHERE id = ? AND status = 'accepted'`,
            [req.params.rideId]
        );
        res.json({ success: true, message: 'Ride started!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/drivers/status (go online/offline)
router.put('/status', auth('driver'), async (req, res) => {
    try {
        const { status } = req.body;
        if (!['available', 'offline'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status.' });
        }

        // Check verification before going online
        if (status === 'available') {
            const [drows] = await db.query('SELECT is_verified, kyc_status FROM drivers WHERE user_id = ?', [req.user.id]);
            if (drows.length > 0 && !drows[0].is_verified) {
                return res.status(403).json({
                    success: false,
                    message: 'Complete KYC verification before going online.',
                    kyc_status: drows[0].kyc_status
                });
            }
        }

        await db.query(`UPDATE drivers SET status = ? WHERE user_id = ?`, [status, req.user.id]);
        res.json({ success: true, message: `Status updated to ${status}.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// STATS & EARNINGS
// ============================================================

// GET /api/drivers/stats
router.get('/stats', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query(
            `SELECT d.*, u.name, u.email, u.phone FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.user_id = ?`,
            [req.user.id]
        );
        if (drows.length === 0) return res.status(404).json({ success: false, message: 'Driver not found.' });

        const [todayRides] = await db.query(
            `SELECT COUNT(*) as count, IFNULL(SUM(fare),0) as earnings
       FROM rides WHERE driver_id = ? AND DATE(completed_at) = CURDATE() AND status = 'completed'`,
            [drows[0].id]
        );

        res.json({
            success: true,
            driver: drows[0],
            today: todayRides[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/earnings — Daily & weekly earnings breakdown
router.get('/earnings', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.status(404).json({ success: false, message: 'Driver not found.' });
        const driverId = drows[0].id;

        // Today's earnings
        const [today] = await db.query(
            `SELECT COUNT(*) as rides, IFNULL(SUM(fare),0) as earnings,
                    IFNULL(SUM(base_fare),0) as base_total, IFNULL(SUM(distance_fare),0) as distance_total
             FROM rides WHERE driver_id = ? AND DATE(completed_at) = CURDATE() AND status = 'completed'`,
            [driverId]
        );

        // This week's earnings (Mon-Sun)
        const [week] = await db.query(
            `SELECT COUNT(*) as rides, IFNULL(SUM(fare),0) as earnings
             FROM rides WHERE driver_id = ? AND YEARWEEK(completed_at, 1) = YEARWEEK(CURDATE(), 1) AND status = 'completed'`,
            [driverId]
        );

        // Last 7 days day-by-day
        const [daily] = await db.query(
            `SELECT DATE(completed_at) as date, COUNT(*) as rides, IFNULL(SUM(fare),0) as earnings
             FROM rides WHERE driver_id = ? AND completed_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status = 'completed'
             GROUP BY DATE(completed_at) ORDER BY date ASC`,
            [driverId]
        );

        // Incentive bonuses earned
        const [incentives] = await db.query(
            `SELECT IFNULL(SUM(amount),0) as total FROM driver_incentives WHERE driver_id = ? AND is_claimed = 1
             AND valid_from <= CURDATE() AND valid_until >= CURDATE()`,
            [driverId]
        );

        // Platform fee (20% of gross)
        const platformRate = 0.20;
        const grossEarnings = parseFloat(today[0].earnings);
        const platformFee = Math.round(grossEarnings * platformRate);
        const netToday = grossEarnings - platformFee + parseFloat(incentives[0].total);

        res.json({
            success: true,
            today: { ...today[0], platform_fee: platformFee, incentive_bonus: parseFloat(incentives[0].total), net_earnings: netToday },
            week: week[0],
            daily,
            platform_rate: platformRate
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/incentives — Active incentive offers
router.get('/incentives', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.json({ success: true, incentives: [] });
        const driverId = drows[0].id;

        const [incentives] = await db.query(
            `SELECT * FROM driver_incentives WHERE driver_id = ? AND valid_until >= CURDATE() ORDER BY valid_until ASC`,
            [driverId]
        );

        // Auto-generate default incentives if none exist
        if (incentives.length === 0) {
            const today = new Date().toISOString().split('T')[0];
            const endOfWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
            const defaults = [
                { type: 'ride_count', title: 'Daily Target Bonus', desc: 'Complete 10 rides today to earn ₹200 bonus', amount: 200, target: 10 },
                { type: 'peak_hour', title: 'Peak Hour Bonus', desc: 'Complete 5 rides during 8AM-10AM or 6PM-9PM', amount: 150, target: 5 },
                { type: 'weekly', title: 'Weekly Champion', desc: 'Complete 50 rides this week for ₹500 bonus', amount: 500, target: 50 },
                { type: 'rating', title: 'Quality Bonus', desc: 'Maintain 4.8+ rating this week for ₹100 bonus', amount: 100, target: 48 }
            ];
            for (const d of defaults) {
                await db.query(
                    `INSERT INTO driver_incentives (driver_id, type, title, description, amount, target, valid_from, valid_until) VALUES (?,?,?,?,?,?,?,?)`,
                    [driverId, d.type, d.title, d.desc, d.amount, d.target, today, endOfWeek]
                );
            }
            // Re-fetch
            const [newIncentives] = await db.query(
                `SELECT * FROM driver_incentives WHERE driver_id = ? AND valid_until >= CURDATE() ORDER BY valid_until ASC`,
                [driverId]
            );
            // Update progress
            for (const inc of newIncentives) {
                let achieved = 0;
                if (inc.type === 'ride_count') {
                    const [c] = await db.query(`SELECT COUNT(*) as cnt FROM rides WHERE driver_id = ? AND DATE(completed_at) = CURDATE() AND status = 'completed'`, [driverId]);
                    achieved = c[0].cnt;
                } else if (inc.type === 'weekly') {
                    const [c] = await db.query(`SELECT COUNT(*) as cnt FROM rides WHERE driver_id = ? AND YEARWEEK(completed_at,1) = YEARWEEK(CURDATE(),1) AND status = 'completed'`, [driverId]);
                    achieved = c[0].cnt;
                }
                await db.query('UPDATE driver_incentives SET achieved = ? WHERE id = ?', [achieved, inc.id]);
                inc.achieved = achieved;
            }
            return res.json({ success: true, incentives: newIncentives });
        }

        // Update progress for existing incentives
        for (const inc of incentives) {
            let achieved = 0;
            if (inc.type === 'ride_count') {
                const [c] = await db.query(`SELECT COUNT(*) as cnt FROM rides WHERE driver_id = ? AND DATE(completed_at) = CURDATE() AND status = 'completed'`, [driverId]);
                achieved = c[0].cnt;
            } else if (inc.type === 'weekly') {
                const [c] = await db.query(`SELECT COUNT(*) as cnt FROM rides WHERE driver_id = ? AND YEARWEEK(completed_at,1) = YEARWEEK(CURDATE(),1) AND status = 'completed'`, [driverId]);
                achieved = c[0].cnt;
            }
            if (achieved !== inc.achieved) {
                await db.query('UPDATE driver_incentives SET achieved = ? WHERE id = ?', [achieved, inc.id]);
                inc.achieved = achieved;
            }
        }

        res.json({ success: true, incentives });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/drivers/settlements — Payment settlement history
router.get('/settlements', auth('driver'), async (req, res) => {
    try {
        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length === 0) return res.json({ success: true, settlements: [] });

        const [settlements] = await db.query(
            `SELECT * FROM driver_settlements WHERE driver_id = ? ORDER BY period_end DESC LIMIT 20`,
            [drows[0].id]
        );
        res.json({ success: true, settlements });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
