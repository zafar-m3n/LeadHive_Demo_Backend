// routes/leadRoutes.js
const express = require("express");
const router = express.Router();

const {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  assignLead,
  getLeadAssignments,
  updateLeadNote,
  deleteLeadNote,
} = require("../controllers/leadController");

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

// All routes require authentication
router.use(authMiddleware);

/**
 * =============================
 * View Leads (all roles, filtered in controller)
 * =============================
 */
router.get("/", roleMiddleware(["admin", "manager", "sales_rep", "retention"]), getLeads);
router.get("/:id", roleMiddleware(["admin", "manager", "sales_rep", "retention"]), getLeadById);
router.get("/:id/assignments", roleMiddleware(["admin", "manager", "sales_rep", "retention"]), getLeadAssignments);
router.put("/:leadId/notes/:noteId", roleMiddleware(["admin", "manager", "sales_rep", "retention"]), updateLeadNote);

/**
 * =============================
 * Admin & Manager only
 * =============================
 */
router.post("/", roleMiddleware(["admin", "manager"]), createLead);
router.put("/:id", roleMiddleware(["admin", "manager", "sales_rep", "retention"]), updateLead);
router.delete("/:id", roleMiddleware(["admin", "manager"]), deleteLead);
router.post("/:id/assign", roleMiddleware(["admin", "manager"]), assignLead);
router.delete("/:leadId/notes/:noteId", roleMiddleware(["admin", "manager", "sales_rep"]), deleteLeadNote);

module.exports = router;
