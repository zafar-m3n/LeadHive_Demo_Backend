const { Op, fn, col, literal } = require("sequelize");
const {
  Lead,
  LeadStatus,
  LeadSource,
  Campaign,
  LeadNote,
  LeadAssignment,
  User,
  Role,
  TeamMember,
  TeamManager,
} = require("../models");
const { resSuccess, resError } = require("../utils/responseUtil");

// Subquery: latest assignment row id per lead
const LATEST_ASSIGNMENT_IDS = literal(`(SELECT MAX(id) FROM lead_assignments GROUP BY lead_id)`);

const FIRST_YEAR = 2025;
const LAST_YEAR = 2035;
const REPORT_TYPES = {
  MONTHLY: "monthly",
  DAILY: "daily",
  CUSTOM_RANGE: "custom_range",
};

const SALES_LIKE_ROLES = ["sales_rep", "retention"];

// =============================
// Helpers
// =============================

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const isValidDateObject = (value) => value instanceof Date && !Number.isNaN(value.getTime());

const toUtcDateStart = (dateStr) => {
  if (!dateStr || typeof dateStr !== "string") return null;

  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  if (
    !isValidDateObject(date) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

const toUtcDateEnd = (dateStr) => {
  const start = toUtcDateStart(dateStr);
  if (!start) return null;

  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 23, 59, 59, 999));
};

const toYMD = (date) => {
  if (!isValidDateObject(date)) return null;
  return date.toISOString().slice(0, 10);
};

const buildMonthlyRange = (year, month) => {
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) {
    throw new Error(`Year must be between ${FIRST_YEAR} and ${LAST_YEAR}`);
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Month must be between 1 and 12");
  }

  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  return {
    report_type: REPORT_TYPES.MONTHLY,
    year,
    month,
    date: null,
    from_date: toYMD(start),
    to_date: toYMD(end),
    start,
    end,
    label: `${monthNames[month - 1]} ${year}`,
  };
};

const buildDailyRange = (dateStr) => {
  const start = toUtcDateStart(dateStr);
  const end = toUtcDateEnd(dateStr);

  if (!start || !end) {
    throw new Error("A valid date is required for daily reports");
  }

  return {
    report_type: REPORT_TYPES.DAILY,
    year: null,
    month: null,
    date: toYMD(start),
    from_date: toYMD(start),
    to_date: toYMD(start),
    start,
    end,
    label: toYMD(start),
  };
};

const buildCustomRange = (fromDateStr, toDateStr) => {
  const start = toUtcDateStart(fromDateStr);
  const end = toUtcDateEnd(toDateStr);

  if (!start || !end) {
    throw new Error("Valid from_date and to_date are required for custom range reports");
  }

  if (start > end) {
    throw new Error("from_date cannot be after to_date");
  }

  return {
    report_type: REPORT_TYPES.CUSTOM_RANGE,
    year: null,
    month: null,
    date: null,
    from_date: toYMD(start),
    to_date: toYMD(end),
    start,
    end,
    label: `${toYMD(start)} to ${toYMD(end)}`,
  };
};

function parseReportPeriod(req) {
  const reportType = String(req.query.report_type || "")
    .trim()
    .toLowerCase();

  if (!reportType) {
    throw new Error("report_type is required");
  }

  if (reportType === REPORT_TYPES.MONTHLY) {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    return buildMonthlyRange(year, month);
  }

  if (reportType === REPORT_TYPES.DAILY) {
    return buildDailyRange(req.query.date);
  }

  if (reportType === REPORT_TYPES.CUSTOM_RANGE) {
    return buildCustomRange(req.query.from_date, req.query.to_date);
  }

  throw new Error("report_type must be one of: monthly, daily, custom_range");
}

/**
 * For a manager, resolve the "team scope":
 *  - self (manager)
 *  - all members of teams they manage
 *
 * Returns array of user_ids (unique).
 */
const resolveManagerAssignees = async (managerId) => {
  const tmRows = await TeamManager.findAll({
    where: { manager_id: managerId },
    attributes: ["team_id"],
    raw: true,
  });

  const teamIds = tmRows.map((row) => row.team_id);
  if (!teamIds.length) return [managerId];

  const memberRows = await TeamMember.findAll({
    where: { team_id: { [Op.in]: teamIds } },
    attributes: ["user_id"],
    raw: true,
  });

  const memberIds = memberRows.map((row) => row.user_id);

  return Array.from(new Set([managerId, ...memberIds]));
};

