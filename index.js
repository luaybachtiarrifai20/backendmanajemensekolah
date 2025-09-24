const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());

// Konfigurasi database langsung (ganti dengan nilai yang sesuai)
const dbConfig = {
  host: "Libra.web.id",
  user: "vldgkamz_luay",
  password: "libraayra20", // atau password kamu
  database: "vldgkamz_manajemensekolah",
  port: 3307,
};

// Konfigurasi JWT secret
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

app.post("/api/kelas", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah kelas baru:", req.body);
    const { nama, wali_kelas_id } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO kelas (id, nama, wali_kelas_id) VALUES (?, ?, ?)",
      [id, nama, wali_kelas_id]
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

app.post("/api/siswa", authenticateToken, async (req, res) => {
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
    } = req.body;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const updatedAt = createdAt;

    const connection = await getConnection();
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
    await connection.end();

    console.log("Siswa berhasil ditambahkan:", nis);
    res.json({ message: "Siswa berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST SISWA:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal menambah siswa" });
  }
});

// Kelola Siswa - Update Siswa
app.put("/api/siswa/:id", authenticateToken, async (req, res) => {
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
    } = req.body;
    const updatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    const connection = await getConnection();
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
    await connection.end();

    console.log("Siswa berhasil diupdate:", id);
    res.json({ message: "Siswa berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT SISWA:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal mengupdate siswa" });
  }
});

// Kelola Siswa - Delete Siswa
app.delete("/api/siswa/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete siswa:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM siswa WHERE id = ?", [id]);
    await connection.end();

    console.log("Siswa berhasil dihapus:", id);
    res.json({ message: "Siswa berhasil dihapus" });
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
      WHERE u.id = ?
      GROUP BY u.id
    `, [id]);
    
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
    const { guru_id, tanggal, mata_pelajaran_id } = req.query;
    console.log("Mengambil data absensi");

    let query = `
      SELECT a.*, s.nama as siswa_nama, s.nis, k.nama as kelas_nama
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
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
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO absensi (id, siswa_id, guru_id, mata_pelajaran_id, tanggal, status, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, siswa_id, guru_id, mata_pelajaran_id, tanggal, status, keterangan]
    );
    await connection.end();

    console.log("Absensi berhasil ditambahkan:", id);
    res.json({ message: "Absensi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST ABSENSI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah absensi" });
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

