const { Op, fn, col, where } = require("sequelize");
const { Lead, LeadSource, LeadStatus, Campaign } = require("../models");

// ---------- helpers ----------
const toSnakeValue = (label, maxLength = 40) => {
  if (!label) return null;
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
};

const parsePaging = (req) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize || "20", 10)));
  const offset = (page - 1) * pageSize;
  const limit = pageSize;
  return { page, pageSize, offset, limit };
};

const buildSearchWhere = (q) => {
  if (!q || !String(q).trim()) return {};
  const needle = String(q).trim().toLowerCase();
  return {
    [Op.or]: [
      where(fn("LOWER", col("label")), { [Op.like]: `%${needle}%` }),
      where(fn("LOWER", col("value")), { [Op.like]: `%${needle}%` }),
    ],
  };
};

const buildSort = (req, allowed = ["label", "value", "id"]) => {
  const sortBy = (req.query.sortBy || "label").toString();
  const dir = (req.query.sortDir || "asc").toString().toUpperCase() === "DESC" ? "DESC" : "ASC";
  return allowed.includes(sortBy) ? [[sortBy, dir]] : [["label", "ASC"]];
};

// ==========================
// Lead Sources CRUD
// ==========================

/**
 * GET /api/v1/admin/lead-sources
 * Query: q?, page?, pageSize?, sortBy? (label|value|id), sortDir? (asc|desc)
 */
const listLeadSources = async (req, res) => {
  try {
    const { offset, limit, page, pageSize } = parsePaging(req);
    const whereClause = buildSearchWhere(req.query.q);
    const order = buildSort(req, ["label", "value", "id"]);

    const { rows, count } = await LeadSource.findAndCountAll({
      where: whereClause,
      order,
      offset,
      limit,
    });

    return res.json({
      success: true,
      data: rows,
      paging: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    });
  } catch (err) {
    console.error("listLeadSources error:", err);
    return res.status(500).json({ success: false, error: "Failed to list lead sources." });
  }
};

/**
 * GET /api/v1/admin/lead-sources/:id
 */
const getLeadSource = async (req, res) => {
  try {
    const item = await LeadSource.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Lead source not found." });
    return res.json({ success: true, data: item });
  } catch (err) {
    console.error("getLeadSource error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch lead source." });
  }
};

/**
 * POST /api/v1/admin/lead-sources
 * Body: { label }
 * - value is generated from label
 */
const createLeadSource = async (req, res) => {
  try {
    const label = req.body?.label ? String(req.body.label).trim() : "";
    if (!label) return res.status(400).json({ success: false, error: "Label is required." });

    const value = toSnakeValue(label);
    if (!value) return res.status(400).json({ success: false, error: "Invalid label." });

    const existing = await LeadSource.findOne({ where: { value } });
    if (existing) {
      return res.status(409).json({ success: false, error: "Lead source already exists." });
    }

    const created = await LeadSource.create({ label: label.slice(0, 80), value });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("createLeadSource error:", err);
    return res.status(500).json({ success: false, error: "Failed to create lead source." });
  }
};

/**
 * PUT /api/v1/admin/lead-sources/:id
 * Body: { label }
 * - value is regenerated from label
 */
const updateLeadSource = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await LeadSource.findByPk(id);
    if (!item) return res.status(404).json({ success: false, error: "Lead source not found." });

    const label = req.body?.label ? String(req.body.label).trim() : "";
    if (!label) return res.status(400).json({ success: false, error: "Label is required." });

    const value = toSnakeValue(label);
    if (!value) return res.status(400).json({ success: false, error: "Invalid label." });

    const conflict = await LeadSource.findOne({
      where: { value, id: { [Op.ne]: id } },
      attributes: ["id"],
    });
    if (conflict) {
      return res.status(409).json({ success: false, error: "Another lead source with this label/value exists." });
    }

    item.label = label.slice(0, 80);
    item.value = value;
    await item.save();

    return res.json({ success: true, data: item });
  } catch (err) {
    console.error("updateLeadSource error:", err);
    return res.status(500).json({ success: false, error: "Failed to update lead source." });
  }
};