const resolveScope = async ({ userId, role }) => {
  if (role === "admin") {
    return {
      scopeType: "all",
      scopedUserIds: null,
    };
  }

  if (role === "manager") {
    const scopedUserIds = await resolveManagerAssignees(userId);

    return {
      scopeType: "team",
      scopedUserIds,
    };
  }

  if (SALES_LIKE_ROLES.includes(role)) {
    return {
      scopeType: "self",
      scopedUserIds: [userId],
    };
  }

  throw new Error("Forbidden for this role");
};

const getAccessibleAgents = async ({ scopeType, scopedUserIds, userId }) => {
  const agentWhere = { is_active: true };

  if (scopeType === "self") {
    agentWhere.id = userId;
  } else if (scopeType === "team" && Array.isArray(scopedUserIds) && scopedUserIds.length) {
    agentWhere.id = { [Op.in]: scopedUserIds };
  }

  const agentUsers = await User.findAll({
    where: agentWhere,
    include: [
      {
        model: Role,
        attributes: [],
        where: { value: { [Op.in]: SALES_LIKE_ROLES } },
      },
    ],
    attributes: ["id", "full_name", "email"],
    order: [["full_name", "ASC"]],
  });

  return agentUsers;
};

const resolveSelectedAgentIds = ({ req, accessibleAgents, role, userId }) => {
  const rawAgentId = req.query.agent_id;

  if (
    rawAgentId === undefined ||
    rawAgentId === null ||
    rawAgentId === "" ||
    String(rawAgentId).toLowerCase() === "all"
  ) {
    return accessibleAgents.map((agent) => agent.id);
  }

  const agentId = Number(rawAgentId);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    throw new Error("agent_id must be a valid integer or 'all'");
  }

  const isAccessible = accessibleAgents.some((agent) => agent.id === agentId);

  if (!isAccessible) {
    if (SALES_LIKE_ROLES.includes(role) && agentId !== userId) {
      throw new Error("You can only view your own reports");
    }
    throw new Error("Selected agent is outside your allowed scope");
  }

  return [agentId];
};

const buildNotesWhere = ({ start, end, agentIds, scopeType }) => {
  const notesWhere = {
    created_at: {
      [Op.gte]: start,
      [Op.lte]: end,
    },
  };

  if (Array.isArray(agentIds) && agentIds.length) {
    notesWhere.author_id = { [Op.in]: agentIds };
  } else if (scopeType !== "all") {
    notesWhere.author_id = { [Op.in]: [-1] };
  }

  return notesWhere;
};

const buildCallStatistics = async ({ agentUsers, notesWhere }) => {
  let callStatistics = {
    totalCalls: 0,
    byAgent: [],
  };

  let callCountsMap = new Map();

  if (!agentUsers.length) {
    return { callStatistics, callCountsMap };
  }

  const callStatsRows = await LeadNote.findAll({
    where: notesWhere,
    attributes: ["author_id", [fn("COUNT", col("LeadNote.id")), "call_count"]],
    group: ["author_id"],
    raw: true,
  });

  callCountsMap = new Map(callStatsRows.map((row) => [Number(row.author_id), Number(row.call_count || 0)]));

  const byAgent = agentUsers.map((user) => {
    const callCount = callCountsMap.get(user.id) || 0;

    return {
      user_id: user.id,
      full_name: user.full_name,
      email: user.email,
      call_count: callCount,
    };
  });

  const totalCalls = byAgent.reduce((sum, item) => sum + item.call_count, 0);

  callStatistics = {
    totalCalls,
    byAgent: byAgent.sort((a, b) => b.call_count - a.call_count || a.full_name.localeCompare(b.full_name)),
  };

  return { callStatistics, callCountsMap };
};

