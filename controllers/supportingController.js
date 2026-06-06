const { Role, LeadStatus, LeadSource, Campaign, User, Team, TeamMember, TeamManager } = require("../models");
const { resSuccess, resError } = require("../utils/responseUtil");
const { Op } = require("sequelize");

// ==============================
// Supporting Controller
// ==============================

// ✅ Get all lead statuses
const getLeadStatuses = async (req, res) => {
  try {
    const statuses = await LeadStatus.findAll({ order: [["id", "ASC"]] });
    return resSuccess(res, statuses);
  } catch (err) {
    console.error("Error fetching lead statuses:", err);
    return resError(res, "Server error fetching lead statuses.");
  }
};

// ✅ Get all lead sources
const getLeadSources = async (req, res) => {
  try {
    const sources = await LeadSource.findAll({ order: [["id", "ASC"]] });
    return resSuccess(res, sources);
  } catch (err) {
    console.error("Error fetching lead sources:", err);
    return resError(res, "Server error fetching lead sources.");
  }
};

// ✅ Get all lead campaigns
const getLeadCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.findAll({ order: [["id", "ASC"]] });
    return resSuccess(res, campaigns);
  } catch (err) {
    console.error("Error fetching lead campaigns:", err);
    return resError(res, "Server error fetching lead campaigns.");
  }
};

// ✅ Get all roles
const getRoles = async (req, res) => {
  try {
    const roles = await Role.findAll({ order: [["id", "ASC"]] });
    return resSuccess(res, roles);
  } catch (err) {
    console.error("Error fetching roles:", err);
    return resError(res, "Server error fetching roles.");
  }
};

// ✅ Get all managers
const getManagers = async (req, res) => {
  try {
    const managers = await User.findAll({
      where: { is_active: true },
      include: [
        {
          model: Role,
          where: { value: "manager" },
          attributes: [],
        },
      ],
      attributes: ["id", "full_name", "email"],
    });
    return resSuccess(res, managers);
  } catch (err) {
    console.error("Error fetching managers:", err);
    return resError(res, "Server error fetching managers.");
  }
};

// ✅ Get all managers & admins (for assigning leads)
const getManagersAndAdmins = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { is_active: true },
      include: [
        {
          model: Role,
          where: { value: { [Op.in]: ["manager", "admin"] } },
          attributes: [],
        },
      ],
      attributes: ["id", "full_name", "email"],
    });
    return resSuccess(res, users);
  } catch (err) {
    console.error("Error fetching managers & admins:", err);
    return resError(res, "Server error fetching managers & admins.");
  }
};

// ✅ Get all team members for a team (uses alias "members")
const getTeamMembers = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findByPk(teamId, {
      include: [
        {
          model: User,
          as: "members",
          through: { attributes: [] },
          attributes: ["id", "full_name", "email"],
          required: false,
        },
      ],
    });

    if (!team) return resError(res, "Team not found.", 404);

    return resSuccess(res, team.members || []);
  } catch (err) {
    console.error("Error fetching team members:", err);
    return resError(res, "Server error fetching team members.");
  }
};

// ✅ Get unassigned active sales reps and retention agents
const getUnassignedSalesReps = async (req, res) => {
  try {
    const salesReps = await User.findAll({
      where: { is_active: true },
      include: [
        {
          model: Role,
          where: { value: { [Op.in]: ["sales_rep", "retention"] } },
          attributes: [],
        },
      ],
      attributes: ["id", "full_name", "email"],
    });

    const assignedMembers = await TeamMember.findAll({ attributes: ["user_id"] });
    const assignedIds = new Set(assignedMembers.map((m) => m.user_id));

    const unassignedReps = salesReps.filter((rep) => !assignedIds.has(rep.id));

    return resSuccess(res, unassignedReps);
  } catch (err) {
    console.error("Error fetching unassigned sales reps:", err);
    return resError(res, "Server error fetching unassigned sales reps.");
  }
};

// ✅ Get unassigned active managers
const getUnassignedManagers = async (req, res) => {
  try {
    const managers = await User.findAll({
      where: { is_active: true },
      include: [
        {
          model: Role,
          where: { value: "manager" },
          attributes: [],
        },
      ],
      attributes: ["id", "full_name", "email"],
    });

    const assignedManagers = await TeamManager.findAll({ attributes: ["manager_id"] });
    const assignedIds = new Set(assignedManagers.map((m) => m.manager_id));

    const unassigned = managers.filter((m) => !assignedIds.has(m.id));

    return resSuccess(res, unassigned);
  } catch (err) {
    console.error("Error fetching unassigned managers:", err);
    return resError(res, "Server error fetching unassigned managers.");
  }
};

// ✅ Get assignees visible to a manager:
const getAssignableUsersForManager = async (req, res) => {
  try {
    const managedTeams = await Team.findAll({
      attributes: ["id"],
      include: [
        {
          model: User,
          as: "managers",
          attributes: [],
          through: { attributes: [] },
          where: { id: req.user.id },
          required: true,
        },
      ],
    });

    const teamIds = managedTeams.map((t) => t.id);

    let teamMembers = [];
    if (teamIds.length) {
      teamMembers = await User.findAll({
        where: { is_active: true },
        include: [
          {
            model: Role,
            where: { value: { [Op.in]: ["sales_rep", "retention"] } },
            attributes: [],
          },
          {
            model: Team,
            as: "memberOfTeams",
            where: { id: { [Op.in]: teamIds } },
            attributes: [],
            through: { attributes: [] },
            required: true,
          },
        ],
        attributes: ["id", "full_name", "email"],
      });
    }

    const admins = await User.findAll({
      where: { is_active: true },
      include: [{ model: Role, where: { value: "admin" }, attributes: [] }],
      attributes: ["id", "full_name", "email"],
    });

    const self = await User.findByPk(req.user.id, {
      attributes: ["id", "full_name", "email", "is_active"],
    });
    const selfEntry = self && self.is_active ? [{ id: self.id, full_name: self.full_name, email: self.email }] : [];

    const combined = [...selfEntry, ...teamMembers, ...admins];
    const uniqueById = Array.from(new Map(combined.map((u) => [u.id, u])).values());

    return resSuccess(res, uniqueById);
  } catch (err) {
    console.error("Error fetching assignable users for manager:", err);
    return resError(res, "Server error fetching assignable users.");
  }
};

