const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const fs = require("fs");
require("dotenv").config();
const app = express();
app.use(express.json());
app.use(cors());

// Konfigurasi database langsung (ganti dengan nilai yang sesuai)
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306, // default value jika tidak ada
};

const JWT_SECRET = "secret_key_yang_aman_dan_unik";

// Middleware untuk koneksi database dengan error handling
async function getConnection() {
  try {
    console.log("Mencoba menghubungkan ke database...");
    const connection = await mysql.createConnection(dbConfig);
    console.log("Berhasil terhubung ke database MySQL");
    return connection;
  } catch (error) {
    console.error("ERROR KONEKSI DATABASE:", error.message);
    console.error("Kode error:", error.code);
    console.error("Detail error:", error);
    throw error;
  }
}

// Middleware untuk verifikasi token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token tidak tersedia" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error("ERROR VERIFIKASI TOKEN:", err.message);
      return res.status(403).json({ error: "Token tidak valid" });
    }
    req.user = user;
    next();
  });
};

// Konfigurasi storage untuk multer - PERBAIKI INI
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads/rpp");
    // Pastikan folder ada
    const fs = require("fs");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log("Created upload directory:", uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Format: timestamp-namaFile-asli
    const timestamp = Date.now();
    const originalName = file.originalname;
    // Bersihkan nama file dari karakter khusus
    const cleanName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const fileName = `${timestamp}-${cleanName}`;
    console.log("Generated filename:", fileName);
    cb(null, fileName);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: function (req, file, cb) {
    console.log("File filter checking:", file.mimetype, file.originalname);

    // Hanya izinkan file Word dan PDF
    const allowedTypes = [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
    ];

    const allowedExtensions = [".pdf", ".doc", ".docx"];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      console.log("File type rejected:", file.mimetype, fileExtension);
      cb(
        new Error("Hanya file Word (.doc, .docx) dan PDF yang diizinkan"),
        false
      );
    }
  },
});

// Error handling untuk multer
const uploadMiddleware = (req, res, next) => {
  upload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading.
      console.error("Multer Error:", err);
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      // An unknown error occurred.
      console.error("Unknown Upload Error:", err);
      return res.status(500).json({
        error: `Upload failed: ${err.message}`,
      });
    }
    // Everything went fine.
    next();
  });
};

// Konfigurasi storage untuk file Excel
const excelStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads/excel");
    const fs = require("fs");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const originalName = file.originalname;
    const cleanName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const fileName = `${timestamp}-${cleanName}`;
    cb(null, fileName);
  },
});

// Konfigurasi multer untuk memory storage (tidak menyimpan file)
const excelUpload = multer({
  storage: multer.memoryStorage(), // Simpan di memory saja
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
    ];

    const allowedExtensions = [".xls", ".xlsx", ".ods"];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file Excel (.xls, .xlsx) yang diizinkan"), false);
    }
  },
});

// Middleware untuk upload Excel (memory storage)
const excelUploadMiddleware = (req, res, next) => {
  excelUpload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error("Multer Error:", err);
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      console.error("Unknown Upload Error:", err);
      return res.status(500).json({
        error: `Upload failed: ${err.message}`,
      });
    }
    next();
  });
};

// Di bagian endpoint siswa, tambahkan fungsi untuk membuat user wali
async function createWaliUser(email, namaWali, siswaId) {
  try {
    console.log("Membuat user wali untuk siswa:", siswaId);

    const connection = await getConnection();

    // Cek apakah email sudah terdaftar
    const [existingUsers] = await connection.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingUsers.length > 0) {
      await connection.end();
      console.log("Email sudah terdaftar:", email);
      return { success: false, error: "Email sudah terdaftar" };
    }

    const id = crypto.randomUUID();
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);

    await connection.execute(
      'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
      [id, namaWali, email, hashedPassword, siswaId]
    );

    await connection.end();

    console.log("User wali berhasil dibuat:", id);
    return { success: true, id };
  } catch (error) {
    console.error("ERROR CREATE WALI USER:", error.message);
    return { success: false, error: error.message };
  }
}

async function deleteWaliUser(siswaId) {
  try {
    console.log("Menghapus user wali untuk siswa:", siswaId);

    const connection = await getConnection();
    await connection.execute(
      "DELETE FROM users WHERE siswa_id = ? AND role = 'wali'",
      [siswaId]
    );
    await connection.end();

    console.log("User wali berhasil dihapus");
    return { success: true };
  } catch (error) {
    console.error("ERROR DELETE WALI USER:", error.message);
    return { success: false, error: error.message };
  }
}

// Middleware untuk logging request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Routes

// Login
app.post("/api/login", async (req, res) => {
  try {
    console.log("Login attempt:", req.body.email);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email dan password diperlukan" });
    }

    const connection = await getConnection();

    const [users] = await connection.execute(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    await connection.end();

    if (users.length === 0) {
      console.log("Login gagal: Email tidak ditemukan");
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      console.log("Login gagal: Password salah");
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log("Login berhasil untuk user:", user.email);
    res.json({
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        role: user.role,
        kelas_id: user.kelas_id,
      },
    });
  } catch (error) {
    console.error("ERROR LOGIN:", error.message);
    res.status(500).json({ error: "Terjadi kesalahan server saat login" });
  }
});

// Endpoint untuk mendapatkan grade levels dari school_configs
app.get(
  "/api/school-configs/grade-levels",
  authenticateToken,
  async (req, res) => {
    try {
      console.log("Mengambil data grade levels dari school_configs");

      const connection = await getConnection();

      // Ambil data dari tabel school_configs
      const [configs] = await connection.execute(
        "SELECT value FROM school_configs WHERE config_key = 'grade_levels'"
      );

      await connection.end();

      if (configs.length === 0) {
        // Jika tidak ada konfigurasi, kembalikan default
        console.log(
          "Konfigurasi grade_levels tidak ditemukan, menggunakan default"
        );
        return res.json([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      }

      try {
        const gradeLevels = JSON.parse(configs[0].value);
        console.log("Grade levels ditemukan:", gradeLevels);
        res.json(gradeLevels);
      } catch (parseError) {
        console.error("ERROR PARSING GRADE LEVELS:", parseError.message);
        res.json([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      }
    } catch (error) {
      console.error("ERROR GET GRADE LEVELS:", error.message);
      res.status(500).json({ error: "Gagal mengambil data grade levels" });
    }
  }
);
// Kelola Kelas
app.get("/api/kelas", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data kelas");
    const connection = await getConnection();
    const [kelas] = await connection.execute(`
      SELECT 
        k.*, 
        u.nama as wali_kelas_nama,
        (SELECT COUNT(*) FROM siswa s WHERE s.kelas_id = k.id) as jumlah_siswa
      FROM kelas k 
      LEFT JOIN users u ON k.wali_kelas_id = u.id
    `);
    await connection.end();
    console.log("Berhasil mengambil data kelas, jumlah:", kelas.length);
    res.json(kelas);
  } catch (error) {
    console.error("ERROR GET KELAS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

app.post("/api/export-classes", async (req, res) => {
  try {
    const { classes } = req.body;

    if (!classes || !Array.isArray(classes)) {
      return res.status(400).json({
        success: false,
        message: "Data kelas tidak valid",
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData = [
      // Header row
      ["Nama Kelas*", "Grade Level*", "Wali Kelas", "Jumlah Siswa", "Status"],
      // Data rows
      ...classes.map((classItem) => [
        classItem.nama || "",
        classItem.grade_level?.toString() || "",
        classItem.wali_kelas_nama || "-",
        classItem.jumlah_siswa?.toString() || "0",
        "Active",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Add style to header row (basic styling)
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 5; i++) {
      worksheet["!cols"][i] = { width: 15 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Kelas");

    // Generate filename
    const filename = `Data_Kelas_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Export classes error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data: ${error.message}`,
    });
  }
});

// Download template Excel untuk kelas
app.get("/api/download-class-template", async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare template data
    const templateData = [
      // Header row
      ["Nama Kelas", "Grade Level", "Wali Kelas"],
      // Example data
      ["7A", "10", "Budi Santoso"],
      ["7B", "10", "Siti Rahayu"],
      ["7B", "11", "Ahmad Wijaya"],
      // Empty row
      [],
      // Notes
      ["* Wajib diisi"],
      ["Grade Level: 1-12 (SD-SMA)"],
      ["Wali Kelas: Nama guru yang terdaftar"],
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 3; i++) {
      worksheet["!cols"][i] = { width: 20 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Kelas");

    // Generate filename
    const filename = "Template_Import_Kelas.xlsx";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Class template download error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template: ${error.message}`,
    });
  }
});

// Download template CSV untuk kelas
app.get("/api/download-class-template-csv", async (req, res) => {
  try {
    const csvContent = `Nama Kelas*,Grade Level*,Wali Kelas
X IPA 1,10,Budi Santoso
X IPA 2,10,Siti Rahayu
XI IPA 1,11,Ahmad Wijaya

*Wajib diisi
Grade Level: 1-12 (SD-SMA)
Wali Kelas: Nama guru yang terdaftar`;

    // Generate filename
    const filename = "Template_Import_Kelas.csv";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write CSV file
    fs.writeFileSync(filePath, csvContent, "utf8");

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading CSV template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template CSV",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("CSV template download error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template CSV: ${error.message}`,
    });
  }
});

// Validasi data kelas sebelum import
app.post("/api/validate-classes", async (req, res) => {
  try {
    const { classes } = req.body;

    if (!classes || !Array.isArray(classes)) {
      return res.status(400).json({
        success: false,
        message: "Data kelas tidak valid",
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < classes.length; i++) {
      const classItem = classes[i];
      const validatedClass = {};
      let hasError = false;

      // Validasi field required
      if (!classItem.nama || classItem.nama.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Nama kelas tidak boleh kosong`);
        hasError = true;
      } else {
        validatedClass.nama = classItem.nama;
      }

      if (
        classItem.grade_level === null ||
        classItem.grade_level === undefined
      ) {
        errors.push(`Baris ${i + 1}: Grade level tidak boleh kosong`);
        hasError = true;
      } else {
        const gradeLevel = parseInt(classItem.grade_level);
        if (isNaN(gradeLevel) || gradeLevel < 1 || gradeLevel > 12) {
          errors.push(`Baris ${i + 1}: Grade level harus antara 1-12`);
          hasError = true;
        } else {
          validatedClass.grade_level = gradeLevel;
        }
      }

      // Field optional
      validatedClass.wali_kelas_nama = classItem.wali_kelas_nama || "";
      validatedClass.jumlah_siswa = classItem.jumlah_siswa || 0;

      if (!hasError) {
        validatedData.push(validatedClass);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validasi data gagal",
        errors: errors,
        validatedData: validatedData,
      });
    }

    res.json({
      success: true,
      message: "Validasi data berhasil",
      validatedData: validatedData,
    });
  } catch (error) {
    console.error("Class validation error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data: ${error.message}`,
    });
  }
});

// Di index.js - Update endpoint POST kelas
app.post("/api/kelas", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah kelas baru:", req.body);
    const { nama, wali_kelas_id, grade_level } = req.body; // Tambahkan grade_level
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO kelas (id, nama, wali_kelas_id, grade_level) VALUES (?, ?, ?, ?)", // Tambahkan grade_level
      [id, nama, wali_kelas_id, grade_level]
    );
    await connection.end();

    console.log("Kelas berhasil ditambahkan:", id);
    res.json({ message: "Kelas berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST KELAS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah kelas" });
  }
});

// Update endpoint PUT kelas
app.put("/api/kelas/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update kelas:", id, req.body);
    const { nama, wali_kelas_id, grade_level } = req.body; // Tambahkan grade_level

    const connection = await getConnection();
    await connection.execute(
      "UPDATE kelas SET nama = ?, wali_kelas_id = ?, grade_level = ? WHERE id = ?", // Tambahkan grade_level
      [nama, wali_kelas_id, grade_level, id]
    );
    await connection.end();

    console.log("Kelas berhasil diupdate:", id);
    res.json({ message: "Kelas berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT KELAS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate kelas" });
  }
});

// Delete Kelas
app.delete("/api/kelas/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete kelas:", id);

    const connection = await getConnection();

    // Cek jika kelas memiliki siswa
    const [siswa] = await connection.execute(
      "SELECT id FROM siswa WHERE kelas_id = ?",
      [id]
    );

    if (siswa.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: "Kelas tidak dapat dihapus karena masih memiliki siswa",
      });
    }

    await connection.execute("DELETE FROM kelas WHERE id = ?", [id]);
    await connection.end();

    console.log("Kelas berhasil dihapus:", id);
    res.json({ message: "Kelas berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE KELAS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus kelas" });
  }
});

// Get Kelas by ID
app.get("/api/kelas/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data kelas by ID:", id);

    const connection = await getConnection();
    const [kelas] = await connection.execute(
      "SELECT k.*, u.nama as wali_kelas_nama FROM kelas k LEFT JOIN users u ON k.wali_kelas_id = u.id WHERE k.id = ?",
      [id]
    );
    await connection.end();

    if (kelas.length === 0) {
      return res.status(404).json({ error: "Kelas tidak ditemukan" });
    }

    console.log("Berhasil mengambil data kelas:", id);
    res.json(kelas[0]);
  } catch (error) {
    console.error("ERROR GET KELAS BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

// Kelola Guru
app.get("/api/guru", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data guru");
    const connection = await getConnection();
    const [guru] = await connection.execute(`
      SELECT 
        u.*, 
        k.nama as kelas_nama,
        (SELECT COUNT(*) FROM kelas WHERE wali_kelas_id = u.id) as is_wali_kelas
      FROM users u 
      LEFT JOIN kelas k ON u.kelas_id = k.id 
      WHERE u.role = 'guru'
    `);
    await connection.end();
    console.log("Berhasil mengambil data guru, jumlah:", guru.length);
    res.json(guru);
  } catch (error) {
    console.error("ERROR GET GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil data guru" });
  }
});

// Delete Guru
app.delete("/api/guru/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete guru:", id);

    const connection = await getConnection();

    // Cek jika guru adalah wali kelas
    const [waliKelas] = await connection.execute(
      "SELECT id FROM kelas WHERE wali_kelas_id = ?",
      [id]
    );

    if (waliKelas.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: "Guru tidak dapat dihapus karena masih menjadi wali kelas",
      });
    }

    await connection.execute(
      "DELETE FROM users WHERE id = ? AND role = 'guru'",
      [id]
    );
    await connection.end();

    console.log("Guru berhasil dihapus:", id);
    res.json({ message: "Guru berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE GURU:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus guru" });
  }
});