/**
 * DELETE /api/v1/admin/lead-sources/:id
 * - Blocks delete if any Lead uses this source (409)
 */
const deleteLeadSource = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await LeadSource.findByPk(id);
    if (!item) return res.status(404).json({ success: false, error: "Lead source not found." });

    const inUse = await Lead.count({ where: { source_id: id } });
    if (inUse > 0) {
      return res.status(409).json({
        success: false,
        error: "Cannot delete: lead source is in use by existing leads.",
        details: { in_use_count: inUse },
      });
    }

    await item.destroy();
    return res.json({ success: true, message: "Lead source deleted." });
  } catch (err) {
    console.error("deleteLeadSource error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete lead source." });
  }
};

// ==========================
// Lead Statuses CRUD
// ==========================

/**
 * GET /api/v1/admin/lead-statuses
 * Query: q?, page?, pageSize?, sortBy? (label|value|id), sortDir? (asc|desc)
 */
const listLeadStatuses = async (req, res) => {
  try {
    const { offset, limit, page, pageSize } = parsePaging(req);
    const whereClause = buildSearchWhere(req.query.q);
    const order = buildSort(req, ["label", "value", "id"]);

    const { rows, count } = await LeadStatus.findAndCountAll({
      where: whereClause,
      order,
      offset,
      limit,
    });

    return res.json({
      success: true,
      data: rows,
      paging: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    });
  } catch (err) {
    console.error("listLeadStatuses error:", err);
    return res.status(500).json({ success: false, error: "Failed to list lead statuses." });
  }
};

/**
 * GET /api/v1/admin/lead-statuses/:id
 */
const getLeadStatus = async (req, res) => {
  try {
    const item = await LeadStatus.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Lead status not found." });
    return res.json({ success: true, data: item });
  } catch (err) {
    console.error("getLeadStatus error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch lead status." });
  }
};

/**
 * POST /api/v1/admin/lead-statuses
 * Body: { label }
 * - value is generated from label
 */
const createLeadStatus = async (req, res) => {
  try {
    const label = req.body?.label ? String(req.body.label).trim() : "";
    if (!label) return res.status(400).json({ success: false, error: "Label is required." });

    const value = toSnakeValue(label);
    if (!value) return res.status(400).json({ success: false, error: "Invalid label." });

    const existing = await LeadStatus.findOne({ where: { value } });
    if (existing) {
      return res.status(409).json({ success: false, error: "Lead status already exists." });
    }

    const created = await LeadStatus.create({ label: label.slice(0, 80), value });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("createLeadStatus error:", err);
    return res.status(500).json({ success: false, error: "Failed to create lead status." });
  }
};

/**
 * PUT /api/v1/admin/lead-statuses/:id
 * Body: { label }
 * - value is regenerated from label
 */
const updateLeadStatus = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await LeadStatus.findByPk(id);
    if (!item) return res.status(404).json({ success: false, error: "Lead status not found." });

    const label = req.body?.label ? String(req.body.label).trim() : "";
    if (!label) return res.status(400).json({ success: false, error: "Label is required." });

    const value = toSnakeValue(label);
    if (!value) return res.status(400).json({ success: false, error: "Invalid label." });

    const conflict = await LeadStatus.findOne({
      where: { value, id: { [Op.ne]: id } },
      attributes: ["id"],
    });
    if (conflict) {
      return res.status(409).json({ success: false, error: "Another lead status with this label/value exists." });
    }

    item.label = label.slice(0, 80);
    item.value = value;
    await item.save();

    return res.json({ success: true, data: item });
  } catch (err) {
    console.error("updateLeadStatus error:", err);
    return res.status(500).json({ success: false, error: "Failed to update lead status." });
  }
};

/**
 * DELETE /api/v1/admin/lead-statuses/:id
 * - Blocks delete if any Lead uses this status (409)
 */
const deleteLeadStatus = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await LeadStatus.findByPk(id);
    if (!item) return res.status(404).json({ success: false, error: "Lead status not found." });

    const inUse = await Lead.count({ where: { status_id: id } });
    if (inUse > 0) {
      return res.status(409).json({
        success: false,
        error: "Cannot delete: lead status is in use by existing leads.",
        details: { in_use_count: inUse },
      });
    }

    await item.destroy();
    return res.json({ success: true, message: "Lead status deleted." });
  } catch (err) {
    console.error("deleteLeadStatus error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete lead status." });
  }
};

