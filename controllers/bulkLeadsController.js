const { Op, literal } = require("sequelize");
const {
  Lead,
  LeadAssignment,
  LeadNote,
  User,
  Role,
  Team,
  TeamMember,
  TeamManager,
  LeadSource,
  LeadStatus,
  Campaign,
} = require("../models");
const { sequelize } = require("../config/database");
const { resSuccess, resError } = require("../utils/responseUtil");

// Subquery: latest assignment row id per lead (re-using style in your leadController)
const LATEST_ASSIGNMENT_IDS = literal(`(SELECT MAX(id) FROM lead_assignments GROUP BY lead_id)`);

const SALES_LIKE_ROLES = ["sales_rep", "retention"];

// --- Helpers ---------------------------------------------------------------

// Get role value of a user (e.g., "admin" | "manager" | "sales_rep" | "retention")
async function getUserRoleValue(userId) {
  const u = await User.findByPk(userId, {
    include: [{ model: Role, attributes: ["value"] }],
    attributes: ["id", "role_id"],
  });
  // Your User belongsTo(Role), so Role is singular:
  return u?.Role?.value || null;
}

// Manager scope check: is a given sales/retention agent in ANY team managed by this manager?
async function isRepUnderManager(managerId, repId) {
  // team ids this manager manages
  const teamsManaged = await TeamManager.findAll({
    where: { manager_id: managerId },
    attributes: ["team_id"],
  });
  const teamIds = teamsManaged.map((t) => t.team_id);
  if (!teamIds.length) return false;

  // is rep a member of at least one of those teams
  const membership = await TeamMember.findOne({
    where: {
      team_id: { [Op.in]: teamIds },
      user_id: repId,
    },
    attributes: ["team_id", "user_id"],
  });

  return !!membership;
}

// Fetch latest assignment for a batch of leads in one call
async function getLatestAssignmentsMap(leadIds) {
  if (!leadIds.length) return new Map();

  const latestRows = await LeadAssignment.findAll({
    where: {
      id: { [Op.in]: LATEST_ASSIGNMENT_IDS },
      lead_id: { [Op.in]: leadIds },
    },
    attributes: ["id", "lead_id", "assignee_id"],
  });

  const map = new Map();
  for (const row of latestRows) {
    map.set(row.lead_id, row.assignee_id);
  }
  return map;
}

// --- Controllers -----------------------------------------------------------

/**
 * POST /api/v1/leads/bulk-assign
 * Body: { lead_ids: number[], assignee_id: number, overwrite?: boolean }
 * Rules:
 *  - admin  -> assignee can be any user
 *  - manager-> assignee must be sales_rep/retention AND within manager's teams
 * Effect:
 *  - append rows to lead_assignments (no DB schema change)
 *  - if overwrite=false, skip leads whose latest assignee is someone else
 */