// ✅ Get the manager(s) of the logged-in sales rep's or retention agent's team(s)
const getMyManager = async (req, res) => {
  try {
    const teams = await Team.findAll({
      attributes: ["id", "name"],
      include: [
        {
          model: User,
          as: "members",
          attributes: [],
          through: { attributes: [] },
          where: { id: req.user.id },
          required: true,
        },
      ],
    });

    if (!teams.length) {
      return resError(res, "You are not assigned to any team.", 404);
    }

    const teamIds = teams.map((t) => t.id);

    const managers = await User.findAll({
      where: { is_active: true },
      attributes: ["id", "full_name", "email"],
      include: [
        {
          model: Role,
          where: { value: "manager" },
          attributes: [],
        },
        {
          model: Team,
          as: "managedTeams",
          attributes: [],
          through: { attributes: [] },
          where: { id: { [Op.in]: teamIds } },
          required: true,
        },
      ],
    });

    if (!managers.length) {
      return resError(res, "No managers found for your team(s).", 404);
    }

    return resSuccess(res, managers);
  } catch (err) {
    console.error("Error fetching manager(s) for sales rep:", err);
    return resError(res, "Server error fetching manager(s).");
  }
};

// ✅ Get all managers for a specific team
const getManagersForTeam = async (req, res) => {
  try {
    const { teamId } = req.params;

    const managers = await User.findAll({
      where: { is_active: true },
      attributes: ["id", "full_name", "email"],
      include: [
        {
          model: Role,
          where: { value: "manager" },
          attributes: [],
        },
        {
          model: Team,
          as: "managedTeams",
          where: { id: teamId },
          attributes: [],
          through: { attributes: [] },
          required: true,
        },
      ],
    });

    if (!managers.length) {
      return resError(res, "No managers found for this team.", 404);
    }

    return resSuccess(res, managers);
  } catch (err) {
    console.error("Error fetching managers for team:", err);
    return resError(res, "Server error fetching managers for team.");
  }
};

const assignManagerToTeam = async (req, res) => {
  try {
    const { teamId, userId } = req.body;

    const team = await Team.findByPk(teamId);
    if (!team) return resError(res, "Team not found", 404);

    const user = await User.findByPk(userId, {
      include: [{ model: Role, attributes: ["value"] }],
    });
    if (!user) return resError(res, "User not found", 404);

    // Optional: ensure user is actually a manager-role
    const hasManagerRole = Array.isArray(user.Roles)
      ? user.Roles.some((r) => r.value === "manager")
      : user.Role && user.Role.value === "manager";
    // If your model uses User.belongsTo(Role) (not many-to-many), tweak above:
    // const hasManagerRole = user.Role?.value === "manager";

    // If you strictly require manager role to be assigned:
    // if (!hasManagerRole) return resError(res, "User is not a manager.", 400);

    const exists = await TeamManager.findOne({
      where: { team_id: teamId, manager_id: userId },
    });
    if (exists) return resError(res, "User is already a manager of this team.", 400);

    await TeamManager.create({ team_id: teamId, manager_id: userId });

    return resSuccess(res, { message: "Manager assigned to team successfully." }, 201);
  } catch (err) {
    console.error("Error assigning manager to team:", err);
    return resError(res, "Server error assigning manager to team.");
  }
};

// ✅ Remove a manager from a team
const removeManagerFromTeam = async (req, res) => {
  try {
    const { teamId, userId } = req.body;

    const team = await Team.findByPk(teamId);
    if (!team) return resError(res, "Team not found", 404);

    const user = await User.findByPk(userId);
    if (!user) return resError(res, "User not found", 404);

    const manager = await TeamManager.findOne({
      where: { team_id: teamId, manager_id: userId },
    });

    if (!manager) return resError(res, "User is not a manager of this team.", 404);

    await manager.destroy();

    return resSuccess(res, { message: "Manager removed from team successfully." });
  } catch (err) {
    console.error("Error removing manager from team:", err);
    return resError(res, "Server error removing manager from team.");
  }
};

const getAssignees = async (req, res) => {
  try {
    const role = req.user?.role;
    if (!["admin", "manager"].includes(role)) {
      return resError(res, "Forbidden", 403);
    }

    const users = await User.findAll({
      where: { is_active: true },
      attributes: ["id", "full_name", "email"],
      order: [
        ["full_name", "ASC"],
        ["id", "ASC"],
      ],
    });

    return resSuccess(res, users);
  } catch (err) {
    console.error("Error fetching assignees:", err);
    return resError(res, "Server error fetching assignees.");
  }
};

// ==============================
// Exports
// ==============================
module.exports = {
  getLeadStatuses,
  getLeadSources,
  getLeadCampaigns,
  getRoles,
  getManagers,
  getManagersAndAdmins,
  getTeamMembers,
  getUnassignedSalesReps,
  getUnassignedManagers,
  getAssignableUsersForManager,
  getMyManager,
  getManagersForTeam,
  assignManagerToTeam,
  removeManagerFromTeam,
  getAssignees,
};