const buildCallsBySource = async ({ agentUsers, notesWhere, start, end }) => {
  if (!agentUsers.length) return [];

  const callsBySourceRows = await LeadNote.findAll({
    where: notesWhere,
    attributes: [
      [col("Lead.source_id"), "source_id"],
      [fn("COUNT", col("LeadNote.id")), "call_count"],
    ],
    include: [
      {
        model: Lead,
        attributes: [],
        where: {
          updated_at: {
            [Op.gte]: start,
            [Op.lte]: end,
          },
        },
        include: [
          {
            model: LeadSource,
            attributes: ["id", "label", "value"],
          },
        ],
      },
    ],
    group: ["Lead.source_id", "Lead->LeadSource.id", "Lead->LeadSource.label", "Lead->LeadSource.value"],
    raw: true,
  });

  return callsBySourceRows.map((row) => ({
    source_id: row.source_id,
    label: row["Lead.LeadSource.label"] || null,
    value: row["Lead.LeadSource.value"] || null,
    call_count: Number(row.call_count || 0),
  }));
};

const buildCallsByCampaign = async ({ agentUsers, notesWhere, start, end }) => {
  if (!agentUsers.length) return [];

  const callsByCampaignRows = await LeadNote.findAll({
    where: notesWhere,
    attributes: [
      [col("Lead.campaign_id"), "campaign_id"],
      [fn("COUNT", col("LeadNote.id")), "call_count"],
    ],
    include: [
      {
        model: Lead,
        attributes: [],
        where: {
          updated_at: {
            [Op.gte]: start,
            [Op.lte]: end,
          },
        },
        include: [
          {
            model: Campaign,
            attributes: ["id", "label", "value"],
          },
        ],
      },
    ],
    group: ["Lead.campaign_id", "Lead->Campaign.id", "Lead->Campaign.label", "Lead->Campaign.value"],
    raw: true,
  });

  return callsByCampaignRows.map((row) => ({
    campaign_id: row.campaign_id,
    label: row["Lead.Campaign.label"] || null,
    value: row["Lead.Campaign.value"] || null,
    call_count: Number(row.call_count || 0),
  }));
};

const buildSalesFromCalls = async ({
  convertedStatus,
  start,
  end,
  notesWhere,
  scopeType,
  scopedUserIds,
  userId,
  selectedAgentIds,
}) => {
  const salesFromCalls = {
    totalCustomers: 0,
    bySource: [],
    byCampaign: [],
  };

  const conversionsMap = new Map();

  if (!convertedStatus || !selectedAgentIds.length) {
    return { salesFromCalls, conversionsMap };
  }

  const leadsWithCallsRows = await LeadNote.findAll({
    where: notesWhere,
    attributes: [[fn("DISTINCT", col("lead_id")), "lead_id"]],
    raw: true,
  });

  const leadIdsWithCallsInPeriod = new Set(
    leadsWithCallsRows.map((row) => Number(row.lead_id)).filter((id) => !Number.isNaN(id)),
  );

  if (!leadIdsWithCallsInPeriod.size) {
    return { salesFromCalls, conversionsMap };
  }

  const salesWhere = {
    status_id: convertedStatus.id,
    updated_at: {
      [Op.gte]: start,
      [Op.lte]: end,
    },
  };

  const assignmentWhere = {
    id: { [Op.in]: LATEST_ASSIGNMENT_IDS },
  };

  if (scopeType === "team" && Array.isArray(scopedUserIds) && scopedUserIds.length) {
    assignmentWhere.assignee_id = { [Op.in]: scopedUserIds };
  } else if (scopeType === "self") {
    assignmentWhere.assignee_id = userId;
  }

  const convertedLeadsRaw = await Lead.findAll({
    where: salesWhere,
    attributes: ["id", "source_id", "campaign_id"],
    include: [
      {
        model: LeadSource,
        attributes: ["id", "label", "value"],
      },
      {
        model: Campaign,
        attributes: ["id", "label", "value"],
      },
      {
        model: LeadAssignment,
        as: "LeadAssignments",
        attributes: ["assignee_id"],
        required: true,
        where: assignmentWhere,
      },
    ],
  });

  const allowedSelectedAgentIds = new Set(selectedAgentIds);

  const convertedLeads = convertedLeadsRaw.filter((lead) => {
    if (!leadIdsWithCallsInPeriod.has(Number(lead.id))) return false;

    const latestAssignment = Array.isArray(lead.LeadAssignments) ? lead.LeadAssignments[0] : null;
    const assigneeId = latestAssignment ? Number(latestAssignment.assignee_id) : null;

    return assigneeId && allowedSelectedAgentIds.has(assigneeId);
  });

  const bySourceMap = new Map();
  const byCampaignMap = new Map();

  for (const lead of convertedLeads) {
    const sourceId = lead.source_id || 0;
    const sourceMapKey = String(sourceId);

    const currentSource = bySourceMap.get(sourceMapKey) || {
      source_id: sourceId,
      label: lead.LeadSource ? lead.LeadSource.label : null,
      value: lead.LeadSource ? lead.LeadSource.value : null,
      count: 0,
    };

    currentSource.count += 1;
    bySourceMap.set(sourceMapKey, currentSource);

    const campaignId = lead.campaign_id || 0;
    const campaignMapKey = String(campaignId);

    const currentCampaign = byCampaignMap.get(campaignMapKey) || {
      campaign_id: campaignId,
      label: lead.Campaign ? lead.Campaign.label : null,
      value: lead.Campaign ? lead.Campaign.value : null,
      count: 0,
    };

    currentCampaign.count += 1;
    byCampaignMap.set(campaignMapKey, currentCampaign);

    const latestAssignment = Array.isArray(lead.LeadAssignments) ? lead.LeadAssignments[0] : null;
    const assigneeId = latestAssignment ? Number(latestAssignment.assignee_id) : null;

    if (assigneeId && allowedSelectedAgentIds.has(assigneeId)) {
      const previous = conversionsMap.get(assigneeId) || 0;
      conversionsMap.set(assigneeId, previous + 1);
    }
  }

  return {
    salesFromCalls: {
      totalCustomers: convertedLeads.length,
      bySource: Array.from(bySourceMap.values()).sort((a, b) => b.count - a.count),
      byCampaign: Array.from(byCampaignMap.values()).sort((a, b) => b.count - a.count),
    },
    conversionsMap,
  };
};

