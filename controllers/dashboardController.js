const { Lead, LeadStatus, LeadSource, Campaign, LeadAssignment, Team, TeamMember, TeamManager } = require("../models");
const { Op, fn, col, literal } = require("sequelize");
const { resSuccess, resError } = require("../utils/responseUtil");

const RETIRED_STATUS_ID = 12;

// ==============================
// Shared helpers
// ==============================

/** Build the include used to scope by assignees via LeadAssignments */
const buildAssignmentInclude = (assigneeIdsOrNull) => {
  if (!assigneeIdsOrNull) {
    return {
      model: LeadAssignment,
      as: "LeadAssignments",
      attributes: [],
      required: false,
    };
  }

  return {
    model: LeadAssignment,
    as: "LeadAssignments",
    attributes: [],
    required: true,
    where: { assignee_id: { [Op.in]: assigneeIdsOrNull } },
  };
};

/** Get current month start and next month start */
const getCurrentMonthRange = () => {
  const now = new Date();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    monthStart,
    nextMonthStart,
  };
};

/** Normalize breakdown so it returns ALL statuses with zeroes where missing */
const normalizeStatusBreakdown = (allStatuses, countedRows) => {
  const map = new Map();

  for (const r of countedRows) {
    const statusId = r.status_id ?? r["status_id"];
    map.set(String(statusId), Number(r.count || 0));
  }

  return allStatuses.map((s) => ({
    status_id: s.id,
    count: map.get(String(s.id)) || 0,
    LeadStatus: { id: s.id, value: s.value, label: s.label },
  }));
};

/** Normalize breakdown so it returns ALL sources with zeroes where missing */
const normalizeSourceBreakdown = (allSources, countedRows) => {
  const map = new Map();

  for (const r of countedRows) {
    const sourceId = r.source_id ?? r["source_id"];
    map.set(String(sourceId), Number(r.count || 0));
  }

  return allSources.map((s) => ({
    source_id: s.id,
    count: map.get(String(s.id)) || 0,
    LeadSource: { id: s.id, value: s.value, label: s.label },
  }));
};

/** Normalize breakdown so it returns ALL campaigns with zeroes where missing */
const normalizeCampaignBreakdown = (allCampaigns, countedRows) => {
  const map = new Map();

  for (const r of countedRows) {
    const campaignId = r.campaign_id ?? r["campaign_id"];
    map.set(String(campaignId), Number(r.count || 0));
  }

  return allCampaigns.map((c) => ({
    campaign_id: c.id,
    count: map.get(String(c.id)) || 0,
    Campaign: { id: c.id, value: c.value, label: c.label },
  }));
};

