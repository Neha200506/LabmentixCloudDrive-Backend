const pool = require("../database/db");
const supabase = require("../config/supabase");


// Create folder
const createFolder = async (req, res) => {
  try {
    const { name, parent_folder_id } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({
        message: "Folder name is required",
      });
    }

    const result = await pool.query(
      `INSERT INTO folders (user_id, name, parent_folder_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, name, parent_folder_id || null],
    );

    res.status(201).json({
      message: "Folder created successfully",
      folder: result.rows[0],
    });
  } catch (error) {
    console.error("Create Folder Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get user's folders
const getFolders = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT *
       FROM folders
       WHERE user_id = $1
       AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [userId],
    );

    res.json({
      message: "Folders fetched successfully",
      folders: result.rows,
    });
  } catch (error) {
    console.error("Get Folders Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
// Rename folder
const renameFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({
        message: "Folder name is required",
      });
    }

    const result = await pool.query(
      `UPDATE folders
       SET name = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [name, id, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Folder not found",
      });
    }

    res.json({
      message: "Folder renamed successfully",
      folder: result.rows[0],
    });
  } catch (error) {
    console.error("Rename Folder Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
// Soft delete folder
const deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE folders
       SET deleted_at = NOW()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Folder not found",
      });
    }

    res.json({
      message: "Folder moved to trash successfully",
      folder: result.rows[0],
    });
  } catch (error) {
    console.error("Delete Folder Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
// Get trashed folders
const getFolderTrash = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT *
       FROM folders
       WHERE user_id = $1
       AND deleted_at IS NOT NULL
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      message: "Folder trash fetched successfully",
      folders: result.rows,
    });
  } catch (error) {
    console.error("Get Folder Trash Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
// Restore folder from trash
const restoreFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const folderCheck = await pool.query(
      `SELECT * FROM folders WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL`,
      [id, userId]
    );

    if (folderCheck.rows.length === 0) {
      return res.status(404).json({
        message: "Trashed folder not found",
      });
    }

    const folder = folderCheck.rows[0];
    let targetParentId = folder.parent_folder_id;

    if (targetParentId) {
      const parentCheck = await pool.query(
        `SELECT id, deleted_at FROM folders WHERE id = $1 AND user_id = $2`,
        [targetParentId, userId]
      );
      if (parentCheck.rows.length === 0 || parentCheck.rows[0].deleted_at !== null) {
        targetParentId = null;
      }
    }

    const result = await pool.query(
      `UPDATE folders
       SET deleted_at = NULL, parent_folder_id = $1
       WHERE id = $2 AND user_id = $3 AND deleted_at IS NOT NULL
       RETURNING *`,
      [targetParentId, id, userId]
    );

    res.json({
      message: "Folder restored successfully",
      folder: result.rows[0],
    });
  } catch (error) {
    console.error("Restore Folder Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Toggle star status of folder
const toggleStarFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE folders
       SET is_starred = NOT COALESCE(is_starred, false)
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Folder not found",
      });
    }

    res.json({
      message: "Folder star toggled successfully",
      folder: result.rows[0],
    });
  } catch (error) {
    console.error("Toggle Star Folder Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Helper to get folder tree IDs
const getFolderTreeIds = async (folderId, userId) => {
  let ids = [folderId];
  let queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift();
    const res = await pool.query(
      `SELECT id FROM folders WHERE parent_folder_id = $1 AND user_id = $2`,
      [current, userId]
    );
    for (const row of res.rows) {
      ids.push(row.id);
      queue.push(row.id);
    }
  }
  return ids;
};

// Permanent delete folder and all contained subfolders/files
const deleteFolderPermanent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check folder exists
    const folderResult = await pool.query(
      `SELECT * FROM folders WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (folderResult.rows.length === 0) {
      return res.status(404).json({
        message: "Folder not found",
      });
    }

    // Traverse directory tree to find all subfolder IDs
    const folderIds = await getFolderTreeIds(id, userId);

    // Retrieve all files in these folders
    const filesResult = await pool.query(
      `SELECT id, storage_path FROM files WHERE folder_id = ANY($1) AND user_id = $2`,
      [folderIds, userId]
    );

    const files = filesResult.rows;

    // Delete files from Supabase Storage
    if (files.length > 0) {
      const storagePaths = files.map(f => f.storage_path);
      const { error } = await supabase.storage
        .from("files")
        .remove(storagePaths);

      if (error) {
        console.warn("Storage deletion warning for folder contents:", error.message);
      }

      // Delete files from DB
      await pool.query(
        `DELETE FROM files WHERE folder_id = ANY($1) AND user_id = $2`,
        [folderIds, userId]
      );
    }

    // Delete folders from DB
    await pool.query(
      `DELETE FROM folders WHERE id = ANY($1) AND user_id = $2`,
      [folderIds, userId]
    );

    res.json({
      message: "Folder and all its contents permanently deleted successfully",
    });
  } catch (error) {
    console.error("Permanent Delete Folder Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  createFolder,
  getFolders,
  renameFolder,
  deleteFolder,
  getFolderTrash,
  restoreFolder,
  toggleStarFolder,
  deleteFolderPermanent,
};