const bulkAssign = async (req, res) => {
  try {
    const { lead_ids = [], assignee_id, overwrite = false, status_id } = req.body || {};
    const actorId = req.user?.id;
    const actorRole = req.user?.role; // "admin" | "manager" | "sales_rep" | "retention"

    if (!Array.isArray(lead_ids) || !lead_ids.length) {
      return resError(res, "lead_ids[] is required.", 400);
    }

    if (!assignee_id) {
      return resError(res, "assignee_id is required.", 400);
    }

    let targetStatus = null;
    let shouldReassignToAdmin = false;

    if (status_id !== undefined && status_id !== null) {
      targetStatus = await LeadStatus.findByPk(status_id);

      if (!targetStatus) {
        return resError(res, "Target status not found.", 404);
      }

      const targetStatusValue = String(targetStatus.value || "").toLowerCase();
      shouldReassignToAdmin = ["converted", "invalid_number"].includes(targetStatusValue);
    }

    const assigneeRole = await getUserRoleValue(assignee_id);

    if (!assigneeRole) {
      return resError(res, "Assignee not found.", 404);
    }

    if (actorRole === "admin") {
      // Admin can assign to anyone.
    } else if (actorRole === "manager") {
      if (!SALES_LIKE_ROLES.includes(assigneeRole)) {
        return resError(res, "Manager can only bulk-assign to sales reps or retention agents.", 403);
      }

      const ok = await isRepUnderManager(actorId, assignee_id);

      if (!ok) {
        return resError(res, "Selected agent is not in your managed teams.", 403);
      }
    } else {
      return resError(res, "Forbidden.", 403);
    }

    const leads = await Lead.findAll({
      where: { id: { [Op.in]: lead_ids } },
      attributes: ["id", "status_id"],
      include: [
        {
          model: LeadStatus,
          attributes: ["id", "value", "label"],
        },
      ],
    });

    const foundIds = new Set(leads.map((lead) => lead.id));
    const missing = lead_ids.filter((id) => !foundIds.has(id));

    const leadById = new Map();

    for (const lead of leads) {
      const plainLead = lead.get({ plain: true });
      leadById.set(Number(plainLead.id), plainLead);
    }

    const latestMap = await getLatestAssignmentsMap([...foundIds]);

    const toCreate = [];
    const idsToAffect = [];
    const skipped = [];

    for (const id of foundIds) {
      const current = latestMap.get(id) ?? null;

      if (!overwrite && current && Number(current) !== Number(assignee_id)) {
        skipped.push({ id, reason: "already_assigned" });
        continue;
      }

      if (!overwrite && Number(current) === Number(assignee_id)) {
        skipped.push({ id, reason: "already_assigned_to_target" });
        continue;
      }

      toCreate.push({
        lead_id: id,
        assignee_id,
        assigned_by: actorId,
      });

      idsToAffect.push(id);
    }

    let created = 0;
    let statusUpdated = 0;

    if (toCreate.length) {
      await sequelize.transaction(async (t) => {
        const adminAssigningToAgent = actorRole === "admin" && SALES_LIKE_ROLES.includes(assigneeRole);

        let assignedStatus = null;

        if (adminAssigningToAgent && !shouldReassignToAdmin) {
          assignedStatus = await LeadStatus.findOne({
            where: { value: "assigned" },
            transaction: t,
          });

          if (!assignedStatus) {
            throw new Error("Assigned status not found");
          }
        }

        const noteCounts = await LeadNote.findAll({
          where: { lead_id: { [Op.in]: idsToAffect } },
          attributes: ["lead_id", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
          group: ["lead_id"],
          transaction: t,
        });

        const noteCountMap = new Map();

        for (const row of noteCounts) {
          noteCountMap.set(Number(row.lead_id), Number(row.get("count") || 0));
        }

        const idsToSetAssigned = [];
        const idsToSetProvidedStatus = [];

        for (const id of idsToAffect) {
          const lead = leadById.get(Number(id));
          const currentStatusValue = String(lead?.LeadStatus?.value || "").toLowerCase();
          const existingNoteCount = noteCountMap.get(Number(id)) || 0;

          const isCurrentlyNew = currentStatusValue === "new";
          const hasNoNotes = existingNoteCount === 0;

          if (adminAssigningToAgent && !shouldReassignToAdmin && isCurrentlyNew && hasNoNotes) {
            idsToSetAssigned.push(id);
          } else if (status_id !== undefined && status_id !== null) {
            idsToSetProvidedStatus.push(id);
          }
        }

        const CHUNK = 1000;

        for (let i = 0; i < toCreate.length; i += CHUNK) {
          const slice = toCreate.slice(i, i + CHUNK);
          await LeadAssignment.bulkCreate(slice, { transaction: t });
          created += slice.length;
        }

        if (idsToSetAssigned.length > 0) {
          const [count] = await Lead.update(
            {
              status_id: assignedStatus.id,
              updated_by: actorId,
            },
            {
              where: { id: { [Op.in]: idsToSetAssigned } },
              transaction: t,
            },
          );

          statusUpdated += count;
        }

        if (idsToSetProvidedStatus.length > 0) {
          const [count] = await Lead.update(
            {
              status_id,
              updated_by: actorId,
            },
            {
              where: { id: { [Op.in]: idsToSetProvidedStatus } },
              transaction: t,
            },
          );

          statusUpdated += count;
        }
      });
    }

    return resSuccess(res, {
      total_requested: lead_ids.length,
      updated: created,
      status_updated: statusUpdated,
      skipped,
      missing,
      assignee_id,
      overwrite: !!overwrite,
      ...(status_id !== undefined ? { status_id } : {}),
    });
  } catch (err) {
    console.error("BulkAssign Error:", err);
    return resError(res, "Bulk assign failed.", 500);
  }
};

/**
 * GET /api/v1/leads/assignable-targets
 * Return only valid targets for the actor:
 *  - admin: active users
 *  - manager: active sales reps/retention agents in any of their managed teams
 */
const getAssignableTargets = async (req, res) => {
  try {
    const actorId = req.user?.id;
    const role = req.user?.role;

    if (role === "admin") {
      const users = await User.findAll({
        where: { is_active: true },
        include: [{ model: Role, attributes: [] }],
        attributes: ["id", "full_name", "email"],
        order: [["full_name", "ASC"]],
      });
      return resSuccess(res, { role: "admin", targets: users });
    }

    if (role === "manager") {
      // team ids this manager manages
      const managed = await TeamManager.findAll({
        where: { manager_id: actorId },
        attributes: ["team_id"],
      });
      const teamIds = managed.map((m) => m.team_id);
      if (!teamIds.length) return resSuccess(res, { role: "manager", targets: [] });

      // distinct sales reps/retention agents in those teams
      const reps = await User.findAll({
        where: { is_active: true },
        include: [
          { model: Role, where: { value: { [Op.in]: SALES_LIKE_ROLES } }, attributes: [] },
          {
            model: Team,
            as: "memberOfTeams",
            attributes: [],
            through: { attributes: [] },
            where: { id: { [Op.in]: teamIds } },
            required: true,
          },
        ],
        attributes: ["id", "full_name", "email"],
        order: [["full_name", "ASC"]],
      });

      return resSuccess(res, { role: "manager", targets: reps });
    }

    return resError(res, "Forbidden.", 403);
  } catch (err) {
    console.error("getAssignableTargets Error:", err);
    return resError(res, "Failed to load assignable targets.", 500);
  }
};

/**
 * DELETE /api/v1/leads/bulk-delete
 * Body: { lead_ids: number[] }
 *
 * Rules:
 *  - admin  -> may delete any of the provided leads
 *  - manager-> may delete any of the provided leads
 *  - sales_rep/retention -> forbidden
 *
 * Effect:
 *  - Hard delete leads and their LeadAssignments (no schema change).
 *  - Returns: { requested, deleted, missing }
 */
const bulkDeleteLeads = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { lead_ids = [] } = req.body || {};
    const actorRole = req.user?.role; // "admin" | "manager" | "sales_rep" | "retention"

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      await t.rollback();
      return resError(res, "lead_ids[] is required.", 400);
    }

    if (SALES_LIKE_ROLES.includes(actorRole)) {
      await t.rollback();
      return resError(res, "Forbidden.", 403);
    }

    // 1) Load the leads that exist
    const leads = await Lead.findAll({
      where: { id: { [Op.in]: lead_ids } },
      attributes: ["id"],
      transaction: t,
    });

    const foundIds = new Set(leads.map((l) => l.id));
    const missing = lead_ids.filter((id) => !foundIds.has(id));

    if (foundIds.size === 0) {
      await t.rollback();
      return resSuccess(res, {
        requested: lead_ids.length,
        deleted: 0,
        missing,
      });
    }

    const idsToDelete = [...foundIds];

    // 2) Hard-delete: remove assignments, then leads
    //    If you have ON DELETE CASCADE on lead_assignments.lead_id, you can omit the first destroy.
    await LeadAssignment.destroy({
      where: { lead_id: { [Op.in]: idsToDelete } },
      transaction: t,
    });

    const deletedCount = await Lead.destroy({
      where: { id: { [Op.in]: idsToDelete } },
      transaction: t,
    });

    await t.commit();

    return resSuccess(res, {
      requested: lead_ids.length,
      deleted: deletedCount,
      missing,
    });
  } catch (err) {
    console.error("BulkDeleteLeads Error:", err);
    try {
      await t.rollback();
    } catch (_) {}
    return resError(res, "Bulk delete failed.", 500);
  }
};

const bulkUpdateStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { lead_ids = [], status_id } = req.body || {};
    const actorId = req.user?.id;

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      await t.rollback();
      return resError(res, "lead_ids[] is required.", 400);
    }
    if (!status_id) {
      await t.rollback();
      return resError(res, "status_id is required.", 400);
    }

    // Validate FK target to give a clear message instead of a generic DB error
    const status = await LeadStatus.findByPk(status_id, { transaction: t });
    if (!status) {
      await t.rollback();
      return resError(res, "Target status not found.", 404);
    }

    // Load existing leads
    const leads = await Lead.findAll({
      where: { id: { [Op.in]: lead_ids } },
      attributes: ["id", "status_id"],
      transaction: t,
    });

    const foundIds = new Set(leads.map((l) => l.id));
    const missing = lead_ids.filter((id) => !foundIds.has(id));

    // Partition into already_set vs to_update
    const byId = new Map(leads.map((l) => [l.id, l]));
    const skipped = [];
    const idsToUpdate = [];
    for (const id of foundIds) {
      const rec = byId.get(id);
      if (Number(rec.status_id) === Number(status_id)) {
        skipped.push({ id, reason: "already_set" });
      } else {
        idsToUpdate.push(id);
      }
    }

    // Apply update
    let updated = 0;
    if (idsToUpdate.length > 0) {
      const [count] = await Lead.update(
        { status_id, updated_by: actorId },
        { where: { id: { [Op.in]: idsToUpdate } }, transaction: t },
      );
      updated = count;
    }

    await t.commit();
    return resSuccess(res, {
      requested: lead_ids.length,
      updated,
      missing,
      skipped,
      status_id,
    });
  } catch (err) {
    console.error("bulkUpdateStatus Error:", err);
    try {
      await t.rollback();
    } catch {}
    return resError(res, "Bulk status update failed.", 500);
  }
};