/** Core summary builder used by role-specific handlers */
const buildSummary = async ({ assigneeIds = null, recentLimit = 10, includeAdminKPIs = false, adminUserId = null }) => {
  const assignmentInclude = buildAssignmentInclude(assigneeIds);

  const [allStatuses, allSources, allCampaigns] = await Promise.all([
    LeadStatus.findAll({
      attributes: ["id", "value", "label"],
      order: [["id", "ASC"]],
    }),
    LeadSource.findAll({
      attributes: ["id", "value", "label"],
      order: [["id", "ASC"]],
    }),
    Campaign.findAll({
      attributes: ["id", "value", "label"],
      order: [["id", "ASC"]],
    }),
  ]);

  const totalLeads = await Lead.count({
    include: [assignmentInclude],
    distinct: true,
    col: "id",
  });

  let unassignedLeads = 0;
  let newThisWeek = 0;
  let retiredLeads = {
    total: 0,
    thisMonth: 0,
    monthStart: null,
    nextMonthStart: null,
  };

  if (includeAdminKPIs) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { monthStart, nextMonthStart } = getCurrentMonthRange();

    const newStatus = allStatuses.find((s) => String(s.value || "").toLowerCase() === "new");
    const newStatusId = newStatus?.id ?? null;

    const [unassignedLeadsCount, newThisWeekCount, retiredTotalCount, retiredThisMonthCount] = await Promise.all([
      Lead.count({
        where: newStatusId
          ? {
              status_id: newStatusId,
            }
          : {
              id: null,
            },
      }),

      Lead.count({
        where: {
          created_at: {
            [Op.gte]: sevenDaysAgo,
          },
        },
        include: [assignmentInclude],
        distinct: true,
        col: "id",
      }),

      Lead.count({
        where: {
          status_id: RETIRED_STATUS_ID,
        },
      }),

      Lead.count({
        where: {
          status_id: RETIRED_STATUS_ID,
          updated_at: {
            [Op.gte]: monthStart,
            [Op.lt]: nextMonthStart,
          },
        },
      }),
    ]);

    unassignedLeads = unassignedLeadsCount;
    newThisWeek = newThisWeekCount;

    retiredLeads = {
      total: retiredTotalCount,
      thisMonth: retiredThisMonthCount,
      monthStart,
      nextMonthStart,
    };
  }

  const rawStatusRows = await Lead.findAll({
    attributes: ["status_id", [fn("COUNT", fn("DISTINCT", col("Lead.id"))), "count"]],
    include: [assignmentInclude, { model: LeadStatus, attributes: [] }],
    group: ["status_id"],
    raw: true,
  });

  const leadsByStatus = normalizeStatusBreakdown(allStatuses, rawStatusRows);

  const rawSourceRows = await Lead.findAll({
    attributes: ["source_id", [fn("COUNT", fn("DISTINCT", col("Lead.id"))), "count"]],
    include: [assignmentInclude, { model: LeadSource, attributes: [] }],
    group: ["source_id"],
    raw: true,
  });

  const leadsBySource = normalizeSourceBreakdown(allSources, rawSourceRows);

  const rawCampaignRows = await Lead.findAll({
    attributes: ["campaign_id", [fn("COUNT", fn("DISTINCT", col("Lead.id"))), "count"]],
    include: [assignmentInclude, { model: Campaign, attributes: [] }],
    group: ["campaign_id"],
    raw: true,
  });

  const leadsByCampaign = normalizeCampaignBreakdown(allCampaigns, rawCampaignRows);

  const recentLeads = await Lead.findAll({
    attributes: ["id", "first_name", "last_name", "email", "company", "created_at"],
    include: [
      assignmentInclude,
      { model: LeadStatus, attributes: ["id", "value", "label"] },
      { model: LeadSource, attributes: ["id", "value", "label"] },
      { model: Campaign, attributes: ["id", "value", "label"] },
    ],
    order: [["created_at", "DESC"]],
    limit: recentLimit,
  });

  return {
    totalLeads,
    leadsByStatus,
    leadsBySource,
    leadsByCampaign,
    recentLeads,
    ...(includeAdminKPIs
      ? {
          unassignedLeads,
          newThisWeek,
          retiredLeads,
        }
      : {}),
  };
};

/** Resolve manager's assignee scope: self + all users in teams they manage */
const resolveManagerAssignees = async (managerId) => {
  const tmRows = await TeamManager.findAll({
    where: { manager_id: managerId },
    attributes: ["team_id"],
    raw: true,
  });

  const teamIds = tmRows.map((r) => r.team_id);

  if (teamIds.length === 0) {
    return [managerId];
  }

  const memberRows = await TeamMember.findAll({
    where: { team_id: { [Op.in]: teamIds } },
    attributes: ["user_id"],
    raw: true,
  });

  const memberIds = memberRows.map((r) => r.user_id);

  return Array.from(new Set([managerId, ...memberIds]));
};

// ==============================
// Role-specific summaries
// ==============================

/**
 * GET /api/v1/dashboard/summary/admin?recentLimit=5
 */
const getAdminSummary = async (req, res) => {
  try {
    const recentLimit = Number(req.query.recentLimit) > 0 ? Number(req.query.recentLimit) : 10;

    const data = await buildSummary({
      assigneeIds: null,
      recentLimit,
      includeAdminKPIs: true,
      adminUserId: req.user.id,
    });

    return resSuccess(res, data);
  } catch (err) {
    console.error("Dashboard Admin Summary Error:", err);
    return resError(res, "Failed to fetch admin summary");
  }
};

/**
 * GET /api/v1/dashboard/summary/manager?recentLimit=5
 */