// Kelola Siswa
app.get("/api/siswa", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data siswa");
    const connection = await getConnection();
    const [siswa] = await connection.execute(`
      SELECT s.*, k.nama as kelas_nama 
      FROM siswa s 
      LEFT JOIN kelas k ON s.kelas_id = k.id
    `);
    await connection.end();
    console.log("Berhasil mengambil data siswa, jumlah:", siswa.length);
    res.json(siswa);
  } catch (error) {
    console.error("ERROR GET SISWA:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});
// Get Siswa by Kelas ID
app.get("/api/siswa/kelas/:kelasId", authenticateToken, async (req, res) => {
  try {
    const { kelasId } = req.params;
    console.log("Mengambil data siswa by kelas ID:", kelasId);

    const connection = await getConnection();
    const [siswa] = await connection.execute(
      "SELECT s.*, k.nama as kelas_nama FROM siswa s LEFT JOIN kelas k ON s.kelas_id = k.id WHERE s.kelas_id = ? ORDER BY s.nama",
      [kelasId]
    );
    await connection.end();

    console.log(
      "Berhasil mengambil data siswa untuk kelas:",
      kelasId,
      "jumlah:",
      siswa.length
    );
    res.json(siswa);
  } catch (error) {
    console.error("ERROR GET SISWA BY KELAS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

// Endpoint untuk download template kelas
app.get("/api/kelas/template", authenticateToken, async (req, res) => {
  try {
    const XLSX = require("xlsx");

    // Data contoh untuk template kelas
    const templateData = [
      {
        nama: "X IPA 1",
        grade_level: "10",
        wali_kelas_nama: "Budi Santoso",
      },
      {
        nama: "X IPA 2",
        grade_level: "10",
        wali_kelas_nama: "Siti Rahayu",
      },
      {
        nama: "XI IPA 1",
        grade_level: "11",
        wali_kelas_nama: "Ahmad Wijaya",
      },
    ];

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Tambahkan worksheet ke workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Kelas");

    // Set header
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_kelas.xlsx"'
    );

    // Tulis ke response
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (error) {
    console.error("ERROR DOWNLOAD TEMPLATE KELAS:", error.message);
    res.status(500).json({ error: "Gagal mendownload template kelas" });
  }
});

// Import kelas dari Excel
app.post(
  "/api/kelas/import",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import kelas dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedClasses = await readExcelClassesFromBuffer(req.file.buffer);

      if (importedClasses.length === 0) {
        return res.status(400).json({
          error: "Tidak ada data kelas yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedClasses.length} classes to import`);

      // Ambil data guru untuk mapping wali kelas
      connection = await getConnection();
      const [teacherList] = await connection.execute(
        "SELECT id, nama FROM users WHERE role = 'guru'"
      );
      await connection.end();

      // Proses import
      const result = await processClassImport(importedClasses, teacherList);

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT KELAS:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport kelas: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel kelas dari buffer
async function readExcelClassesFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const classes = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const classData = mapExcelRowToClass(row, index + 2);
      if (classData) {
        classes.push(classData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${classes.length} classes from Excel buffer`);
  return classes;
}

// Fungsi mapping row untuk kelas
function mapExcelRowToClass(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama kelas"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    "";

  const gradeLevel =
    normalizedRow["grade_level"] ||
    normalizedRow["grade level"] ||
    normalizedRow["tingkat"] ||
    normalizedRow["level"] ||
    normalizedRow["tingkat kelas"] ||
    "";

  const waliKelasNama =
    normalizedRow["wali_kelas_nama"] ||
    normalizedRow["wali kelas"] ||
    normalizedRow["nama wali kelas"] ||
    normalizedRow["homeroom teacher"] ||
    normalizedRow["wali"] ||
    "";

  // Jika data required tidak ada, skip
  if (!nama || !gradeLevel) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nama,
      gradeLevel,
    });
    return null;
  }

  // Validasi grade level
  const cleanGradeLevel = parseInt(gradeLevel);
  if (isNaN(cleanGradeLevel) || cleanGradeLevel < 1 || cleanGradeLevel > 12) {
    console.log(`Skipping row ${rowNumber}: Invalid grade level`, gradeLevel);
    return null;
  }

  const classData = {
    nama: nama.toString().trim(),
    grade_level: cleanGradeLevel,
    wali_kelas_nama: waliKelasNama.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped class data for row ${rowNumber}:`, classData);
  return classData;
}

// Fungsi processClassImport
async function processClassImport(importedClasses, teacherList) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const classData of importedClasses) {
      try {
        // Validasi data required
        if (!classData.nama || !classData.grade_level) {
          results.failed++;
          results.errors.push(
            `Baris ${classData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cek nama kelas duplikat
        const [existingClass] = await connection.execute(
          "SELECT id FROM kelas WHERE nama = ?",
          [classData.nama]
        );

        if (existingClass.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${classData.row_number}: Kelas '${classData.nama}' sudah terdaftar`
          );
          continue;
        }

        // Cari wali_kelas_id berdasarkan nama guru (jika ada)
        let waliKelasId = null;
        if (classData.wali_kelas_nama) {
          const teacherItem = teacherList.find(
            (teacher) =>
              teacher.nama.toLowerCase() ===
              classData.wali_kelas_nama.toLowerCase()
          );

          if (!teacherItem) {
            results.failed++;
            results.errors.push(
              `Baris ${classData.row_number}: Guru '${classData.wali_kelas_nama}' tidak ditemukan`
            );
            continue;
          }
          waliKelasId = teacherItem.id;
        }

        // Mulai transaction untuk kelas ini
        await connection.beginTransaction();

        try {
          const classId = crypto.randomUUID();

          // Insert kelas
          await connection.execute(
            "INSERT INTO kelas (id, nama, grade_level, wali_kelas_id) VALUES (?, ?, ?, ?)",
            [classId, classData.nama, classData.grade_level, waliKelasId]
          );

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (classError) {
        results.failed++;
        results.errors.push(
          `Baris ${classData.row_number}: ${classError.message}`
        );
        console.error(
          `Error importing class ${classData.nama}:`,
          classError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel kelas
app.post(
  "/api/debug/excel-kelas",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL KELAS ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// Import siswa dari Excel - TANPA SIMPAN FILE
app.post(
  "/api/siswa/import",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import siswa dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedStudents = await readExcelFromBuffer(req.file.buffer);

      if (importedStudents.length === 0) {
        return res.status(400).json({
          error: "Tidak ada data siswa yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedStudents.length} students to import`);

      // Ambil data kelas untuk mapping
      connection = await getConnection();
      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas"
      );
      await connection.end();

      // Proses import
      const result = await processStudentImport(importedStudents, classList);

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT SISWA:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport siswa: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel dari buffer (tanpa simpan file)
async function readExcelFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const students = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const studentData = mapExcelRowToStudent(row, index + 2);
      if (studentData) {
        students.push(studentData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${students.length} students from Excel buffer`);
  return students;
}

// Fungsi mapping row (sama seperti sebelumnya)
function mapExcelRowToStudent(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const nis =
    normalizedRow["nis"] ||
    normalizedRow["nomor induk siswa"] ||
    normalizedRow["no induk siswa"] ||
    normalizedRow["nomor induk"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama siswa"] ||
    normalizedRow["nama lengkap"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    "";

  // Jika data required tidak ada, skip
  if (!nis || !nama || !kelasNama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nis,
      nama,
      kelasNama,
    });
    return null;
  }

  // Mapping jenis kelamin
  let jenisKelamin = "L"; // default
  const genderValue =
    normalizedRow["jenis_kelamin"] ||
    normalizedRow["jenis kelamin"] ||
    normalizedRow["gender"] ||
    normalizedRow["kelamin"] ||
    "";

  if (genderValue) {
    const normalizedGender = genderValue.toString().toLowerCase().trim();
    if (
      normalizedGender.includes("perempuan") ||
      normalizedGender === "p" ||
      normalizedGender === "female"
    ) {
      jenisKelamin = "P";
    } else if (
      normalizedGender.includes("laki") ||
      normalizedGender === "l" ||
      normalizedGender === "male"
    ) {
      jenisKelamin = "L";
    }
  }

  // Format tanggal lahir
  let tanggalLahir = "";
  const dobValue =
    normalizedRow["tanggal_lahir"] ||
    normalizedRow["tanggal lahir"] ||
    normalizedRow["tgl lahir"] ||
    normalizedRow["date of birth"] ||
    normalizedRow["dob"] ||
    "";

  if (dobValue) {
    tanggalLahir = formatDateFromExcel(dobValue);
  }

  // Mapping lainnya
  const alamat =
    normalizedRow["alamat"] ||
    normalizedRow["address"] ||
    normalizedRow["alamat lengkap"] ||
    "";

  const namaWali =
    normalizedRow["nama_wali"] ||
    normalizedRow["nama wali"] ||
    normalizedRow["wali"] ||
    normalizedRow["parent name"] ||
    "";

  const noTelepon =
    normalizedRow["no_telepon"] ||
    normalizedRow["no telepon"] ||
    normalizedRow["telepon"] ||
    normalizedRow["phone"] ||
    normalizedRow["nomor telepon"] ||
    "";

  const emailWali =
    normalizedRow["email_wali"] ||
    normalizedRow["email wali"] ||
    normalizedRow["email"] ||
    normalizedRow["parent email"] ||
    "";

  const student = {
    nis: nis.toString().trim(),
    nama: nama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    alamat: alamat.toString().trim(),
    tanggal_lahir: tanggalLahir,
    jenis_kelamin: jenisKelamin,
    nama_wali: namaWali.toString().trim(),
    no_telepon: noTelepon.toString().trim(),
    email_wali: emailWali.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped student data for row ${rowNumber}:`, student);
  return student;
}

// Fungsi processStudentImport (tetap sama seperti sebelumnya)
async function processStudentImport(importedStudents, classList) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const studentData of importedStudents) {
      try {
        // Validasi data required
        if (!studentData.nis || !studentData.nama || !studentData.kelas_nama) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cari kelas_id berdasarkan nama kelas
        const classItem = classList.find(
          (cls) =>
            cls.nama.toLowerCase() === studentData.kelas_nama.toLowerCase()
        );

        if (!classItem) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Kelas '${studentData.kelas_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cek NIS duplikat
        const [existingNIS] = await connection.execute(
          "SELECT id FROM siswa WHERE nis = ?",
          [studentData.nis]
        );

        if (existingNIS.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: NIS '${studentData.nis}' sudah terdaftar`
          );
          continue;
        }

        // Mulai transaction untuk siswa ini
        await connection.beginTransaction();

        try {
          const studentId = crypto.randomUUID();
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const updatedAt = createdAt;

          // Insert siswa
          await connection.execute(
            "INSERT INTO siswa (id, nis, nama, kelas_id, alamat, tanggal_lahir, jenis_kelamin, nama_wali, no_telepon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              studentId,
              studentData.nis,
              studentData.nama,
              classItem.id,
              studentData.alamat,
              studentData.tanggal_lahir,
              studentData.jenis_kelamin,
              studentData.nama_wali,
              studentData.no_telepon,
              createdAt,
              updatedAt,
            ]
          );

          // Buat user wali jika email disediakan
          if (studentData.email_wali && studentData.nama_wali) {
            // Cek apakah email sudah terdaftar
            const [existingUsers] = await connection.execute(
              "SELECT id FROM users WHERE email = ?",
              [studentData.email_wali]
            );

            if (existingUsers.length === 0) {
              const waliId = crypto.randomUUID();
              const password = "password123";
              const hashedPassword = await bcrypt.hash(password, 10);

              await connection.execute(
                'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
                [
                  waliId,
                  studentData.nama_wali,
                  studentData.email_wali,
                  hashedPassword,
                  studentId,
                ]
              );
            }
          }

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (studentError) {
        results.failed++;
        results.errors.push(
          `Baris ${studentData.row_number}: ${studentError.message}`
        );
        console.error(
          `Error importing student ${studentData.nis}:`,
          studentError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel (memory storage)
app.post(
  "/api/debug/excel",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// Helper function untuk parse berbagai format tanggal
function tryParseDate(dateString, format) {
  try {
    const parts = dateString.split(/[/\-\.]/);
    if (parts.length !== 3) return null;

    let day, month, year;

    switch (format) {
      case "DD/MM/YYYY":
      case "DD-MM-YYYY":
        day = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        year = parseInt(parts[2]);
        break;
      case "MM/DD/YYYY":
      case "MM-DD-YYYY":
        month = parseInt(parts[0]) - 1;
        day = parseInt(parts[1]);
        year = parseInt(parts[2]);
        break;
      case "YYYY/MM/DD":
      case "YYYY-MM-DD":
        year = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        day = parseInt(parts[2]);
        break;
      default:
        return null;
    }

    // Validasi tahun
    if (year < 100) {
      year += 2000; // Handle 2-digit year
    }

    const date = new Date(year, month, day);
    if (
      !isNaN(date.getTime()) &&
      date.getDate() === day &&
      date.getMonth() === month &&
      date.getFullYear() === year
    ) {
      return date;
    }
  } catch (error) {
    console.error("Error parsing date:", error);
  }

  return null;
}
// Fungsi improved untuk format tanggal dari Excel
function formatDateFromExcel(dateValue) {
  if (!dateValue) return "";

  console.log("Original date value:", dateValue, "Type:", typeof dateValue);

  try {
    // Jika sudah dalam format string ISO
    if (typeof dateValue === "string") {
      // Coba parse berbagai format
      const dateFormats = [
        "YYYY-MM-DD",
        "DD/MM/YYYY",
        "MM/DD/YYYY",
        "YYYY/MM/DD",
        "DD-MM-YYYY",
        "MM-DD-YYYY",
      ];

      for (const format of dateFormats) {
        const parsed = tryParseDate(dateValue, format);
        if (parsed) {
          return parsed.toISOString().split("T")[0];
        }
      }

      // Jika mengandung timestamp, ambil hanya tanggalnya
      if (dateValue.includes(" ")) {
        const datePart = dateValue.split(" ")[0];
        const parsed = new Date(datePart);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split("T")[0];
        }
      }
    }

    // Jika dari Excel (number)
    if (typeof dateValue === "number") {
      const excelEpoch = new Date(1899, 11, 30); // Excel epoch
      const date = new Date(
        excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000
      );
      if (!isNaN(date.getTime())) {
        return date.toISOString().split("T")[0];
      }
    }

    // Jika Date object
    if (dateValue instanceof Date) {
      if (!isNaN(dateValue.getTime())) {
        return dateValue.toISOString().split("T")[0];
      }
    }

    // Coba parse sebagai date langsung
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  } catch (error) {
    console.error("Error formatting date:", error);
  }

  return ""; // Return empty string jika tidak bisa diparse
}

// Fungsi untuk mapping berbagai format kolom Excel
function mapExcelRowToStudent(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const nis =
    normalizedRow["nis"] ||
    normalizedRow["nomor induk siswa"] ||
    normalizedRow["no induk siswa"] ||
    normalizedRow["nomor induk"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama siswa"] ||
    normalizedRow["nama lengkap"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    "";

  // Jika data required tidak ada, skip
  if (!nis || !nama || !kelasNama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nis,
      nama,
      kelasNama,
    });
    return null;
  }

  // Mapping jenis kelamin
  let jenisKelamin = "L"; // default
  const genderValue =
    normalizedRow["jenis_kelamin"] ||
    normalizedRow["jenis kelamin"] ||
    normalizedRow["gender"] ||
    normalizedRow["kelamin"] ||
    "";

  if (genderValue) {
    const normalizedGender = genderValue.toString().toLowerCase().trim();
    if (
      normalizedGender.includes("perempuan") ||
      normalizedGender === "p" ||
      normalizedGender === "female"
    ) {
      jenisKelamin = "P";
    } else if (
      normalizedGender.includes("laki") ||
      normalizedGender === "l" ||
      normalizedGender === "male"
    ) {
      jenisKelamin = "L";
    }
  }

  // Format tanggal lahir
  let tanggalLahir = "";
  const dobValue =
    normalizedRow["tanggal_lahir"] ||
    normalizedRow["tanggal lahir"] ||
    normalizedRow["tgl lahir"] ||
    normalizedRow["date of birth"] ||
    normalizedRow["dob"] ||
    "";

  if (dobValue) {
    tanggalLahir = formatDateFromExcel(dobValue);
  }

  // Mapping lainnya
  const alamat =
    normalizedRow["alamat"] ||
    normalizedRow["address"] ||
    normalizedRow["alamat lengkap"] ||
    "";

  const namaWali =
    normalizedRow["nama_wali"] ||
    normalizedRow["nama wali"] ||
    normalizedRow["wali"] ||
    normalizedRow["parent name"] ||
    "";

  const noTelepon =
    normalizedRow["no_telepon"] ||
    normalizedRow["no telepon"] ||
    normalizedRow["telepon"] ||
    normalizedRow["phone"] ||
    normalizedRow["nomor telepon"] ||
    "";

  const emailWali =
    normalizedRow["email_wali"] ||
    normalizedRow["email wali"] ||
    normalizedRow["email"] ||
    normalizedRow["parent email"] ||
    "";

  const student = {
    nis: nis.toString().trim(),
    nama: nama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    alamat: alamat.toString().trim(),
    tanggal_lahir: tanggalLahir,
    jenis_kelamin: jenisKelamin,
    nama_wali: namaWali.toString().trim(),
    no_telepon: noTelepon.toString().trim(),
    email_wali: emailWali.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped student data for row ${rowNumber}:`, student);
  return student;
}

// Fungsi untuk membaca file Excel - PERBAIKAN
async function readExcelFile(filePath) {
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data:", data);

  const students = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const studentData = mapExcelRowToStudent(row, index + 2);
      if (studentData) {
        students.push(studentData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${students.length} students from Excel`);
  return students;
}

// Fungsi untuk memproses import siswa
async function processStudentImport(importedStudents, classList) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const studentData of importedStudents) {
      try {
        // Validasi data required
        if (!studentData.nis || !studentData.nama || !studentData.kelas_nama) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cari kelas_id berdasarkan nama kelas
        const classItem = classList.find(
          (cls) =>
            cls.nama.toLowerCase() === studentData.kelas_nama.toLowerCase()
        );

        if (!classItem) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Kelas '${studentData.kelas_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cek NIS duplikat
        const [existingNIS] = await connection.execute(
          "SELECT id FROM siswa WHERE nis = ?",
          [studentData.nis]
        );

        if (existingNIS.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: NIS '${studentData.nis}' sudah terdaftar`
          );
          continue;
        }

        // Mulai transaction untuk siswa ini
        await connection.beginTransaction();

        try {
          const studentId = crypto.randomUUID();
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const updatedAt = createdAt;

          // Insert siswa
          await connection.execute(
            "INSERT INTO siswa (id, nis, nama, kelas_id, alamat, tanggal_lahir, jenis_kelamin, nama_wali, no_telepon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              studentId,
              studentData.nis,
              studentData.nama,
              classItem.id,
              studentData.alamat,
              studentData.tanggal_lahir,
              studentData.jenis_kelamin,
              studentData.nama_wali,
              studentData.no_telepon,
              createdAt,
              updatedAt,
            ]
          );

          // Buat user wali jika email disediakan
          if (studentData.email_wali && studentData.nama_wali) {
            // Cek apakah email sudah terdaftar
            const [existingUsers] = await connection.execute(
              "SELECT id FROM users WHERE email = ?",
              [studentData.email_wali]
            );

            if (existingUsers.length === 0) {
              const waliId = crypto.randomUUID();
              const password = "password123";
              const hashedPassword = await bcrypt.hash(password, 10);

              await connection.execute(
                'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
                [
                  waliId,
                  studentData.nama_wali,
                  studentData.email_wali,
                  hashedPassword,
                  studentId,
                ]
              );
            }
          }

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (studentError) {
        results.failed++;
        results.errors.push(
          `Baris ${studentData.row_number}: ${studentError.message}`
        );
        console.error(
          `Error importing student ${studentData.nis}:`,
          studentError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Fungsi helper untuk format tanggal
function formatDate(dateValue) {
  if (!dateValue) return "";

  // Jika sudah dalam format string
  if (typeof dateValue === "string") {
    return dateValue;
  }

  // Jika dari Excel (number)
  if (typeof dateValue === "number") {
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(
      excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000
    );
    return date.toISOString().slice(0, 10);
  }

  // Jika Date object
  if (dateValue instanceof Date) {
    return dateValue.toISOString().slice(0, 10);
  }

  return "";
}

// Download template Excel
app.get("/api/siswa/template", authenticateToken, async (req, res) => {
  try {
    const XLSX = require("xlsx");

    // Data contoh untuk template
    const templateData = [
      {
        nis: "2024001",
        nama: "John Doe",
        kelas_nama: "X IPA 1",
        alamat: "Jl. Contoh No. 123",
        tanggal_lahir: "2008-05-15",
        jenis_kelamin: "L",
        nama_wali: "Robert Doe",
        no_telepon: "081234567890",
        email_wali: "robert@example.com",
      },
      {
        nis: "2024002",
        nama: "Jane Smith",
        kelas_nama: "X IPA 2",
        alamat: "Jl. Sample No. 456",
        tanggal_lahir: "2008-08-20",
        jenis_kelamin: "P",
        nama_wali: "Alice Smith",
        no_telepon: "081298765432",
        email_wali: "alice@example.com",
      },
    ];

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Tambahkan worksheet ke workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Siswa");

    // Set header
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_siswa.xlsx"'
    );

    // Tulis ke response
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (error) {
    console.error("ERROR DOWNLOAD TEMPLATE:", error.message);
    res.status(500).json({ error: "Gagal mendownload template" });
  }
});

// Modifikasi endpoint POST siswa dengan transaction yang benar
app.post("/api/siswa", authenticateToken, async (req, res) => {
  let connection;
  try {
    console.log("Menambah siswa baru:", req.body);
    const {
      nis,
      nama,
      kelas_id,
      alamat,
      tanggal_lahir,
      jenis_kelamin,
      nama_wali,
      no_telepon,
      email_wali,
    } = req.body;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const updatedAt = createdAt;

    connection = await getConnection();

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // 1. Insert siswa terlebih dahulu
      await connection.execute(
        "INSERT INTO siswa (id, nis, nama, kelas_id, alamat, tanggal_lahir, jenis_kelamin, nama_wali, no_telepon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          nis,
          nama,
          kelas_id,
          alamat,
          tanggal_lahir,
          jenis_kelamin,
          nama_wali,
          no_telepon,
          createdAt,
          updatedAt,
        ]
      );

      console.log("Siswa berhasil dimasukkan ke database dengan ID:", id);

      // 2. Buat user wali jika email_wali disediakan
      if (email_wali && nama_wali) {
        console.log("Membuat user wali dengan email:", email_wali);

        // Cek apakah email sudah terdaftar
        const [existingUsers] = await connection.execute(
          "SELECT id FROM users WHERE email = ?",
          [email_wali]
        );

        if (existingUsers.length > 0) {
          await connection.rollback();
          return res.status(400).json({
            error: `Email wali '${email_wali}' sudah terdaftar`,
          });
        }

        const waliId = crypto.randomUUID();
        const password = "password123";
        const hashedPassword = await bcrypt.hash(password, 10);

        await connection.execute(
          'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
          [waliId, nama_wali, email_wali, hashedPassword, id]
        );

        console.log("User wali berhasil dibuat dengan ID:", waliId);
      }

      // Commit transaction
      await connection.commit();
      console.log("Transaction committed successfully");

      res.json({
        message: "Siswa berhasil ditambahkan",
        id,
        info: email_wali
          ? "User wali berhasil dibuat dengan password: password123"
          : "User wali tidak dibuat (email tidak disediakan)",
      });
    } catch (transactionError) {
      // Rollback jika ada error dalam transaction
      await connection.rollback();
      console.error("Transaction error:", transactionError.message);
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR POST SISWA:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error stack:", error.stack);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({
      error: "Gagal menambah siswa: " + error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    // Pastikan koneksi ditutup
    if (connection) {
      await connection.end();
    }
  }
});

// Modifikasi endpoint PUT siswa
// Modifikasi endpoint PUT siswa - PERBAIKAN
app.put("/api/siswa/:id", authenticateToken, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    console.log("Update siswa:", id, req.body);
    const {
      nis,
      nama,
      kelas_id,
      alamat,
      tanggal_lahir,
      jenis_kelamin,
      nama_wali,
      no_telepon,
      email_wali, // Tambahkan field email_wali
    } = req.body;
    const updatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    connection = await getConnection();

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // Update siswa
      await connection.execute(
        "UPDATE siswa SET nis = ?, nama = ?, kelas_id = ?, alamat = ?, tanggal_lahir = ?, jenis_kelamin = ?, nama_wali = ?, no_telepon = ?, updated_at = ? WHERE id = ?",
        [
          nis,
          nama,
          kelas_id,
          alamat,
          tanggal_lahir,
          jenis_kelamin,
          nama_wali,
          no_telepon,
          updatedAt,
          id,
        ]
      );

      // Cek apakah sudah ada user wali untuk siswa ini
      const [existingWali] = await connection.execute(
        "SELECT id, email FROM users WHERE siswa_id = ? AND role = 'wali'",
        [id]
      );

      if (email_wali && nama_wali) {
        if (existingWali.length > 0) {
          // Update user wali yang sudah ada
          if (existingWali[0].email !== email_wali) {
            // Cek jika email baru sudah digunakan
            const [emailCheck] = await connection.execute(
              "SELECT id FROM users WHERE email = ? AND id != ?",
              [email_wali, existingWali[0].id]
            );

            if (emailCheck.length > 0) {
              await connection.rollback();
              await connection.end();
              return res
                .status(400)
                .json({ error: "Email wali sudah digunakan" });
            }
          }

          await connection.execute(
            "UPDATE users SET nama = ?, email = ? WHERE siswa_id = ? AND role = 'wali'",
            [nama_wali, email_wali, id]
          );
        } else {
          // BUAT USER WALI BARU - INI YANG DIPERBAIKI
          const waliId = crypto.randomUUID();
          const password = "password123";
          const hashedPassword = await bcrypt.hash(password, 10);

          // Cek apakah email sudah terdaftar
          const [emailCheck] = await connection.execute(
            "SELECT id FROM users WHERE email = ?",
            [email_wali]
          );

          if (emailCheck.length > 0) {
            await connection.rollback();
            await connection.end();
            return res.status(400).json({
              error: "Email wali sudah digunakan oleh user lain",
            });
          }

          await connection.execute(
            'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
            [waliId, nama_wali, email_wali, hashedPassword, id]
          );

          console.log("User wali baru berhasil dibuat:", waliId);
        }
      } else if (existingWali.length > 0) {
        // Hapus user wali jika email_wali dihapus
        await connection.execute(
          "DELETE FROM users WHERE siswa_id = ? AND role = 'wali'",
          [id]
        );
      }

      // Commit transaction
      await connection.commit();
      await connection.end();

      console.log("Siswa berhasil diupdate:", id);
      res.json({
        message: "Siswa berhasil diupdate",
        info:
          email_wali && nama_wali
            ? "User wali berhasil dibuat/diperbarui dengan password: password123"
            : undefined,
      });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR PUT SISWA:", error.message);
    console.error("SQL Error code:", error.code);

    if (connection) {
      await connection.end();
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal mengupdate siswa: " + error.message });
  }
});

// Modifikasi endpoint DELETE siswa
app.delete("/api/siswa/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete siswa:", id);

    const connection = await getConnection();

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // Hapus user wali terlebih dahulu
      await connection.execute(
        "DELETE FROM users WHERE siswa_id = ? AND role = 'wali'",
        [id]
      );

      // Hapus siswa
      await connection.execute("DELETE FROM siswa WHERE id = ?", [id]);

      // Commit transaction
      await connection.commit();
      await connection.end();

      console.log("Siswa berhasil dihapus:", id);
      res.json({ message: "Siswa berhasil dihapus" });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR DELETE SISWA:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus siswa" });
  }
});

// Kelola Siswa - Get Siswa by ID
app.get("/api/siswa/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data siswa by ID:", id);

    const connection = await getConnection();
    const [siswa] = await connection.execute(
      "SELECT s.*, k.nama as kelas_nama FROM siswa s LEFT JOIN kelas k ON s.kelas_id = k.id WHERE s.id = ?",
      [id]
    );
    await connection.end();

    if (siswa.length === 0) {
      return res.status(404).json({ error: "Siswa tidak ditemukan" });
    }

    console.log("Berhasil mengambil data siswa:", id);
    res.json(siswa[0]);
  } catch (error) {
    console.error("ERROR GET SISWA BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

// Get Mata Pelajaran
app.get("/api/mata-pelajaran", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data mata pelajaran");
    const connection = await getConnection();
    const [mataPelajaran] = await connection.execute(
      "SELECT * FROM mata_pelajaran"
    );
    await connection.end();
    console.log(
      "Berhasil mengambil data mata pelajaran, jumlah:",
      mataPelajaran.length
    );
    res.json(mataPelajaran);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data mata pelajaran" });
  }
});

app.post('/api/export-subjects', async (req, res) => {
  try {
    const { subjects } = req.body;

    if (!subjects || !Array.isArray(subjects)) {
      return res.status(400).json({
        success: false,
        message: 'Data mata pelajaran tidak valid'
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();
    
    // Prepare data for Excel
    const excelData = [
      // Header row
      ['Kode*', 'Nama*', 'Deskripsi', 'Kelas', 'Status'],
      // Data rows
      ...subjects.map(subject => [
        subject.kode || '',
        subject.nama || '',
        subject.deskripsi || '',
        getClassNames(subject),
        'Active'
      ])
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Add style to header row (basic styling)
    if (!worksheet['!cols']) worksheet['!cols'] = [];
    for (let i = 0; i < 5; i++) {
      worksheet['!cols'][i] = { width: 15 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Mata Pelajaran');

    // Generate filename
    const filename = `Data_Mata_Pelajaran_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, '../temp', filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, '../temp'))) {
      fs.mkdirSync(path.join(__dirname, '../temp'), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        res.status(500).json({
          success: false,
          message: 'Gagal mengunduh file'
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });

  } catch (error) {
    console.error('Export subjects error:', error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data: ${error.message}`
    });
  }
});

// Download template Excel untuk mata pelajaran
app.get('/api/download-subject-template', async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();
    
    // Prepare template data
    const templateData = [
      // Header row
      ['Kode', 'Nama', 'Deskripsi', 'Kelas'],
      // Example data
      ['BI-7', 'Bahasa Indonesia', 'Bahasa Indonesia untuk kelas 7', '7A'],
      ['BIN-7', 'Bahasa Inggris', 'Bahasa Inggris untuk kelas 7', '7A'],
      ['MTK-7', 'Matematika', 'Matematika untuk kelas 7', '7A,7B'],
      ['IPA-7', 'Ilmu Pengetahuan Alam', 'IPA untuk kelas 7', '7A,7B,7C'],
      // Empty row
      [],
      // Notes
      ['* Wajib diisi'],
      ['Kelas: Pisahkan dengan koma jika multiple'],
      ['Contoh: 7A,7B,8A']
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    if (!worksheet['!cols']) worksheet['!cols'] = [];
    for (let i = 0; i < 4; i++) {
      worksheet['!cols'][i] = { width: 20 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Mata Pelajaran');

    // Generate filename
    const filename = 'Template_Import_Mata_Pelajaran.xlsx';
    const filePath = path.join(__dirname, '../temp', filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, '../temp'))) {
      fs.mkdirSync(path.join(__dirname, '../temp'), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Error downloading template:', err);
        res.status(500).json({
          success: false,
          message: 'Gagal mengunduh template'
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });

  } catch (error) {
    console.error('Subject template download error:', error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template: ${error.message}`
    });
  }
});

app.post('/api/validate-subjects', async (req, res) => {
  try {
    const { subjects } = req.body;

    if (!subjects || !Array.isArray(subjects)) {
      return res.status(400).json({
        success: false,
        message: 'Data mata pelajaran tidak valid'
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      const validatedSubject = {};
      let hasError = false;

      // Validasi field required
      if (!subject.kode || subject.kode.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Kode mata pelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSubject.kode = subject.kode.toString().trim();
      }

      if (!subject.nama || subject.nama.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Nama mata pelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSubject.nama = subject.nama.toString().trim();
      }

      // Field optional
      validatedSubject.deskripsi = subject.deskripsi || '';
      validatedSubject.kelas = subject.kelas || '';

      if (!hasError) {
        validatedData.push(validatedSubject);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validasi data gagal',
        errors: errors,
        validatedData: validatedData
      });
    }

    res.json({
      success: true,
      message: 'Validasi data berhasil',
      validatedData: validatedData
    });

  } catch (error) {
    console.error('Subject validation error:', error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data: ${error.message}`
    });
  }
});

function getClassNames(subject) {
  if (subject.kelas_names) {
    return subject.kelas_names;
  }
  
  if (subject.kelas_list && Array.isArray(subject.kelas_list)) {
    return subject.kelas_list.map(kelas => kelas.nama || '').join(', ');
  }
  
  return '';
}

// Import mata pelajaran dari Excel
app.post(
  "/api/mata-pelajaran/import",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import mata pelajaran dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedSubjects = await readExcelSubjectsFromBuffer(
        req.file.buffer
      );

      if (importedSubjects.length === 0) {
        return res.status(400).json({
          error:
            "Tidak ada data mata pelajaran yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedSubjects.length} subjects to import`);

      // Ambil data kelas untuk mapping
      connection = await getConnection();
      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas"
      );
      await connection.end();

      // Proses import
      const result = await processSubjectImport(importedSubjects, classList);

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT MATA PELAJARAN:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport mata pelajaran: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel mata pelajaran dari buffer
async function readExcelSubjectsFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const subjects = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const subjectData = mapExcelRowToSubject(row, index + 2);
      if (subjectData) {
        subjects.push(subjectData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${subjects.length} subjects from Excel buffer`);
  return subjects;
}

// Fungsi mapping row untuk mata pelajaran
function mapExcelRowToSubject(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const kode =
    normalizedRow["kode"] ||
    normalizedRow["code"] ||
    normalizedRow["kode mata pelajaran"] ||
    normalizedRow["subject code"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama mata pelajaran"] ||
    normalizedRow["subject name"] ||
    normalizedRow["mata pelajaran"] ||
    "";

  // Jika data required tidak ada, skip
  if (!kode || !nama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      kode,
      nama,
    });
    return null;
  }

  // Mapping lainnya
  const deskripsi =
    normalizedRow["deskripsi"] ||
    normalizedRow["description"] ||
    normalizedRow["deskripsi mata pelajaran"] ||
    normalizedRow["subject description"] ||
    "";

  const kelasNames =
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["kelas names"] ||
    normalizedRow["classes"] ||
    normalizedRow["nama kelas"] ||
    "";

  const subject = {
    kode: kode.toString().trim(),
    nama: nama.toString().trim(),
    deskripsi: deskripsi.toString().trim(),
    kelas_names: kelasNames.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped subject data for row ${rowNumber}:`, subject);
  return subject;
}

// Fungsi processSubjectImport
async function processSubjectImport(importedSubjects, classList) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const subjectData of importedSubjects) {
      try {
        // Validasi data required
        if (!subjectData.kode || !subjectData.nama) {
          results.failed++;
          results.errors.push(
            `Baris ${subjectData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cek kode duplikat
        const [existingKode] = await connection.execute(
          "SELECT id FROM mata_pelajaran WHERE kode = ?",
          [subjectData.kode]
        );

        if (existingKode.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${subjectData.row_number}: Kode '${subjectData.kode}' sudah terdaftar`
          );
          continue;
        }

        // Mulai transaction untuk mata pelajaran ini
        await connection.beginTransaction();

        try {
          const subjectId = crypto.randomUUID();
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const updatedAt = createdAt;

          // Insert mata pelajaran
          await connection.execute(
            "INSERT INTO mata_pelajaran (id, kode, nama, deskripsi, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [
              subjectId,
              subjectData.kode,
              subjectData.nama,
              subjectData.deskripsi,
              createdAt,
              updatedAt,
            ]
          );

          // Tambahkan relasi kelas jika disediakan
          if (subjectData.kelas_names) {
            const kelasItems = subjectData.kelas_names
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== "");

            for (const kelasNama of kelasItems) {
              const classItem = classList.find(
                (cls) => cls.nama.toLowerCase() === kelasNama.toLowerCase()
              );

              if (classItem) {
                const relationId = crypto.randomUUID();
                await connection.execute(
                  "INSERT INTO mata_pelajaran_kelas (id, mata_pelajaran_id, kelas_id) VALUES (?, ?, ?)",
                  [relationId, subjectId, classItem.id]
                );
              }
            }
          }

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (subjectError) {
        results.failed++;
        results.errors.push(
          `Baris ${subjectData.row_number}: ${subjectError.message}`
        );
        console.error(
          `Error importing subject ${subjectData.kode}:`,
          subjectError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel mata pelajaran
app.post(
  "/api/debug/excel-mata-pelajaran",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL MATA PELAJARAN ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get Mata Pelajaran by ID
app.get("/api/mata-pelajaran/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data mata pelajaran by ID:", id);

    const connection = await getConnection();
    const [mataPelajaran] = await connection.execute(
      "SELECT * FROM mata_pelajaran WHERE id = ?",
      [id]
    );
    await connection.end();

    if (mataPelajaran.length === 0) {
      return res.status(404).json({ error: "Mata pelajaran tidak ditemukan" });
    }

    console.log("Berhasil mengambil data mata pelajaran:", id);
    res.json(mataPelajaran[0]);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data mata pelajaran" });
  }
});

// Create Mata Pelajaran
app.post("/api/mata-pelajaran", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah mata pelajaran baru:", req.body);
    const { kode, nama, deskripsi } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO mata_pelajaran (id, kode, nama, deskripsi) VALUES (?, ?, ?, ?)",
      [id, kode, nama, deskripsi]
    );
    await connection.end();

    console.log("Mata pelajaran berhasil ditambahkan:", id);
    res.json({ message: "Mata pelajaran berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST MATA PELAJARAN:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ error: "Kode mata pelajaran sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal menambah mata pelajaran" });
  }
});

// Update Mata Pelajaran
app.put("/api/mata-pelajaran/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update mata pelajaran:", id, req.body);
    const { kode, nama, deskripsi } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE mata_pelajaran SET kode = ?, nama = ?, deskripsi = ? WHERE id = ?",
      [kode, nama, deskripsi, id]
    );
    await connection.end();

    console.log("Mata pelajaran berhasil diupdate:", id);
    res.json({ message: "Mata pelajaran berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT MATA PELAJARAN:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ error: "Kode mata pelajaran sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal mengupdate mata pelajaran" });
  }
});

// Delete Mata Pelajaran
app.delete("/api/mata-pelajaran/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete mata pelajaran:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM mata_pelajaran WHERE id = ?", [id]);
    await connection.end();

    console.log("Mata pelajaran berhasil dihapus:", id);
    res.json({ message: "Mata pelajaran berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE MATA PELAJARAN:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({
        error: "Mata pelajaran tidak dapat dihapus karena masih digunakan",
      });
    }

    res.status(500).json({ error: "Gagal menghapus mata pelajaran" });
  }
});

// Ganti query di endpoint /api/guru/:id
app.get("/api/guru/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data guru by ID:", id);

    const connection = await getConnection();

    // Query yang diperbaiki - ambil data guru dengan mata pelajaran dari tabel many-to-many
    const [guru] = await connection.execute(
      `
      SELECT 
        u.*, 
        k.nama as kelas_nama,
        (SELECT COUNT(*) FROM kelas WHERE wali_kelas_id = u.id) as is_wali_kelas,
        GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
        GROUP_CONCAT(DISTINCT mp.id) as mata_pelajaran_ids
      FROM users u 
      LEFT JOIN kelas k ON u.kelas_id = k.id 
      LEFT JOIN guru_mata_pelajaran gmp ON u.id = gmp.guru_id
      LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id
      WHERE u.id = ?
      GROUP BY u.id
    `,
      [id]
    );

    await connection.end();

    if (guru.length === 0) {
      return res.status(404).json({ error: "Guru tidak ditemukan" });
    }

    console.log("Berhasil mengambil data guru:", id);
    res.json(guru[0]);
  } catch (error) {
    console.error("ERROR GET GURU BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data guru" });
  }
});

// Endpoint untuk download template guru
app.get("/api/guru/template", authenticateToken, async (req, res) => {
  try {
    const XLSX = require("xlsx");

    // Data contoh untuk template guru
    const templateData = [
      {
        nip: "198001012000121001",
        nama: "Budi Santoso",
        email: "budi.santoso@sekolah.sch.id",
        mata_pelajaran_nama: "Matematika",
        kelas_nama: "X IPA 1",
        no_telepon: "081234567890",
        is_wali_kelas: "Ya",
      },
      {
        nip: "198002022000122002",
        nama: "Siti Rahayu",
        email: "siti.rahayu@sekolah.sch.id",
        mata_pelajaran_nama: "Bahasa Indonesia",
        kelas_nama: "X IPA 2",
        no_telepon: "081298765432",
        is_wali_kelas: "Tidak",
      },
    ];

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Tambahkan worksheet ke workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Guru");

    // Set header
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_guru.xlsx"'
    );

    // Tulis ke response
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (error) {
    console.error("ERROR DOWNLOAD TEMPLATE GURU:", error.message);
    res.status(500).json({ error: "Gagal mendownload template guru" });
  }
});

// Import guru dari Excel
app.post(
  "/api/guru/import",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import guru dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedTeachers = await readExcelTeachersFromBuffer(
        req.file.buffer
      );

      if (importedTeachers.length === 0) {
        return res.status(400).json({
          error: "Tidak ada data guru yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedTeachers.length} teachers to import`);

      // Ambil data kelas dan mata pelajaran untuk mapping
      connection = await getConnection();
      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas"
      );
      const [subjectList] = await connection.execute(
        "SELECT id, nama FROM mata_pelajaran"
      );
      await connection.end();

      // Proses import
      const result = await processTeacherImport(
        importedTeachers,
        classList,
        subjectList
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT GURU:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport guru: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel guru dari buffer
async function readExcelTeachersFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const teachers = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const teacherData = mapExcelRowToTeacher(row, index + 2);
      if (teacherData) {
        teachers.push(teacherData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${teachers.length} teachers from Excel buffer`);
  return teachers;
}

// Fungsi mapping row untuk guru
function mapExcelRowToTeacher(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const nip =
    normalizedRow["nip"] ||
    normalizedRow["nomor induk pegawai"] ||
    normalizedRow["no induk pegawai"] ||
    normalizedRow["nomor induk"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama guru"] ||
    normalizedRow["nama lengkap"] ||
    "";

  const email =
    normalizedRow["email"] ||
    normalizedRow["email guru"] ||
    normalizedRow["alamat email"] ||
    "";

  const mataPelajaranNama =
    normalizedRow["mata_pelajaran_nama"] ||
    normalizedRow["mata pelajaran"] ||
    normalizedRow["pelajaran"] ||
    normalizedRow["subject"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    "";

  // Jika data required tidak ada, skip
  if (!nip || !nama || !email) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nip,
      nama,
      email,
    });
    return null;
  }

  // Mapping is_wali_kelas
  let isWaliKelas = false;
  const waliKelasValue =
    normalizedRow["is_wali_kelas"] ||
    normalizedRow["wali kelas"] ||
    normalizedRow["is_wali"] ||
    normalizedRow["homeroom teacher"] ||
    "";

  if (waliKelasValue) {
    const normalizedWali = waliKelasValue.toString().toLowerCase().trim();
    if (
      normalizedWali.includes("ya") ||
      normalizedWali === "y" ||
      normalizedWali === "yes" ||
      normalizedWali === "true" ||
      normalizedWali === "1"
    ) {
      isWaliKelas = true;
    }
  }

  // Mapping lainnya
  const noTelepon =
    normalizedRow["no_telepon"] ||
    normalizedRow["no telepon"] ||
    normalizedRow["telepon"] ||
    normalizedRow["phone"] ||
    normalizedRow["nomor telepon"] ||
    "";

  const teacher = {
    nip: nip.toString().trim(),
    nama: nama.toString().trim(),
    email: email.toString().trim(),
    mata_pelajaran_nama: mataPelajaranNama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    no_telepon: noTelepon.toString().trim(),
    is_wali_kelas: isWaliKelas,
    row_number: rowNumber,
  };

  console.log(`Mapped teacher data for row ${rowNumber}:`, teacher);
  return teacher;
}

// Fungsi processTeacherImport
async function processTeacherImport(importedTeachers, classList, subjectList) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const teacherData of importedTeachers) {
      try {
        // Validasi data required
        if (!teacherData.nip || !teacherData.nama || !teacherData.email) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cek NIP duplikat
        const [existingNIP] = await connection.execute(
          "SELECT id FROM users WHERE nip = ? AND role = 'guru'",
          [teacherData.nip]
        );

        if (existingNIP.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: NIP '${teacherData.nip}' sudah terdaftar`
          );
          continue;
        }

        // Cek email duplikat
        const [existingEmail] = await connection.execute(
          "SELECT id FROM users WHERE email = ?",
          [teacherData.email]
        );

        if (existingEmail.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: Email '${teacherData.email}' sudah terdaftar`
          );
          continue;
        }

        // Cari kelas_id berdasarkan nama kelas (jika ada)
        let kelasId = null;
        if (teacherData.kelas_nama) {
          const classItem = classList.find(
            (cls) =>
              cls.nama.toLowerCase() === teacherData.kelas_nama.toLowerCase()
          );

          if (!classItem) {
            results.failed++;
            results.errors.push(
              `Baris ${teacherData.row_number}: Kelas '${teacherData.kelas_nama}' tidak ditemukan`
            );
            continue;
          }
          kelasId = classItem.id;
        }

        // Mulai transaction untuk guru ini
        await connection.beginTransaction();

        try {
          const teacherId = crypto.randomUUID();
          const password = "password123";
          const hashedPassword = await bcrypt.hash(password, 10);

          // Insert guru
          await connection.execute(
            "INSERT INTO users (id, nama, email, password, role, nip, kelas_id, is_wali_kelas, no_telepon) VALUES (?, ?, ?, ?, 'guru', ?, ?, ?, ?)",
            [
              teacherId,
              teacherData.nama,
              teacherData.email,
              hashedPassword,
              teacherData.nip,
              kelasId,
              teacherData.is_wali_kelas,
              teacherData.no_telepon || "",
            ]
          );

          // Tambahkan mata pelajaran jika disediakan
          if (teacherData.mata_pelajaran_nama) {
            const mataPelajaranItems = teacherData.mata_pelajaran_nama
              .split(",")
              .map((item) => item.trim());

            for (const mpNama of mataPelajaranItems) {
              const subjectItem = subjectList.find(
                (subj) => subj.nama.toLowerCase() === mpNama.toLowerCase()
              );

              if (subjectItem) {
                const relationId = crypto.randomUUID();
                await connection.execute(
                  "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id) VALUES (?, ?, ?)",
                  [relationId, teacherId, subjectItem.id]
                );
              }
            }
          }

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (teacherError) {
        results.failed++;
        results.errors.push(
          `Baris ${teacherData.row_number}: ${teacherError.message}`
        );
        console.error(
          `Error importing teacher ${teacherData.nip}:`,
          teacherError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel guru
app.post(
  "/api/debug/excel-guru",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL GURU ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

app.post("/api/guru", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah guru baru:", req.body);

    // Hapus mata_pelajaran_id dari data karena sekarang menggunakan many-to-many
    const { nama, email, kelas_id, nip, is_wali_kelas } = req.body;
    const id = crypto.randomUUID();

    // Debug: Pastikan password valid
    const password = "password123";
    console.log("Password to hash:", password, "Type:", typeof password);

    if (!password || typeof password !== "string") {
      console.error("Invalid password:", password);
      return res.status(400).json({ error: "Password tidak valid" });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      console.log("Password hashed successfully");

      const connection = await getConnection();

      // Hapus mata_pelajaran_id dari query
      await connection.execute(
        'INSERT INTO users (id, nama, email, password, role, kelas_id, nip, is_wali_kelas) VALUES (?, ?, ?, ?, "guru", ?, ?, ?)',
        [
          id,
          nama,
          email,
          hashedPassword,
          kelas_id || null,
          nip || null,
          is_wali_kelas || false,
        ]
      );

      await connection.end();

      console.log("Guru berhasil ditambahkan:", email);
      res.json({
        message: "Guru berhasil ditambahkan",
        id,
        info: "Password default: password123",
      });
    } catch (hashError) {
      console.error("BCRYPT HASH ERROR:", hashError.message);
      console.error("Hash error details:", hashError);
      res.status(500).json({ error: "Gagal mengenkripsi password" });
    }
  } catch (error) {
    console.error("ERROR POST GURU:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error stack:", error.stack);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal menambah guru" });
  }
});

// Update Guru dengan Mata Pelajaran
// Update Guru - Hapus mata_pelajaran_id dari update karena sekarang menggunakan many-to-many
app.put("/api/guru/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update guru:", id, req.body);

    // Pastikan semua nilai tidak undefined
    const { nama, email, kelas_id, nip, is_wali_kelas } = req.body;

    // Konversi nilai yang mungkin undefined ke null
    const cleanKelasId = kelas_id || null;
    const cleanNip = nip || null;
    const cleanIsWaliKelas = is_wali_kelas || false;

    const connection = await getConnection();

    const updateData = [
      nama,
      email,
      cleanKelasId,
      cleanNip,
      cleanIsWaliKelas,
      id,
    ];

    console.log("Update data:", updateData);

    await connection.execute(
      "UPDATE users SET nama = ?, email = ?, kelas_id = ?, nip = ?, is_wali_kelas = ? WHERE id = ?",
      updateData
    );

    await connection.end();

    console.log("Guru berhasil diupdate:", id);
    res.json({ message: "Guru berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT GURU:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error details:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal mengupdate guru" });
  }
});

// Kelola Absensi
app.get("/api/absensi", authenticateToken, async (req, res) => {
  try {
    const { guru_id, tanggal, mata_pelajaran_id, siswa_id } = req.query; // Tambahkan siswa_id
    console.log("Mengambil data absensi");

    let query = `
      SELECT a.*, s.nama as siswa_nama, s.nis, k.nama as kelas_nama, mp.nama as mata_pelajaran_nama
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
      JOIN mata_pelajaran mp ON a.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND a.guru_id = ?";
      params.push(guru_id);
    }

    if (tanggal) {
      query += " AND a.tanggal = ?";
      params.push(tanggal);
    }

    if (mata_pelajaran_id) {
      query += " AND a.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    if (siswa_id) {
      query += " AND a.siswa_id = ?";
      params.push(siswa_id);
    }

    const connection = await getConnection();
    const [absensi] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data absensi, jumlah:", absensi.length);
    res.json(absensi);
  } catch (error) {
    console.error("ERROR GET ABSENSI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data absensi" });
  }
});

// Debug endpoint untuk cek struktur tabel absensi
app.get("/api/debug/absensi-structure", authenticateToken, async (req, res) => {
  try {
    const connection = await getConnection();
    const [structure] = await connection.execute("DESCRIBE absensi");
    await connection.end();
    res.json({ structure });
  } catch (error) {
    console.error("ERROR GET ABSENSI STRUCTURE:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get data absensi existing untuk debugging
app.get("/api/debug/absensi-data", authenticateToken, async (req, res) => {
  try {
    const connection = await getConnection();
    const [absensi] = await connection.execute(
      "SELECT * FROM absensi LIMIT 10"
    );
    await connection.end();
    res.json({ absensi });
  } catch (error) {
    console.error("ERROR GET ABSENSI DATA:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Perbaiki endpoint POST absensi dengan validasi lengkap
app.post("/api/absensi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah absensi:", req.body);
    const {
      siswa_id,
      guru_id,
      mata_pelajaran_id,
      tanggal,
      status,
      keterangan,
    } = req.body;

    // Validasi data required dengan pesan yang lebih jelas
    const missingFields = [];
    if (!siswa_id) missingFields.push("siswa_id");
    if (!guru_id) missingFields.push("guru_id");
    if (!mata_pelajaran_id) missingFields.push("mata_pelajaran_id");
    if (!tanggal) missingFields.push("tanggal");
    if (!status) missingFields.push("status");

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        missing_fields: missingFields,
        received_data: {
          siswa_id: !!siswa_id,
          guru_id: !!guru_id,
          mata_pelajaran_id: !!mata_pelajaran_id,
          tanggal: !!tanggal,
          status: !!status,
        },
      });
    }

    // Validasi status
    const allowedStatus = ["hadir", "terlambat", "izin", "sakit", "alpha"];
    if (!allowedStatus.includes(status)) {
      return res.status(400).json({
        error: "Status tidak valid",
        allowed: allowedStatus,
        received: status,
      });
    }

    const id = crypto.randomUUID();

    const connection = await getConnection();

    // Cek apakah absensi sudah ada untuk kombinasi yang sama
    const [existing] = await connection.execute(
      "SELECT id FROM absensi WHERE siswa_id = ? AND mata_pelajaran_id = ? AND tanggal = ? AND guru_id = ?",
      [siswa_id, mata_pelajaran_id, tanggal, guru_id]
    );

    if (existing.length > 0) {
      // Update jika sudah ada
      await connection.execute(
        "UPDATE absensi SET status = ?, keterangan = ?, updated_at = NOW() WHERE id = ?",
        [status, keterangan || "", existing[0].id]
      );
      await connection.end();
      console.log("Absensi berhasil diupdate:", existing[0].id);
      return res.json({
        message: "Absensi berhasil diupdate",
        id: existing[0].id,
        action: "updated",
      });
    } else {
      // Insert baru
      await connection.execute(
        "INSERT INTO absensi (id, siswa_id, guru_id, mata_pelajaran_id, tanggal, status, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          siswa_id,
          guru_id,
          mata_pelajaran_id,
          tanggal,
          status,
          keterangan || "",
        ]
      );
      await connection.end();
      console.log("Absensi berhasil ditambahkan:", id);
      return res.json({
        message: "Absensi berhasil ditambahkan",
        id,
        action: "created",
      });
    }
  } catch (error) {
    console.error("ERROR POST ABSENSI:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error details:", error);

    if (error.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        error:
          "Tabel absensi tidak ditemukan. Silakan buat tabel terlebih dahulu.",
      });
    }

    if (error.code === "ER_BAD_NULL_ERROR") {
      return res.status(400).json({
        error: "Data required tidak boleh kosong",
        details: error.message,
      });
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        error:
          "Absensi untuk siswa ini sudah ada pada tanggal dan mata pelajaran yang sama",
      });
    }

    res.status(500).json({
      error: "Gagal menambah absensi: " + error.message,
      code: error.code,
    });
  }
});

// Kelola Nilai
app.get("/api/nilai", authenticateToken, async (req, res) => {
  try {
    const { siswa_id, guru_id, mata_pelajaran_id, jenis } = req.query;
    console.log("Mengambil data nilai");

    let query = `
      SELECT n.*, s.nama as siswa_nama, s.nis, mp.nama as mata_pelajaran_nama
      FROM nilai n
      JOIN siswa s ON n.siswa_id = s.id
      JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (siswa_id) {
      query += " AND n.siswa_id = ?";
      params.push(siswa_id);
    }

    if (guru_id) {
      query += " AND n.guru_id = ?";
      params.push(guru_id);
    }

    if (mata_pelajaran_id) {
      query += " AND n.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    if (jenis) {
      query += " AND n.jenis = ?";
      params.push(jenis);
    }

    const connection = await getConnection();
    const [nilai] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data nilai, jumlah:", nilai.length);
    res.json(nilai);
  } catch (error) {
    console.error("ERROR GET NILAI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data nilai" });
  }
});

app.post("/api/nilai", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah nilai:", req.body);
    const {
      siswa_id,
      guru_id,
      mata_pelajaran_id,
      jenis,
      nilai: nilaiValue,
      deskripsi,
      tanggal,
    } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO nilai (id, siswa_id, guru_id, mata_pelajaran_id, jenis, nilai, deskripsi, tanggal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        siswa_id,
        guru_id,
        mata_pelajaran_id,
        jenis,
        nilaiValue,
        deskripsi,
        tanggal,
      ]
    );
    await connection.end();

    console.log("Nilai berhasil ditambahkan:", id);
    res.json({ message: "Nilai berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST NILAI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah nilai" });
  }
});

// Update Nilai
app.put("/api/nilai/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update nilai:", id, req.body);
    const {
      siswa_id,
      guru_id,
      mata_pelajaran_id,
      jenis,
      nilai: nilaiValue,
      deskripsi,
      tanggal,
    } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE nilai SET siswa_id = ?, guru_id = ?, mata_pelajaran_id = ?, jenis = ?, nilai = ?, deskripsi = ?, tanggal = ? WHERE id = ?",
      [
        siswa_id,
        guru_id,
        mata_pelajaran_id,
        jenis,
        nilaiValue,
        deskripsi,
        tanggal,
        id,
      ]
    );
    await connection.end();

    console.log("Nilai berhasil diupdate:", id);
    res.json({ message: "Nilai berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT NILAI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate nilai" });
  }
});

// Delete Nilai
app.delete("/api/nilai/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete nilai:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM nilai WHERE id = ?", [id]);
    await connection.end();

    console.log("Nilai berhasil dihapus:", id);
    res.json({ message: "Nilai berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE NILAI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus nilai" });
  }
});

// Get Nilai by ID
app.get("/api/nilai/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data nilai by ID:", id);

    const connection = await getConnection();
    const [nilai] = await connection.execute(
      "SELECT n.*, s.nama as siswa_nama, s.nis, mp.nama as mata_pelajaran_nama FROM nilai n JOIN siswa s ON n.siswa_id = s.id JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id WHERE n.id = ?",
      [id]
    );
    await connection.end();

    if (nilai.length === 0) {
      return res.status(404).json({ error: "Nilai tidak ditemukan" });
    }

    console.log("Berhasil mengambil data nilai:", id);
    res.json(nilai[0]);
  } catch (error) {
    console.error("ERROR GET NILAI BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data nilai" });
  }
});

// Get Bab by Mata Pelajaran
app.get("/api/bab-materi", authenticateToken, async (req, res) => {
  try {
    const { mata_pelajaran_id } = req.query;
    console.log("Mengambil data bab materi");

    let query = `
      SELECT bm.*, mp.nama as mata_pelajaran_nama
      FROM bab_materi bm
      JOIN mata_pelajaran mp ON bm.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (mata_pelajaran_id) {
      query += " AND bm.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    query += " ORDER BY bm.urutan";

    const connection = await getConnection();
    const [babMateri] = await connection.execute(query, params);
    await connection.end();

    console.log(
      "Berhasil mengambil data bab materi, jumlah:",
      babMateri.length
    );
    res.json(babMateri);
  } catch (error) {
    console.error("ERROR GET BAB MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data bab materi" });
  }
});

// Get Sub Bab by Bab ID
app.get("/api/sub-bab-materi", authenticateToken, async (req, res) => {
  try {
    const { bab_id } = req.query;
    console.log("Mengambil data sub bab materi");

    if (!bab_id) {
      return res.status(400).json({ error: "Parameter bab_id diperlukan" });
    }

    const connection = await getConnection();
    const [subBabMateri] = await connection.execute(
      "SELECT sbm.*, bm.judul_bab FROM sub_bab_materi sbm JOIN bab_materi bm ON sbm.bab_id = bm.id WHERE sbm.bab_id = ? ORDER BY sbm.urutan",
      [bab_id]
    );
    await connection.end();

    console.log(
      "Berhasil mengambil data sub bab materi, jumlah:",
      subBabMateri.length
    );
    res.json(subBabMateri);
  } catch (error) {
    console.error("ERROR GET SUB BAB MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data sub bab materi" });
  }
});

// Get Konten Materi by Sub Bab ID
app.get("/api/konten-materi", authenticateToken, async (req, res) => {
  try {
    const { sub_bab_id } = req.query;
    console.log("Mengambil data konten materi");

    if (!sub_bab_id) {
      return res.status(400).json({ error: "Parameter sub_bab_id diperlukan" });
    }

    const connection = await getConnection();
    const [kontenMateri] = await connection.execute(
      `SELECT km.*, sbm.judul_sub_bab, bm.judul_bab, mp.nama as mata_pelajaran_nama 
       FROM konten_materi km 
       JOIN sub_bab_materi sbm ON km.sub_bab_id = sbm.id 
       JOIN bab_materi bm ON sbm.bab_id = bm.id 
       JOIN mata_pelajaran mp ON bm.mata_pelajaran_id = mp.id 
       WHERE km.sub_bab_id = ? 
       ORDER BY km.created_at`,
      [sub_bab_id]
    );
    await connection.end();

    console.log(
      "Berhasil mengambil data konten materi, jumlah:",
      kontenMateri.length
    );
    res.json(kontenMateri);
  } catch (error) {
    console.error("ERROR GET KONTEN MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data konten materi" });
  }
});

// Create Bab Materi
app.post("/api/bab-materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah bab materi baru:", req.body);
    const { mata_pelajaran_id, judul_bab, urutan } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO bab_materi (id, mata_pelajaran_id, judul_bab, urutan) VALUES (?, ?, ?, ?)",
      [id, mata_pelajaran_id, judul_bab, urutan]
    );
    await connection.end();

    console.log("Bab materi berhasil ditambahkan:", id);
    res.json({ message: "Bab materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah bab materi" });
  }
});

// Create Sub Bab Materi
app.post("/api/sub-bab-materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah sub bab materi baru:", req.body);
    const { bab_id, judul_sub_bab, urutan } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO sub_bab_materi (id, bab_id, judul_sub_bab, urutan) VALUES (?, ?, ?, ?)",
      [id, bab_id, judul_sub_bab, urutan]
    );
    await connection.end();

    console.log("Sub bab materi berhasil ditambahkan:", id);
    res.json({ message: "Sub bab materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST SUB BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah sub bab materi" });
  }
});

