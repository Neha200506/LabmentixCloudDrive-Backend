const supabase = require("../config/supabase");
const pool = require("../database/db");

// Upload file
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No file uploaded",
      });
    }

    const file = req.file;
    const fileName = `${Date.now()}-${file.originalname}`;

    const { error } = await supabase.storage
      .from("files")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      return res.status(500).json({
        message: "File upload failed",
        error: error.message,
      });
    }

    const userId = req.user.id;
    const { folder_id } = req.body;

    let dbFolderId = null;
    if (folder_id && folder_id !== 'null' && folder_id !== 'undefined') {
      dbFolderId = folder_id;
    }

    const result = await pool.query(
      `INSERT INTO files
       (user_id, file_name, file_size, file_type, storage_path, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, file.originalname, file.size, file.mimetype, fileName, dbFolderId]
    );

    res.status(201).json({
      message: "File uploaded successfully",
      file: result.rows[0],
    });
  } catch (error) {
    console.error("Upload Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get user's files with pagination
const getFiles = async (req, res) => {
  try {
    const userId = req.user.id;
    const folderId = req.query.folder_id;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || 10, 1),
      1000
    );

    const offset = (page - 1) * limit;

    let countQueryText = `SELECT COUNT(*) FROM files WHERE user_id = $1 AND deleted_at IS NULL`;
    let queryText = `SELECT * FROM files WHERE user_id = $1 AND deleted_at IS NULL`;
    let countParams = [userId];
    let queryParams = [userId, limit, offset];

    if (folderId) {
      if (folderId === 'root' || folderId === 'null') {
        countQueryText += ` AND folder_id IS NULL`;
        queryText += ` AND folder_id IS NULL`;
      } else {
        countQueryText += ` AND folder_id = $2`;
        countParams.push(folderId);
        queryText += ` AND folder_id = $4`;
        queryParams.push(folderId);
      }
    }

    queryText += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;

    const countResult = await pool.query(countQueryText, countParams);
    const result = await pool.query(queryText, queryParams);

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    res.json({
      message: "Files fetched successfully",
      files: result.rows,
      page,
      limit,
      total,
      totalPages,
    });
  } catch (error) {
    console.error("Get Files Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get download URL
const getFileUrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT *
       FROM files
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const file = result.rows[0];

    const { data, error } = await supabase.storage
      .from("files")
      .createSignedUrl(file.storage_path, 3600);

    if (error) {
      return res.status(500).json({
        message: "Could not create file URL",
        error: error.message,
      });
    }

    res.json({
      message: "File URL generated successfully",
      url: data.signedUrl,
    });
  } catch (error) {
    console.error("Get File URL Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Rename file
const renameFile = async (req, res) => {
  try {
    const { id } = req.params;
    const { file_name } = req.body;
    const userId = req.user.id;

    if (!file_name) {
      return res.status(400).json({
        message: "File name is required",
      });
    }

    const result = await pool.query(
      `UPDATE files
       SET file_name = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [file_name, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    res.json({
      message: "File renamed successfully",
      file: result.rows[0],
    });
  } catch (error) {
    console.error("Rename File Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Soft delete file
const deleteFile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE files
       SET deleted_at = NOW()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    res.json({
      message: "File moved to trash successfully",
      file: result.rows[0],
    });
  } catch (error) {
    console.error("Delete File Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get trashed files
const getTrash = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT *
       FROM files
       WHERE user_id = $1
       AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [userId]
    );

    res.json({
      message: "Trash fetched successfully",
      files: result.rows,
    });
  } catch (error) {
    console.error("Get Trash Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Restore file from trash
const restoreFile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const fileCheck = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL`,
      [id, userId]
    );

    if (fileCheck.rows.length === 0) {
      return res.status(404).json({
        message: "Trashed file not found",
      });
    }

    const file = fileCheck.rows[0];
    let targetFolderId = file.folder_id;

    if (targetFolderId) {
      const parentCheck = await pool.query(
        `SELECT id, deleted_at FROM folders WHERE id = $1 AND user_id = $2`,
        [targetFolderId, userId]
      );
      if (parentCheck.rows.length === 0 || parentCheck.rows[0].deleted_at !== null) {
        targetFolderId = null;
      }
    }

    const result = await pool.query(
      `UPDATE files
       SET deleted_at = NULL, folder_id = $1
       WHERE id = $2 AND user_id = $3 AND deleted_at IS NOT NULL
       RETURNING *`,
      [targetFolderId, id, userId]
    );

    res.json({
      message: "File restored successfully",
      file: result.rows[0],
    });
  } catch (error) {
    console.error("Restore File Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Search user's files
const searchFiles = async (req, res) => {
  try {
    const userId = req.user.id;
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        message: "Search query is required",
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM files
       WHERE user_id = $1
       AND deleted_at IS NULL
       AND to_tsvector('english', file_name)
           @@ plainto_tsquery('english', $2)
       ORDER BY created_at DESC`,
      [userId, q]
    );

    res.json({
      message: "Search completed successfully",
      files: result.rows,
    });
  } catch (error) {
    console.error("Search Files Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Toggle star status of file
const toggleStarFile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE files
       SET is_starred = NOT COALESCE(is_starred, false)
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    res.json({
      message: "File star toggled successfully",
      file: result.rows[0],
    });
  } catch (error) {
    console.error("Toggle Star File Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Permanent delete file
const deleteFilePermanent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const file = result.rows[0];

    // Delete from Supabase Storage
    const { error } = await supabase.storage
      .from("files")
      .remove([file.storage_path]);

    if (error) {
      console.warn("Storage deletion warning (might already be deleted):", error.message);
    }

    // Delete row from DB
    await pool.query(
      `DELETE FROM files WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    res.json({
      message: "File permanently deleted successfully",
    });
  } catch (error) {
    console.error("Permanent Delete File Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  uploadFile,
  getFiles,
  getFileUrl,
  renameFile,
  deleteFile,
  getTrash,
  restoreFile,
  searchFiles,
  toggleStarFile,
  deleteFilePermanent,
};