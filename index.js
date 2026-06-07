const express = require("express");
const morgan = require("morgan");
const colors = require("colors");
const dotenv = require("dotenv");
const cors = require("cors");
const { connectDB } = require("./config/database");
const { startLeadRetirementScheduler } = require("./schedulers/leadRetirementScheduler");

// ✅ Load env variables
dotenv.config();

// ✅ Connect to Database
connectDB();

// ✅ Create Express App
const app = express();

// ✅ Middleware
app.use(express.json());
app.use(morgan("dev"));

app.use(
  cors({
    origin: [process.env.NODE_LEADHIVE_FRONTEND_URL, "http://localhost:5173"],
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  }),
);

// ✅ Serve static uploads folder
app.use("/uploads", express.static("uploads"));

// ✅ Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const teamRoutes = require("./routes/teamRoutes");
const leadRoutes = require("./routes/leadRoutes");
const supportingRoutes = require("./routes/supportingRoutes");
const leadsUploadRoutes = require("./routes/leadsUploadRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const bulkLeadsRoutes = require("./routes/bulkLeadsRoutes");
const sourceStatusRoutes = require("./routes/sourceStatusRoutes");
const leadsExportRoutes = require("./routes/leadsExportRoutes");
const reportsRoutes = require("./routes/reportsRoutes");
const leadRetirementRoutes = require("./routes/leadRetirementRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

// ✅ Use Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/teams", teamRoutes);
app.use("/api/v1/leads", leadRoutes);
app.use("/api/v1/supports", supportingRoutes);
app.use("/api/v1/leads/upload", leadsUploadRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/bulk", bulkLeadsRoutes);
app.use("/api/v1/lead", sourceStatusRoutes);
app.use("/api/v1/leads/export", leadsExportRoutes);
app.use("/api/v1/reports", reportsRoutes);
app.use("/api/v1/leads/retirement", leadRetirementRoutes);
app.use("/api/v1/notifications", notificationRoutes);

// ✅ Root Route
app.get("/", (req, res) => {
  res.status(200).json({ message: "LeadHive API is running..." });
});

// ✅ Define Port
const PORT = process.env.NODE_LEADHIVE_PORT || 8080;

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`LeadHive server running on port ${PORT} in ${process.env.NODE_LEADHIVE_MODE} mode`.bgCyan.white);
  startLeadRetirementScheduler();
});