// Create Konten Materi
app.post("/api/konten-materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah konten materi baru:", req.body);
    const { sub_bab_id, judul_konten, isi_konten } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO konten_materi (id, sub_bab_id, judul_konten, isi_konten) VALUES (?, ?, ?, ?)",
      [id, sub_bab_id, judul_konten, isi_konten]
    );
    await connection.end();

    console.log("Konten materi berhasil ditambahkan:", id);
    res.json({ message: "Konten materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST KONTEN MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah konten materi" });
  }
});

// Update Bab Materi
app.put("/api/bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update bab materi:", id, req.body);
    const { judul_bab, urutan } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE bab_materi SET judul_bab = ?, urutan = ? WHERE id = ?",
      [judul_bab, urutan, id]
    );
    await connection.end();

    console.log("Bab materi berhasil diupdate:", id);
    res.json({ message: "Bab materi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate bab materi" });
  }
});

// Update Sub Bab Materi
app.put("/api/sub-bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update sub bab materi:", id, req.body);
    const { judul_sub_bab, urutan } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE sub_bab_materi SET judul_sub_bab = ?, urutan = ? WHERE id = ?",
      [judul_sub_bab, urutan, id]
    );
    await connection.end();

    console.log("Sub bab materi berhasil diupdate:", id);
    res.json({ message: "Sub bab materi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT SUB BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate sub bab materi" });
  }
});

