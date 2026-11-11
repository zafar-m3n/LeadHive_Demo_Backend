const { Op, literal } = require("sequelize");
const { Lead, LeadAssignment, LeadStatus, User, Role, Notification } = require("../models");
const { sequelize } = require("../config/database");

const REGISTERED_STATUS_ID = 10;
const CONVERTED_STATUS_ID = 11;

const SALES_ROLE_VALUE = "sales_rep";
const REASSIGN_ALLOWED_ROLES = ["admin", "manager"];
const RETIRED_VALUE_PREFIX = "retired_";
const RETIRED_VALUE = "retired";

function isRetiredStatusValue(value) {
  return value === RETIRED_VALUE || String(value || "").startsWith(RETIRED_VALUE_PREFIX);
}

const LATEST_ASSIGNMENT_IDS = literal(`
  (
    SELECT MAX(id)
    FROM lead_assignments
    GROUP BY lead_id
  )
`);

function getRetirementDays() {
  const days = Number(process.env.NODE_LEADHIVE_RETIREMENT_DAYS || 14);

  if (!Number.isFinite(days) || days <= 0) {
    return 14;
  }

  return days;
}

function getCutoffDate(retirementDays) {
  return new Date(Date.now() - retirementDays * 24 * 60 * 60 * 1000);
}

function buildActivityCutoffCondition(cutoffDate) {
  const escapedCutoffDate = sequelize.escape(cutoffDate);

  return literal(`
    GREATEST(
      COALESCE(
        (
          SELECT MAX(ln.created_at)
          FROM lead_notes ln
          WHERE ln.lead_id = \`Lead\`.\`id\`
        ),
        '1970-01-01'
      ),
      (
        SELECT la.assigned_at
        FROM lead_assignments la
        WHERE la.lead_id = \`Lead\`.\`id\`
        ORDER BY la.id DESC
        LIMIT 1
      )
    ) <= ${escapedCutoffDate}
  `);
}

async function getReassignmentUser() {
  const email = process.env.NODE_LEADHIVE_RETIREMENT_REASSIGN_EMAIL;

  if (!email || String(email).trim().length === 0) {
    throw new Error("NODE_LEADHIVE_RETIREMENT_REASSIGN_EMAIL is required.");
  }

  const user = await User.findOne({
    where: {
      email: String(email).trim().toLowerCase(),
      is_active: true,
    },
    include: [
      {
        model: Role,
        attributes: ["id", "value", "label"],
      },
    ],
    attributes: ["id", "full_name", "email", "role_id", "is_active"],
  });

  if (!user) {
    throw new Error("Retirement reassignment user not found or inactive.");
  }

  const roleValue = user.Role?.value || null;

  if (!REASSIGN_ALLOWED_ROLES.includes(roleValue)) {
    throw new Error("Retirement reassignment user must be an admin or manager.");
  }

  return user;
}

async function getEligibleRetirementLeads(cutoffDate, transaction = null) {
  return Lead.findAll({
    where: {
      status_id: {
        [Op.notIn]: [REGISTERED_STATUS_ID, CONVERTED_STATUS_ID],
      },
      [Op.and]: [buildActivityCutoffCondition(cutoffDate)],
    },
    include: [
      {
        model: LeadStatus,
        required: true,
        attributes: ["id", "value", "label"],
        where: {
          value: {
            [Op.notLike]: `${RETIRED_VALUE_PREFIX}%`,
            [Op.ne]: RETIRED_VALUE,
          },
        },
      },
      {
        model: LeadAssignment,
        required: true,
        where: {
          id: {
            [Op.in]: LATEST_ASSIGNMENT_IDS,
          },
        },
        attributes: ["id", "lead_id", "assignee_id", "assigned_at"],
        include: [
          {
            model: User,
            as: "assignee",
            required: true,
            attributes: ["id", "full_name", "email", "role_id"],
            include: [
              {
                model: Role,
                required: true,
                attributes: ["id", "value", "label"],
                where: {
                  value: SALES_ROLE_VALUE,
                },
              },
            ],
          },
        ],
      },
    ],
    attributes: ["id", "status_id"],
    transaction,
  });
}

async function getOrCreateRetiredStatus(originalStatus, transaction) {
  const value = `${RETIRED_VALUE_PREFIX}${originalStatus.value}`.slice(0, 40);
  const label = `Retired ${originalStatus.label}`.slice(0, 80);

  const [status] = await LeadStatus.findOrCreate({
    where: { value },
    defaults: { value, label },
    transaction,
  });

  return status;
}

