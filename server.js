const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== TIDB CLOUD CONNECTION ==========
const pool = mysql.createPool({
    host: process.env.TIDB_HOST,
    port: parseInt(process.env.TIDB_PORT) || 4000,
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE || 'pluto_invoice',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// ========== TEST DATABASE CONNECTION ==========
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ TiDB Cloud connected successfully!');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ TiDB Cloud connection failed:', error.message);
        return false;
    }
}

// ========== HEALTH CHECK API ==========
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        database: process.env.TIDB_DATABASE
    });
});

// ========== SAVE INVOICE API ==========
app.post('/api/invoices', async (req, res) => {
    try {
        const { invoiceNo, date, items, grandTotal, words } = req.body;
        
        // Validate required fields
        if (!invoiceNo || !date || !items || !grandTotal) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        const [result] = await pool.execute(
            `INSERT INTO invoices 
            (invoice_number, invoice_date, items_data, grand_total, total_words) 
            VALUES (?, ?, ?, ?, ?)`,
            [invoiceNo, date, JSON.stringify(items), grandTotal, words]
        );
        
        res.json({ 
            success: true, 
            id: result.insertId,
            message: 'Invoice saved successfully'
        });
        
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========== GET ALL INVOICES API ==========
app.get('/api/invoices', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM invoices ORDER BY created_at DESC'
        );
        
        const invoices = rows.map(row => ({
            id: row.id,
            invoiceNo: row.invoice_number,
            date: row.invoice_date,
            items: JSON.parse(row.items_data),
            grandTotal: row.grand_total,
            words: row.total_words,
            timestamp: row.created_at
        }));
        
        res.json({ success: true, invoices });
        
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========== GET SINGLE INVOICE API ==========
app.get('/api/invoices/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM invoices WHERE id = ?',
            [req.params.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Invoice not found' 
            });
        }
        
        const invoice = {
            id: rows[0].id,
            invoiceNo: rows[0].invoice_number,
            date: rows[0].invoice_date,
            items: JSON.parse(rows[0].items_data),
            grandTotal: rows[0].grand_total,
            words: rows[0].total_words,
            timestamp: rows[0].created_at
        };
        
        res.json({ success: true, invoice });
        
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========== UPDATE INVOICE API ==========
app.put('/api/invoices/:id', async (req, res) => {
    try {
        const { invoiceNo, date, items, grandTotal, words } = req.body;
        const id = req.params.id;
        
        await pool.execute(
            `UPDATE invoices 
            SET invoice_number = ?, invoice_date = ?, items_data = ?, 
                grand_total = ?, total_words = ? 
            WHERE id = ?`,
            [invoiceNo, date, JSON.stringify(items), grandTotal, words, id]
        );
        
        res.json({ 
            success: true, 
            message: 'Invoice updated successfully' 
        });
        
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========== DELETE INVOICE API ==========
app.delete('/api/invoices/:id', async (req, res) => {
    try {
        const [result] = await pool.execute(
            'DELETE FROM invoices WHERE id = ?',
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Invoice not found' 
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Invoice deleted successfully' 
        });
        
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========== ROOT ENDPOINT ==========
app.get('/', (req, res) => {
    res.json({
        name: 'Pluto\'s Restaurant Invoice API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /api/health',
            invoices: 'GET /api/invoices',
            invoiceById: 'GET /api/invoices/:id',
            createInvoice: 'POST /api/invoices',
            updateInvoice: 'PUT /api/invoices/:id',
            deleteInvoice: 'DELETE /api/invoices/:id'
        }
    });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 API URL: http://localhost:${PORT}`);
    await testConnection();
});