const buildAgentPerformance = async ({
  agentUsers,
  allStatuses,
  allSources,
  allCampaigns,
  start,
  end,
  callCountsMap,
  conversionsMap,
}) => {
  let agentPerformance = {
    statuses: allStatuses.map((status) => ({
      id: status.id,
      value: status.value,
      label: status.label,
    })),
    sources: allSources.map((source) => ({
      id: source.id,
      value: source.value,
      label: source.label,
    })),
    campaigns: allCampaigns.map((campaign) => ({
      id: campaign.id,
      value: campaign.value,
      label: campaign.label,
    })),
    agents: [],
  };

  const agentIds = agentUsers.map((user) => user.id);

  if (!agentIds.length) {
    return agentPerformance;
  }

  const statusRows = await LeadAssignment.findAll({
    attributes: [
      "assignee_id",
      [col("Lead.status_id"), "status_id"],
      [fn("COUNT", col("LeadAssignment.lead_id")), "lead_count"],
    ],
    where: {
      id: { [Op.in]: LATEST_ASSIGNMENT_IDS },
      assignee_id: { [Op.in]: agentIds },
      assigned_at: {
        [Op.gte]: start,
        [Op.lte]: end,
      },
    },
    include: [
      {
        model: Lead,
        attributes: [],
      },
    ],
    group: ["assignee_id", "Lead.status_id"],
    raw: true,
  });

  const statusCountsByAgent = new Map();
  for (const row of statusRows) {
    const assigneeId = String(row.assignee_id);
    const statusId = String(row.status_id || 0);
    const count = Number(row.lead_count || 0);

    if (!statusCountsByAgent.has(assigneeId)) {
      statusCountsByAgent.set(assigneeId, new Map());
    }

    const innerMap = statusCountsByAgent.get(assigneeId);
    innerMap.set(statusId, (innerMap.get(statusId) || 0) + count);
  }

  const sourceRows = await LeadAssignment.findAll({
    attributes: [
      "assignee_id",
      [col("Lead.source_id"), "source_id"],
      [fn("COUNT", col("LeadAssignment.lead_id")), "lead_count"],
    ],
    where: {
      id: { [Op.in]: LATEST_ASSIGNMENT_IDS },
      assignee_id: { [Op.in]: agentIds },
      assigned_at: {
        [Op.gte]: start,
        [Op.lte]: end,
      },
    },
    include: [
      {
        model: Lead,
        attributes: [],
      },
    ],
    group: ["assignee_id", "Lead.source_id"],
    raw: true,
  });

  const sourceCountsByAgent = new Map();
  for (const row of sourceRows) {
    const assigneeId = String(row.assignee_id);
    const sourceId = String(row.source_id || 0);
    const count = Number(row.lead_count || 0);

    if (!sourceCountsByAgent.has(assigneeId)) {
      sourceCountsByAgent.set(assigneeId, new Map());
    }

    const innerMap = sourceCountsByAgent.get(assigneeId);
    innerMap.set(sourceId, (innerMap.get(sourceId) || 0) + count);
  }

  const campaignRows = await LeadAssignment.findAll({
    attributes: [
      "assignee_id",
      [col("Lead.campaign_id"), "campaign_id"],
      [fn("COUNT", col("LeadAssignment.lead_id")), "lead_count"],
    ],
    where: {
      id: { [Op.in]: LATEST_ASSIGNMENT_IDS },
      assignee_id: { [Op.in]: agentIds },
      assigned_at: {
        [Op.gte]: start,
        [Op.lte]: end,
      },
    },
    include: [
      {
        model: Lead,
        attributes: [],
      },
    ],
    group: ["assignee_id", "Lead.campaign_id"],
    raw: true,
  });

  const campaignCountsByAgent = new Map();
  for (const row of campaignRows) {
    const assigneeId = String(row.assignee_id);
    const campaignId = String(row.campaign_id || 0);
    const count = Number(row.lead_count || 0);

    if (!campaignCountsByAgent.has(assigneeId)) {
      campaignCountsByAgent.set(assigneeId, new Map());
    }

    const innerMap = campaignCountsByAgent.get(assigneeId);
    innerMap.set(campaignId, (innerMap.get(campaignId) || 0) + count);
  }

  const agents = agentUsers.map((user) => {
    const agentId = user.id;
    const statusMap = statusCountsByAgent.get(String(agentId)) || new Map();
    const sourceMap = sourceCountsByAgent.get(String(agentId)) || new Map();
    const campaignMap = campaignCountsByAgent.get(String(agentId)) || new Map();

    const statusCounts = allStatuses.map((status) => ({
      status_id: status.id,
      status_value: status.value,
      status_label: status.label,
      count: statusMap.get(String(status.id)) || 0,
    }));

    const sourceCounts = allSources.map((source) => ({
      source_id: source.id,
      source_value: source.value,
      source_label: source.label,
      count: sourceMap.get(String(source.id)) || 0,
    }));

    const campaignCounts = allCampaigns.map((campaign) => ({
      campaign_id: campaign.id,
      campaign_value: campaign.value,
      campaign_label: campaign.label,
      count: campaignMap.get(String(campaign.id)) || 0,
    }));

    const callsThisPeriod = callCountsMap.get(agentId) || 0;
    const conversionsThisPeriod = conversionsMap.get(agentId) || 0;
    const conversionRate = callsThisPeriod > 0 ? conversionsThisPeriod / callsThisPeriod : 0;

    return {
      user_id: agentId,
      full_name: user.full_name,
      email: user.email,
      calls_this_period: callsThisPeriod,
      calls_this_month: callsThisPeriod, // kept for backward compatibility
      conversions_this_period: conversionsThisPeriod,
      conversion_rate: conversionRate,
      status_counts: statusCounts,
      source_counts: sourceCounts,
      campaign_counts: campaignCounts,
    };
  });

  agentPerformance = {
    statuses: agentPerformance.statuses,
    sources: agentPerformance.sources,
    campaigns: agentPerformance.campaigns,
    agents: agents.sort((a, b) => b.calls_this_period - a.calls_this_period || a.full_name.localeCompare(b.full_name)),
  };

  return agentPerformance;
};

