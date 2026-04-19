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
    const sql = `SELECT * FROM tickets WHERE created_by = ? 
    ORDER BY CASE WHEN status = 'closed' THEN 1 ELSE 0 END, 
    CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' 
    THEN 3 WHEN 'P4' THEN 4 ELSE 5 END, created_at DESC`;
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
    const role = req.session.user.role;
    if (role === 'technician') {
        const sql = "SELECT user_id, full_name FROM users WHERE role = 'technician'";
        db.query(sql, (err, technicians) => {
            if (err) throw err;

            res.render('create-ticket', {
                role,
                technicians,
                currentUserId: req.session.user.id
            });
        });
    } else {
        res.render('create-ticket', {
            role,
            technicians: [],
            currentUserId: null
        });
    }
});

app.post('/tickets/create', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    const { title, description, priority, assigned_to } = req.body;
    const userId = req.session.user.id;
    const role = req.session.user.role;
    let assignedUser = null;
    if (role === 'technician' && assigned_to) {
        assignedUser = assigned_to;
    }
    const ticketSql = `
        INSERT INTO tickets (title, description, priority, status, created_by, assigned_to)
        VALUES (?, ?, ?, 'open', ?, ?)
    `;
    db.query(ticketSql, [title, description, priority, userId, assignedUser], (err, result) => {
        if (err) throw err;
        const ticketId = result.insertId;
        const commentSql = `
            INSERT INTO ticket_comments (ticket_id, user_id, comment)
            VALUES (?, ?, ?)
        `;
        db.query(commentSql, [ticketId, userId, description], (err) => {
            if (err) throw err;
            if (role === 'technician') {
                return res.redirect('/technician-dashboard');
            }
            res.redirect('/dashboard');
        });
    });
});

app.get('/tickets/view/:id', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const ticketId = req.params.id;

    const ticketSql = `
        SELECT 
            t.*,
            c.full_name AS customer_name,
            c.contact AS customer_contact,
            tech.full_name AS technician_name,
            tech.contact AS technician_contact
        FROM tickets t
        JOIN users c ON t.created_by = c.user_id
        LEFT JOIN users tech ON t.assigned_to = tech.user_id
        WHERE t.ticket_id = ?
`;

    const commentSql = `
        SELECT c.*, u.full_name, u.role
        FROM ticket_comments c
        JOIN users u ON c.user_id = u.user_id
        WHERE c.ticket_id = ?
        ORDER BY c.created_at ASC
    `;

    const techSql = `
        SELECT user_id, full_name FROM users WHERE role = 'technician'
    `;

    db.query(ticketSql, [ticketId], (err, ticketResult) => {
        if (err) throw err;

        db.query(commentSql, [ticketId], (err, comments) => {
            if (err) throw err;

            db.query(techSql, (err, technicians) => {
                if (err) throw err;

                res.render('ticket-view', {
                    ticket: ticketResult[0],
                    comments,
                    technicians,
                    role: req.session.user.role,
                    userId: req.session.user.id
                });
            });
        });
    });
});

app.get('/tickets/my', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const userId = req.session.user.id;

    const sql = `
        SELECT * FROM tickets
        WHERE created_by = ? OR assigned_to = ?
        ORDER BY created_at DESC
    `;

    db.query(sql, [userId, userId], (err, results) => {
        if (err) throw err;

        res.render('my-tickets', { 
            tickets: results,
            dashtitle: 'My Tickets'
        });
    });
});

app.get('/tickets/all', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    const role = req.session.user.role;
    if (role !== 'technician' && role !== 'admin') {
        return res.redirect('/dashboard');
    }
    const sql = `
        SELECT t.*, u.full_name AS created_by_name
        FROM tickets t
        JOIN users u ON t.created_by = u.user_id
        ORDER BY t.created_at DESC
    `;
    db.query(sql, (err, results) => {
        if (err) throw err;

        res.render('my-tickets', { 
            tickets: results,
            dashtitle: 'All Tickets'
        });
    });
});