// Kelola RPP
app.get("/api/rpp", authenticateToken, async (req, res) => {
  try {
    const { guru_id, mata_pelajaran_id } = req.query;
    console.log("Mengambil data RPP");

    let query = `
      SELECT r.*, u.nama as guru_nama, mp.nama as mata_pelajaran_nama
      FROM rpp r
      JOIN users u ON r.guru_id = u.id
      JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND r.guru_id = ?";
      params.push(guru_id);
    }

    if (mata_pelajaran_id) {
      query += " AND r.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

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
app.get("/api/guru", authenticateToken, async (req, res) => {
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

app.post("/api/rpp", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah RPP:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      judul,
      tujuan_pembelajaran,
      materi_pokok,
      kegiatan_pembelajaran,
      penilaian,
      alat_media,
      file_path,
    } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO rpp (id, guru_id, mata_pelajaran_id, judul, tujuan_pembelajaran, materi_pokok, kegiatan_pembelajaran, penilaian, alat_media, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        guru_id,
        mata_pelajaran_id,
        judul,
        tujuan_pembelajaran,
        materi_pokok,
        kegiatan_pembelajaran,
        penilaian,
        alat_media,
        file_path,
      ]
    );
    await connection.end();

    console.log("RPP berhasil ditambahkan:", id);
    res.json({ message: "RPP berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST RPP:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah RPP" });
  }
});

// Get Jadwal Mengajar
app.get("/api/jadwal-mengajar", authenticateToken, async (req, res) => {
  try {
    const { guru_id, kelas_id, hari, semester, tahun_ajaran } = req.query;
    console.log("Mengambil data jadwal mengajar");

    let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
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

    if (hari) {
      query += " AND jm.hari = ?";
      params.push(hari);
    }

    if (semester) {
      query += " AND jm.semester = ?";
      params.push(semester);
    }

    if (tahun_ajaran) {
      query += " AND jm.tahun_ajaran = ?";
      params.push(tahun_ajaran);
    }

    query += " ORDER BY jm.hari, jm.jam_mulai";

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data jadwal mengajar, jumlah:", jadwal.length);
    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL MENGAJAR:", error.message);
    res.status(500).json({ error: "Gagal mengambil data jadwal mengajar" });
  }
});

// Create Jadwal Mengajar
app.post("/api/jadwal-mengajar", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah jadwal mengajar baru:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      hari,
      jam_mulai,
      jam_selesai,
      semester,
      tahun_ajaran
    } = req.body;
    
    const id = crypto.randomUUID();

    // Validasi jam
    if (jam_mulai >= jam_selesai) {
      return res.status(400).json({ error: "Jam mulai harus sebelum jam selesai" });
    }

    const connection = await getConnection();
    
    // Cek konflik jadwal
    const [konflik] = await connection.execute(
      `SELECT * FROM jadwal_mengajar 
       WHERE guru_id = ? AND hari = ? AND semester = ? AND tahun_ajaran = ?
       AND ((jam_mulai <= ? AND jam_selesai > ?) OR (jam_mulai < ? AND jam_selesai >= ?))`,
      [guru_id, hari, semester, tahun_ajaran, jam_selesai, jam_mulai, jam_selesai, jam_mulai]
    );

    if (konflik.length > 0) {
      await connection.end();
      return res.status(400).json({ error: "Guru memiliki jadwal yang bertabrakan" });
    }

    await connection.execute(
      "INSERT INTO jadwal_mengajar (id, guru_id, mata_pelajaran_id, kelas_id, hari, jam_mulai, jam_selesai, semester, tahun_ajaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, guru_id, mata_pelajaran_id, kelas_id, hari, jam_mulai, jam_selesai, semester, tahun_ajaran]
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

// Update Jadwal Mengajar
app.put("/api/jadwal-mengajar/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update jadwal mengajar:", id, req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      hari,
      jam_mulai,
      jam_selesai,
      semester,
      tahun_ajaran
    } = req.body;

    // Validasi jam
    if (jam_mulai >= jam_selesai) {
      return res.status(400).json({ error: "Jam mulai harus sebelum jam selesai" });
    }

    const connection = await getConnection();
    
    // Cek konflik jadwal (kecuali dengan dirinya sendiri)
    const [konflik] = await connection.execute(
      `SELECT * FROM jadwal_mengajar 
       WHERE id != ? AND guru_id = ? AND hari = ? AND semester = ? AND tahun_ajaran = ?
       AND ((jam_mulai <= ? AND jam_selesai > ?) OR (jam_mulai < ? AND jam_selesai >= ?))`,
      [id, guru_id, hari, semester, tahun_ajaran, jam_selesai, jam_mulai, jam_selesai, jam_mulai]
    );

    if (konflik.length > 0) {
      await connection.end();
      return res.status(400).json({ error: "Guru memiliki jadwal yang bertabrakan" });
    }

    await connection.execute(
      "UPDATE jadwal_mengajar SET guru_id = ?, mata_pelajaran_id = ?, kelas_id = ?, hari = ?, jam_mulai = ?, jam_selesai = ?, semester = ?, tahun_ajaran = ? WHERE id = ?",
      [guru_id, mata_pelajaran_id, kelas_id, hari, jam_mulai, jam_selesai, semester, tahun_ajaran, id]
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

async function buatHash(pw) {
  const saltRounds = 10;
  const hash = await bcrypt.hash(pw, saltRounds);
  console.log("Hash baru:", hash);
}

buatHash("password123");

const PORT = 3001;
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