// Update Konten Materi
app.put("/api/konten-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update konten materi:", id, req.body);
    const { judul_konten, isi_konten } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE konten_materi SET judul_konten = ?, isi_konten = ? WHERE id = ?",
      [judul_konten, isi_konten, id]
    );
    await connection.end();

    console.log("Konten materi berhasil diupdate:", id);
    res.json({ message: "Konten materi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT KONTEN MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate konten materi" });
  }
});

// Delete Bab Materi
app.delete("/api/bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete bab materi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM bab_materi WHERE id = ?", [id]);
    await connection.end();

    console.log("Bab materi berhasil dihapus:", id);
    res.json({ message: "Bab materi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({
        error: "Bab materi tidak dapat dihapus karena masih memiliki sub bab",
      });
    }

    res.status(500).json({ error: "Gagal menghapus bab materi" });
  }
});

// Delete Sub Bab Materi
app.delete("/api/sub-bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete sub bab materi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM sub_bab_materi WHERE id = ?", [id]);
    await connection.end();

    console.log("Sub bab materi berhasil dihapus:", id);
    res.json({ message: "Sub bab materi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE SUB BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({
        error:
          "Sub bab materi tidak dapat dihapus karena masih memiliki konten",
      });
    }

    res.status(500).json({ error: "Gagal menghapus sub bab materi" });
  }
});

