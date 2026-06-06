const express = require("express");
const {
  getRoles,
  getLeadStatuses,
  getLeadSources,
  getLeadCampaigns,
  getManagers,
  getTeamMembers,
  getUnassignedSalesReps,
  getUnassignedManagers,
  getManagersAndAdmins,
  getAssignableUsersForManager,
  getMyManager,
  getManagersForTeam,
  assignManagerToTeam,
  removeManagerFromTeam,
  getAssignees,
} = require("../controllers/supportingController");

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const router = express.Router();

// ==============================
// Supporting Data Routes
// ==============================

// ✅ Get all roles (Admin only)
router.get("/roles", authMiddleware, roleMiddleware(["admin"]), getRoles);

// ✅ Get all lead statuses (Admin, Manager, Sales Rep, Retention)
router.get(
  "/leads/statuses",
  authMiddleware,
  roleMiddleware(["admin", "manager", "sales_rep", "retention"]),
  getLeadStatuses,
);

// ✅ Get all lead sources (Admin, Manager, Sales Rep, Retention)
router.get(
  "/leads/sources",
  authMiddleware,
  roleMiddleware(["admin", "manager", "sales_rep", "retention"]),
  getLeadSources,
);

// ✅ Get all lead campaigns (Admin, Manager, Sales Rep, Retention)
router.get(
  "/leads/campaigns",
  authMiddleware,
  roleMiddleware(["admin", "manager", "sales_rep", "retention"]),
  getLeadCampaigns,
);

// ✅ Get all managers (Admin only)
router.get("/users/managers", authMiddleware, roleMiddleware(["admin"]), getManagers);

// ✅ Get all managers & admins (Admin only)
router.get("/users/managers-admins", authMiddleware, roleMiddleware(["admin"]), getManagersAndAdmins);

// ✅ Get team members by teamId (Admin and Manager only)
router.get("/teams/:teamId/members", authMiddleware, roleMiddleware(["admin", "manager"]), getTeamMembers);

// ✅ Get unassigned active sales reps and retention agents (Admin and Manager only)
router.get("/users/sales/unassigned", authMiddleware, roleMiddleware(["admin", "manager"]), getUnassignedSalesReps);

// ✅ Get unassigned active managers (Admin only)
router.get("/users/managers/unassigned", authMiddleware, roleMiddleware(["admin"]), getUnassignedManagers);

// ✅ Get assignable users for a manager (Admin and Manager only)
router.get("/users/assignable", authMiddleware, roleMiddleware(["admin", "manager"]), getAssignableUsersForManager);

// ✅ Get my manager (for any user)
router.get("/users/manager", authMiddleware, getMyManager);

// ✅ Get all managers for a specific team (New route)
router.get("/teams/:teamId/managers", authMiddleware, roleMiddleware(["admin", "manager"]), getManagersForTeam);

// ✅ Assign a manager to a team (Admin only)
router.post("/teams/:id/managers", authMiddleware, roleMiddleware(["admin"]), assignManagerToTeam);

// ✅ Remove a manager from a team (Admin only)
router.delete("/teams/:id/managers/:userId", authMiddleware, roleMiddleware(["admin"]), removeManagerFromTeam);

// ✅ Get all assignable users (managers and sales reps) for tasks and notes (Admin, Manager)
router.get("/users/assignees", authMiddleware, roleMiddleware(["admin", "manager"]), getAssignees);

module.exports = router;
