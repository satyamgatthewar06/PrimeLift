const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 3306
  });

  console.log('📦 Setting up database...');
  await conn.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'ridebooking_db'}`);
  await conn.query(`USE ${process.env.DB_NAME || 'ridebooking_db'}`);

  // Users table - enhanced with profile_photo and otp fields
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(100) NOT NULL,
      email         VARCHAR(100) NOT NULL UNIQUE,
      password      VARCHAR(255) NOT NULL,
      phone         VARCHAR(15)  NOT NULL,
      role          ENUM('rider','driver','admin') DEFAULT 'rider',
      profile_photo VARCHAR(255) DEFAULT '',
      gender        VARCHAR(10) DEFAULT '',
      address       TEXT,
      otp_code      VARCHAR(6) DEFAULT NULL,
      otp_expires   TIMESTAMP NULL,
      is_active     TINYINT(1) DEFAULT 1,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

  // Alter existing users table to add new columns if they don't exist
  const alterCols = [
    { col: 'profile_photo', def: "VARCHAR(255) DEFAULT ''" },
    { col: 'gender', def: "VARCHAR(10) DEFAULT ''" },
    { col: 'address', def: "TEXT" },
    { col: 'otp_code', def: "VARCHAR(6) DEFAULT NULL" },
    { col: 'otp_expires', def: "TIMESTAMP NULL" }
  ];
  for (const c of alterCols) {
    try { await conn.query(`ALTER TABLE users ADD COLUMN ${c.col} ${c.def}`); } catch (e) { }
  }

  // Drivers table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      user_id        INT NOT NULL,
      vehicle_type   ENUM('bike','auto','car','suv') NOT NULL,
      vehicle_no     VARCHAR(20) NOT NULL,
      vehicle_model  VARCHAR(50),
      vehicle_color  VARCHAR(30) DEFAULT '',
      status         ENUM('available','busy','offline') DEFAULT 'offline',
      latitude       DECIMAL(10,7) DEFAULT 0,
      longitude      DECIMAL(10,7) DEFAULT 0,
      rating         DECIMAL(3,2) DEFAULT 5.00,
      total_rides    INT DEFAULT 0,
      total_earnings DECIMAL(12,2) DEFAULT 0.00,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

  const driverAlterCols = [
    { col: 'vehicle_color', def: "VARCHAR(30) DEFAULT ''" },
    { col: 'latitude', def: "DECIMAL(10,7) DEFAULT 0" },
    { col: 'longitude', def: "DECIMAL(10,7) DEFAULT 0" }
  ];
  for (const c of driverAlterCols) {
    try { await conn.query(`ALTER TABLE drivers ADD COLUMN ${c.col} ${c.def}`); } catch (e) { }
  }

  // Rides table - enhanced with scheduling, lat/lng, etc.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS rides (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      rider_id          INT NOT NULL,
      driver_id         INT,
      pickup_location   TEXT NOT NULL,
      dropoff_location  TEXT NOT NULL,
      pickup_lat        DECIMAL(10,7) DEFAULT 0,
      pickup_lng        DECIMAL(10,7) DEFAULT 0,
      dropoff_lat       DECIMAL(10,7) DEFAULT 0,
      dropoff_lng       DECIMAL(10,7) DEFAULT 0,
      distance_km       DECIMAL(8,2) DEFAULT 0,
      fare              DECIMAL(10,2) DEFAULT 0,
      base_fare         DECIMAL(10,2) DEFAULT 0,
      distance_fare     DECIMAL(10,2) DEFAULT 0,
      surge_multiplier  DECIMAL(3,1) DEFAULT 1.0,
      vehicle_type      ENUM('bike','auto','car','suv') NOT NULL,
      status            ENUM('requested','accepted','ongoing','completed','cancelled','scheduled') DEFAULT 'requested',
      payment_method    ENUM('cash','upi','card','wallet') DEFAULT 'cash',
      scheduled_at      TIMESTAMP NULL,
      is_scheduled      TINYINT(1) DEFAULT 0,
      sos_triggered     TINYINT(1) DEFAULT 0,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      accepted_at       TIMESTAMP NULL,
      completed_at      TIMESTAMP NULL,
      FOREIGN KEY (rider_id)  REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
    )`);

  const rideAlterCols = [
    { col: 'pickup_lat', def: "DECIMAL(10,7) DEFAULT 0" },
    { col: 'pickup_lng', def: "DECIMAL(10,7) DEFAULT 0" },
    { col: 'dropoff_lat', def: "DECIMAL(10,7) DEFAULT 0" },
    { col: 'dropoff_lng', def: "DECIMAL(10,7) DEFAULT 0" },
    { col: 'base_fare', def: "DECIMAL(10,2) DEFAULT 0" },
    { col: 'distance_fare', def: "DECIMAL(10,2) DEFAULT 0" },
    { col: 'surge_multiplier', def: "DECIMAL(3,1) DEFAULT 1.0" },
    { col: 'scheduled_at', def: "TIMESTAMP NULL" },
    { col: 'is_scheduled', def: "TINYINT(1) DEFAULT 0" },
    { col: 'sos_triggered', def: "TINYINT(1) DEFAULT 0" }
  ];
  for (const c of rideAlterCols) {
    try { await conn.query(`ALTER TABLE rides ADD COLUMN ${c.col} ${c.def}`); } catch (e) { }
  }

  // Payments table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id      INT AUTO_INCREMENT PRIMARY KEY,
      ride_id INT NOT NULL,
      amount  DECIMAL(10,2) NOT NULL,
      method  ENUM('cash','upi','card','wallet') DEFAULT 'cash',
      status  ENUM('pending','paid') DEFAULT 'pending',
      paid_at TIMESTAMP NULL,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
    )`);

  // Ratings table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ratings (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      ride_id    INT NOT NULL,
      rated_by   INT NOT NULL,
      rating     INT,
      comment    TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id)  REFERENCES rides(id) ON DELETE CASCADE,
      FOREIGN KEY (rated_by) REFERENCES users(id) ON DELETE CASCADE
    )`);

  // Notifications table (NEW)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      ride_id    INT,
      title      VARCHAR(100) NOT NULL,
      message    TEXT NOT NULL,
      type       ENUM('ride','payment','promo','system') DEFAULT 'ride',
      is_read    TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

  // SOS table (NEW)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sos_alerts (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      ride_id    INT NOT NULL,
      user_id    INT NOT NULL,
      latitude   DECIMAL(10,7),
      longitude  DECIMAL(10,7),
      status     ENUM('active','resolved') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

  // Driver KYC table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_kyc (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      driver_id   INT NOT NULL,
      doc_type    ENUM('aadhaar','driving_license') NOT NULL,
      doc_number  VARCHAR(50) DEFAULT '',
      doc_front   LONGTEXT,
      doc_back    LONGTEXT,
      status      ENUM('pending','approved','rejected') DEFAULT 'pending',
      admin_remarks TEXT,
      reviewed_by INT,
      reviewed_at TIMESTAMP NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    )`);

  // Vehicle Documents table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      driver_id   INT NOT NULL,
      doc_type    ENUM('rc_book','insurance','permit','fitness_cert') NOT NULL,
      doc_number  VARCHAR(50) DEFAULT '',
      doc_file    LONGTEXT,
      expiry_date DATE NULL,
      status      ENUM('pending','approved','rejected','expired') DEFAULT 'pending',
      admin_remarks TEXT,
      reviewed_at TIMESTAMP NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    )`);

  // Driver Incentives table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_incentives (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      driver_id   INT NOT NULL,
      type        ENUM('ride_count','peak_hour','referral','rating','weekly') DEFAULT 'ride_count',
      title       VARCHAR(100) NOT NULL,
      description TEXT,
      amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
      target      INT DEFAULT 0,
      achieved    INT DEFAULT 0,
      is_claimed  TINYINT(1) DEFAULT 0,
      valid_from  DATE NOT NULL,
      valid_until DATE NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    )`);

  // Driver Settlements table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_settlements (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      driver_id     INT NOT NULL,
      period_start  DATE NOT NULL,
      period_end    DATE NOT NULL,
      total_rides   INT DEFAULT 0,
      gross_earnings DECIMAL(12,2) DEFAULT 0,
      platform_fee  DECIMAL(10,2) DEFAULT 0,
      incentive_bonus DECIMAL(10,2) DEFAULT 0,
      deductions    DECIMAL(10,2) DEFAULT 0,
      net_payout    DECIMAL(12,2) DEFAULT 0,
      status        ENUM('pending','processing','paid','failed') DEFAULT 'pending',
      paid_at       TIMESTAMP NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    )`);

  // Add kyc_status and is_verified columns to drivers
  const driverKycCols = [
    { col: 'kyc_status', def: "ENUM('not_submitted','pending','approved','rejected') DEFAULT 'not_submitted'" },
    { col: 'is_verified', def: "TINYINT(1) DEFAULT 0" }
  ];
  for (const c of driverKycCols) {
    try { await conn.query(`ALTER TABLE drivers ADD COLUMN ${c.col} ${c.def}`); } catch (e) { }
  }

  console.log('✅ Tables created!');

  // Seed demo users
  const [existing] = await conn.query(`SELECT COUNT(*) as c FROM users`);
  if (existing[0].c === 0) {
    console.log('🌱 Seeding demo data...');
    const hash = await bcrypt.hash('password', 10);

    await conn.query(
      `INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, ?)`,
      ['Admin', 'admin@ride.com', hash, '9000000000', 'admin']
    );
    await conn.query(
      `INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, ?)`,
      ['Rahul Sharma', 'rider@ride.com', hash, '9111111111', 'rider']
    );
    await conn.query(
      `INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, ?)`,
      ['Suresh Patil', 'driver@ride.com', hash, '9222222222', 'driver']
    );
    await conn.query(
      `INSERT INTO drivers (user_id, vehicle_type, vehicle_no, vehicle_model, vehicle_color, status, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [3, 'car', 'MH12AB1234', 'Swift Dzire', 'White', 'available', 19.0760, 72.8777]
    );

    console.log('✅ Demo users created!');
    console.log('   Admin:  admin@ride.com  / password');
    console.log('   Rider:  rider@ride.com  / password');
    console.log('   Driver: driver@ride.com / password');
  }

  await conn.end();
  console.log('✅ Database ready!\n');
}

module.exports = initDatabase;