function groupLeadsByStatus(leads) {
  const groups = new Map();

  for (const lead of leads) {
    const statusId = lead.status_id;

    if (!groups.has(statusId)) {
      groups.set(statusId, {
        originalStatus: lead.LeadStatus,
        leadIds: [],
      });
    }

    groups.get(statusId).leadIds.push(lead.id);
  }

  return groups;
}

async function createRetirementNotification(reassignmentUser, retiredCount, retirementDays) {
  if (!retiredCount || retiredCount <= 0) {
    return false;
  }

  await Notification.create({
    user_id: reassignmentUser.id,
    title: `${retiredCount} leads retired automatically`,
    message: `${retiredCount} inactive leads were retired and reassigned to you after ${retirementDays}+ days without follow-up activity.`,
  });

  return true;
}

async function previewLeadRetirement() {
  const retirementDays = getRetirementDays();
  const cutoffDate = getCutoffDate(retirementDays);
  const reassignmentUser = await getReassignmentUser();
  const eligibleLeads = await getEligibleRetirementLeads(cutoffDate);
  const groups = groupLeadsByStatus(eligibleLeads);

  const statusBreakdown = Array.from(groups.values()).map((group) => ({
    original_status: group.originalStatus.label,
    retired_status: `Retired ${group.originalStatus.label}`,
    count: group.leadIds.length,
  }));

  return {
    retirement_days: retirementDays,
    cutoff_date: cutoffDate,
    eligible_count: eligibleLeads.length,
    status_breakdown: statusBreakdown,
    reassignment_user: {
      id: reassignmentUser.id,
      full_name: reassignmentUser.full_name,
      email: reassignmentUser.email,
      role: reassignmentUser.Role?.value || null,
    },
  };
}

async function runLeadRetirement() {
  const retirementDays = getRetirementDays();
  const cutoffDate = getCutoffDate(retirementDays);
  const reassignmentUser = await getReassignmentUser();
  const retiredAt = new Date();

  const t = await sequelize.transaction();

  try {
    const eligibleLeads = await getEligibleRetirementLeads(cutoffDate, t);
    const leadIds = eligibleLeads.map((lead) => lead.id);
    const groups = groupLeadsByStatus(eligibleLeads);

    let retiredCount = 0;
    let assignmentCreatedCount = 0;
    const statusBreakdown = [];

    if (leadIds.length > 0) {
      for (const [originalStatusId, group] of groups) {
        const retiredStatus = await getOrCreateRetiredStatus(group.originalStatus, t);

        const [updatedCount] = await Lead.update(
          {
            status_id: retiredStatus.id,
            updated_by: reassignmentUser.id,
            updated_at: retiredAt,
          },
          {
            where: {
              id: {
                [Op.in]: group.leadIds,
              },
              status_id: originalStatusId,
            },
            transaction: t,
          },
        );

        retiredCount += updatedCount;

        statusBreakdown.push({
          original_status: group.originalStatus.label,
          retired_status: retiredStatus.label,
          retired_status_id: retiredStatus.id,
          count: updatedCount,
        });
      }

      const assignmentRows = leadIds.map((leadId) => ({
        lead_id: leadId,
        assignee_id: reassignmentUser.id,
        assigned_by: reassignmentUser.id,
      }));

      await LeadAssignment.bulkCreate(assignmentRows, {
        transaction: t,
      });

      assignmentCreatedCount = assignmentRows.length;
    }

    await t.commit();

    let notificationCreated = false;

    try {
      notificationCreated = await createRetirementNotification(reassignmentUser, retiredCount, retirementDays);
    } catch (err) {
      console.error("CreateRetirementNotification Error:", err.message);
    }

    return {
      retirement_days: retirementDays,
      cutoff_date: cutoffDate,
      eligible_count: leadIds.length,
      retired_count: retiredCount,
      assignment_created_count: assignmentCreatedCount,
      status_breakdown: statusBreakdown,
      notification_created: notificationCreated,
      reassignment_user: {
        id: reassignmentUser.id,
        full_name: reassignmentUser.full_name,
        email: reassignmentUser.email,
        role: reassignmentUser.Role?.value || null,
      },
    };
  } catch (err) {
    try {
      await t.rollback();
    } catch (_) {}

    throw err;
  }
}

module.exports = {
  previewLeadRetirement,
  runLeadRetirement,
  isRetiredStatusValue,
};