// Delete Konten Materi
app.delete("/api/konten-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete konten materi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM konten_materi WHERE id = ?", [id]);
    await connection.end();

    console.log("Konten materi berhasil dihapus:", id);
    res.json({ message: "Konten materi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE KONTEN MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus konten materi" });
  }
});

// Kelola Materi
app.get("/api/materi", authenticateToken, async (req, res) => {
  try {
    const { guru_id, mata_pelajaran_id } = req.query;
    console.log("Mengambil data materi");

    let query = `
      SELECT m.*, u.nama as guru_nama, mp.nama as mata_pelajaran_nama
      FROM materi m
      JOIN users u ON m.guru_id = u.id
      JOIN mata_pelajaran mp ON m.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND m.guru_id = ?";
      params.push(guru_id);
    }

    if (mata_pelajaran_id) {
      query += " AND m.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    const connection = await getConnection();
    const [materi] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data materi, jumlah:", materi.length);
    res.json(materi);
  } catch (error) {
    console.error("ERROR GET MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data materi" });
  }
});

app.post("/api/materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah materi:", req.body);
    const { guru_id, mata_pelajaran_id, judul, deskripsi, file_path } =
      req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO materi (id, guru_id, mata_pelajaran_id, judul, deskripsi, file_path) VALUES (?, ?, ?, ?, ?, ?)",
      [id, guru_id, mata_pelajaran_id, judul, deskripsi, file_path]
    );
    await connection.end();

    console.log("Materi berhasil ditambahkan:", id);
    res.json({ message: "Materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah materi" });
  }
});

// Endpoint khusus untuk mata pelajaran by guru
app.get("/api/mata-pelajaran-by-guru", authenticateToken, async (req, res) => {
  try {
    const { guru_id } = req.query;
    console.log("Mengambil mata pelajaran untuk guru:", guru_id);

    if (!guru_id) {
      return res.status(400).json({ error: "Parameter guru_id diperlukan" });
    }

    const connection = await getConnection();

    // Query yang diperbaiki - pastikan kita mencari berdasarkan user_id
    const [result] = await connection.execute(
      `SELECT mp.* 
       FROM mata_pelajaran mp
       JOIN users u ON mp.id = u.mata_pelajaran_id
       WHERE u.id = ?`,
      [guru_id]
    );

    await connection.end();

    console.log("Mata pelajaran ditemukan:", result.length);
    res.json(result);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN BY GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil mata pelajaran guru" });
  }
});

// Get all Mata Pelajaran with Kelas
app.get(
  "/api/mata-pelajaran-with-kelas",
  authenticateToken,
  async (req, res) => {
    try {
      console.log("Mengambil mata pelajaran dengan data kelas");

      const connection = await getConnection();

      const [mataPelajaran] = await connection.execute(`
      SELECT 
        mp.*,
        GROUP_CONCAT(DISTINCT k.nama) as kelas_names,
        GROUP_CONCAT(DISTINCT k.id) as kelas_ids,
        COUNT(DISTINCT k.id) as jumlah_kelas
      FROM mata_pelajaran mp
      LEFT JOIN mata_pelajaran_kelas mpk ON mp.id = mpk.mata_pelajaran_id
      LEFT JOIN kelas k ON mpk.kelas_id = k.id
      GROUP BY mp.id
      ORDER BY mp.nama
    `);

      await connection.end();

      console.log(
        "Mata pelajaran dengan kelas ditemukan:",
        mataPelajaran.length
      );
      res.json(mataPelajaran);
    } catch (error) {
      console.error("ERROR GET MATA PELAJARAN WITH KELAS:", error.message);
      res
        .status(500)
        .json({ error: "Gagal mengambil data mata pelajaran dengan kelas" });
    }
  }
);

// Get Kelas by Mata Pelajaran
app.get("/api/kelas-by-mata-pelajaran", authenticateToken, async (req, res) => {
  try {
    const { mata_pelajaran_id } = req.query;
    console.log("Mengambil kelas untuk mata pelajaran:", mata_pelajaran_id);

    if (!mata_pelajaran_id) {
      return res
        .status(400)
        .json({ error: "Parameter mata_pelajaran_id diperlukan" });
    }

    const connection = await getConnection();

    const [kelas] = await connection.execute(
      `SELECT k.* 
       FROM kelas k
       JOIN mata_pelajaran_kelas mpk ON k.id = mpk.kelas_id
       WHERE mpk.mata_pelajaran_id = ?
       ORDER BY k.nama`,
      [mata_pelajaran_id]
    );

    await connection.end();

    console.log("Kelas ditemukan:", kelas.length);
    res.json(kelas);
  } catch (error) {
    console.error("ERROR GET KELAS BY MATA PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

// Add Kelas to Mata Pelajaran
app.post("/api/mata-pelajaran-kelas", authenticateToken, async (req, res) => {
  try {
    const { mata_pelajaran_id, kelas_id } = req.body;
    console.log("Menambah kelas ke mata pelajaran:", {
      mata_pelajaran_id,
      kelas_id,
    });

    if (!mata_pelajaran_id || !kelas_id) {
      return res
        .status(400)
        .json({ error: "mata_pelajaran_id dan kelas_id diperlukan" });
    }

    const id = crypto.randomUUID();
    const connection = await getConnection();

    // Check if relationship already exists
    const [existing] = await connection.execute(
      "SELECT * FROM mata_pelajaran_kelas WHERE mata_pelajaran_id = ? AND kelas_id = ?",
      [mata_pelajaran_id, kelas_id]
    );

    if (existing.length > 0) {
      await connection.end();
      return res
        .status(400)
        .json({ error: "Relasi mata pelajaran-kelas sudah ada" });
    }

    await connection.execute(
      "INSERT INTO mata_pelajaran_kelas (id, mata_pelajaran_id, kelas_id) VALUES (?, ?, ?)",
      [id, mata_pelajaran_id, kelas_id]
    );

    await connection.end();

    console.log("Relasi mata pelajaran-kelas berhasil ditambahkan:", id);
    res.json({ message: "Relasi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR ADD MATA PELAJARAN KELAS:", error.message);
    res
      .status(500)
      .json({ error: "Gagal menambah relasi mata pelajaran-kelas" });
  }
});

// Remove Kelas from Mata Pelajaran
app.delete("/api/mata-pelajaran-kelas", authenticateToken, async (req, res) => {
  try {
    const { mata_pelajaran_id, kelas_id } = req.query;
    console.log("Menghapus kelas dari mata pelajaran:", {
      mata_pelajaran_id,
      kelas_id,
    });

    if (!mata_pelajaran_id || !kelas_id) {
      return res
        .status(400)
        .json({ error: "mata_pelajaran_id dan kelas_id diperlukan" });
    }

    const connection = await getConnection();

    await connection.execute(
      "DELETE FROM mata_pelajaran_kelas WHERE mata_pelajaran_id = ? AND kelas_id = ?",
      [mata_pelajaran_id, kelas_id]
    );

    await connection.end();

    console.log("Relasi mata pelajaran-kelas berhasil dihapus");
    res.json({ message: "Relasi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR REMOVE MATA PELAJARAN KELAS:", error.message);
    res
      .status(500)
      .json({ error: "Gagal menghapus relasi mata pelajaran-kelas" });
  }
});

// Add mata pelajaran to guru
app.post(
  "/api/guru/:id/mata-pelajaran",
  authenticateToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { mata_pelajaran_id } = req.body;

      console.log("Menambah mata pelajaran ke guru:", id, mata_pelajaran_id);

      const connection = await getConnection();

      // Check if relationship already exists
      const [existing] = await connection.execute(
        "SELECT * FROM guru_mata_pelajaran WHERE guru_id = ? AND mata_pelajaran_id = ?",
        [id, mata_pelajaran_id]
      );

      if (existing.length > 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Guru sudah memiliki mata pelajaran ini" });
      }

      const relationId = crypto.randomUUID();
      await connection.execute(
        "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id) VALUES (?, ?, ?)",
        [relationId, id, mata_pelajaran_id]
      );

      await connection.end();

      console.log("Mata pelajaran berhasil ditambahkan ke guru");
      res.json({
        message: "Mata pelajaran berhasil ditambahkan",
        id: relationId,
      });
    } catch (error) {
      console.error("ERROR ADD MATA PELAJARAN TO GURU:", error.message);
      res.status(500).json({ error: "Gagal menambah mata pelajaran ke guru" });
    }
  }
);

// Get mata pelajaran by guru
app.get("/api/guru/:id/mata-pelajaran", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil mata pelajaran untuk guru:", id);

    const connection = await getConnection();

    const [mataPelajaran] = await connection.execute(
      `SELECT mp.* 
       FROM mata_pelajaran mp
       JOIN guru_mata_pelajaran gmp ON mp.id = gmp.mata_pelajaran_id
       WHERE gmp.guru_id = ?`,
      [id]
    );

    await connection.end();

    console.log("Mata pelajaran ditemukan:", mataPelajaran.length);
    res.json(mataPelajaran);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN BY GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil mata pelajaran guru" });
  }
});

// Remove mata pelajaran from guru
app.delete(
  "/api/guru/:guruId/mata-pelajaran/:mataPelajaranId",
  authenticateToken,
  async (req, res) => {
    try {
      const { guruId, mataPelajaranId } = req.params;
      console.log(
        "Menghapus mata pelajaran dari guru:",
        guruId,
        mataPelajaranId
      );

      const connection = await getConnection();

      await connection.execute(
        "DELETE FROM guru_mata_pelajaran WHERE guru_id = ? AND mata_pelajaran_id = ?",
        [guruId, mataPelajaranId]
      );

      await connection.end();

      console.log("Mata pelajaran berhasil dihapus dari guru");
      res.json({ message: "Mata pelajaran berhasil dihapus" });
    } catch (error) {
      console.error("ERROR REMOVE MATA PELAJARAN FROM GURU:", error.message);
      res
        .status(500)
        .json({ error: "Gagal menghapus mata pelajaran dari guru" });
    }
  }
);

// Kelola Guru - Get all teachers with their subjects
app.get("/api/guru-matapelajaran", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data guru");
    const connection = await getConnection();

    const [guru] = await connection.execute(`
      SELECT 
        u.*, 
        k.nama as kelas_nama,
        (SELECT COUNT(*) FROM kelas WHERE wali_kelas_id = u.id) as is_wali_kelas,
        GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
        GROUP_CONCAT(DISTINCT mp.id) as mata_pelajaran_ids
      FROM users u 
      LEFT JOIN kelas k ON u.kelas_id = k.id 
      LEFT JOIN guru_mata_pelajaran gmp ON u.id = gmp.guru_id
      LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id
      WHERE u.role = 'guru'
      GROUP BY u.id
    `);

    await connection.end();

    console.log("Berhasil mengambil data guru, jumlah:", guru.length);
    res.json(guru);
  } catch (error) {
    console.error("ERROR GET GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil data guru" });
  }
});

// Get all hari
app.get("/api/hari", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data hari");
    const connection = await getConnection();
    const [hari] = await connection.execute(
      "SELECT * FROM hari ORDER BY urutan"
    );
    await connection.end();
    console.log("Berhasil mengambil data hari, jumlah:", hari.length);
    res.json(hari);
  } catch (error) {
    console.error("ERROR GET HARI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data hari" });
  }
});

// Get all semester
app.get("/api/semester", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data semester");
    const connection = await getConnection();
    const [semester] = await connection.execute(
      "SELECT * FROM semester ORDER BY nama"
    );
    await connection.end();
    console.log("Berhasil mengambil data semester, jumlah:", semester.length);
    res.json(semester);
  } catch (error) {
    console.error("ERROR GET SEMESTER:", error.message);
    res.status(500).json({ error: "Gagal mengambil data semester" });
  }
});

// Get all jam pelajaran
app.get("/api/jam-pelajaran", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data jam pelajaran");
    const connection = await getConnection();
    const [jamPelajaran] = await connection.execute(
      "SELECT * FROM jam_pelajaran ORDER BY jam_ke"
    );
    await connection.end();
    console.log(
      "Berhasil mengambil data jam pelajaran, jumlah:",
      jamPelajaran.length
    );
    res.json(jamPelajaran);
  } catch (error) {
    console.error("ERROR GET JAM PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data jam pelajaran" });
  }
});

// Create jam pelajaran
app.post("/api/jam-pelajaran", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah jam pelajaran baru:", req.body);
    const { jam_ke, jam_mulai, jam_selesai } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO jam_pelajaran (id, jam_ke, jam_mulai, jam_selesai) VALUES (?, ?, ?, ?)",
      [id, jam_ke, jam_mulai, jam_selesai]
    );
    await connection.end();

    console.log("Jam pelajaran berhasil ditambahkan:", id);
    res.json({ message: "Jam pelajaran berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST JAM PELAJARAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah jam pelajaran" });
  }
});

// Update Get Jadwal Mengajar untuk menggunakan struktur baru
app.get("/api/jadwal-mengajar", authenticateToken, async (req, res) => {
  try {
    const { guru_id, kelas_id, hari_id, semester_id, tahun_ajaran } = req.query;
    console.log("Mengambil data jadwal mengajar");

    let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        s.nama as semester_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND jm.guru_id = ?";
      params.push(guru_id);
    }

    if (kelas_id) {
      query += " AND jm.kelas_id = ?";
      params.push(kelas_id);
    }

    if (hari_id) {
      query += " AND jm.hari_id = ?";
      params.push(hari_id);
    }

    if (semester_id) {
      query += " AND jm.semester_id = ?";
      params.push(semester_id);
    }

    if (tahun_ajaran) {
      query += " AND jm.tahun_ajaran = ?";
      params.push(tahun_ajaran);
    }

    query += " ORDER BY h.urutan, jp.jam_ke";

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log(
      "Berhasil mengambil data jadwal mengajar, jumlah:",
      jadwal.length
    );
    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL MENGAJAR:", error.message);
    res.status(500).json({ error: "Gagal mengambil data jadwal mengajar" });
  }
});

// Fungsi untuk membaca Excel jadwal mengajar dari buffer
async function readExcelSchedulesFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel schedule data from buffer:", data);

  const schedules = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const scheduleData = mapExcelRowToSchedule(row, index + 2);
      if (scheduleData) {
        schedules.push(scheduleData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${schedules.length} schedules from Excel buffer`);
  return schedules;
}

// Fungsi mapping row untuk jadwal mengajar
function mapExcelRowToSchedule(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing schedule row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const guruNama =
    normalizedRow["guru_nama"] ||
    normalizedRow["nama guru"] ||
    normalizedRow["guru"] ||
    normalizedRow["teacher"] ||
    normalizedRow["teacher name"] ||
    "";

  const mataPelajaranNama =
    normalizedRow["mata_pelajaran_nama"] ||
    normalizedRow["mata pelajaran"] ||
    normalizedRow["pelajaran"] ||
    normalizedRow["subject"] ||
    normalizedRow["subject name"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    normalizedRow["class name"] ||
    "";

  const hariNama =
    normalizedRow["hari_nama"] ||
    normalizedRow["hari"] ||
    normalizedRow["day"] ||
    normalizedRow["nama hari"] ||
    "";

  const jamKe =
    normalizedRow["jam ke"] ||
    normalizedRow["jam"] ||
    normalizedRow["period"] ||
    normalizedRow["jam pelajaran"] ||
    "";

  const semesterNama =
    normalizedRow["semester_nama"] ||
    normalizedRow["semester"] ||
    normalizedRow["semester name"] ||
    "";

  const tahunAjaran =
    normalizedRow["tahun_ajaran"] ||
    normalizedRow["tahun ajaran"] ||
    normalizedRow["academic year"] ||
    normalizedRow["tahun"] ||
    "";

  // Jika data required tidak ada, skip
  if (
    !guruNama ||
    !mataPelajaranNama ||
    !kelasNama ||
    !hariNama ||
    !jamKe ||
    !semesterNama ||
    !tahunAjaran
  ) {
    console.log(`Skipping schedule row ${rowNumber}: Missing required data`, {
      guruNama,
      mataPelajaranNama,
      kelasNama,
      hariNama,
      jamKe,
      semesterNama,
      tahunAjaran,
    });
    return null;
  }

  const schedule = {
    guru_nama: guruNama.toString().trim(),
    mata_pelajaran_nama: mataPelajaranNama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    hari_nama: hariNama.toString().trim(),
    jam_ke: jamKe.toString().trim(),
    semester_nama: semesterNama.toString().trim(),
    tahun_ajaran: tahunAjaran.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped schedule data for row ${rowNumber}:`, schedule);
  return schedule;
}

// Fungsi processScheduleImport
async function processScheduleImport(
  importedSchedules,
  teacherList,
  subjectList,
  classList,
  dayList,
  semesterList,
  periodList
) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const scheduleData of importedSchedules) {
      try {
        // Validasi data required
        if (
          !scheduleData.guru_nama ||
          !scheduleData.mata_pelajaran_nama ||
          !scheduleData.kelas_nama ||
          !scheduleData.hari_nama ||
          !scheduleData.jam_ke ||
          !scheduleData.semester_nama ||
          !scheduleData.tahun_ajaran
        ) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cari guru berdasarkan nama
        const teacherItem = teacherList.find(
          (teacher) =>
            teacher.nama.toLowerCase() === scheduleData.guru_nama.toLowerCase()
        );

        if (!teacherItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Guru '${scheduleData.guru_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari mata pelajaran berdasarkan nama
        const subjectItem = subjectList.find(
          (subject) =>
            subject.nama.toLowerCase() ===
            scheduleData.mata_pelajaran_nama.toLowerCase()
        );

        if (!subjectItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Mata pelajaran '${scheduleData.mata_pelajaran_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari kelas berdasarkan nama
        const classItem = classList.find(
          (cls) =>
            cls.nama.toLowerCase() === scheduleData.kelas_nama.toLowerCase()
        );

        if (!classItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Kelas '${scheduleData.kelas_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari hari berdasarkan nama
        const dayItem = dayList.find(
          (day) =>
            day.nama.toLowerCase() === scheduleData.hari_nama.toLowerCase()
        );

        if (!dayItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Hari '${scheduleData.hari_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari semester berdasarkan nama
        const semesterItem = semesterList.find(
          (semester) =>
            semester.nama
              .toLowerCase()
              .includes(scheduleData.semester_nama.toLowerCase()) ||
            scheduleData.semester_nama
              .toLowerCase()
              .includes(semester.nama.toLowerCase())
        );

        if (!semesterItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Semester '${scheduleData.semester_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari jam pelajaran berdasarkan jam_ke
        const periodItem = periodList.find(
          (period) =>
            period.jam_ke.toString() === scheduleData.jam_ke.toString()
        );

        if (!periodItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Jam ke-${scheduleData.jam_ke} tidak ditemukan`
          );
          continue;
        }

        // Cek apakah jadwal sudah ada (untuk menghindari duplikasi)
        const [existingSchedule] = await connection.execute(
          `SELECT id FROM jadwal_mengajar 
           WHERE guru_id = ? AND mata_pelajaran_id = ? AND kelas_id = ? 
           AND hari_id = ? AND jam_pelajaran_id = ? AND semester_id = ? AND tahun_ajaran = ?`,
          [
            teacherItem.id,
            subjectItem.id,
            classItem.id,
            dayItem.id,
            periodItem.id,
            semesterItem.id,
            scheduleData.tahun_ajaran,
          ]
        );

        if (existingSchedule.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Jadwal sudah ada untuk kombinasi ini`
          );
          continue;
        }

        // Cek konflik jadwal - guru
        const [teacherConflict] = await connection.execute(
          `SELECT id FROM jadwal_mengajar 
           WHERE guru_id = ? AND hari_id = ? AND jam_pelajaran_id = ? 
           AND semester_id = ? AND tahun_ajaran = ?`,
          [
            teacherItem.id,
            dayItem.id,
            periodItem.id,
            semesterItem.id,
            scheduleData.tahun_ajaran,
          ]
        );

        if (teacherConflict.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Guru sudah memiliki jadwal lain di jam yang sama`
          );
          continue;
        }

        // Cek konflik jadwal - kelas
        const [classConflict] = await connection.execute(
          `SELECT id FROM jadwal_mengajar 
           WHERE kelas_id = ? AND hari_id = ? AND jam_pelajaran_id = ? 
           AND semester_id = ? AND tahun_ajaran = ?`,
          [
            classItem.id,
            dayItem.id,
            periodItem.id,
            semesterItem.id,
            scheduleData.tahun_ajaran,
          ]
        );

        if (classConflict.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Kelas sudah memiliki jadwal lain di jam yang sama`
          );
          continue;
        }

        // Mulai transaction untuk jadwal ini
        await connection.beginTransaction();

        try {
          const scheduleId = crypto.randomUUID();

          // Insert jadwal mengajar
          await connection.execute(
            `INSERT INTO jadwal_mengajar 
             (id, guru_id, mata_pelajaran_id, kelas_id, hari_id, jam_pelajaran_id, semester_id, tahun_ajaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              scheduleId,
              teacherItem.id,
              subjectItem.id,
              classItem.id,
              dayItem.id,
              periodItem.id,
              semesterItem.id,
              scheduleData.tahun_ajaran,
            ]
          );

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (scheduleError) {
        results.failed++;
        results.errors.push(
          `Baris ${scheduleData.row_number}: ${scheduleError.message}`
        );
        console.error(
          `Error importing schedule for ${scheduleData.guru_nama}:`,
          scheduleError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

app.post("/api/export-schedules", async (req, res) => {
  try {
    const { schedules } = req.body;

    if (!schedules || !Array.isArray(schedules)) {
      return res.status(400).json({
        success: false,
        message: "Data jadwal tidak valid",
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData = [
      // Header row
      [
        "Guru",
        "Mata Pelajaran",
        "Kelas",
        "Hari",
        "Jam Ke",
        "Semester",
        "Tahun Ajaran",
        "Jam Mulai",
        "Jam Selesai",
      ],
      // Data rows
      ...schedules.map((schedule) => [
        schedule.guru_nama || "",
        schedule.mata_pelajaran_nama || "",
        schedule.kelas_nama || "",
        schedule.hari_nama || "",
        schedule.jam_ke?.toString() || "",
        schedule.semester_nama || "",
        schedule.tahun_ajaran || "",
        schedule.jam_mulai || "",
        schedule.jam_selesai || "",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Add style to header row
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 9; i++) {
      worksheet["!cols"][i] = { width: 15 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Jadwal Mengajar");

    // Generate filename
    const filename = `Data_Jadwal_Mengajar_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data: ${error.message}`,
    });
  }
});

// Download template Excel untuk jadwal mengajar
app.get("/api/download-template-schedule", async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare template data
    const templateData = [
      // Header row
      [
        "Guru",
        "Mata Pelajaran",
        "Kelas",
        "Hari",
        "Jam Ke",
        "Semester",
        "Tahun Ajaran",
      ],
      // Example data
      [
        "Budi Santoso",
        "Ilmu Pengetahuan Alam 7",
        "7A",
        "Senin",
        "1",
        "Ganjil",
        "2024/2025",
      ],
      ["Sari Dewi", "Matematika 7", "7B", "Selasa", "2", "Ganjil", "2024/2025"],
      // Empty row
      [],
      // Notes
      ["Catatan:"],
      ["* Wajib diisi"],
      [
        "- Pastikan nama guru, mata pelajaran, kelas, dan hari sesuai dengan data yang ada di sistem",
      ],
      ["- Jam ke harus sesuai dengan data jam pelajaran yang tersedia (1-10)"],
      ["- Format tahun ajaran: YYYY/YYYY (contoh: 2024/2025)"],
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 7; i++) {
      worksheet["!cols"][i] = { width: 20 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Template Jadwal Mengajar"
    );

    // Generate filename
    const filename = "Template_Import_Jadwal_Mengajar.xlsx";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Template download error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template: ${error.message}`,
    });
  }
});

// Validasi data jadwal sebelum import
app.post("/validate-schedules", async (req, res) => {
  try {
    const { schedules } = req.body;

    if (!schedules || !Array.isArray(schedules)) {
      return res.status(400).json({
        success: false,
        message: "Data jadwal tidak valid",
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < schedules.length; i++) {
      const schedule = schedules[i];
      const validatedSchedule = {};
      let hasError = false;

      // Validasi field required
      if (!schedule.guru_nama || schedule.guru_nama.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Nama guru tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.guru_nama = schedule.guru_nama;
      }

      if (
        !schedule.mata_pelajaran_nama ||
        schedule.mata_pelajaran_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Nama mata pelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.mata_pelajaran_nama = schedule.mata_pelajaran_nama;
      }

      if (
        !schedule.kelas_nama ||
        schedule.kelas_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Nama kelas tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.kelas_nama = schedule.kelas_nama;
      }

      if (!schedule.hari_nama || schedule.hari_nama.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Hari tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.hari_nama = schedule.hari_nama;
      }

      if (schedule.jam_ke === null || schedule.jam_ke === undefined) {
        errors.push(`Baris ${i + 1}: Jam ke tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.jam_ke = schedule.jam_ke;
      }

      if (
        !schedule.semester_nama ||
        schedule.semester_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Semester tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.semester_nama = schedule.semester_nama;
      }

      if (
        !schedule.tahun_ajaran ||
        schedule.tahun_ajaran.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Tahun ajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.tahun_ajaran = schedule.tahun_ajaran;
      }

      // Field optional
      validatedSchedule.jam_mulai = schedule.jam_mulai;
      validatedSchedule.jam_selesai = schedule.jam_selesai;

      if (!hasError) {
        validatedData.push(validatedSchedule);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validasi data gagal",
        errors: errors,
        validatedData: validatedData,
      });
    }

    res.json({
      success: true,
      message: "Validasi data berhasil",
      validatedData: validatedData,
    });
  } catch (error) {
    console.error("Validation error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data: ${error.message}`,
    });
  }
});

// Import jadwal mengajar dari Excel
app.post(
  "/api/jadwal-mengajar/import",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import jadwal mengajar dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedSchedules = await readExcelSchedulesFromBuffer(
        req.file.buffer
      );

      if (importedSchedules.length === 0) {
        return res.status(400).json({
          error:
            "Tidak ada data jadwal mengajar yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedSchedules.length} schedules to import`);

      // Ambil data referensi untuk mapping
      connection = await getConnection();

      const [teacherList] = await connection.execute(
        "SELECT id, nama FROM users WHERE role = 'guru'"
      );

      const [subjectList] = await connection.execute(
        "SELECT id, nama FROM mata_pelajaran"
      );

      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas"
      );

      const [dayList] = await connection.execute("SELECT id, nama FROM hari");

      const [semesterList] = await connection.execute(
        "SELECT id, nama FROM semester"
      );

      const [periodList] = await connection.execute(
        "SELECT id, jam_ke FROM jam_pelajaran"
      );

      await connection.end();

      // Proses import
      const result = await processScheduleImport(
        importedSchedules,
        teacherList,
        subjectList,
        classList,
        dayList,
        semesterList,
        periodList
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT JADWAL MENGAJAR:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport jadwal mengajar: " + error.message,
      });
    }
  }
);

// Update Create Jadwal Mengajar dengan validasi bentrokan
app.post("/api/jadwal-mengajar", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah jadwal mengajar baru:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      hari_id,
      jam_pelajaran_id,
      semester_id,
      tahun_ajaran,
    } = req.body;

    const id = crypto.randomUUID();

    const connection = await getConnection();

    // Cek konflik jadwal - guru, hari, semester, jam_pelajaran yang sama
    const [konflikGuru] = await connection.execute(
      `SELECT jm.*, u.nama as guru_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN users u ON jm.guru_id = u.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.guru_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
      [guru_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
    );

    if (konflikGuru.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: `Guru sudah memiliki jadwal di jam ke-${konflikGuru[0].jam_ke} pada hari yang sama`,
      });
    }

    // Cek konflik jadwal - kelas, hari, semester, jam_pelajaran yang sama
    const [konflikKelas] = await connection.execute(
      `SELECT jm.*, k.nama as kelas_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN kelas k ON jm.kelas_id = k.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.kelas_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
      [kelas_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
    );

    if (konflikKelas.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: `Kelas sudah memiliki jadwal di jam ke-${konflikKelas[0].jam_ke} pada hari yang sama`,
      });
    }

    await connection.execute(
      "INSERT INTO jadwal_mengajar (id, guru_id, mata_pelajaran_id, kelas_id, hari_id, jam_pelajaran_id, semester_id, tahun_ajaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        guru_id,
        mata_pelajaran_id,
        kelas_id,
        hari_id,
        jam_pelajaran_id,
        semester_id,
        tahun_ajaran,
      ]
    );

    await connection.end();

    console.log("Jadwal mengajar berhasil ditambahkan:", id);
    res.json({ message: "Jadwal mengajar berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST JADWAL MENGAJAR:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah jadwal mengajar" });
  }
});