const bulkUpdateSource = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { lead_ids = [], source_id } = req.body || {};
    const actorId = req.user?.id;

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      await t.rollback();
      return resError(res, "lead_ids[] is required.", 400);
    }
    if (!source_id) {
      await t.rollback();
      return resError(res, "source_id is required.", 400);
    }

    // Validate FK target
    const source = await LeadSource.findByPk(source_id, { transaction: t });
    if (!source) {
      await t.rollback();
      return resError(res, "Target source not found.", 404);
    }

    // Load existing leads
    const leads = await Lead.findAll({
      where: { id: { [Op.in]: lead_ids } },
      attributes: ["id", "source_id"],
      transaction: t,
    });

    const foundIds = new Set(leads.map((l) => l.id));
    const missing = lead_ids.filter((id) => !foundIds.has(id));

    // Partition into already_set vs to_update
    const byId = new Map(leads.map((l) => [l.id, l]));
    const skipped = [];
    const idsToUpdate = [];
    for (const id of foundIds) {
      const rec = byId.get(id);
      if (Number(rec.source_id) === Number(source_id)) {
        skipped.push({ id, reason: "already_set" });
      } else {
        idsToUpdate.push(id);
      }
    }

    // Apply update
    let updated = 0;
    if (idsToUpdate.length > 0) {
      const [count] = await Lead.update(
        { source_id, updated_by: actorId },
        { where: { id: { [Op.in]: idsToUpdate } }, transaction: t },
      );
      updated = count;
    }

    await t.commit();
    return resSuccess(res, {
      requested: lead_ids.length,
      updated,
      missing,
      skipped,
      source_id,
    });
  } catch (err) {
    console.error("bulkUpdateSource Error:", err);
    try {
      await t.rollback();
    } catch {}
    return resError(res, "Bulk source update failed.", 500);
  }
};

const bulkUpdateCampaign = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { lead_ids = [], campaign_id } = req.body || {};
    const actorId = req.user?.id;

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      await t.rollback();
      return resError(res, "lead_ids[] is required.", 400);
    }
    if (!campaign_id) {
      await t.rollback();
      return resError(res, "campaign_id is required.", 400);
    }

    // Validate FK target
    const campaign = await Campaign.findByPk(campaign_id, { transaction: t });
    if (!campaign) {
      await t.rollback();
      return resError(res, "Target campaign not found.", 404);
    }

    // Load existing leads
    const leads = await Lead.findAll({
      where: { id: { [Op.in]: lead_ids } },
      attributes: ["id", "campaign_id"],
      transaction: t,
    });

    const foundIds = new Set(leads.map((l) => l.id));
    const missing = lead_ids.filter((id) => !foundIds.has(id));

    // Partition into already_set vs to_update
    const byId = new Map(leads.map((l) => [l.id, l]));
    const skipped = [];
    const idsToUpdate = [];
    for (const id of foundIds) {
      const rec = byId.get(id);
      if (Number(rec.campaign_id) === Number(campaign_id)) {
        skipped.push({ id, reason: "already_set" });
      } else {
        idsToUpdate.push(id);
      }
    }

    // Apply update
    let updated = 0;
    if (idsToUpdate.length > 0) {
      const [count] = await Lead.update(
        { campaign_id, updated_by: actorId },
        { where: { id: { [Op.in]: idsToUpdate } }, transaction: t },
      );
      updated = count;
    }

    await t.commit();
    return resSuccess(res, {
      requested: lead_ids.length,
      updated,
      missing,
      skipped,
      campaign_id,
    });
  } catch (err) {
    console.error("bulkUpdateCampaign Error:", err);
    try {
      await t.rollback();
    } catch {}
    return resError(res, "Bulk campaign update failed.", 500);
  }
};

// --------------------------------------------------------------------------

module.exports = {
  bulkAssign,
  getAssignableTargets,
  bulkDeleteLeads,
  bulkUpdateStatus,
  bulkUpdateSource,
  bulkUpdateCampaign,
};
