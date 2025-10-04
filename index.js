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
  port: 3306,
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