const getManagerSummary = async (req, res) => {
  try {
    const recentLimit = Number(req.query.recentLimit) > 0 ? Number(req.query.recentLimit) : 10;

    const manager_id = req.user.id;

    const assignee_ids = await resolveManagerAssignees(manager_id);

    const inScopeLeadIds = (() => {
      if (!assignee_ids?.length) {
        return literal("(SELECT 0)");
      }

      const ids = assignee_ids.join(",");

      return literal(`
        (
          SELECT la.lead_id
          FROM lead_assignments la
          INNER JOIN (
            SELECT lead_id, MAX(id) AS max_id
            FROM lead_assignments
            GROUP BY lead_id
          ) t ON t.max_id = la.id
          WHERE la.assignee_id IN (${ids})
        )
      `);
    })();

    const selfLeadIds = literal(`
      (
        SELECT la.lead_id
        FROM lead_assignments la
        INNER JOIN (
          SELECT lead_id, MAX(id) AS max_id
          FROM lead_assignments
          GROUP BY lead_id
        ) t ON t.max_id = la.id
        WHERE la.assignee_id = ${manager_id}
      )
    `);

    const [self_leads, team_leads] = await Promise.all([
      Lead.count({
        where: {
          id: {
            [Op.in]: selfLeadIds,
          },
        },
      }),
      Lead.count({
        where: {
          id: {
            [Op.in]: inScopeLeadIds,
          },
        },
      }),
    ]);

    const { User } = require("../models");

    const teamUsers = await User.findAll({
      where: {
        id: {
          [Op.in]: assignee_ids,
        },
      },
      attributes: ["id", "full_name", "email"],
      order: [["full_name", "ASC"]],
      raw: true,
    });

    const latestGroupedRows = await LeadAssignment.findAll({
      attributes: ["assignee_id", [fn("COUNT", col("LeadAssignment.lead_id")), "count"]],
      where: {
        id: {
          [Op.in]: literal(`(SELECT MAX(id) FROM lead_assignments GROUP BY lead_id)`),
        },
        assignee_id: {
          [Op.in]: assignee_ids,
        },
      },
      group: ["assignee_id"],
      raw: true,
    });

    const countMap = new Map();

    for (const r of latestGroupedRows) {
      countMap.set(String(r.assignee_id), Number(r.count || 0));
    }

    const leads_by_member = teamUsers
      .map((u) => ({
        assignee_id: u.id,
        count: countMap.get(String(u.id)) || 0,
        assignee: {
          id: u.id,
          full_name: u.full_name,
          email: u.email,
        },
      }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }

        return (a.assignee.full_name || "").localeCompare(b.assignee.full_name || "");
      });

    const recent_team_leads = await Lead.findAll({
      attributes: ["id", "first_name", "last_name", "email", "company", "created_at"],
      where: {
        id: {
          [Op.in]: inScopeLeadIds,
        },
      },
      include: [
        { model: LeadStatus, attributes: ["id", "value", "label"] },
        { model: LeadSource, attributes: ["id", "value", "label"] },
        { model: Campaign, attributes: ["id", "value", "label"] },
      ],
      order: [["created_at", "DESC"]],
      limit: recentLimit,
    });

    return resSuccess(res, {
      self_leads,
      team_leads,
      leads_by_member,
      recent_team_leads,
    });
  } catch (err) {
    console.error("Dashboard Manager Summary Error:", err);
    return resError(res, "Failed to fetch manager summary");
  }
};

/**
 * GET /api/v1/dashboard/summary/sales_rep?recentLimit=8
 */
