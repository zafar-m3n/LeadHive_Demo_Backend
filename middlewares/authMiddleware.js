const jwt = require("jsonwebtoken");
require("dotenv").config();

const OFFICE_STATIC_IP = process.env.NODE_LEADHIVE_OFFICE_STATIC_IP;

const getClientIp = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim().replace("::ffff:", "");
  }

  return req.socket.remoteAddress?.replace("::ffff:", "");
};

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "No token provided. Authorization denied.",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.NODE_LEADHIVE_JWT_SECRET);

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    if (req.user.role !== "admin") {
      const clientIp = getClientIp(req);

      if (clientIp !== OFFICE_STATIC_IP) {
        return res.status(403).json({
          success: false,
          error: "Unauthorized agent access.",
        });
      }
    }

    return next();
  } catch (err) {
    console.error("Auth Error:", err.message);
    return res.status(401).json({
      success: false,
      error: "Invalid or expired token.",
    });
  }
};

module.exports = authMiddleware;
