const cron = require("node-cron");
const { runLeadRetirement } = require("../jobs/leadRetirementJob");

function startLeadRetirementScheduler() {
  const enabled = process.env.NODE_LEADHIVE_RETIREMENT_ENABLED === "true";
  const schedule = process.env.NODE_LEADHIVE_RETIREMENT_CRON || "0 8 * * *";

  if (!enabled) {
    console.log("Lead retirement scheduler is disabled.".yellow);
    return;
  }

  if (!cron.validate(schedule)) {
    console.log(`Invalid lead retirement cron schedule: ${schedule}`.red);
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      console.log("Running automatic lead retirement job...".cyan);

      const result = await runLeadRetirement();

      console.log(
        `Lead retirement completed. Retired: ${result.retired_count}, Reassigned: ${result.assignment_created_count}`
          .green,
      );
    } catch (err) {
      console.error("Lead retirement scheduler error:", err.message);
    }
  });

  console.log(`Lead retirement scheduler started with schedule: ${schedule}`.bgYellow.black);
}

module.exports = {
  startLeadRetirementScheduler,
};
