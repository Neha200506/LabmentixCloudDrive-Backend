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

    let countQueryText;
    let queryText;
    let countParams;
    let queryParams;

    if (folderId) {
      countQueryText = `SELECT COUNT(*) FROM files WHERE user_id = $1 AND deleted_at IS NULL`;
      queryText = `SELECT f.*, false AS is_shared, NULL AS shared_permission, u.full_name AS owner_name FROM files f LEFT JOIN users u ON f.user_id = u.id WHERE f.user_id = $1 AND f.deleted_at IS NULL`;
      countParams = [userId];
      queryParams = [userId, limit, offset];

      if (folderId === 'root' || folderId === 'null') {
        countQueryText += ` AND folder_id IS NULL`;
        queryText += ` AND f.folder_id IS NULL`;
      } else {
        countQueryText += ` AND folder_id = $2`;
        countParams.push(folderId);
        queryText += ` AND f.folder_id = $4`;
        queryParams.push(folderId);
      }
    } else {
      // General dashboard view: return owned files AND shared files
      countQueryText = `
        SELECT COUNT(DISTINCT f.id) 
        FROM files f
        LEFT JOIN permissions p ON f.id = p.file_id AND p.shared_with = $1
        LEFT JOIN users u_me ON u_me.id = $1
        LEFT JOIN file_shares fs ON f.id = fs.file_id AND fs.share_token LIKE 'email:' || LOWER(u_me.email) || ':%'
        WHERE (f.user_id = $1 OR p.shared_with = $1 OR fs.id IS NOT NULL) AND f.deleted_at IS NULL`;
      
      queryText = `
        SELECT f.id, f.user_id, f.folder_id, f.file_name, f.file_size, f.file_type, f.storage_path, f.created_at, f.deleted_at, f.is_starred,
               u.full_name AS owner_name,
               CASE WHEN f.user_id = $1 THEN false ELSE true END AS is_shared,
               COALESCE(p.permission_type, fs.role) AS shared_permission
        FROM files f
        LEFT JOIN users u ON f.user_id = u.id
        LEFT JOIN permissions p ON f.id = p.file_id AND p.shared_with = $1
        LEFT JOIN users u_me ON u_me.id = $1
        LEFT JOIN file_shares fs ON f.id = fs.file_id AND fs.share_token LIKE 'email:' || LOWER(u_me.email) || ':%'
        WHERE (f.user_id = $1 OR p.shared_with = $1 OR fs.id IS NOT NULL) AND f.deleted_at IS NULL
        GROUP BY f.id, f.user_id, f.folder_id, f.file_name, f.file_size, f.file_type, f.storage_path, f.created_at, f.deleted_at, f.is_starred, u.full_name, p.permission_type, fs.role`;
        
      countParams = [userId];
      queryParams = [userId, limit, offset];
    }

    queryText += ` ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`;

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
      `SELECT f.*
       FROM files f
       LEFT JOIN permissions p ON f.id = p.file_id AND p.shared_with = $2
       WHERE f.id = $1 AND (f.user_id = $2 OR p.shared_with = $2)`,
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

    // Check if user is owner or has edit permission
    const checkAccess = await pool.query(
      `SELECT f.*, 
              CASE WHEN f.user_id = $2 THEN 'owner' ELSE p.permission_type END AS perm
       FROM files f
       LEFT JOIN permissions p ON f.id = p.file_id AND p.shared_with = $2
       WHERE f.id = $1 AND f.deleted_at IS NULL`,
      [id, userId]
    );

    if (checkAccess.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    const permission = (checkAccess.rows[0].perm || "").toLowerCase();
    if (permission !== 'owner' && permission !== 'edit' && permission !== 'editor') {
      return res.status(403).json({
        message: "You do not have permission to edit this file",
      });
    }

    const result = await pool.query(
      `UPDATE files
       SET file_name = $1
       WHERE id = $2
       RETURNING *`,
      [file_name, id]
    );

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

    const checkAccess = await pool.query(
      `SELECT f.*, 
              CASE WHEN f.user_id = $2 THEN 'owner' ELSE p.permission_type END AS perm
       FROM files f
       LEFT JOIN permissions p ON f.id = p.file_id AND p.shared_with = $2
       WHERE f.id = $1 AND f.deleted_at IS NULL`,
      [id, userId]
    );

    if (checkAccess.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    const permission = (checkAccess.rows[0].perm || "").toLowerCase();
    if (permission !== 'owner' && permission !== 'edit' && permission !== 'editor') {
      return res.status(403).json({
        message: "You do not have permission to delete this file",
      });
    }

    const result = await pool.query(
      `UPDATE files
       SET deleted_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

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

    // Only file owner or Editor can permanently delete
    const checkAccess = await pool.query(
      `SELECT f.*, 
              CASE WHEN f.user_id = $2 THEN 'owner' ELSE p.permission_type END AS perm
       FROM files f
       LEFT JOIN permissions p ON f.id = p.file_id AND p.shared_with = $2
       WHERE f.id = $1`,
      [id, userId]
    );

    if (checkAccess.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    const permission = (checkAccess.rows[0].perm || "").toLowerCase();
    if (permission !== 'owner' && permission !== 'edit' && permission !== 'editor') {
      return res.status(403).json({
        message: "You do not have permission to permanently delete this file",
      });
    }

    const file = checkAccess.rows[0];

    // Delete from Supabase Storage
    const { error } = await supabase.storage
      .from("files")
      .remove([file.storage_path]);

    if (error) {
      console.warn("Storage deletion warning (might already be deleted):", error.message);
    }

    // Delete row from DB
    await pool.query(
      `DELETE FROM files WHERE id = $1`,
      [id]
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

// Update file content
const updateFileContent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { content } = req.body;

    if (content === undefined || content === null) {
      return res.status(400).json({
        message: "Content is required",
      });
    }

    // Check access: user must be owner or have edit permission
    const checkAccess = await pool.query(
      `SELECT f.*, 
              CASE 
                WHEN f.user_id = $2 THEN 'owner' 
                ELSE COALESCE(p.permission_type, fs.role) 
              END AS perm
       FROM files f
       LEFT JOIN permissions p ON f.id = p.file_id AND p.shared_with = $2
       LEFT JOIN users u ON u.id = $2
       LEFT JOIN file_shares fs ON f.id = fs.file_id AND fs.share_token LIKE 'email:' || LOWER(u.email) || ':%'
       WHERE f.id = $1 AND f.deleted_at IS NULL`,
      [id, userId]
    );

    if (checkAccess.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    const fileRecord = checkAccess.rows[0];
    const permission = (fileRecord.perm || "").toLowerCase();

    if (permission !== 'owner' && permission !== 'edit' && permission !== 'editor') {
      return res.status(403).json({
        message: "You do not have permission to edit this file",
      });
    }

    let contentBuffer;
    let contentType = fileRecord.file_type || 'text/plain';

    if ((fileRecord.file_name && fileRecord.file_name.toLowerCase().endsWith('.pdf')) || fileRecord.file_type === 'application/pdf') {
      contentType = 'application/pdf';
      try {
        const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
        let pdfDoc;

        const { data: existingData, error: downloadError } = await supabase.storage
          .from("files")
          .download(fileRecord.storage_path);

        if (!downloadError && existingData) {
          const existingBuffer = Buffer.from(await existingData.arrayBuffer());
          pdfDoc = await PDFDocument.load(existingBuffer);
        } else {
          pdfDoc = await PDFDocument.create();
        }

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const lines = (content || '').split('\n');

        let page = pdfDoc.addPage([600, 800]);
        page.drawText("--- Document Edit / Notes ---", { x: 50, y: 750, size: 12, font, color: rgb(0.2, 0.4, 0.8) });
        let y = 720;

        for (const line of lines) {
          if (y < 40) {
            page = pdfDoc.addPage([600, 800]);
            y = 750;
          }
          const safeLine = line.replace(/[^\x00-\x7F]/g, '');
          page.drawText(safeLine || ' ', { x: 50, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
          y -= 16;
        }
        const pdfBytes = await pdfDoc.save();
        contentBuffer = Buffer.from(pdfBytes);
      } catch (pdfErr) {
        console.error("PDF compilation error, falling back to UTF-8 buffer:", pdfErr);
        contentBuffer = Buffer.from(content, 'utf-8');
      }
    } else {
      contentBuffer = Buffer.from(content, 'utf-8');
    }

    // Upload/upsert file to Supabase storage
    const { error: uploadError } = await supabase.storage
      .from("files")
      .upload(fileRecord.storage_path, contentBuffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      return res.status(500).json({
        message: "Failed to update storage file content",
        error: uploadError.message,
      });
    }

    // Update file_size and created_at timestamp in DB
    const updateDbResult = await pool.query(
      `UPDATE files
       SET file_size = $1, created_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [contentBuffer.length, id]
    );

    res.json({
      message: "File content updated successfully",
      file: updateDbResult.rows[0],
    });
  } catch (error) {
    console.error("Update File Content Error:", error);
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
  updateFileContent,
};