app.post('/tickets/assign', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    if (req.session.user.role !== 'technician') {
        return res.redirect('/dashboard');
    }
    const { ticket_id, assigned_to } = req.body;
    const currentUserId = req.session.user.id;
    const updateSql = `
        UPDATE tickets
        SET assigned_to = ?
        WHERE ticket_id = ?
    `;
    db.query(updateSql, [assigned_to, ticket_id], (err) => {
        if (err) throw err;
        const userSql = `
            SELECT full_name FROM users WHERE user_id = ?
        `;
        db.query(userSql, [assigned_to], (err, result) => {
            if (err) throw err;
            const techName = result[0]?.full_name || "Unassigned";
            const commentSql = `
                INSERT INTO ticket_comments (ticket_id, user_id, comment)
                VALUES (?, ?, ?)
            `;
            const message = `Ticket assigned to ${techName}`;
            db.query(commentSql, [ticket_id, currentUserId, message], (err) => {
                if (err) throw err;
                res.redirect('/tickets/view/' + ticket_id);
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
    const role = req.session.user.role;

    const checkSql = `
        SELECT status, created_by, assigned_to
        FROM tickets
        WHERE ticket_id = ?
    `;

    const insertSql = `
        INSERT INTO ticket_comments (ticket_id, user_id, comment)
        VALUES (?, ?, ?)
    `;

    db.query(checkSql, [ticket_id], (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
            return res.send("Ticket not found");
        }

        const ticket = results[0];

        // 🚫 Prevent commenting on closed ticket
        if (ticket.status === 'closed') {
            return res.send("Cannot comment on closed ticket");
        }

        // ✅ Authorization logic
        const isOwner = ticket.created_by === userId;
        const isAssignedTech = ticket.assigned_to === userId;
        const isTechnician = role === 'technician';

        if (!isOwner && !isAssignedTech && !isTechnician) {
            return res.send("Unauthorized");
        }

        db.query(insertSql, [ticket_id, userId, comment], (err) => {
            if (err) throw err;

            res.redirect(`/tickets/view/${ticket_id}`);
        });
    });
});

app.post('/update-contact', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    const userId = req.session.user.id;
    let newContact = req.body.contact;
    const redirectTo = req.body.redirectTo || '/dashboard';
    newContact = newContact.trim();
    if (newContact.length > 20) {
        newContact = newContact.substring(0, 20);
    }
    if (!/^[0-9]+$/.test(newContact)) {
        return res.send("Invalid contact number");
    }
    const sql = "UPDATE users SET contact = ? WHERE user_id = ?";
    db.query(sql, [newContact, userId], (err, result) => {
        if (err) throw err;
        req.session.user.contact = newContact;
        res.redirect(redirectTo);
    });
});

app.post('/tickets/close', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    const userId = req.session.user.id;
    const ticketId = req.body.ticket_id;
    const checkSql = "SELECT * FROM tickets WHERE ticket_id = ? AND created_by = ?";
    db.query(checkSql, [ticketId, userId], (err, results) => {
        if (err) throw err;
        if (results.length === 0) {
            return res.send("Unauthorized action");
        }
        const updateSql = "UPDATE tickets SET status = 'closed' WHERE ticket_id = ?";
        db.query(updateSql, [ticketId], (err) => {
            if (err) throw err;
            const commentSql = `
                INSERT INTO ticket_comments (ticket_id, user_id, comment)
                VALUES (?, ?, ?)
            `;
            const systemMessage = "This ticket was closed by customer (system)";
            db.query(commentSql, [ticketId, userId, systemMessage], (err) => {
            if (err) throw err;
                res.redirect('/tickets/view/' + ticketId);
            });
        });
    });
});

app.post('/tickets/reopen', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    const userId = req.session.user.id;
    const { ticket_id, reopen_reason } = req.body;
    const checkSql = "SELECT * FROM tickets WHERE ticket_id = ? AND created_by = ?";
    db.query(checkSql, [ticket_id, userId], (err, results) => {
        if (err) throw err;
        if (results.length === 0) {
            return res.send("Unauthorized action");
        }
        if (results[0].status !== 'closed') {
            return res.send("Ticket is not closed");
        }
        const updateSql = "UPDATE tickets SET status = 'open' WHERE ticket_id = ?";
        db.query(updateSql, [ticket_id], (err) => {
            if (err) throw err;
            const commentSql = `
                INSERT INTO ticket_comments (ticket_id, user_id, comment)
                VALUES (?, ?, ?)
            `;
            const message = `Ticket reopened by customer: ${reopen_reason}`;
            db.query(commentSql, [ticket_id, userId, message], (err) => {
                if (err) throw err;

                res.redirect('/tickets/view/' + ticket_id);
            });
        });
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