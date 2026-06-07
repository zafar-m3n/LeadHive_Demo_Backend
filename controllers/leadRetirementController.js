const { previewLeadRetirement, runLeadRetirement } = require("../jobs/leadRetirementJob");
const { resSuccess, resError } = require("../utils/responseUtil");

const previewRetirement = async (req, res) => {
  try {
    const result = await previewLeadRetirement();

    return resSuccess(res, result);
  } catch (err) {
    console.error("PreviewRetirement Error:", err);
    return resError(res, err.message || "Failed to preview lead retirement.", 500);
  }
};

const runRetirementNow = async (req, res) => {
  try {
    const result = await runLeadRetirement();

    return resSuccess(res, result);
  } catch (err) {
    console.error("RunRetirementNow Error:", err);
    return resError(res, err.message || "Failed to run lead retirement.", 500);
  }
};

module.exports = {
  previewRetirement,
  runRetirementNow,
};