// Update Jadwal Mengajar dengan validasi bentrokan
app.put("/api/jadwal-mengajar/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update jadwal mengajar:", id, req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      hari_id,
      jam_pelajaran_id,
      semester_id,
      tahun_ajaran,
    } = req.body;

    const connection = await getConnection();

    // Cek konflik jadwal - guru (kecuali dengan dirinya sendiri)
    const [konflikGuru] = await connection.execute(
      `SELECT jm.*, u.nama as guru_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN users u ON jm.guru_id = u.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.id != ? AND jm.guru_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
      [id, guru_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
    );

    if (konflikGuru.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: `Guru sudah memiliki jadwal di jam ke-${konflikGuru[0].jam_ke} pada hari yang sama`,
      });
    }

    // Cek konflik jadwal - kelas (kecuali dengan dirinya sendiri)
    const [konflikKelas] = await connection.execute(
      `SELECT jm.*, k.nama as kelas_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN kelas k ON jm.kelas_id = k.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.id != ? AND jm.kelas_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
      [id, kelas_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
    );

    if (konflikKelas.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: `Kelas sudah memiliki jadwal di jam ke-${konflikKelas[0].jam_ke} pada hari yang sama`,
      });
    }

    await connection.execute(
      "UPDATE jadwal_mengajar SET guru_id = ?, mata_pelajaran_id = ?, kelas_id = ?, hari_id = ?, jam_pelajaran_id = ?, semester_id = ?, tahun_ajaran = ? WHERE id = ?",
      [
        guru_id,
        mata_pelajaran_id,
        kelas_id,
        hari_id,
        jam_pelajaran_id,
        semester_id,
        tahun_ajaran,
        id,
      ]
    );

    await connection.end();

    console.log("Jadwal mengajar berhasil diupdate:", id);
    res.json({ message: "Jadwal mengajar berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT JADWAL MENGAJAR:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate jadwal mengajar" });
  }
});

// Delete Jadwal Mengajar
app.delete("/api/jadwal-mengajar/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete jadwal mengajar:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM jadwal_mengajar WHERE id = ?", [id]);
    await connection.end();

    console.log("Jadwal mengajar berhasil dihapus:", id);
    res.json({ message: "Jadwal mengajar berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE JADWAL MENGAJAR:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus jadwal mengajar" });
  }
});

