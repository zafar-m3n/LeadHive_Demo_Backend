const { Op, fn, col, where } = require("sequelize");
const validator = require("validator");
const { Lead, LeadStatus, LeadSource, Campaign, LeadAssignment, LeadNote } = require("../models");

const BATCH_SIZE = 300;

const sanitizeStr = (v) =>
  v === undefined || v === null
    ? ""
    : String(v)
        .replace(/\u00A0/g, " ")
        .trim();

const toSnakeValue = (label, maxLength = 40) => {
  if (!label) return null;
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
};

const normalizePhoneDigits = (p) => (p ? String(p) : "").replace(/\D+/g, "").slice(0, 32);

const chunkArray = (arr, size) => {
  const chunks = [];

  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }

  return chunks;
};

const importLeads = async (req, res) => {
  try {
    const { leads, fallback_source, fallback_campaign, is_new_source } = req.body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ success: false, error: "No leads provided." });
    }

    const sequelizeInstance = Lead.sequelize;

    const setupTransaction = await sequelizeInstance.transaction();

    try {
      const incomingSourceLabels = new Set();

      for (const r of leads) {
        const src = sanitizeStr(r?.source);
        if (src) incomingSourceLabels.add(src);
      }

      if (fallback_source) {
        incomingSourceLabels.add(sanitizeStr(fallback_source));
      }

      if (incomingSourceLabels.size) {
        const candidateRows = Array.from(incomingSourceLabels)
          .map((label) => ({
            value: toSnakeValue(label, 40),
            label: String(label).trim().slice(0, 80),
          }))
          .filter((r) => r.value && r.label);

        const seenVals = new Set();
        const uniqueRows = [];

        for (const r of candidateRows) {
          if (!seenVals.has(r.value)) {
            seenVals.add(r.value);
            uniqueRows.push(r);
          }
        }

        if (uniqueRows.length) {
          await LeadSource.bulkCreate(uniqueRows, {
            ignoreDuplicates: true,
            transaction: setupTransaction,
          });
        }
      }

      const incomingCampaignLabels = new Set();

      for (const r of leads) {
        const campaign = sanitizeStr(r?.campaign);
        if (campaign) incomingCampaignLabels.add(campaign);
      }

      if (fallback_campaign) {
        incomingCampaignLabels.add(sanitizeStr(fallback_campaign));
      }

      if (incomingCampaignLabels.size) {
        const candidateRows = Array.from(incomingCampaignLabels)
          .map((label) => ({
            value: toSnakeValue(label, 80),
            label: String(label).trim().slice(0, 120),
          }))
          .filter((r) => r.value && r.label);

        const seenVals = new Set();
        const uniqueRows = [];

        for (const r of candidateRows) {
          if (!seenVals.has(r.value)) {
            seenVals.add(r.value);
            uniqueRows.push(r);
          }
        }

        if (uniqueRows.length) {
          await Campaign.bulkCreate(uniqueRows, {
            ignoreDuplicates: true,
            transaction: setupTransaction,
          });
        }
      }

      await setupTransaction.commit();
    } catch (err) {
      await setupTransaction.rollback();
      throw err;
    }

    const [statuses, sources, campaigns] = await Promise.all([
      LeadStatus.findAll(),
      LeadSource.findAll(),
      Campaign.findAll(),
    ]);

    const statusMap = new Map();

    for (const s of statuses) {
      if (s.label) statusMap.set(sanitizeStr(s.label).toLowerCase(), s);
      if (s.value) statusMap.set(sanitizeStr(s.value).toLowerCase(), s);
    }

    const defaultStatus = statusMap.get("new") || null;

    const sourceMap = new Map();

    for (const s of sources) {
      if (s.label) sourceMap.set(sanitizeStr(s.label).toLowerCase(), s);
      if (s.value) sourceMap.set(sanitizeStr(s.value).toLowerCase(), s);
    }

    let defaultSource = null;

    if (fallback_source) {
      const key = sanitizeStr(fallback_source).toLowerCase();
      defaultSource = sourceMap.get(key) || null;
    }

    const campaignMap = new Map();

    for (const c of campaigns) {
      if (c.label) campaignMap.set(sanitizeStr(c.label).toLowerCase(), c);
      if (c.value) campaignMap.set(sanitizeStr(c.value).toLowerCase(), c);
    }

    let defaultCampaign = null;

    if (fallback_campaign) {
      const key = sanitizeStr(fallback_campaign).toLowerCase();
      defaultCampaign = campaignMap.get(key) || null;
    }

    const prepared = [];
    const notes = [];
    const seenEmails = new Set();
    const seenPhones = new Set();

    leads.forEach((row, idx) => {
      const r = row || {};

      const firstName = sanitizeStr(r.first_name);
      const lastName = sanitizeStr(r.last_name);
      const company = sanitizeStr(r.company);
      const country = sanitizeStr(r.country);
      const status = sanitizeStr(r.status);
      const source = sanitizeStr(r.source);
      const campaignValue = sanitizeStr(r.campaign);
      const noteBody = sanitizeStr(r.notes);

      let email = sanitizeStr(r.email).toLowerCase();
      if (email === "") email = null;

      const phoneRaw = sanitizeStr(r.phone) || null;
      const phoneNorm = phoneRaw ? normalizePhoneDigits(phoneRaw) : null;

      const isEmptyRow =
        !firstName &&
        !lastName &&
        !company &&
        !email &&
        !phoneRaw &&
        !country &&
        !status &&
        !source &&
        !campaignValue &&
        !noteBody;

      const hasName = !!firstName || !!lastName;
      const hasContactMethod = !!email || !!phoneNorm;

      if (isEmptyRow) {
        notes.push({ index: idx, note: "empty_row" });
        return;
      }

      if (!hasContactMethod) {
        notes.push({ index: idx, note: "missing_contact_method" });
        return;
      }

      if (!hasName) {
        notes.push({ index: idx, email, phone: phoneRaw, note: "missing_name" });
        return;
      }

      if (email && !validator.isEmail(email)) {
        notes.push({ index: idx, email, note: "invalid_email_format" });
        return;
      }

      if (email && seenEmails.has(email)) {
        notes.push({ index: idx, email, note: "duplicate_email_in_file" });
        return;
      }

      if (email) seenEmails.add(email);

      if (phoneNorm && seenPhones.has(phoneNorm)) {
        notes.push({ index: idx, phone: phoneRaw, note: "duplicate_phone_in_file" });
        return;
      }

      if (phoneNorm) seenPhones.add(phoneNorm);

      let st = null;
      const rStatus = status.toLowerCase();

      if (rStatus) st = statusMap.get(rStatus);
      if (!st) st = defaultStatus;

      let src = null;
      const rSource = source.toLowerCase();

      if (rSource) {
        src = sourceMap.get(rSource);
      }

      if (!src && defaultSource) {
        src = defaultSource;
      }

      let campaign = null;
      const rCampaign = campaignValue.toLowerCase();

      if (rCampaign) {
        campaign = campaignMap.get(rCampaign);
      }

      if (!campaign && defaultCampaign) {
        campaign = defaultCampaign;
      }

      prepared.push({
        _rowIndex: idx,
        first_name: firstName || null,
        last_name: lastName || null,
        company: company || null,
        email,
        phone: phoneRaw,
        _phoneNorm: phoneNorm,
        country: country || null,
        status_id: st ? st.id : null,
        source_id: src ? src.id : null,
        campaign_id: campaign ? campaign.id : null,
        _noteBody: noteBody,
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null,
      });
    });

    if (prepared.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid rows to import.",
        details: { notes },
      });
    }

    const batches = chunkArray(prepared, BATCH_SIZE);
    const createdLeads = [];

    for (const batch of batches) {
      const batchTransaction = await sequelizeInstance.transaction();

      try {
        const emails = batch.map((p) => p.email).filter(Boolean);
        const phoneNorms = Array.from(new Set(batch.map((p) => p._phoneNorm).filter(Boolean)));

        const whereClauses = [];

        if (emails.length) {
          whereClauses.push({ email: { [Op.in]: emails } });
        }

        if (phoneNorms.length) {
          const normalizedDbPhone = fn("REGEXP_REPLACE", col("phone"), "[^0-9]", "");
          whereClauses.push(where(normalizedDbPhone, { [Op.in]: phoneNorms }));
        }

        const existing = whereClauses.length
          ? await Lead.findAll({
              where: { [Op.or]: whereClauses },
              attributes: ["email", "phone"],
              transaction: batchTransaction,
            })
          : [];

        const existingEmails = new Set(
          existing
            .map((e) => e.email)
            .filter(Boolean)
            .map((e) => String(e).toLowerCase()),
        );

        const existingPhoneNorms = new Set(existing.map((e) => normalizePhoneDigits(e.phone)).filter(Boolean));

        const toInsert = [];

        for (const p of batch) {
          if (p.email && existingEmails.has(p.email)) {
            notes.push({ index: p._rowIndex, email: p.email, note: "duplicate_email_in_db" });
            continue;
          }

          if (p._phoneNorm && existingPhoneNorms.has(p._phoneNorm)) {
            notes.push({ index: p._rowIndex, phone: p.phone, note: "duplicate_phone_in_db" });
            continue;
          }

          toInsert.push(p);
        }

        if (toInsert.length === 0) {
          await batchTransaction.commit();
          continue;
        }

        const batchCreatedLeads = await Lead.bulkCreate(
          toInsert.map(({ _rowIndex, _phoneNorm, _noteBody, ...rest }) => rest),
          { validate: true, returning: true, transaction: batchTransaction },
        );

        if (req.user?.id && batchCreatedLeads.length) {
          const assignments = batchCreatedLeads.map((l) => ({
            lead_id: l.id,
            assignee_id: req.user.id,
            assigned_by: req.user.id,
          }));

          await LeadAssignment.bulkCreate(assignments, { transaction: batchTransaction });
        }

        const notesPayload = [];

        for (let i = 0; i < batchCreatedLeads.length; i++) {
          const noteBody = toInsert[i]._noteBody;

          if (typeof noteBody === "string" && noteBody.trim().length > 0) {
            notesPayload.push({
              lead_id: batchCreatedLeads[i].id,
              author_id: req.user?.id || null,
              body: noteBody.trim(),
            });
          }
        }

        if (notesPayload.length) {
          await LeadNote.bulkCreate(notesPayload, { transaction: batchTransaction });
        }

        await batchTransaction.commit();

        createdLeads.push(...batchCreatedLeads);
      } catch (err) {
        await batchTransaction.rollback();
        throw err;
      }
    }

    if (createdLeads.length === 0) {
      return res.status(409).json({
        success: false,
        error: "All rows are duplicates or invalid.",
        details: { notes },
      });
    }

    return res.status(201).json({
      success: true,
      message: `${createdLeads.length} leads imported successfully.`,
      summary: {
        attempted: leads.length,
        inserted: createdLeads.length,
        duplicates_or_skipped: notes.length,
      },
      notes,
      data: createdLeads,
    });
  } catch (err) {
    console.error("Import Error:", err);
    return res.status(500).json({ success: false, error: "Error importing leads." });
  }
};

