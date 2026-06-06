// routes/sourceStatusRoutes.js
const express = require("express");
const {
  // Lead Sources
  listLeadSources,
  getLeadSource,
  createLeadSource,
  updateLeadSource,
  deleteLeadSource,

  // Lead Statuses
  listLeadStatuses,
  getLeadStatus,
  createLeadStatus,
  updateLeadStatus,
  deleteLeadStatus,

  // Campaigns
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
} = require("../controllers/sourceStatusController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const router = express.Router();

// ==============================
// Lead Sources Routes (Admin only)
// ==============================

// ✅ List/search/paginate lead sources
router.get("/lead/sources", authMiddleware, roleMiddleware(["admin"]), listLeadSources);

// ✅ Get single lead source by id
router.get("/lead/sources/:id", authMiddleware, roleMiddleware(["admin"]), getLeadSource);

// ✅ Create lead source
router.post("/lead/sources", authMiddleware, roleMiddleware(["admin"]), createLeadSource);

// ✅ Update lead source
router.put("/lead/sources/:id", authMiddleware, roleMiddleware(["admin"]), updateLeadSource);

// ✅ Delete lead source (blocked if in use)
router.delete("/lead/sources/:id", authMiddleware, roleMiddleware(["admin"]), deleteLeadSource);

// ==============================
// Lead Statuses Routes (Admin only)
// ==============================

// ✅ List/search/paginate lead statuses
router.get("/lead/statuses", authMiddleware, roleMiddleware(["admin"]), listLeadStatuses);

// ✅ Get single lead status by id
router.get("/lead/statuses/:id", authMiddleware, roleMiddleware(["admin"]), getLeadStatus);

// ✅ Create lead status
router.post("/lead/statuses", authMiddleware, roleMiddleware(["admin"]), createLeadStatus);

// ✅ Update lead status
router.put("/lead/statuses/:id", authMiddleware, roleMiddleware(["admin"]), updateLeadStatus);

// ✅ Delete lead status (blocked if in use)
router.delete("/lead/statuses/:id", authMiddleware, roleMiddleware(["admin"]), deleteLeadStatus);

// ==============================
// Campaign Routes (Admin only)
// ==============================

// ✅ List/search/paginate campaigns
router.get("/lead/campaigns", authMiddleware, roleMiddleware(["admin"]), listCampaigns);

// ✅ Get single campaign by id
router.get("/lead/campaigns/:id", authMiddleware, roleMiddleware(["admin"]), getCampaign);

// ✅ Create campaign
router.post("/lead/campaigns", authMiddleware, roleMiddleware(["admin"]), createCampaign);

// ✅ Update campaign
router.put("/lead/campaigns/:id", authMiddleware, roleMiddleware(["admin"]), updateCampaign);

// ✅ Delete campaign (blocked if in use)
router.delete("/lead/campaigns/:id", authMiddleware, roleMiddleware(["admin"]), deleteCampaign);

module.exports = router;