// =============================
// Controllers
// =============================

/**
 * GET /api/v1/reports/agents
 *
 * Returns the list of sales reps/retention agents the logged-in user is allowed to report on.
 */
const getReportAgents = async (req, res) => {
  try {
    const { id: userId, role } = req.user;

    let scope;
    try {
      scope = await resolveScope({ userId, role });
    } catch (err) {
      return resError(res, err.message, 403);
    }

    const accessibleAgents = await getAccessibleAgents({
      scopeType: scope.scopeType,
      scopedUserIds: scope.scopedUserIds,
      userId,
    });

    return resSuccess(res, {
      scope: {
        type: scope.scopeType,
        user_id: userId,
      },
      agents: accessibleAgents.map((agent) => ({
        id: agent.id,
        full_name: agent.full_name,
        email: agent.email,
      })),
    });
  } catch (err) {
    console.error("getReportAgents Error:", err);
    return resError(res, "Failed to load report agents.", 500);
  }
};

/**
 * GET /api/v1/reports
 *
 * Supported filters:
 *  - monthly:
 *      ?report_type=monthly&year=2026&month=3&agent_id=all
 *  - daily:
 *      ?report_type=daily&date=2026-04-02&agent_id=12
 *  - custom range:
 *      ?report_type=custom_range&from_date=2026-04-01&to_date=2026-04-15&agent_id=all
 */