// Endpoint untuk mendeteksi jadwal yang bentrok
app.get(
  "/api/jadwal-mengajar/conflicts",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        hari_id,
        kelas_id,
        semester_id,
        tahun_ajaran,
        jam_pelajaran_id,
        exclude_id,
      } = req.query;

      console.log("Mengecek jadwal bentrok:", req.query);

      if (
        !hari_id ||
        !kelas_id ||
        !semester_id ||
        !tahun_ajaran ||
        !jam_pelajaran_id
      ) {
        return res.status(400).json({ error: "Parameter tidak lengkap" });
      }

      let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.hari_id = ? 
        AND jm.kelas_id = ? 
        AND jm.semester_id = ? 
        AND jm.tahun_ajaran = ? 
        AND jm.jam_pelajaran_id = ?
    `;

      let params = [
        hari_id,
        kelas_id,
        semester_id,
        tahun_ajaran,
        jam_pelajaran_id,
      ];

      if (exclude_id) {
        query += " AND jm.id != ?";
        params.push(exclude_id);
      }

      const connection = await getConnection();
      const [conflicts] = await connection.execute(query, params);
      await connection.end();

      console.log("Jadwal bentrok ditemukan:", conflicts.length);
      res.json(conflicts);
    } catch (error) {
      console.error("ERROR CHECK CONFLICTS:", error.message);
      res.status(500).json({ error: "Gagal memeriksa jadwal bentrok" });
    }
  }
);

// Get Jadwal Mengajar by Guru ID
app.get(
  "/api/jadwal-mengajar/guru/:guruId",
  authenticateToken,
  async (req, res) => {
    try {
      const { guruId } = req.params;
      const { semester_id, tahun_ajaran, hari_id } = req.query;

      console.log("Mengambil jadwal mengajar untuk guru:", guruId);

      let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        h.urutan as hari_urutan,
        s.nama as semester_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.guru_id = ?
    `;

      let params = [guruId];

      if (semester_id) {
        query += " AND jm.semester_id = ?";
        params.push(semester_id);
      }

      if (tahun_ajaran) {
        query += " AND jm.tahun_ajaran = ?";
        params.push(tahun_ajaran);
      }

      if (hari_id) {
        query += " AND jm.hari_id = ?";
        params.push(hari_id);
      }

      query += " ORDER BY h.urutan, jp.jam_ke";

      const connection = await getConnection();
      const [jadwal] = await connection.execute(query, params);
      await connection.end();

      console.log("Berhasil mengambil jadwal guru, jumlah:", jadwal.length);
      res.json(jadwal);
    } catch (error) {
      console.error("ERROR GET JADWAL MENGAJAR BY GURU:", error.message);
      res.status(500).json({ error: "Gagal mengambil jadwal mengajar guru" });
    }
  }
);

// Endpoint untuk debug - cek data jadwal berdasarkan guru ID
app.get(
  "/api/debug/jadwal-guru/:guruId",
  authenticateToken,
  async (req, res) => {
    try {
      const { guruId } = req.params;
      console.log("Debug jadwal untuk guru:", guruId);

      const connection = await getConnection();

      // Query untuk melihat semua jadwal guru tertentu
      const [jadwal] = await connection.execute(
        `SELECT jm.*, u.nama as guru_nama 
       FROM jadwal_mengajar jm 
       JOIN users u ON jm.guru_id = u.id 
       WHERE jm.guru_id = ?`,
        [guruId]
      );

      // Query untuk melihat data user
      const [user] = await connection.execute(
        "SELECT * FROM users WHERE id = ?",
        [guruId]
      );

      await connection.end();

      console.log("Data jadwal ditemukan:", jadwal.length);
      console.log("Data user:", user.length > 0 ? user[0] : "Tidak ditemukan");

      res.json({
        guru: user[0] || null,
        jadwal: jadwal,
        total_jadwal: jadwal.length,
      });
    } catch (error) {
      console.error("ERROR DEBUG JADWAL GURU:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// PERBAIKAN: Endpoint current dengan filter yang benar
app.get("/api/jadwal-mengajar/current", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { semester_id, tahun_ajaran, hari_id } = req.query;

    console.log("Mengambil jadwal dengan filter:", {
      userId,
      semester_id,
      tahun_ajaran,
      hari_id,
    });

    let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        h.urutan as hari_urutan,
        s.nama as semester_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.guru_id = ?
    `;

    let params = [userId];

    // PERBAIKAN: Filter semester - handle berbagai format
    if (semester_id) {
      // Handle jika semester_id adalah angka (1,2) atau string (ganjil, genap)
      if (semester_id === "1" || semester_id === "2") {
        query += " AND jm.semester_id = ?";
        params.push(semester_id);
      } else if (semester_id.toLowerCase().includes("ganjil")) {
        query +=
          " AND (jm.semester_id = '1' OR jm.semester_id = 'ganjil' OR s.nama LIKE '%ganjil%')";
      } else if (semester_id.toLowerCase().includes("genap")) {
        query +=
          " AND (jm.semester_id = '2' OR jm.semester_id = 'genap' OR s.nama LIKE '%genap%')";
      } else {
        query += " AND (jm.semester_id = ? OR s.nama LIKE ?)";
        params.push(semester_id, `%${semester_id}%`);
      }
    }

    // PERBAIKAN: Filter tahun ajaran
    if (tahun_ajaran) {
      query += " AND jm.tahun_ajaran = ?";
      params.push(tahun_ajaran);
    }

    // PERBAIKAN: Filter hari - handle berbagai format
    if (hari_id) {
      // Handle jika hari_id adalah angka (1,2,3...) atau nama hari
      if (!isNaN(hari_id)) {
        query += " AND jm.hari_id = ?";
        params.push(hari_id);
      } else {
        // Jika nama hari, cari di tabel hari
        query += " AND (h.nama = ? OR h.id = ?)";
        params.push(hari_id, hari_id);
      }
    }

    query += " ORDER BY h.urutan, jp.jam_ke";

    console.log("Executing query:", query);
    console.log("With params:", params);

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log("Jadwal ditemukan setelah filter:", jadwal.length);

    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL MENGAJAR CURRENT:", error.message);
    res.status(500).json({ error: "Gagal mengambil jadwal mengajar" });
  }
});

// Endpoint alternatif untuk filter yang lebih fleksibel
app.get(
  "/api/jadwal-mengajar/filtered",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { hari, semester, tahun_ajaran } = req.query;

      console.log("Filtered request:", {
        userId,
        hari,
        semester,
        tahun_ajaran,
      });

      let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        h.urutan as hari_urutan,
        s.nama as semester_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.guru_id = ?
    `;

      let params = [userId];

      // Filter hari berdasarkan nama
      if (hari && hari !== "Semua Hari") {
        query += " AND h.nama = ?";
        params.push(hari);
      }

      // Filter semester berdasarkan nama
      if (semester && semester !== "Semua Semester") {
        if (semester === "Ganjil" || semester === "1") {
          query += " AND (s.nama LIKE '%ganjil%' OR jm.semester_id = '1')";
        } else if (semester === "Genap" || semester === "2") {
          query += " AND (s.nama LIKE '%genap%' OR jm.semester_id = '2')";
        } else {
          query += " AND s.nama LIKE ?";
          params.push(`%${semester}%`);
        }
      }

      // Filter tahun ajaran
      if (tahun_ajaran) {
        query += " AND jm.tahun_ajaran = ?";
        params.push(tahun_ajaran);
      }

      query += " ORDER BY h.urutan, jp.jam_ke";

      console.log("Filtered query:", query);
      console.log("Filtered params:", params);

      const connection = await getConnection();
      const [jadwal] = await connection.execute(query, params);
      await connection.end();

      console.log("Filtered jadwal found:", jadwal.length);
      res.json(jadwal);
    } catch (error) {
      console.error("ERROR FILTERED JADWAL:", error.message);
      res.status(500).json({ error: "Gagal mengambil jadwal terfilter" });
    }
  }
);

// Get RPP dengan detail lengkap
app.get("/api/rpp", authenticateToken, async (req, res) => {
  try {
    const { guru_id, status } = req.query;
    console.log("Mengambil data RPP");

    let query = `
      SELECT r.*, 
        mp.nama as mata_pelajaran_nama,
        u.nama as guru_nama,
        k.nama as kelas_nama
      FROM rpp r
      JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id
      JOIN users u ON r.guru_id = u.id
      LEFT JOIN kelas k ON r.kelas_id = k.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND r.guru_id = ?";
      params.push(guru_id);
    }

    if (status) {
      query += " AND r.status = ?";
      params.push(status);
    }

    query += " ORDER BY r.created_at DESC";

    const connection = await getConnection();
    const [rpp] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data RPP, jumlah:", rpp.length);
    res.json(rpp);
  } catch (error) {
    console.error("ERROR GET RPP:", error.message);
    res.status(500).json({ error: "Gagal mengambil data RPP" });
  }
});

app.post('/api/export-rpp', async (req, res) => {
  try {
    const { rppList } = req.body;

    if (!rppList || !Array.isArray(rppList)) {
      return res.status(400).json({
        success: false,
        message: 'Data RPP tidak valid'
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();
    
    // Prepare data for Excel
    const excelData = [
      // Header row
      [
        'Judul RPP', 'Guru Pengajar', 'Mata Pelajaran', 'Kelas', 'Semester', 
        'Tahun Ajaran', 'Status', 'Tanggal Dibuat', 'Catatan Admin', 
        'Kompetensi Dasar', 'Tujuan Pembelajaran', 'Materi Pembelajaran', 
        'Metode Pembelajaran', 'Media Pembelajaran', 'Sumber Belajar', 
        'Langkah Pembelajaran', 'Penilaian'
      ],
      // Data rows
      ...rppList.map(rpp => [
        rpp.judul || '',
        rpp.guru_nama || '',
        rpp.mata_pelajaran_nama || '',
        rpp.kelas_nama || '',
        rpp.semester || '',
        rpp.tahun_ajaran || '',
        getStatusText(rpp.status),
        formatDateForExport(rpp.created_at),
        rpp.catatan_admin || '',
        rpp.kompetensi_dasar || '',
        rpp.tujuan_pembelajaran || '',
        rpp.materi_pembelajaran || '',
        rpp.metode_pembelajaran || '',
        rpp.media_pembelajaran || '',
        rpp.sumber_belajar || '',
        rpp.langkah_pembelajaran || '',
        rpp.penilaian || ''
      ])
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths for better readability
    if (!worksheet['!cols']) worksheet['!cols'] = [];
    const columnWidths = [20, 15, 20, 10, 10, 12, 10, 12, 15, 25, 25, 25, 20, 20, 20, 30, 25];
    for (let i = 0; i < columnWidths.length; i++) {
      worksheet['!cols'][i] = { width: columnWidths[i] };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data RPP');

    // Generate filename
    const filename = `Data_RPP_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, '../temp', filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, '../temp'))) {
      fs.mkdirSync(path.join(__dirname, '../temp'), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        res.status(500).json({
          success: false,
          message: 'Gagal mengunduh file'
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });

  } catch (error) {
    console.error('Export RPP error:', error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data RPP: ${error.message}`
    });
  }
});

// Download template RPP Excel
app.get('/api/download-rpp-template', async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();
    
    // Prepare template data
    const templateData = [
      // Header row
      [
        'Judul RPP*', 'Mata Pelajaran ID*', 'Kelas ID*', 'Semester*', 
        'Tahun Ajaran*', 'Kompetensi Dasar*', 'Tujuan Pembelajaran*', 
        'Materi Pembelajaran*', 'Metode Pembelajaran', 'Media Pembelajaran', 
        'Sumber Belajar', 'Langkah Pembelajaran*', 'Penilaian*'
      ],
      // Example data
      [
        'RPP Matematika Kelas 10 - Aljabar',
        '1',
        '5',
        'Ganjil',
        '2024/2025',
        'Memahami konsep aljabar dasar',
        'Siswa dapat menyelesaikan persamaan linear',
        'Konsep variabel, koefisien, dan konstanta',
        'Ceramah, diskusi, latihan',
        'Papan tulis, proyektor',
        'Buku paket matematika kelas 10',
        'Pendahuluan, kegiatan inti, penutup',
        'Tes tertulis, observasi'
      ],
      // Second example
      [
        'RPP Bahasa Indonesia Kelas 8 - Cerpen',
        '2',
        '3',
        'Genap',
        '2024/2025',
        'Menganalisis unsur intrinsik cerpen',
        'Siswa dapat mengidentifikasi tokoh, latar, dan alur cerita',
        'Unsur intrinsik cerpen: tokoh, latar, alur, tema',
        'Diskusi kelompok, presentasi',
        'Teks cerpen, LCD proyektor',
        'Buku kumpulan cerpen, LKS',
        'Pembukaan, eksplorasi, elaborasi, konfirmasi',
        'Penilaian proses, hasil karya, presentasi'
      ],
      // Empty row
      [],
      // Notes
      ['* Wajib diisi'],
      ['Format Semester: Ganjil / Genap'],
      ['Format Tahun Ajaran: YYYY/YYYY (contoh: 2024/2025)'],
      ['Mata Pelajaran ID dan Kelas ID harus sesuai dengan ID di sistem']
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths for template
    if (!worksheet['!cols']) worksheet['!cols'] = [];
    const templateWidths = [25, 18, 12, 10, 15, 25, 25, 25, 20, 20, 20, 25, 20];
    for (let i = 0; i < templateWidths.length; i++) {
      worksheet['!cols'][i] = { width: templateWidths[i] };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template RPP');

    // Generate filename
    const filename = 'Template_RPP.xlsx';
    const filePath = path.join(__dirname, '../temp', filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, '../temp'))) {
      fs.mkdirSync(path.join(__dirname, '../temp'), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Error downloading template:', err);
        res.status(500).json({
          success: false,
          message: 'Gagal mengunduh template'
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });

  } catch (error) {
    console.error('RPP template download error:', error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template RPP: ${error.message}`
    });
  }
});