// ==========================
// Campaigns CRUD
// ==========================

/**
 * GET /api/v1/admin/campaigns
 * Query: q?, page?, pageSize?, sortBy? (label|value|id), sortDir? (asc|desc)
 */
const listCampaigns = async (req, res) => {
  try {
    const { offset, limit, page, pageSize } = parsePaging(req);
    const whereClause = buildSearchWhere(req.query.q);
    const order = buildSort(req, ["label", "value", "id"]);

    const { rows, count } = await Campaign.findAndCountAll({
      where: whereClause,
      order,
      offset,
      limit,
    });

    return res.json({
      success: true,
      data: rows,
      paging: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    });
  } catch (err) {
    console.error("listCampaigns error:", err);
    return res.status(500).json({ success: false, error: "Failed to list campaigns." });
  }
};

/**
 * GET /api/v1/admin/campaigns/:id
 */
const getCampaign = async (req, res) => {
  try {
    const item = await Campaign.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Campaign not found." });
    return res.json({ success: true, data: item });
  } catch (err) {
    console.error("getCampaign error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch campaign." });
  }
};

/**
 * POST /api/v1/admin/campaigns
 * Body: { label }
 * - value is generated from label
 */
const createCampaign = async (req, res) => {
  try {
    const label = req.body?.label ? String(req.body.label).trim() : "";
    if (!label) return res.status(400).json({ success: false, error: "Label is required." });

    const value = toSnakeValue(label, 80);
    if (!value) return res.status(400).json({ success: false, error: "Invalid label." });

    const existing = await Campaign.findOne({ where: { value } });
    if (existing) {
      return res.status(409).json({ success: false, error: "Campaign already exists." });
    }

    const created = await Campaign.create({ label: label.slice(0, 120), value });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("createCampaign error:", err);
    return res.status(500).json({ success: false, error: "Failed to create campaign." });
  }
};

/**
 * PUT /api/v1/admin/campaigns/:id
 * Body: { label }
 * - value is regenerated from label
 */
const updateCampaign = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Campaign.findByPk(id);
    if (!item) return res.status(404).json({ success: false, error: "Campaign not found." });

    const label = req.body?.label ? String(req.body.label).trim() : "";
    if (!label) return res.status(400).json({ success: false, error: "Label is required." });

    const value = toSnakeValue(label, 80);
    if (!value) return res.status(400).json({ success: false, error: "Invalid label." });

    const conflict = await Campaign.findOne({
      where: { value, id: { [Op.ne]: id } },
      attributes: ["id"],
    });
    if (conflict) {
      return res.status(409).json({ success: false, error: "Another campaign with this label/value exists." });
    }

    item.label = label.slice(0, 120);
    item.value = value;
    await item.save();

    return res.json({ success: true, data: item });
  } catch (err) {
    console.error("updateCampaign error:", err);
    return res.status(500).json({ success: false, error: "Failed to update campaign." });
  }
};

/**
 * DELETE /api/v1/admin/campaigns/:id
 * - Blocks delete if any Lead uses this campaign (409)
 */
const deleteCampaign = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Campaign.findByPk(id);
    if (!item) return res.status(404).json({ success: false, error: "Campaign not found." });

    const inUse = await Lead.count({ where: { campaign_id: id } });
    if (inUse > 0) {
      return res.status(409).json({
        success: false,
        error: "Cannot delete: campaign is in use by existing leads.",
        details: { in_use_count: inUse },
      });
    }

    await item.destroy();
    return res.json({ success: true, message: "Campaign deleted." });
  } catch (err) {
    console.error("deleteCampaign error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete campaign." });
  }
};

module.exports = {
  // sources
  listLeadSources,
  getLeadSource,
  createLeadSource,
  updateLeadSource,
  deleteLeadSource,

  // statuses
  listLeadStatuses,
  getLeadStatus,
  createLeadStatus,
  updateLeadStatus,
  deleteLeadStatus,

  // campaigns
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
};