const getReports = async (req, res) => {
  try {
    const { id: userId, role } = req.user;

    let period;
    try {
      period = parseReportPeriod(req);
    } catch (err) {
      return resError(res, err.message, 400);
    }

    let scope;
    try {
      scope = await resolveScope({ userId, role });
    } catch (err) {
      return resError(res, err.message, 403);
    }

    const { scopeType, scopedUserIds } = scope;
    const { start, end } = period;

    const allStatuses = await LeadStatus.findAll({
      attributes: ["id", "value", "label"],
      order: [["id", "ASC"]],
    });

    const allSources = await LeadSource.findAll({
      attributes: ["id", "value", "label"],
      order: [["id", "ASC"]],
    });

    const allCampaigns = await Campaign.findAll({
      attributes: ["id", "value", "label"],
      order: [["id", "ASC"]],
    });

    const convertedStatus = allStatuses.find((status) => {
      const value = String(status.value || "").toLowerCase();
      const label = String(status.label || "").toLowerCase();
      return value === "converted" || label === "converted to customer";
    });

    const accessibleAgents = await getAccessibleAgents({
      scopeType,
      scopedUserIds,
      userId,
    });

    let selectedAgentIds;
    try {
      selectedAgentIds = resolveSelectedAgentIds({
        req,
        accessibleAgents,
        role,
        userId,
      });
    } catch (err) {
      return resError(res, err.message, 400);
    }

    const filteredAgentUsers = accessibleAgents.filter((agent) => selectedAgentIds.includes(agent.id));
    const notesWhere = buildNotesWhere({
      start,
      end,
      agentIds: selectedAgentIds,
      scopeType,
    });

    const { callStatistics, callCountsMap } = await buildCallStatistics({
      agentUsers: filteredAgentUsers,
      notesWhere,
    });

    const callsBySource = await buildCallsBySource({
      agentUsers: filteredAgentUsers,
      notesWhere,
      start,
      end,
    });

    const callsByCampaign = await buildCallsByCampaign({
      agentUsers: filteredAgentUsers,
      notesWhere,
      start,
      end,
    });

    const { salesFromCalls, conversionsMap } = await buildSalesFromCalls({
      convertedStatus,
      start,
      end,
      notesWhere,
      scopeType,
      scopedUserIds,
      userId,
      selectedAgentIds,
    });

    const agentPerformance = await buildAgentPerformance({
      agentUsers: filteredAgentUsers,
      allStatuses,
      allSources,
      allCampaigns,
      start,
      end,
      callCountsMap,
      conversionsMap,
    });

    return resSuccess(res, {
      period: {
        report_type: period.report_type,
        year: period.year,
        month: period.month,
        date: period.date,
        from_date: period.from_date,
        to_date: period.to_date,
        start,
        end,
        label: period.label,
      },
      scope: {
        type: scopeType,
        user_id: userId,
      },
      filters: {
        selected_agent_id: selectedAgentIds.length === 1 ? selectedAgentIds[0] : "all",
        available_agents: accessibleAgents.map((agent) => ({
          id: agent.id,
          full_name: agent.full_name,
          email: agent.email,
        })),
      },
      cards: {
        callStatistics,
        callsBySource,
        callsByCampaign,
        salesFromCalls,
        agentPerformance,
        monthlyPerformance: agentPerformance, // kept for backward compatibility
      },
    });
  } catch (err) {
    console.error("getReports Error:", err);
    return resError(res, "Failed to build reports.", 500);
  }
};

// Backward-compatible alias if your route still uses getMonthlyReports
const getMonthlyReports = getReports;

module.exports = {
  getReports,
  getMonthlyReports,
  getReportAgents,
};
