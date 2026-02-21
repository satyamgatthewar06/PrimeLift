@echo off
echo ========================================
echo    RideGo - Ride Booking App Setup
echo ========================================
echo.

echo [1/3] Installing Node.js dependencies...
npm install

echo.
echo [2/3] IMPORTANT: Update your MySQL password in backend/.env
echo       Open backend/.env and change DB_PASSWORD to your MySQL password
echo.
echo [3/3] Setup MySQL database:
echo       Open MySQL Workbench or MySQL CLI and run:
echo       mysql -u root -p ^< database.sql
echo.
echo ========================================
echo After setup, start the server with:
echo   npm start
echo.
echo Then open your browser to:
echo   http://localhost:5000
echo.
echo Demo Login Credentials:
echo   Admin:  admin@ride.com   / admin123
echo   Rider:  rider@ride.com  / rider123
echo   Driver: driver@ride.com / driver123
echo ========================================
pause
