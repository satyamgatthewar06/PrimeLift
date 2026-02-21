const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/auth');

// Fare rates
const RATES = {
    bike: { base: 15, perKm: 7, label: 'Bike', icon: '🏍️', eta: '5 min' },
    auto: { base: 25, perKm: 10, label: 'Auto', icon: '🛺', eta: '7 min' },
    car: { base: 40, perKm: 14, label: 'Mini', icon: '🚗', eta: '8 min' },
    suv: { base: 60, perKm: 18, label: 'Prime', icon: '🚙', eta: '10 min' }
};

function calculateFare(vehicleType, distanceKm) {
    const rate = RATES[vehicleType] || RATES.car;
    const hour = new Date().getHours();
    const surge = (hour >= 8 && hour <= 10) || (hour >= 18 && hour <= 21) ? 1.5 : 1.0;
    const baseFare = rate.base;
    const distFare = rate.perKm * distanceKm;
    const total = Math.round((baseFare + distFare) * surge);
    return { baseFare, distFare: Math.round(distFare), surge, total };
}

// Helper: create notification
async function notify(userId, title, message, rideId = null, type = 'ride') {
    await db.query(
        'INSERT INTO notifications (user_id, ride_id, title, message, type) VALUES (?,?,?,?,?)',
        [userId, rideId, title, message, type]
    );
}

