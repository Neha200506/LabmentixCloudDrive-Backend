const pool = require("../database/db");

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

    const result = await pool.query(
      `UPDATE folders
       SET deleted_at = NULL
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Trashed folder not found",
      });
    }

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
module.exports = {
  createFolder,
  getFolders,
  renameFolder,
  deleteFolder,
  getFolderTrash,
  restoreFolder,
};
