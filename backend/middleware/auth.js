const jwt = require('jsonwebtoken');

const auth = (roles = []) => {
    if (typeof roles === 'string') roles = [roles];

    return (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. No token.' });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;

            if (roles.length && !roles.includes(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Forbidden. Insufficient permissions.' });
            }
            next();
        } catch (err) {
            return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
        }
    };
};

module.exports = auth;
