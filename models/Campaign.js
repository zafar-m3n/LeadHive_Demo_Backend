const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Campaign = sequelize.define(
  "Campaign",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    value: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true,
    },
    label: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
  },
  {
    tableName: "campaigns",
    timestamps: false,
    underscored: true,
  },
);

module.exports = Campaign;
