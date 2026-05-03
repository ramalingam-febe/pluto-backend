const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection pool with FIXED SSL configuration
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER || 'koQBsMLYytSui1f.root',
    password: process.env.DB_PASSWORD || 'VV3IoTlN2hYtc2lx',
    database: process.env.DB_NAME || 'pluto_invoice',
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false  // CHANGE THIS TO false FOR TiDB SERVERLESS
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Test database connection (don't exit on failure)
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Connected to TiDB Cloud successfully!');
        
        // Check if invoices table exists, create if not
        await connection.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id INT PRIMARY KEY AUTO_INCREMENT,
                invoice_no VARCHAR(100) NOT NULL,
                invoice_date DATE NOT NULL,
                items JSON NOT NULL,
                grand_total VARCHAR(50) NOT NULL,
                grand_value DECIMAL(10,2) NOT NULL,
                words TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Invoices table ready');
        
        connection.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('⚠️ Server will continue in degraded mode (no database)');
        // Don't exit - let server run even without database
    }
}

// ========== API ENDPOINTS ==========

// Health check endpoint (always works)
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        database: pool ? 'configured' : 'not configured',
        timestamp: new Date().toISOString() 
    });
});

// Get all invoices
app.get('/api/invoices', async (req, res) => {
    try {
        // Check if pool is available
        if (!pool) {
            return res.json({ success: true, invoices: [] });
        }
        
        const [rows] = await pool.query(
            'SELECT id, invoice_no, invoice_date, items, grand_total, grand_value, words, created_at FROM invoices ORDER BY created_at DESC'
        );
        
        const invoices = rows.map(row => ({
            id: row.id,
            invoiceNo: row.invoice_no,
            date: row.invoice_date,
            items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
            grandTotal: row.grand_total,
            grandValue: row.grand_value,
            words: row.words,
            timestamp: row.created_at
        }));
        
        res.json({ success: true, invoices });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            hint: 'Check if invoices table exists'
        });
    }
});

// Get single invoice by ID
app.get('/api/invoices/:id', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }
        
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
            items: typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : rows[0].items,
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
        if (!pool) {
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }
        
        const { invoiceNo, date, items, grandTotal, grandValue, words } = req.body;
        
        // Validate required fields
        if (!invoiceNo || !date || !items || !grandTotal) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields',
                required: ['invoiceNo', 'date', 'items', 'grandTotal']
            });
        }
        
        // Ensure items is properly formatted
        const itemsJson = typeof items === 'string' ? items : JSON.stringify(items);
        
        const [result] = await pool.query(
            'INSERT INTO invoices (invoice_no, invoice_date, items, grand_total, grand_value, words) VALUES (?, ?, ?, ?, ?, ?)',
            [invoiceNo, date, itemsJson, grandTotal, grandValue || 0, words || '']
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
        if (!pool) {
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }
        
        const { invoiceNo, date, items, grandTotal, grandValue, words } = req.body;
        
        const itemsJson = typeof items === 'string' ? items : JSON.stringify(items);
        
        const [result] = await pool.query(
            'UPDATE invoices SET invoice_no = ?, invoice_date = ?, items = ?, grand_total = ?, grand_value = ?, words = ? WHERE id = ?',
            [invoiceNo, date, itemsJson, grandTotal, grandValue || 0, words, req.params.id]
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
        if (!pool) {
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }
        
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

// 404 handler for undefined routes
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        error: `Route ${req.method} ${req.url} not found` 
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Internal server error',
        message: err.message 
    });
});

// Start server
async function startServer() {
    await testConnection(); // Don't wait for this to complete
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📊 API URL: http://localhost:${PORT}/api`);
        console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
    });
}

startServer();

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    if (pool) {
        pool.end().then(() => process.exit(0));
    } else {
        process.exit(0);
    }
});
