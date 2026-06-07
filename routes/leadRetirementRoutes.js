const express = require("express");
const router = express.Router();

const { previewRetirement, runRetirementNow } = require("../controllers/leadRetirementController");

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

// ==============================
// Lead Retirement Routes
// ==============================

// All routes require authentication
router.use(authMiddleware);

// Admin & Manager only
router.get("/preview", roleMiddleware(["admin", "manager"]), previewRetirement);
router.post("/run", roleMiddleware(["admin", "manager"]), runRetirementNow);

module.exports = router;
