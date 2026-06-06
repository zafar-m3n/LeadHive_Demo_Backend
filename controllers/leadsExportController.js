const { Op } = require("sequelize");
const { Lead, LeadStatus, LeadSource, Campaign } = require("../models");
const { resSuccess, resError } = require("../utils/responseUtil");

function buildExportQueryParts(req) {
  const { status_ids, source_ids, campaign_ids } =
    req.body?.filters && typeof req.body.filters === "object" ? req.body.filters : req.body || {};

  const where = {};

  if (status_ids) {
    const ids = String(status_ids)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length) where.status_id = { [Op.in]: ids };
  }

  if (source_ids) {
    const ids = String(source_ids)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length) where.source_id = { [Op.in]: ids };
  }

  if (campaign_ids) {
    const ids = String(campaign_ids)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length) where.campaign_id = { [Op.in]: ids };
  }

  const include = [
    { model: LeadStatus, attributes: ["id", "value", "label"] },
    { model: LeadSource, attributes: ["id", "value", "label"] },
    { model: Campaign, attributes: ["id", "value", "label"] },
  ];

  return { where, include };
}

const CSV_DELIM = ",";
const CRLF = "\r\n";

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  const needsQuote = /[",\r\n]/.test(s);
  const safe = s.replace(/"/g, '""');
  return needsQuote ? `"${safe}"` : safe;
}

function writeCsvHeader(res) {
  const header =
    ["first_name", "last_name", "company", "email", "phone", "country", "status", "source", "campaign"].join(
      CSV_DELIM,
    ) + CRLF;

  res.write("\uFEFF" + header);
}

function leadToCsvRow(l) {
  const cells = [
    csvEscape(l.first_name || ""),
    csvEscape(l.last_name || ""),
    csvEscape(l.company || ""),
    csvEscape(l.email || ""),
    csvEscape(l.phone || ""),
    csvEscape(l.country || ""),
    csvEscape(l?.LeadStatus?.label || ""),
    csvEscape(l?.LeadSource?.label || ""),
    csvEscape(l?.Campaign?.label || ""),
  ];

  return cells.join(CSV_DELIM) + CRLF;
}

const exportCount = async (req, res) => {
  try {
    const { where, include } = buildExportQueryParts(req);

    const { count } = await Lead.findAndCountAll({
      where,
      include,
      distinct: true,
      col: "id",
      limit: 1,
    });

    return resSuccess(res, { count });
  } catch (err) {
    console.error("ExportCount Error:", err);
    return resError(res, "Failed to get export count", 500);
  }
};

const exportDownload = async (req, res) => {
  try {
    const { where, include } = buildExportQueryParts(req);

    const { count } = await Lead.findAndCountAll({
      where,
      include,
      distinct: true,
      col: "id",
      limit: 1,
    });

    if (!count) return resSuccess(res, { message: "No leads match the filters", rows: 0 });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fname = `leads_export_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours(),
    )}${pad(now.getMinutes())}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);

    writeCsvHeader(res);

    const PAGE_SIZE = 5000;
    let offset = 0;

    while (true) {
      const rows = await Lead.findAll({
        where,
        include,
        limit: PAGE_SIZE,
        offset,
        attributes: [
          "id",
          "first_name",
          "last_name",
          "company",
          "email",
          "phone",
          "country",
          "status_id",
          "source_id",
          "campaign_id",
        ],
      });

      if (!rows.length) break;

      for (const l of rows) {
        res.write(leadToCsvRow(l));
      }

      offset += PAGE_SIZE;
    }

    res.end();
  } catch (err) {
    console.error("ExportDownload Error:", err);
    if (!res.headersSent) {
      return resError(res, "Failed to generate export", 500);
    } else {
      try {
        res.end();
      } catch (_) {}
    }
  }
};

module.exports = { exportCount, exportDownload };