// GET /api/rides/estimate  — fare estimate for ALL vehicle types
router.get('/estimate', async (req, res) => {
    try {
        const dist = parseFloat(req.query.distance_km) || 5;
        const estimates = {};
        for (const [type, rate] of Object.entries(RATES)) {
            const f = calculateFare(type, dist);
            estimates[type] = { ...f, label: rate.label, icon: rate.icon, eta: rate.eta };
        }
        const hour = new Date().getHours();
        const surge = (hour >= 8 && hour <= 10) || (hour >= 18 && hour <= 21) ? 1.5 : 1.0;
        res.json({ success: true, distance_km: dist, surge, estimates });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// POST /api/rides/book
router.post('/book', auth('rider'), async (req, res) => {
    try {
        const {
            pickup_location, dropoff_location, vehicle_type,
            distance_km, payment_method,
            pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
            scheduled_at
        } = req.body;

        if (!pickup_location || !dropoff_location || !vehicle_type) {
            return res.status(400).json({ success: false, message: 'Pickup, dropoff, and vehicle type required.' });
        }

        const dist = parseFloat(distance_km) || (Math.random() * 15 + 2).toFixed(1) * 1;
        const fareInfo = calculateFare(vehicle_type, dist);
        const isScheduled = scheduled_at ? 1 : 0;
        const rideStatus = isScheduled ? 'scheduled' : 'requested';

        const [result] = await db.query(
            `INSERT INTO rides (rider_id, pickup_location, dropoff_location,
             pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
             distance_km, fare, base_fare, distance_fare, surge_multiplier,
             vehicle_type, payment_method, status, is_scheduled, scheduled_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, pickup_location, dropoff_location,
            pickup_lat || 0, pickup_lng || 0, dropoff_lat || 0, dropoff_lng || 0,
                dist, fareInfo.total, fareInfo.baseFare, fareInfo.distFare, fareInfo.surge,
                vehicle_type, payment_method || 'cash', rideStatus, isScheduled,
            scheduled_at || null]
        );

        // Auto-assign driver if not scheduled
        let assignedDriver = null;
        if (!isScheduled) {
            const [drivers] = await db.query(
                `SELECT d.id, u.name, u.phone, d.vehicle_no, d.vehicle_model, d.vehicle_color, d.rating
                 FROM drivers d JOIN users u ON d.user_id = u.id
                 WHERE d.vehicle_type = ? AND d.status = 'available'
                 ORDER BY d.rating DESC LIMIT 1`,
                [vehicle_type]
            );

            if (drivers.length > 0) {
                const driver = drivers[0];
                await db.query(
                    `UPDATE rides SET driver_id = ?, status = 'accepted', accepted_at = NOW() WHERE id = ?`,
                    [driver.id, result.insertId]
                );
                await db.query(`UPDATE drivers SET status = 'busy' WHERE id = ?`, [driver.id]);
                assignedDriver = driver;

                await notify(req.user.id, '🚗 Driver Assigned!',
                    `${driver.name} will arrive in ${RATES[vehicle_type]?.eta || '8 min'}. Vehicle: ${driver.vehicle_model} (${driver.vehicle_color}) - ${driver.vehicle_no}`,
                    result.insertId);
            } else {
                await notify(req.user.id, '🔍 Searching for Driver',
                    'We are finding the best driver for you. Please wait...', result.insertId);
            }
        } else {
            await notify(req.user.id, '📅 Ride Scheduled!',
                `Your ride from ${pickup_location} to ${dropoff_location} is scheduled for ${new Date(scheduled_at).toLocaleString()}.`,
                result.insertId);
        }

        // Create payment record
        await db.query(
            `INSERT INTO payments (ride_id, amount, method) VALUES (?, ?, ?)`,
            [result.insertId, fareInfo.total, payment_method || 'cash']
        );

        res.status(201).json({
            success: true,
            message: assignedDriver ? 'Ride booked! Driver assigned.' :
                isScheduled ? 'Ride scheduled successfully!' :
                    'Ride requested. Searching for driver...',
            ride: {
                id: result.insertId,
                pickup_location, dropoff_location,
                distance_km: dist,
                fare: fareInfo.total, base_fare: fareInfo.baseFare,
                distance_fare: fareInfo.distFare, surge_multiplier: fareInfo.surge,
                vehicle_type, payment_method: payment_method || 'cash',
                status: assignedDriver ? 'accepted' : rideStatus,
                driver: assignedDriver, is_scheduled: isScheduled
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/rides/my-rides
router.get('/my-rides', auth('rider'), async (req, res) => {
    try {
        const [rides] = await db.query(
            `SELECT r.*, u.name AS driver_name, u.phone AS driver_phone,
             d.vehicle_no, d.vehicle_model, d.vehicle_color, d.rating AS driver_rating
             FROM rides r
             LEFT JOIN drivers d ON r.driver_id = d.id
             LEFT JOIN users u ON d.user_id = u.id
             WHERE r.rider_id = ?
             ORDER BY r.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, rides });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/rides/active
router.get('/active', auth(), async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'rider') {
            query = `SELECT r.*, u.name AS driver_name, u.phone AS driver_phone,
                     d.vehicle_no, d.vehicle_model, d.vehicle_color, d.rating AS driver_rating,
                     d.latitude AS driver_lat, d.longitude AS driver_lng
                     FROM rides r
                     LEFT JOIN drivers d ON r.driver_id = d.id
                     LEFT JOIN users u ON d.user_id = u.id
                     WHERE r.rider_id = ? AND r.status IN ('requested','accepted','ongoing')
                     ORDER BY r.created_at DESC LIMIT 1`;
            params = [req.user.id];
        } else {
            const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
            if (drows.length === 0) return res.json({ success: true, ride: null });
            query = `SELECT r.*, u.name AS rider_name, u.phone AS rider_phone
                     FROM rides r JOIN users u ON r.rider_id = u.id
                     WHERE r.driver_id = ? AND r.status IN ('accepted','ongoing')
                     ORDER BY r.created_at DESC LIMIT 1`;
            params = [drows[0].id];
        }

        const [rides] = await db.query(query, params);
        res.json({ success: true, ride: rides[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/rides/:id/invoice
router.get('/:id/invoice', auth(), async (req, res) => {
    try {
        const [rides] = await db.query(
            `SELECT r.*, u.name AS rider_name, u.phone AS rider_phone, u.email AS rider_email,
             du.name AS driver_name, du.phone AS driver_phone2,
             d.vehicle_no, d.vehicle_model, d.vehicle_color, d.rating AS driver_rating,
             p.method AS payment_method_used, p.status AS payment_status
             FROM rides r
             JOIN users u ON r.rider_id = u.id
             LEFT JOIN drivers d ON r.driver_id = d.id
             LEFT JOIN users du ON d.user_id = du.id
             LEFT JOIN payments p ON p.ride_id = r.id
             WHERE r.id = ?`, [req.params.id]
        );
        if (rides.length === 0) return res.status(404).json({ success: false, message: 'Ride not found.' });

        const ride = rides[0];
        const gstRate = 0.05;
        const gst = Math.round(ride.fare * gstRate);
        const platformFee = 10;

        res.json({
            success: true,
            invoice: {
                invoice_no: `RG-${ride.id}-${Date.now().toString(36).toUpperCase()}`,
                date: ride.completed_at || ride.created_at,
                rider: { name: ride.rider_name, phone: ride.rider_phone, email: ride.rider_email },
                driver: { name: ride.driver_name, phone: ride.driver_phone2, vehicle: `${ride.vehicle_model} (${ride.vehicle_color}) - ${ride.vehicle_no}` },
                trip: {
                    pickup: ride.pickup_location,
                    dropoff: ride.dropoff_location,
                    distance_km: ride.distance_km,
                    vehicle_type: ride.vehicle_type,
                    duration: ride.completed_at ? Math.round((new Date(ride.completed_at) - new Date(ride.accepted_at || ride.created_at)) / 60000) + ' min' : '—'
                },
                fare_breakdown: {
                    base_fare: ride.base_fare || ride.fare * 0.2,
                    distance_fare: ride.distance_fare || ride.fare * 0.7,
                    surge: ride.surge_multiplier || 1.0,
                    gst: gst,
                    platform_fee: platformFee,
                    total: ride.fare
                },
                payment: {
                    method: ride.payment_method,
                    status: ride.payment_status || 'pending'
                },
                status: ride.status
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/rides/:id/cancel
router.put('/:id/cancel', auth(), async (req, res) => {
    try {
        const [rides] = await db.query('SELECT * FROM rides WHERE id = ?', [req.params.id]);
        if (rides.length === 0) return res.status(404).json({ success: false, message: 'Ride not found.' });

        const ride = rides[0];
        if (!['requested', 'accepted', 'scheduled'].includes(ride.status)) {
            return res.status(400).json({ success: false, message: 'Cannot cancel this ride.' });
        }

        await db.query(`UPDATE rides SET status = 'cancelled' WHERE id = ?`, [req.params.id]);
        if (ride.driver_id) {
            await db.query(`UPDATE drivers SET status = 'available' WHERE id = ?`, [ride.driver_id]);
        }

        await notify(ride.rider_id, '❌ Ride Cancelled', 'Your ride has been cancelled.', ride.id);

        res.json({ success: true, message: 'Ride cancelled.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/rides/:id/complete
router.put('/:id/complete', auth('driver'), async (req, res) => {
    try {
        const [rides] = await db.query('SELECT * FROM rides WHERE id = ?', [req.params.id]);
        if (rides.length === 0) return res.status(404).json({ success: false, message: 'Ride not found.' });

        await db.query(
            `UPDATE rides SET status = 'completed', completed_at = NOW() WHERE id = ?`,
            [req.params.id]
        );

        const [drows] = await db.query('SELECT id FROM drivers WHERE user_id = ?', [req.user.id]);
        if (drows.length > 0) {
            await db.query(`UPDATE drivers SET status = 'available', total_rides = total_rides + 1, total_earnings = total_earnings + ? WHERE id = ?`,
                [rides[0].fare, drows[0].id]);
        }

        await db.query(`UPDATE payments SET status = 'paid', paid_at = NOW() WHERE ride_id = ?`, [req.params.id]);

        await notify(rides[0].rider_id, '🎉 Ride Completed!',
            `Your trip is complete. Fare: ₹${rides[0].fare}. Please rate your driver.`, rides[0].id);

        res.json({ success: true, message: 'Ride completed!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// POST /api/rides/:id/sos
router.post('/:id/sos', auth(), async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        await db.query(
            'INSERT INTO sos_alerts (ride_id, user_id, latitude, longitude) VALUES (?,?,?,?)',
            [req.params.id, req.user.id, latitude || 0, longitude || 0]
        );
        await db.query('UPDATE rides SET sos_triggered = 1 WHERE id = ?', [req.params.id]);

        // Notify admin
        const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin'");
        for (const a of admins) {
            await notify(a.id, '🚨 SOS ALERT!',
                `Emergency triggered on ride #${req.params.id} by user ${req.user.name}. Location: ${latitude},${longitude}`,
                parseInt(req.params.id), 'system');
        }

        await notify(req.user.id, '🚨 SOS Alert Sent',
            'Emergency alert sent to our team. Help is on the way. Stay safe.', parseInt(req.params.id));

        res.json({ success: true, message: 'SOS alert sent! Emergency team notified.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// POST /api/rides/:id/rate
router.post('/:id/rate', auth(), async (req, res) => {
    try {
        const { rating, comment } = req.body;
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
        }

        await db.query(
            'INSERT INTO ratings (ride_id, rated_by, rating, comment) VALUES (?, ?, ?, ?)',
            [req.params.id, req.user.id, rating, comment || '']
        );

        const [rides] = await db.query('SELECT driver_id FROM rides WHERE id = ?', [req.params.id]);
        if (rides[0]?.driver_id) {
            await db.query(
                `UPDATE drivers SET rating = (SELECT AVG(r.rating) FROM ratings r JOIN rides ri ON r.ride_id = ri.id WHERE ri.driver_id = ?) WHERE id = ?`,
                [rides[0].driver_id, rides[0].driver_id]
            );
        }

        res.json({ success: true, message: 'Rating submitted. Thank you!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
