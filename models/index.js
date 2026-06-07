const Role = require("./Role");
const LeadStatus = require("./LeadStatus");
const LeadSource = require("./LeadSource");
const Campaign = require("./Campaign");
const User = require("./User");
const Team = require("./Team");
const TeamMember = require("./TeamMember");
const TeamManager = require("./TeamManager");
const Lead = require("./Lead");
const LeadAssignment = require("./LeadAssignment");
const LeadNote = require("./LeadNote");
const Notification = require("./Notification");

// =============================
// Associations
// =============================

// --- Roles & Users ---
Role.hasMany(User, { foreignKey: "role_id" });
User.belongsTo(Role, { foreignKey: "role_id" });

// --- Teams & Users (Managers M2M) ---
Team.belongsToMany(User, {
  through: TeamManager,
  as: "managers",
  foreignKey: "team_id",
  otherKey: "manager_id",
});

User.belongsToMany(Team, {
  through: TeamManager,
  as: "managedTeams",
  foreignKey: "manager_id",
  otherKey: "team_id",
});

// --- Teams & Users (Members M2M) ---
Team.belongsToMany(User, {
  through: TeamMember,
  as: "members",
  foreignKey: "team_id",
  otherKey: "user_id",
});

User.belongsToMany(Team, {
  through: TeamMember,
  as: "memberOfTeams",
  foreignKey: "user_id",
  otherKey: "team_id",
});

// --- Leads with Statuses, Sources & Campaigns ---
Lead.belongsTo(LeadStatus, { foreignKey: "status_id" });
LeadStatus.hasMany(Lead, { foreignKey: "status_id" });

Lead.belongsTo(LeadSource, { foreignKey: "source_id" });
LeadSource.hasMany(Lead, { foreignKey: "source_id" });

Lead.belongsTo(Campaign, { foreignKey: "campaign_id" });
Campaign.hasMany(Lead, { foreignKey: "campaign_id" });

// --- Leads created/updated by Users ---
User.hasMany(Lead, { foreignKey: "created_by", as: "createdLeads" });
Lead.belongsTo(User, { foreignKey: "created_by", as: "creator" });

User.hasMany(Lead, { foreignKey: "updated_by", as: "updatedLeads" });
Lead.belongsTo(User, { foreignKey: "updated_by", as: "updater" });

// --- Lead Assignments ---
Lead.hasMany(LeadAssignment, { foreignKey: "lead_id" });
LeadAssignment.belongsTo(Lead, { foreignKey: "lead_id" });

User.hasMany(LeadAssignment, { foreignKey: "assignee_id", as: "assignedLeads" });
LeadAssignment.belongsTo(User, { foreignKey: "assignee_id", as: "assignee" });

User.hasMany(LeadAssignment, { foreignKey: "assigned_by", as: "assignmentsMade" });
LeadAssignment.belongsTo(User, { foreignKey: "assigned_by", as: "assigner" });

// --- Lead Notes ---
Lead.hasMany(LeadNote, { foreignKey: "lead_id", as: "notes" });
LeadNote.belongsTo(Lead, { foreignKey: "lead_id" });

User.hasMany(LeadNote, { foreignKey: "author_id", as: "authoredNotes" });
LeadNote.belongsTo(User, { foreignKey: "author_id", as: "author" });

// --- Notifications ---
User.hasMany(Notification, { foreignKey: "user_id", as: "notifications" });
Notification.belongsTo(User, { foreignKey: "user_id", as: "user" });

// =============================
// Export all models
// =============================
module.exports = {
  Role,
  LeadStatus,
  LeadSource,
  Campaign,
  User,
  Team,
  TeamMember,
  TeamManager,
  Lead,
  LeadAssignment,
  LeadNote,
  Notification,
};