// Validasi data RPP sebelum import
app.post('/api/validate-rpp', async (req, res) => {
  try {
    const { rppData } = req.body;

    if (!rppData || !Array.isArray(rppData)) {
      return res.status(400).json({
        success: false,
        message: 'Data RPP tidak valid'
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < rppData.length; i++) {
      const rpp = rppData[i];
      const validatedRpp = {};
      let hasError = false;

      // Validasi field required
      if (!rpp.judul || rpp.judul.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Judul RPP tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.judul = rpp.judul.toString().trim();
      }

      if (!rpp.mata_pelajaran_id || isNaN(parseInt(rpp.mata_pelajaran_id))) {
        errors.push(`Baris ${i + 1}: Mata Pelajaran ID tidak valid`);
        hasError = true;
      } else {
        validatedRpp.mata_pelajaran_id = parseInt(rpp.mata_pelajaran_id);
      }

      if (!rpp.kelas_id || isNaN(parseInt(rpp.kelas_id))) {
        errors.push(`Baris ${i + 1}: Kelas ID tidak valid`);
        hasError = true;
      } else {
        validatedRpp.kelas_id = parseInt(rpp.kelas_id);
      }

      if (!rpp.semester || !['Ganjil', 'Genap'].includes(rpp.semester)) {
        errors.push(`Baris ${i + 1}: Semester harus "Ganjil" atau "Genap"`);
        hasError = true;
      } else {
        validatedRpp.semester = rpp.semester;
      }

      if (!rpp.tahun_ajaran || !isValidTahunAjaran(rpp.tahun_ajaran)) {
        errors.push(`Baris ${i + 1}: Format tahun ajaran tidak valid (contoh: 2024/2025)`);
        hasError = true;
      } else {
        validatedRpp.tahun_ajaran = rpp.tahun_ajaran;
      }

      if (!rpp.kompetensi_dasar || rpp.kompetensi_dasar.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Kompetensi dasar tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.kompetensi_dasar = rpp.kompetensi_dasar.toString().trim();
      }

      if (!rpp.tujuan_pembelajaran || rpp.tujuan_pembelajaran.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Tujuan pembelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.tujuan_pembelajaran = rpp.tujuan_pembelajaran.toString().trim();
      }

      if (!rpp.materi_pembelajaran || rpp.materi_pembelajaran.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Materi pembelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.materi_pembelajaran = rpp.materi_pembelajaran.toString().trim();
      }

      if (!rpp.langkah_pembelajaran || rpp.langkah_pembelajaran.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Langkah pembelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.langkah_pembelajaran = rpp.langkah_pembelajaran.toString().trim();
      }

      if (!rpp.penilaian || rpp.penilaian.toString().trim() === '') {
        errors.push(`Baris ${i + 1}: Penilaian tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.penilaian = rpp.penilaian.toString().trim();
      }

      // Field optional
      validatedRpp.metode_pembelajaran = rpp.metode_pembelajaran || '';
      validatedRpp.media_pembelajaran = rpp.media_pembelajaran || '';
      validatedRpp.sumber_belajar = rpp.sumber_belajar || '';

      if (!hasError) {
        validatedData.push(validatedRpp);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validasi data RPP gagal',
        errors: errors,
        validatedData: validatedData
      });
    }

    res.json({
      success: true,
      message: 'Validasi data RPP berhasil',
      validatedData: validatedData
    });

  } catch (error) {
    console.error('RPP validation error:', error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data RPP: ${error.message}`
    });
  }
});

// Helper functions
function getStatusText(status) {
  switch (status) {
    case 'Disetujui':
      return 'Approved';
    case 'Menunggu':
      return 'Pending';
    case 'Ditolak':
      return 'Rejected';
    default:
      return status || '-';
  }
}

function formatDateForExport(date) {
  if (!date) return '';
  try {
    const parsed = new Date(date);
    return parsed.toISOString().split('T')[0];
  } catch (e) {
    return date;
  }
}

function isValidTahunAjaran(tahunAjaran) {
  const pattern = /^\d{4}\/\d{4}$/;
  if (!pattern.test(tahunAjaran)) return false;
  
  const [start, end] = tahunAjaran.split('/');
  return parseInt(end) - parseInt(start) === 1;
}

// Create RPP dengan handling undefined values
app.post("/api/rpp", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah RPP:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      judul,
      semester,
      tahun_ajaran,
      kompetensi_inti,
      kompetensi_dasar,
      indikator,
      tujuan_pembelajaran,
      materi_pokok,
      metode_pembelajaran,
      media_alat,
      sumber_belajar,
      kegiatan_pembelajaran,
      penilaian,
      file_path,
      status = "Menunggu",
    } = req.body;

    // Validasi field required
    if (
      !guru_id ||
      !mata_pelajaran_id ||
      !judul ||
      !semester ||
      !tahun_ajaran
    ) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        required: [
          "guru_id",
          "mata_pelajaran_id",
          "judul",
          "semester",
          "tahun_ajaran",
        ],
      });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    const connection = await getConnection();

    // Handle undefined values by converting them to null
    const cleanKelasId = kelas_id || null;
    const cleanKompetensiInti = kompetensi_inti || null;
    const cleanKompetensiDasar = kompetensi_dasar || null;
    const cleanIndikator = indikator || null;
    const cleanTujuanPembelajaran = tujuan_pembelajaran || null;
    const cleanMateriPokok = materi_pokok || null;
    const cleanMetodePembelajaran = metode_pembelajaran || null;
    const cleanMediaAlat = media_alat || null;
    const cleanSumberBelajar = sumber_belajar || null;
    const cleanKegiatanPembelajaran = kegiatan_pembelajaran || null;
    const cleanPenilaian = penilaian || null;
    const cleanFilePath = file_path || null;

    await connection.execute(
      `INSERT INTO rpp (
        id, guru_id, mata_pelajaran_id, kelas_id, judul, semester, tahun_ajaran,
        kompetensi_inti, kompetensi_dasar, indikator, tujuan_pembelajaran,
        materi_pokok, metode_pembelajaran, media_alat, sumber_belajar,
        kegiatan_pembelajaran, penilaian, file_path, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        guru_id,
        mata_pelajaran_id,
        cleanKelasId,
        judul,
        semester,
        tahun_ajaran,
        cleanKompetensiInti,
        cleanKompetensiDasar,
        cleanIndikator,
        cleanTujuanPembelajaran,
        cleanMateriPokok,
        cleanMetodePembelajaran,
        cleanMediaAlat,
        cleanSumberBelajar,
        cleanKegiatanPembelajaran,
        cleanPenilaian,
        cleanFilePath,
        status,
        createdAt,
      ]
    );
    await connection.end();

    console.log("Berhasil menambah RPP:", id);
    res.json({ id, message: "RPP berhasil disimpan" });
  } catch (error) {
    console.error("ERROR CREATE RPP:", error.message);
    console.error("Error details:", error);
    res.status(500).json({ error: "Gagal menyimpan RPP: " + error.message });
  }
});

// Update status RPP (untuk admin)
app.put("/api/rpp/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, catatan } = req.body;

    console.log("Update status RPP:", id, status);

    const connection = await getConnection();
    await connection.execute(
      "UPDATE rpp SET status = ?, catatan_admin = ?, updated_at = NOW() WHERE id = ?",
      [status, catatan || "", id]
    );
    await connection.end();

    console.log("Status RPP berhasil diupdate:", id);
    res.json({ message: "Status RPP berhasil diupdate" });
  } catch (error) {
    console.error("ERROR UPDATE RPP STATUS:", error.message);
    res.status(500).json({ error: "Gagal mengupdate status RPP" });
  }
});

// Delete RPP
app.delete("/api/rpp/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete RPP:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM rpp WHERE id = ?", [id]);
    await connection.end();

    console.log("RPP berhasil dihapus:", id);
    res.json({ message: "RPP berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE RPP:", error.message);
    res.status(500).json({ error: "Gagal menghapus RPP" });
  }
});

// Endpoint untuk upload file
app.post(
  "/api/upload/rpp",
  authenticateToken,
  uploadMiddleware,
  async (req, res) => {
    try {
      console.log("Upload RPP endpoint hit");

      if (!req.file) {
        console.log("No file received");
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received:", {
        originalname: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: req.file.path,
      });

      const fileUrl = `/uploads/rpp/${req.file.filename}`;

      console.log("File uploaded successfully:", fileUrl);

      res.json({
        message: "File berhasil diupload",
        file_path: fileUrl,
        file_name: req.file.originalname,
        file_size: req.file.size,
      });
    } catch (error) {
      console.error("ERROR UPLOAD FILE:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengupload file",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Get kegiatan by guru
app.get("/api/kegiatan/guru/:guruId", authenticateToken, async (req, res) => {
  try {
    const { guruId } = req.params;
    console.log("Mengambil kegiatan untuk guru:", guruId);

    const connection = await getConnection();

    const [kegiatan] = await connection.execute(
      `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        GROUP_CONCAT(DISTINCT s.nama) as siswa_target_names
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id
      LEFT JOIN siswa s ON kst.siswa_id = s.id
      WHERE kk.guru_id = ?
      GROUP BY kk.id
      ORDER BY kk.tanggal DESC, kk.created_at DESC
    `,
      [guruId]
    );

    await connection.end();

    console.log("Kegiatan ditemukan:", kegiatan.length);
    res.json(kegiatan);
  } catch (error) {
    console.error("ERROR GET KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan" });
  }
});

// Get kegiatan by kelas (untuk siswa)
app.get("/api/kegiatan/kelas/:kelasId", authenticateToken, async (req, res) => {
  try {
    const { kelasId } = req.params;
    const { siswa_id } = req.query;

    console.log("Mengambil kegiatan untuk kelas:", kelasId);

    const connection = await getConnection();

    let query = `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        (kst.siswa_id IS NOT NULL) as untuk_siswa_ini
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id AND kst.siswa_id = ?
      WHERE kk.kelas_id = ? AND (kk.target = 'umum' OR kst.siswa_id = ?)
      GROUP BY kk.id
      ORDER BY kk.tanggal DESC, kk.created_at DESC
    `;

    const [kegiatan] = await connection.execute(query, [
      siswa_id,
      kelasId,
      siswa_id,
    ]);

    await connection.end();

    console.log("Kegiatan ditemukan:", kegiatan.length);
    res.json(kegiatan);
  } catch (error) {
    console.error("ERROR GET KEGIATAN KELAS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan" });
  }
});

// Get semua pengumuman
app.get("/api/pengumuman", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data pengumuman");
    const connection = await getConnection();

    const [pengumuman] = await connection.execute(`
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      ORDER BY 
        CASE WHEN p.prioritas = 'penting' THEN 1 ELSE 2 END,
        p.created_at DESC
    `);

    await connection.end();
    console.log(
      "Berhasil mengambil data pengumuman, jumlah:",
      pengumuman.length
    );
    res.json(pengumuman);
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data pengumuman" });
  }
});

// Get pengumuman by ID
app.get("/api/pengumuman/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data pengumuman by ID:", id);

    const connection = await getConnection();
    const [pengumuman] = await connection.execute(
      `SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      WHERE p.id = ?`,
      [id]
    );
    await connection.end();

    if (pengumuman.length === 0) {
      return res.status(404).json({ error: "Pengumuman tidak ditemukan" });
    }

    console.log("Berhasil mengambil data pengumuman:", id);
    res.json(pengumuman[0]);
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data pengumuman" });
  }
});

// Create pengumuman baru
app.post("/api/pengumuman", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah pengumuman baru:", req.body);
    const {
      judul,
      konten,
      kelas_id,
      role_target,
      prioritas,
      tanggal_awal,
      tanggal_akhir,
    } = req.body;

    // Validasi data required
    if (!judul || !konten) {
      return res.status(400).json({
        error: "Judul dan konten harus diisi",
      });
    }

    const id = crypto.randomUUID();
    const pembuat_id = req.user.id; // ID user yang login

    const connection = await getConnection();

    await connection.execute(
      `INSERT INTO pengumuman 
        (id, judul, konten, kelas_id, role_target, pembuat_id, prioritas, tanggal_awal, tanggal_akhir) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        judul,
        konten,
        kelas_id || null,
        role_target || "all",
        pembuat_id,
        prioritas || "biasa",
        tanggal_awal || null,
        tanggal_akhir || null,
      ]
    );

    await connection.end();

    console.log("Pengumuman berhasil ditambahkan:", id);
    res.json({
      message: "Pengumuman berhasil ditambahkan",
      id,
    });
  } catch (error) {
    console.error("ERROR POST PENGUMUMAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah pengumuman" });
  }
});

// Update pengumuman
app.put("/api/pengumuman/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update pengumuman:", id, req.body);

    const {
      judul,
      konten,
      kelas_id,
      role_target,
      prioritas,
      tanggal_awal,
      tanggal_akhir,
    } = req.body;

    // Validasi data required
    if (!judul || !konten) {
      return res.status(400).json({
        error: "Judul dan konten harus diisi",
      });
    }

    const connection = await getConnection();

    await connection.execute(
      `UPDATE pengumuman 
       SET judul = ?, konten = ?, kelas_id = ?, role_target = ?, 
           prioritas = ?, tanggal_awal = ?, tanggal_akhir = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        judul,
        konten,
        kelas_id || null,
        role_target || "all",
        prioritas || "biasa",
        tanggal_awal || null,
        tanggal_akhir || null,
        id,
      ]
    );

    await connection.end();

    console.log("Pengumuman berhasil diupdate:", id);
    res.json({ message: "Pengumuman berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT PENGUMUMAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate pengumuman" });
  }
});

// Delete pengumuman
app.delete("/api/pengumuman/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete pengumuman:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM pengumuman WHERE id = ?", [id]);
    await connection.end();

    console.log("Pengumuman berhasil dihapus:", id);
    res.json({ message: "Pengumuman berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE PENGUMUMAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus pengumuman" });
  }
});

// Get pengumuman untuk user berdasarkan role dan kelas
app.get("/api/pengumuman/user/current", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    console.log(
      "Mengambil pengumuman untuk user:",
      user.id,
      "role:",
      user.role
    );

    const connection = await getConnection();

    let query = `
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      WHERE 1=1
        AND (p.tanggal_awal IS NULL OR p.tanggal_awal <= CURDATE())
        AND (p.tanggal_akhir IS NULL OR p.tanggal_akhir >= CURDATE())
    `;

    let params = [];

    // Filter berdasarkan role user
    if (user.role === "siswa") {
      // Untuk siswa: ambil pengumuman untuk role 'all', 'siswa', atau kelas siswa
      const [siswaData] = await connection.execute(
        "SELECT kelas_id FROM siswa WHERE id = ?",
        [user.id]
      );

      if (siswaData.length > 0) {
        const kelasId = siswaData[0].kelas_id;
        query += ` AND (
          p.role_target IN ('all', 'siswa') 
          OR (p.kelas_id = ?)
        )`;
        params.push(kelasId);
      } else {
        query += ` AND p.role_target IN ('all', 'siswa')`;
      }
    } else if (user.role === "guru") {
      // Untuk guru: ambil pengumuman untuk role 'all', 'guru', atau kelas yang diampu
      query += ` AND (
        p.role_target IN ('all', 'guru') 
        OR (p.kelas_id IN (SELECT kelas_id FROM jadwal_mengajar WHERE guru_id = ?))
      )`;
      params.push(user.id);
    } else if (user.role === "wali") {
      // Untuk wali: ambil pengumuman untuk role 'all', 'wali', atau kelas anaknya
      const [siswaData] = await connection.execute(
        "SELECT kelas_id FROM siswa WHERE id IN (SELECT siswa_id FROM users WHERE id = ?)",
        [user.id]
      );

      if (siswaData.length > 0) {
        const kelasId = siswaData[0].kelas_id;
        query += ` AND (
          p.role_target IN ('all', 'wali') 
          OR (p.kelas_id = ?)
        )`;
        params.push(kelasId);
      } else {
        query += ` AND p.role_target IN ('all', 'wali')`;
      }
    } else if (user.role === "admin") {
      // Admin bisa melihat semua pengumuman
      // Tidak perlu filter tambahan
    } else {
      // Untuk role lainnya, hanya ambil pengumuman umum
      query += ` AND p.role_target = 'all'`;
    }

    query +=
      " ORDER BY CASE WHEN p.prioritas = 'penting' THEN 1 ELSE 2 END, p.created_at DESC";

    console.log("Query pengumuman:", query);
    console.log("Parameters:", params);

    const [pengumuman] = await connection.execute(query, params);
    await connection.end();

    console.log("Pengumuman untuk user ditemukan:", pengumuman.length);
    res.json(pengumuman);
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN USER CURRENT:", error.message);
    console.error("Error stack:", error.stack);
    res
      .status(500)
      .json({ error: "Gagal mengambil data pengumuman: " + error.message });
  }
});

// Backup endpoint untuk pengumuman
app.get("/api/pengumuman/fallback", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    console.log("Mengambil pengumuman fallback untuk:", user.role);

    const connection = await getConnection();

    // Query sederhana sebagai fallback
    let query = `
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      WHERE p.role_target IN ('all', ?)
        AND (p.tanggal_awal IS NULL OR p.tanggal_awal <= CURDATE())
        AND (p.tanggal_akhir IS NULL OR p.tanggal_akhir >= CURDATE())
      ORDER BY 
        CASE WHEN p.prioritas = 'penting' THEN 1 ELSE 2 END,
        p.created_at DESC
      LIMIT 50
    `;

    const [pengumuman] = await connection.execute(query, [user.role]);
    await connection.end();

    console.log("Pengumuman fallback ditemukan:", pengumuman.length);
    res.json(pengumuman);
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN FALLBACK:", error.message);
    res.status(500).json({ error: "Gagal mengambil data pengumuman fallback" });
  }
});

// Create kegiatan baru
app.post("/api/kegiatan", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah kegiatan baru:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      judul,
      deskripsi,
      jenis,
      target,
      bab_id,
      sub_bab_id,
      batas_waktu,
      tanggal,
      hari,
      siswa_target,
    } = req.body;

    // Validasi data required
    if (
      !guru_id ||
      !mata_pelajaran_id ||
      !kelas_id ||
      !judul ||
      !tanggal ||
      !hari
    ) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        required: [
          "guru_id",
          "mata_pelajaran_id",
          "kelas_id",
          "judul",
          "tanggal",
          "hari",
        ],
      });
    }

    const id = crypto.randomUUID();
    const connection = await getConnection();

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // Insert kegiatan utama
      await connection.execute(
        `INSERT INTO kegiatan_kelas 
         (id, guru_id, mata_pelajaran_id, kelas_id, judul, deskripsi, jenis, target, 
          bab_id, sub_bab_id, batas_waktu, tanggal, hari) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          guru_id,
          mata_pelajaran_id,
          kelas_id,
          judul,
          deskripsi || null,
          jenis || "materi",
          target || "umum",
          bab_id || null,
          sub_bab_id || null,
          batas_waktu || null,
          tanggal,
          hari,
        ]
      );

      // Jika target khusus, insert siswa target
      if (target === "khusus" && siswa_target && siswa_target.length > 0) {
        for (const siswaId of siswa_target) {
          const targetId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO kegiatan_siswa_target (id, kegiatan_id, siswa_id) VALUES (?, ?, ?)",
            [targetId, id, siswaId]
          );
        }
      }

      // Commit transaction
      await connection.commit();

      console.log("Kegiatan berhasil ditambahkan:", id);
      res.status(201).json({
        message: "Kegiatan berhasil ditambahkan",
        id,
        type: "created",
      });
    } catch (transactionError) {
      // Rollback jika ada error
      await connection.rollback();
      throw transactionError;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("ERROR CREATE KEGIATAN:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({ error: "Data referensi tidak valid" });
    }

    res
      .status(500)
      .json({ error: "Gagal menambah kegiatan: " + error.message });
  }
});

// Update kegiatan
app.put("/api/kegiatan/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update kegiatan:", id, req.body);

    const {
      judul,
      deskripsi,
      jenis,
      target,
      bab_id,
      sub_bab_id,
      batas_waktu,
      tanggal,
      hari,
      siswa_target,
    } = req.body;

    const connection = await getConnection();
    await connection.beginTransaction();

    try {
      // Update kegiatan utama
      await connection.execute(
        `UPDATE kegiatan_kelas 
         SET judul = ?, deskripsi = ?, jenis = ?, target = ?, 
             bab_id = ?, sub_bab_id = ?, batas_waktu = ?, tanggal = ?, hari = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          judul,
          deskripsi || null,
          jenis,
          target,
          bab_id || null,
          sub_bab_id || null,
          batas_waktu || null,
          tanggal,
          hari,
          id,
        ]
      );

      // Hapus siswa target lama
      await connection.execute(
        "DELETE FROM kegiatan_siswa_target WHERE kegiatan_id = ?",
        [id]
      );

      // Insert siswa target baru jika target khusus
      if (target === "khusus" && siswa_target && siswa_target.length > 0) {
        for (const siswaId of siswa_target) {
          const targetId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO kegiatan_siswa_target (id, kegiatan_id, siswa_id) VALUES (?, ?, ?)",
            [targetId, id, siswaId]
          );
        }
      }

      await connection.commit();

      console.log("Kegiatan berhasil diupdate:", id);
      res.json({ message: "Kegiatan berhasil diupdate" });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("ERROR UPDATE KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal mengupdate kegiatan" });
  }
});

// Delete kegiatan
app.delete("/api/kegiatan/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete kegiatan:", id);

    const connection = await getConnection();

    // Hapus otomatis akan cascade ke kegiatan_siswa_target karena foreign key constraint
    await connection.execute("DELETE FROM kegiatan_kelas WHERE id = ?", [id]);
    await connection.end();

    console.log("Kegiatan berhasil dihapus:", id);
    res.json({ message: "Kegiatan berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal menghapus kegiatan" });
  }
});

// Get jadwal untuk dropdown (disesuaikan)
app.get("/api/jadwal/guru/:guruId", authenticateToken, async (req, res) => {
  try {
    const { guruId } = req.params;
    const { hari, tahun_ajaran } = req.query;

    console.log("Mengambil jadwal untuk form kegiatan:", guruId);

    let query = `
      SELECT 
        jm.id,
        jm.kelas_id,
        k.nama as kelas_nama,
        jm.mata_pelajaran_id,
        mp.nama as mata_pelajaran_nama,
        jm.hari_id,
        h.nama as hari_nama
      FROM jadwal_mengajar jm
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN hari h ON jm.hari_id = h.id
      WHERE jm.guru_id = ?
    `;

    let params = [guruId];

    if (hari && hari !== "Semua Hari") {
      query += " AND h.nama = ?";
      params.push(hari);
    }

    if (tahun_ajaran) {
      query += " AND jm.tahun_ajaran = ?";
      params.push(tahun_ajaran);
    }

    query += " ORDER BY h.urutan, k.nama";

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log("Jadwal ditemukan untuk form:", jadwal.length);
    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL FORM:", error.message);
    res.status(500).json({ error: "Gagal mengambil data jadwal" });
  }
});

// Serve static files untuk uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Endpoint untuk mengecek koneksi database
app.get("/api/health", async (req, res) => {
  try {
    const connection = await getConnection();
    const [result] = await connection.execute("SELECT 1 as test");
    await connection.end();
    res.json({
      status: "OK",
      database: "Connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("HEALTH CHECK ERROR:", error.message);
    res.status(500).json({
      status: "ERROR",
      database: "Disconnected",
      error: error.message,
    });
  }
});

// Endpoint untuk melihat daftar tabel yang ada
app.get("/api/debug/tables", async (req, res) => {
  try {
    const connection = await getConnection();
    const [tables] = await connection.execute("SHOW TABLES");
    await connection.end();
    res.json({ tables });
  } catch (error) {
    console.error("DEBUG TABLES ERROR:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// PERBAIKAN: Handle 404 yang benar
app.use((req, res, next) => {
  console.log("404 Not Found:", req.originalUrl);
  res.status(404).json({ error: "Endpoint tidak ditemukan" });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("UNHANDLED ERROR:", error.message);
  console.error(error.stack);
  res
    .status(500)
    .json({ error: "Terjadi kesalahan server yang tidak terduga" });
});

// async function buatHash(pw) {
//   const saltRounds = 10;
//   const hash = await bcrypt.hash(pw, saltRounds);
//   console.log("Hash baru:", hash);
// }

// buatHash("password123");
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Database: ${dbConfig.host}/${dbConfig.database}`);

  // Test connection on startup
  getConnection()
    .then((conn) => {
      console.log("Koneksi database berhasil pada startup");
      return conn.end();
    })
    .catch((err) => {
      console.error("Koneksi database gagal pada startup:", err.message);
    });
});
