const pool = require("../database/db");
const supabase = require("../config/supabase");
const crypto = require("crypto");

// Create shareable link
const createShare = async (req, res) => {
  try {
    const { file_id, role } = req.body;
    const ownerId = req.user.id;

    if (!file_id) {
      return res.status(400).json({
        message: "File ID is required",
      });
    }

    const allowedRoles = ["view", "edit", "owner"];

    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role",
      });
    }

    // Check that the file belongs to the logged-in user
    const fileResult = await pool.query(
      `SELECT *
       FROM files
       WHERE id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
      [file_id, ownerId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const shareToken = crypto.randomBytes(32).toString("hex");

    const result = await pool.query(
      `INSERT INTO file_shares
       (file_id, owner_id, share_token, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [file_id, ownerId, shareToken, role || "view"]
    );

    res.status(201).json({
      message: "Share link created successfully",
      share: result.rows[0],
      share_url: `http://localhost:8080/api/share/${shareToken}`,
    });
  } catch (error) {
    console.error("Create Share Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Access shared file
const accessShare = async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT
         file_shares.*,
         files.file_name,
         files.file_type,
         files.storage_path
       FROM file_shares
       JOIN files ON file_shares.file_id = files.id
       WHERE file_shares.share_token = $1
       AND files.deleted_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Share link not found or file is unavailable",
      });
    }

    const share = result.rows[0];

    const { data, error } = await supabase.storage
      .from("files")
      .createSignedUrl(share.storage_path, 3600);

    if (error) {
      return res.status(500).json({
        message: "Could not create secure file URL",
        error: error.message,
      });
    }

    res.json({
      message: "Shared file accessed successfully",
      file: {
        name: share.file_name,
        type: share.file_type,
        role: share.role,
        url: data.signedUrl,
      },
    });
  } catch (error) {
    console.error("Access Share Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  createShare,
  accessShare,
};