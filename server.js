const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== TIDB CLOUD CONNECTION WITH SSL ==========
const pool = mysql.createPool({
    host: process.env.TIDB_HOST,
    port: parseInt(process.env.TIDB_PORT) || 4000,
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE || 'pluto_invoice',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    // 🔑 THIS IS THE FIX - SSL/TLS REQUIRED
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// Test connection with SSL
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ TiDB Cloud connected successfully (SSL enabled)!');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ TiDB Cloud connection failed:', error.message);
        console.error('💡 Make sure you are using TLS v1.2 or higher');
        return false;
    }
}

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        ssl: 'enabled'
    });
});

// Save Invoice
app.post('/api/invoices', async (req, res) => {
    try {
        const { invoiceNo, date, items, grandTotal, words } = req.body;
        
        if (!invoiceNo || !date || !items) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        const [result] = await pool.execute(
            'INSERT INTO invoices (invoice_number, invoice_date, items_data, grand_total, total_words) VALUES (?, ?, ?, ?, ?)',
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

// Get All Invoices
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

// Get Single Invoice
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

// Update Invoice
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

// Delete Invoice
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

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Pluto\'s Restaurant Invoice API',
        version: '1.0.0',
        status: 'running',
        ssl: 'enabled',
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

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 API URL: http://localhost:${PORT}`);
    await testConnection();
});