const getSalesRepSummary = async (req, res) => {
  try {
    const recentLimit = Number(req.query.recentLimit) > 0 ? Number(req.query.recentLimit) : 8;

    const userId = req.user.id;

    const latestAssignedToMeLeadIds = literal(`
      (
        SELECT la.lead_id
        FROM lead_assignments la
        INNER JOIN (
          SELECT lead_id, MAX(id) AS max_id
          FROM lead_assignments
          GROUP BY lead_id
        ) t ON t.max_id = la.id
        WHERE la.assignee_id = ${userId}
      )
    `);

    const [allStatuses, allSources, allCampaigns] = await Promise.all([
      LeadStatus.findAll({
        attributes: ["id", "value", "label"],
        order: [["id", "ASC"]],
      }),
      LeadSource.findAll({
        attributes: ["id", "value", "label"],
        order: [["id", "ASC"]],
      }),
      Campaign.findAll({
        attributes: ["id", "value", "label"],
        order: [["id", "ASC"]],
      }),
    ]);

    const newStatus = allStatuses.find((s) => String(s.value || "").toLowerCase() === "new");

    const newStatusId = newStatus?.id ?? null;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const assigned = await Lead.count({
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
      },
    });

    const newThisWeek = await Lead.count({
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
        created_at: {
          [Op.gte]: sevenDaysAgo,
        },
      },
    });

    const inboxNew = newStatusId
      ? await Lead.count({
          where: {
            id: {
              [Op.in]: latestAssignedToMeLeadIds,
            },
            status_id: newStatusId,
          },
        })
      : 0;

    const avgAgeRow = await Lead.findOne({
      attributes: [[fn("AVG", literal("DATEDIFF(NOW(), created_at)")), "avg_days"]],
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
      },
      raw: true,
    });

    const avgAgeDays = Number(avgAgeRow?.avg_days || 0);

    const rawStatusRows = await Lead.findAll({
      attributes: ["status_id", [fn("COUNT", literal("*")), "count"]],
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
      },
      group: ["status_id"],
      raw: true,
    });

    const rawSourceRows = await Lead.findAll({
      attributes: ["source_id", [fn("COUNT", literal("*")), "count"]],
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
      },
      group: ["source_id"],
      raw: true,
    });

    const rawCampaignRows = await Lead.findAll({
      attributes: ["campaign_id", [fn("COUNT", literal("*")), "count"]],
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
      },
      group: ["campaign_id"],
      raw: true,
    });

    const statusCountMap = new Map(rawStatusRows.map((r) => [String(r.status_id), Number(r.count || 0)]));

    const byStatus = allStatuses.map((s) => ({
      status_id: s.id,
      count: statusCountMap.get(String(s.id)) || 0,
      LeadStatus: {
        id: s.id,
        value: s.value,
        label: s.label,
      },
    }));

    const sourceCountMap = new Map(
      rawSourceRows.filter((r) => r.source_id != null).map((r) => [String(r.source_id), Number(r.count || 0)]),
    );

    const bySource = allSources.map((s) => ({
      source_id: s.id,
      count: sourceCountMap.get(String(s.id)) || 0,
      LeadSource: {
        id: s.id,
        value: s.value,
        label: s.label,
      },
    }));

    const campaignCountMap = new Map(
      rawCampaignRows.filter((r) => r.campaign_id != null).map((r) => [String(r.campaign_id), Number(r.count || 0)]),
    );

    const byCampaign = allCampaigns.map((c) => ({
      campaign_id: c.id,
      count: campaignCountMap.get(String(c.id)) || 0,
      Campaign: {
        id: c.id,
        value: c.value,
        label: c.label,
      },
    }));

    const recentAssigned = await LeadAssignment.findAll({
      attributes: ["id", "lead_id", "assignee_id", "assigned_at"],
      where: {
        assignee_id: userId,
        id: {
          [Op.in]: literal(`(SELECT MAX(id) FROM lead_assignments GROUP BY lead_id)`),
        },
      },
      include: [
        {
          model: Lead,
          attributes: ["id", "first_name", "last_name", "email", "company", "created_at", "updated_at"],
          include: [
            { model: LeadStatus, attributes: ["id", "value", "label"] },
            { model: LeadSource, attributes: ["id", "value", "label"] },
            { model: Campaign, attributes: ["id", "value", "label"] },
          ],
        },
      ],
      order: [["assigned_at", "DESC"]],
      limit: recentLimit,
    });

    const recentUpdates = await Lead.findAll({
      attributes: ["id", "first_name", "last_name", "email", "company", "created_at", "updated_at"],
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
      },
      include: [
        { model: LeadStatus, attributes: ["id", "value", "label"] },
        { model: LeadSource, attributes: ["id", "value", "label"] },
        { model: Campaign, attributes: ["id", "value", "label"] },
      ],
      order: [["updated_at", "DESC"]],
      limit: recentLimit,
    });

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);

    const dailyRows = await Lead.findAll({
      attributes: [
        [literal("DATE(created_at)"), "day"],
        [fn("COUNT", literal("*")), "count"],
      ],
      where: {
        id: {
          [Op.in]: latestAssignedToMeLeadIds,
        },
        created_at: {
          [Op.gte]: fourteenDaysAgo,
        },
      },
      group: [literal("DATE(created_at)")],
      order: [literal("DATE(created_at) ASC")],
      raw: true,
    });

    const dailyIntakeLast14 = dailyRows.map((r) => ({
      day: r.day,
      count: Number(r.count || 0),
    }));

    return resSuccess(res, {
      totals: {
        assigned,
        newThisWeek,
        inboxNew,
        avgAgeDays,
      },
      byStatus,
      bySource,
      byCampaign,
      recentAssigned,
      recentUpdates,
      dailyIntakeLast14,
    });
  } catch (err) {
    console.error("Dashboard Sales Rep Summary Error:", err);
    return resError(res, "Failed to fetch sales rep summary");
  }
};

// ==============================
// Assignments - self
// ==============================

/**
 * GET /api/v1/dashboard/assignments
 */
const getMyAssignments = async (req, res) => {
  try {
    const { id } = req.user;

    const assignments = await LeadAssignment.findAll({
      where: {
        assignee_id: id,
      },
      include: [
        {
          model: Lead,
          include: [
            { model: LeadStatus, attributes: ["id", "value", "label"] },
            { model: LeadSource, attributes: ["id", "value", "label"] },
            { model: Campaign, attributes: ["id", "value", "label"] },
          ],
        },
      ],
      order: [["assigned_at", "DESC"]],
      limit: 25,
    });

    return resSuccess(res, assignments);
  } catch (err) {
    console.error("Dashboard MyAssignments Error:", err);
    return resError(res, "Failed to fetch my assignments");
  }
};

module.exports = {
  getAdminSummary,
  getManagerSummary,
  getSalesRepSummary,
  getMyAssignments,
};
