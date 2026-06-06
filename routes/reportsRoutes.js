const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const { getReports, getReportAgents } = require("../controllers/reportsController");

// Reports data
router.get("/", authMiddleware, roleMiddleware(["admin", "manager", "sales_rep", "retention"]), getReports);

// Agents for reports filter dropdown
router.get("/agents", authMiddleware, roleMiddleware(["admin", "manager", "sales_rep", "retention"]), getReportAgents);

module.exports = router;
