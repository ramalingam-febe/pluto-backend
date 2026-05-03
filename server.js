const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER || 'your_username',
    password: process.env.DB_PASSWORD || 'your_password',
    database: process.env.DB_NAME || 'pluto_restaurant',
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Connected to TiDB Cloud successfully!');
        connection.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
}

testConnection();

// ========== API ENDPOINTS ==========

// Get all invoices
app.get('/api/invoices', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, invoice_no, invoice_date, items, grand_total, grand_value, words, created_at FROM invoices ORDER BY created_at DESC'
        );
        
        const invoices = rows.map(row => ({
            id: row.id,
            invoiceNo: row.invoice_no,
            date: row.invoice_date,
            items: JSON.parse(row.items),
            grandTotal: row.grand_total,
            grandValue: row.grand_value,
            words: row.words,
            timestamp: row.created_at
        }));
        
        res.json({ success: true, invoices });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single invoice by ID
app.get('/api/invoices/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, invoice_no, invoice_date, items, grand_total, grand_value, words FROM invoices WHERE id = ?',
            [req.params.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        
        const invoice = {
            id: rows[0].id,
            invoiceNo: rows[0].invoice_no,
            date: rows[0].invoice_date,
            items: JSON.parse(rows[0].items),
            grandTotal: rows[0].grand_total,
            grandValue: rows[0].grand_value,
            words: rows[0].words
        };
        
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Error fetching invoice:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new invoice
app.post('/api/invoices', async (req, res) => {
    try {
        const { invoiceNo, date, items, grandTotal, grandValue, words } = req.body;
        
        // Validate required fields
        if (!invoiceNo || !date || !items || !grandTotal) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const [result] = await pool.query(
            'INSERT INTO invoices (invoice_no, invoice_date, items, grand_total, grand_value, words) VALUES (?, ?, ?, ?, ?, ?)',
            [invoiceNo, date, JSON.stringify(items), grandTotal, grandValue || 0, words || '']
        );
        
        res.json({ 
            success: true, 
            id: result.insertId,
            message: 'Invoice saved successfully'
        });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update invoice
app.put('/api/invoices/:id', async (req, res) => {
    try {
        const { invoiceNo, date, items, grandTotal, grandValue, words } = req.body;
        
        const [result] = await pool.query(
            'UPDATE invoices SET invoice_no = ?, invoice_date = ?, items = ?, grand_total = ?, grand_value = ?, words = ? WHERE id = ?',
            [invoiceNo, date, JSON.stringify(items), grandTotal, grandValue || 0, words, req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        
        res.json({ success: true, message: 'Invoice updated successfully' });
    } catch (error) {
        console.error('Error updating invoice:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete invoice
app.delete('/api/invoices/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM invoices WHERE id = ?', [req.params.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        
        res.json({ success: true, message: 'Invoice deleted successfully' });
    } catch (error) {
        console.error('Error deleting invoice:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 API URL: http://localhost:${PORT}/api`);
});
