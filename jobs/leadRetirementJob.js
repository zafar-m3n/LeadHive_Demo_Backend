const { Op, literal } = require("sequelize");
const { Lead, LeadAssignment, User, Role, Notification } = require("../models");
const { sequelize } = require("../config/database");

const RETIRED_STATUS_ID = 12;
const REGISTERED_STATUS_ID = 10;
const CONVERTED_STATUS_ID = 11;

const SALES_ROLE_VALUE = "sales_rep";
const REASSIGN_ALLOWED_ROLES = ["admin", "manager"];

const LATEST_ASSIGNMENT_IDS = literal(`(SELECT MAX(id) FROM lead_assignments GROUP BY lead_id)`);

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
    include: [{ model: Role, attributes: ["id", "value", "label"] }],
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
        [Op.notIn]: [REGISTERED_STATUS_ID, CONVERTED_STATUS_ID, RETIRED_STATUS_ID],
      },
    },
    include: [
      {
        model: LeadAssignment,
        required: true,
        where: {
          id: {
            [Op.in]: LATEST_ASSIGNMENT_IDS,
          },
          assigned_at: {
            [Op.lte]: cutoffDate,
          },
        },
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

async function createRetirementNotification(reassignmentUser, retiredCount, retirementDays) {
  if (!retiredCount || retiredCount <= 0) {
    return false;
  }

  await Notification.create({
    user_id: reassignmentUser.id,
    title: `${retiredCount} leads retired automatically`,
    message: `${retiredCount} leads assigned to sales agents for ${retirementDays}+ days were retired and reassigned to you.`,
  });

  return true;
}

async function previewLeadRetirement() {
  const retirementDays = getRetirementDays();
  const cutoffDate = getCutoffDate(retirementDays);
  const reassignmentUser = await getReassignmentUser();
  const eligibleLeads = await getEligibleRetirementLeads(cutoffDate);

  return {
    retirement_days: retirementDays,
    retired_status_id: RETIRED_STATUS_ID,
    skipped_status_ids: [REGISTERED_STATUS_ID, CONVERTED_STATUS_ID, RETIRED_STATUS_ID],
    cutoff_date: cutoffDate,
    eligible_count: eligibleLeads.length,
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

  const t = await sequelize.transaction();

  try {
    const eligibleLeads = await getEligibleRetirementLeads(cutoffDate, t);
    const leadIds = eligibleLeads.map((lead) => lead.id);

    let retiredCount = 0;
    let assignmentCreatedCount = 0;

    if (leadIds.length > 0) {
      const [updatedCount] = await Lead.update(
        {
          status_id: RETIRED_STATUS_ID,
          updated_by: reassignmentUser.id,
        },
        {
          where: {
            id: {
              [Op.in]: leadIds,
            },
          },
          transaction: t,
        },
      );

      retiredCount = updatedCount;

      const assignmentRows = leadIds.map((leadId) => ({
        lead_id: leadId,
        assignee_id: reassignmentUser.id,
        assigned_by: reassignmentUser.id,
      }));

      await LeadAssignment.bulkCreate(assignmentRows, { transaction: t });

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
      retired_status_id: RETIRED_STATUS_ID,
      skipped_status_ids: [REGISTERED_STATUS_ID, CONVERTED_STATUS_ID, RETIRED_STATUS_ID],
      cutoff_date: cutoffDate,
      eligible_count: leadIds.length,
      retired_count: retiredCount,
      assignment_created_count: assignmentCreatedCount,
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
};
