require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');
const session = require('express-session');


const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secretkey',
    resave: false,
    saveUninitialized: true
}));

app.set('view engine', 'ejs');

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

app.post('/register', async (req, res) => {
    const { full_name, contact, email, password, confirm_password } = req.body;

    if (!full_name || !contact || !email || !password || !confirm_password) {
        return res.send('All fields are required');
    }

    if (password !== confirm_password) {
        return res.send('Passwords do not match');
    }

    if (contact.length < 10) {
        return res.send('Invalid contact number');
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const role = 'customer';

        const sql = `
            INSERT INTO users (email, password, full_name, contact, role, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;

        db.query(sql, [email, hashedPassword, full_name, contact, role], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.send('Email already exists');
                }
                throw err;
            }

            res.send('Registration successful!');
        });

    } catch (error) {
        console.error(error);
        res.send('Something went wrong');
    }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    const sql = 'SELECT * FROM users WHERE email = ?';

    db.query(sql, [email], async (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
            return res.send('User not found');
        }

        const user = results[0];

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.send('Incorrect password');
        }

        // Save session
        req.session.user = {
            id: user.user_id,
            email: user.email,
            role: user.role,
            name: user.full_name,
            contact:user.contact
        };

        if (user.role === 'technician') {
            return res.redirect('/technician');
        } else if (user.role === 'admin') {
            return res.redirect('/admin');
        } else {
            return res.redirect('/dashboard'); 
        }
    });
});

app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const userId = req.session.user.id;

    const sql = "SELECT * FROM tickets WHERE created_by = ? ORDER BY CASE WHEN status = 'closed' THEN 1 ELSE 0 END, CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END, created_at DESC";

    db.query(sql, [userId], (err, results) => {
        if (err) throw err;

        res.render('dashboard', {
            user: req.session.user,
            tickets: results
        });
    });
});

app.get('/technician', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    if (req.session.user.role !== 'technician') {
        return res.redirect('/dashboard');
    }

    const sql = `
        SELECT t.*, u.full_name AS technician_name
        FROM tickets t
        LEFT JOIN users u ON t.assigned_to = u.user_id
        WHERE t.priority = 'P1' AND t.status != 'closed'
        ORDER BY t.created_at DESC
    `;

    db.query(sql, (err, results) => {
        if (err) throw err;

        res.render('technician-dashboard', {
            user: req.session.user,
            tickets: results
        });
    });
});

app.post('/forgot-password', async (req, res) => {
    const { email, new_password } = req.body;

    if (!email || !new_password) {
        return res.send('All fields are required');
    }

    try {
        const hashedPassword = await bcrypt.hash(new_password, 10);

        const sql = 'UPDATE users SET password = ? WHERE email = ?';

        db.query(sql, [hashedPassword, email], (err, result) => {
            if (err) throw err;

            if (result.affectedRows === 0) {
                return res.send('Email not found');
            }

            res.send('Password updated successfully!');
        });

    } catch (error) {
        console.error(error);
        res.send('Something went wrong');
    }
});

app.get('/tickets/create', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    res.render('create-ticket');
});

app.post('/tickets/create', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const { title, description, priority } = req.body;
    const userId = req.session.user.id;

    const ticketSql = `
        INSERT INTO tickets (title, description, priority, status, created_by)
        VALUES (?, ?, ?, 'open', ?)
    `;

    db.query(ticketSql, [title, description, priority, userId], (err, result) => {
        if (err) throw err;

        const ticketId = result.insertId;

        const commentSql = `
            INSERT INTO ticket_comments (ticket_id, user_id, comment)
            VALUES (?, ?, ?)
        `;

        db.query(commentSql, [ticketId, userId, description], (err) => {
            if (err) throw err;

            res.redirect('/dashboard');
        });
    });
});

app.get('/tickets/update/:id', (req, res) => {
    const ticketId = req.params.id;

    const ticketQuery = `
        SELECT t.*, u.full_name AS technician_name
        FROM tickets t
        LEFT JOIN users u ON t.assigned_to = u.user_id
        WHERE t.ticket_id = ?
    `;

    const commentsQuery = `
        SELECT tc.*, u.full_name, u.role
        FROM ticket_comments tc
        JOIN users u ON tc.user_id = u.user_id
        WHERE tc.ticket_id = ?
        ORDER BY tc.created_at ASC
    `;

    db.query(ticketQuery, [ticketId], (err, ticketResult) => {
        if (err) throw err;

        db.query(commentsQuery, [ticketId], (err, commentsResult) => {
            if (err) throw err;

            res.render('ticket-update', {
                ticket: ticketResult[0],
                comments: commentsResult,
                user: req.session.user
            });
        });
    });
});

app.post('/comments/add', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const { comment, ticket_id } = req.body;
    const userId = req.session.user.id;

    const sql = `
        INSERT INTO ticket_comments (ticket_id, user_id, comment)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [ticket_id, userId, comment], (err) => {
        if (err) throw err;

        res.redirect(`/tickets/update/${ticket_id}`);
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.send('Error logging out');
        }

        res.redirect('/');
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});