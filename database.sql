-- ============================================================
-- RIDE BOOKING APP - DATABASE SCHEMA
-- Run this file in MySQL Workbench or CLI:
--   mysql -u root -p < database.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS ridebooking_db;
USE ridebooking_db;

-- ---- USERS ----
CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(100) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  phone      VARCHAR(15)  NOT NULL,
  role       ENUM('rider','driver','admin') DEFAULT 'rider',
  is_active  TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---- DRIVERS (extends users where role='driver') ----
CREATE TABLE IF NOT EXISTS drivers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  vehicle_type  ENUM('bike','auto','car','suv') NOT NULL,
  vehicle_no    VARCHAR(20) NOT NULL,
  vehicle_model VARCHAR(50),
  status        ENUM('available','busy','offline') DEFAULT 'offline',
  rating        DECIMAL(3,2) DEFAULT 5.00,
  total_rides   INT DEFAULT 0,
  total_earnings DECIMAL(12,2) DEFAULT 0.00,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---- RIDES ----
CREATE TABLE IF NOT EXISTS rides (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  rider_id          INT NOT NULL,
  driver_id         INT,
  pickup_location   TEXT NOT NULL,
  dropoff_location  TEXT NOT NULL,
  distance_km       DECIMAL(8,2) DEFAULT 0,
  fare              DECIMAL(10,2) DEFAULT 0,
  vehicle_type      ENUM('bike','auto','car','suv') NOT NULL,
  status            ENUM('requested','accepted','ongoing','completed','cancelled') DEFAULT 'requested',
  payment_method    ENUM('cash','upi','card','wallet') DEFAULT 'cash',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at       TIMESTAMP NULL,
  completed_at      TIMESTAMP NULL,
  FOREIGN KEY (rider_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
);

-- ---- PAYMENTS ----
CREATE TABLE IF NOT EXISTS payments (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  ride_id   INT NOT NULL,
  amount    DECIMAL(10,2) NOT NULL,
  method    ENUM('cash','upi','card','wallet') DEFAULT 'cash',
  status    ENUM('pending','paid') DEFAULT 'pending',
  paid_at   TIMESTAMP NULL,
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);

-- ---- RATINGS ----
CREATE TABLE IF NOT EXISTS ratings (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  ride_id   INT NOT NULL,
  rated_by  INT NOT NULL,
  rating    INT CHECK (rating BETWEEN 1 AND 5),
  comment   TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ride_id)  REFERENCES rides(id) ON DELETE CASCADE,
  FOREIGN KEY (rated_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Admin user (password: admin123)
INSERT INTO users (name, email, password, phone, role) VALUES
('Admin', 'admin@ride.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '9000000000', 'admin');

-- Sample rider (password: rider123)
INSERT INTO users (name, email, password, phone, role) VALUES
('Rahul Sharma', 'rider@ride.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '9111111111', 'rider');

-- Sample driver (password: driver123)
INSERT INTO users (name, email, password, phone, role) VALUES
('Suresh Patil', 'driver@ride.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '9222222222', 'driver');

-- Driver profile
INSERT INTO drivers (user_id, vehicle_type, vehicle_no, vehicle_model, status) VALUES
(3, 'car', 'MH12AB1234', 'Swift Dzire', 'available');

-- Sample completed ride
INSERT INTO rides (rider_id, driver_id, pickup_location, dropoff_location, distance_km, fare, vehicle_type, status, payment_method, completed_at)
VALUES (2, 1, 'Shivajinagar, Pune', 'Hinjewadi, Pune', 12.5, 170.00, 'car', 'completed', 'upi', NOW());

INSERT INTO payments (ride_id, amount, method, status, paid_at) VALUES (1, 170.00, 'upi', 'paid', NOW());
INSERT INTO ratings (ride_id, rated_by, rating, comment) VALUES (1, 2, 5, 'Great ride, very smooth!');

-- Update driver stats
UPDATE drivers SET total_rides = 1, total_earnings = 170.00, rating = 5.00 WHERE id = 1;
