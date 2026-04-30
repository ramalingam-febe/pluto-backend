const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();

// ========== CORS CONFIGURATION ==========
// Allow multiple origins including your Netlify frontend
const allowedOrigins = [
    'https://plutoswebapp.netlify.app',
    'https://pulutoswebapp.netlify.app',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8000'
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(null, true); // Allow for testing
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ========== TIDB CLOUD CONNECTION WITH SSL ==========
const pool = mysql.createPool({
    host: process.env.TIDB_HOST || 'gateway01.ap-south-1.prod.aws.tidbcloud.com',
    port: parseInt(process.env.TIDB_PORT) || 4000,
    user: process.env.TIDB_USER || 'your_username.root',
    password: process.env.TIDB_PASSWORD || 'your_password',
    database: process.env.TIDB_DATABASE || 'pluto_invoice',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ TiDB Cloud connected successfully!');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ TiDB Cloud connection failed:', error.message);
        console.error('💡 Please check your environment variables');
        return false;
    }
}

// ========== HEALTH CHECK ENDPOINT ==========
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        cors: 'enabled'
    });
});

// ========== GET ALL INVOICES ==========
app.get('/api/invoices', async (req, res) => {
    try {
        console.log('📋 Fetching all invoices...');
        const [rows] = await pool.execute('SELECT * FROM invoices ORDER BY created_at DESC');
        
        const invoices = rows.map(row => ({
            id: row.id,
            invoiceNo: row.invoice_number,
            date: row.invoice_date,
            items: JSON.parse(row.items_data),
            grandTotal: row.grand_total,
            words: row.total_words,
            timestamp: row.created_at
        }));
        
        console.log(`📋 Retrieved ${invoices.length} invoices`);
        res.json({ success: true, invoices });
        
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== GET SINGLE INVOICE ==========
app.get('/api/invoices/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid invoice ID' });
        }
        
        const [rows] = await pool.execute('SELECT * FROM invoices WHERE id = ?', [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== SAVE INVOICE ==========
app.post('/api/invoices', async (req, res) => {
    try {
        const { invoiceNo, date, items, grandTotal, words } = req.body;
        
        console.log(`📝 Saving invoice: ${invoiceNo}`);
        
        // Validate required fields
        if (!invoiceNo || !date || !items || !items.length) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: invoiceNo, date, or items'
            });
        }
        
        // Validate items
        const validItems = items.map(item => ({
            ...item,
            qty: parseFloat(item.qty) || 0,
            price: parseFloat(item.price) || 0
        }));
        
        const [result] = await pool.execute(
            'INSERT INTO invoices (invoice_number, invoice_date, items_data, grand_total, total_words) VALUES (?, ?, ?, ?, ?)',
            [invoiceNo, date, JSON.stringify(validItems), grandTotal, words]
        );
        
        console.log(`✅ Invoice saved! ID: ${result.insertId}`);
        res.json({
            success: true,
            id: result.insertId,
            message: 'Invoice saved successfully'
        });
        
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== UPDATE INVOICE ==========
app.put('/api/invoices/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid invoice ID' });
        }
        
        const { invoiceNo, date, items, grandTotal, words } = req.body;
        
        if (!invoiceNo || !date || !items) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        await pool.execute(
            `UPDATE invoices 
            SET invoice_number = ?, invoice_date = ?, items_data = ?, 
                grand_total = ?, total_words = ? 
            WHERE id = ?`,
            [invoiceNo, date, JSON.stringify(items), grandTotal, words, id]
        );
        
        console.log(`📝 Invoice ${id} updated`);
        res.json({ success: true, message: 'Invoice updated successfully' });
        
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== DELETE INVOICE ==========
app.delete('/api/invoices/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid invoice ID' });
        }
        
        const [result] = await pool.execute('DELETE FROM invoices WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        
        console.log(`🗑️ Invoice ${id} deleted`);
        res.json({ success: true, message: 'Invoice deleted successfully' });
        
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ROOT ENDPOINT ==========
app.get('/', (req, res) => {
    res.json({
        name: 'Pluto\'s Restaurant Invoice API',
        version: '1.0.0',
        status: 'running',
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
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`📍 Public: https://pluto-backend-pxoy.onrender.com\n`);
    await testConnection();
});
