const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();

// Simple CORS - Allow all
app.use(cors());
app.use(express.json());

// TiDB Cloud Connection
let pool;
let dbConnected = false;

async function initDB() {
    try {
        pool = await mysql.createPool({
            host: process.env.TIDB_HOST || 'gateway01.ap-south-1.prod.aws.tidbcloud.com',
            port: parseInt(process.env.TIDB_PORT) || 4000,
            user: process.env.TIDB_USER,
            password: process.env.TIDB_PASSWORD,
            database: process.env.TIDB_DATABASE || 'pluto_invoice',
            waitForConnections: true,
            connectionLimit: 10,
            ssl: {
                minVersion: 'TLSv1.2',
                rejectUnauthorized: true
            }
        });
        
        // Test connection
        const conn = await pool.getConnection();
        console.log('✅ TiDB Cloud connected!');
        conn.release();
        dbConnected = true;
        
        // Create table if not exists
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS invoices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_number VARCHAR(50) UNIQUE NOT NULL,
                invoice_date DATE NOT NULL,
                items_data JSON,
                grand_total VARCHAR(50),
                total_words VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Table ready');
        
    } catch (error) {
        console.error('❌ DB Error:', error.message);
        dbConnected = false;
    }
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        dbConnected: dbConnected,
        timestamp: new Date().toISOString() 
    });
});

// GET all invoices
app.get('/api/invoices', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.json({ success: true, invoices: [] });
        }
        const [rows] = await pool.execute('SELECT * FROM invoices ORDER BY id DESC');
        res.json({ success: true, invoices: rows });
    } catch (error) {
        console.error('GET error:', error.message);
        res.json({ success: true, invoices: [] });
    }
});

// POST new invoice
app.post('/api/invoices', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.json({ success: false, error: 'Database not connected' });
        }
        
        const { invoiceNo, date, items, grandTotal, words } = req.body;
        
        console.log('Received invoice:', invoiceNo);
        
        const [result] = await pool.execute(
            'INSERT INTO invoices (invoice_number, invoice_date, items_data, grand_total, total_words) VALUES (?, ?, ?, ?, ?)',
            [invoiceNo, date, JSON.stringify(items), grandTotal, words]
        );
        
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('POST error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// DELETE invoice
app.delete('/api/invoices/:id', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.json({ success: false });
        }
        await pool.execute('DELETE FROM invoices WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

// Root
app.get('/', (req, res) => {
    res.json({ 
        name: 'Pluto Invoice API',
        status: 'running',
        dbConnected: dbConnected
    });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`🚀 Server on port ${PORT}`);
    await initDB();
});
