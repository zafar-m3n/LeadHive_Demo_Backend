const express = require("express");
const {
  getAdminSummary,
  getManagerSummary,
  getSalesRepSummary,
  getMyAssignments,
} = require("../controllers/dashboardController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const router = express.Router();

// ==============================
// Dashboard Routes
// ==============================

// ✅ Summary stats for admin/manager/sales_rep/retention
// routes/dashboardRoutes.js
router.get("/summary/admin", authMiddleware, roleMiddleware(["admin"]), getAdminSummary);
router.get("/summary/manager", authMiddleware, roleMiddleware(["manager"]), getManagerSummary);
router.get("/summary/sales_rep", authMiddleware, roleMiddleware(["sales_rep", "retention"]), getSalesRepSummary);
router.get("/summary/retention", authMiddleware, roleMiddleware(["retention"]), getSalesRepSummary);

router.get("/assignments", authMiddleware, roleMiddleware(["manager", "sales_rep", "retention"]), getMyAssignments);

module.exports = router;