const getTemplateSchema = async (req, res) => {
  try {
    return res.json({
      fields: [
        "first_name",
        "last_name",
        "company",
        "email",
        "phone",
        "country",
        "status",
        "source",
        "campaign",
        "notes",
      ],
      defaults: {
        status: "New",
        source: "Choose Fallback Source",
        campaign: "Choose Fallback Campaign",
      },
      duplicate_check: "email_or_phone (phone compared by digits-only)",
      required_rules: [
        "A valid lead must have a first name or last name.",
        "A valid lead must have at least one contact method: phone or email.",
        "Company, country, source, campaign, status, and notes do not count as lead identifiers.",
      ],
      notes: [
        "Completely empty rows are skipped.",
        "Rows without first_name and last_name are skipped.",
        "Rows without both phone and email are skipped.",
        "If status is missing or invalid, 'new' is used.",
        "If source is missing or invalid, fallback source is used when provided.",
        "If campaign is missing or invalid, fallback campaign is used when provided.",
        "Unknown sources are created automatically (value = lowercase_with_underscores, label = original).",
        "Unknown campaigns are created automatically (value = lowercase_with_underscores, label = original).",
        "Duplicates are detected by email OR phone; phone is normalized to digits-only for comparison.",
        "Rows with invalid email format are skipped.",
        "If a row includes 'notes', it is saved as the first note on that lead.",
      ],
    });
  } catch (err) {
    console.error("Schema Error:", err);
    return res.status(500).json({ success: false, error: "Could not fetch template schema." });
  }
};

module.exports = { importLeads, getTemplateSchema };
