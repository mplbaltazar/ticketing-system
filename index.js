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
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
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
        if (user.status === 'inactive') {
            return res.send('Account is inactive. Contact admin.');
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

app.get('/dashboard', checkActiveUser, (req, res) => {
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

app.get('/technician', checkActiveUser, requireRole('technician'), (req, res) => {
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

app.get('/admin', checkActiveUser, requireRole('admin'), (req, res) => {

    const sql = `
        SELECT t.*, u.full_name AS created_by_name, tech.full_name AS technician_name
        FROM tickets t
        LEFT JOIN users u ON t.created_by = u.user_id
        LEFT JOIN users tech ON t.assigned_to = tech.user_id
        ORDER BY 
            CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END,
            CASE t.priority 
                WHEN 'P1' THEN 1 
                WHEN 'P2' THEN 2 
                WHEN 'P3' THEN 3 
                WHEN 'P4' THEN 4 
                ELSE 5 
            END,
            t.created_at DESC
    `;
    db.query(sql, (err, results) => {
        if (err) throw err;

        res.render('admin', {
            user: req.session.user,
            tickets: results
        });
    });
});

app.get('/admin/users', checkActiveUser, requireRole('admin'), (req, res) => {
    const sql = `
    SELECT user_id, full_name, email, role, contact, created_at, status 
    FROM users 
    ORDER BY created_at DESC
    `;
    db.query(sql, (err, results) => {
        if (err) throw err;

        res.render('admin-users', {
            user: req.session.user,
            users: results
        });
    });
});

app.post('/admin/users/update-role', checkActiveUser, requireRole('admin'), (req, res) => {
    const { user_id, role } = req.body;
    if (parseInt(user_id) === req.session.user.id) {
        return res.send('You cannot change your own role');
    }
    const sql = 'UPDATE users SET role = ? WHERE user_id = ?';
    db.query(sql, [role, user_id], (err) => {
        if (err) throw err;

        res.redirect('/admin/users');
    });
});

app.get('/admin/users/new', checkActiveUser, requireRole('admin'), (req, res) => {
    res.render('admin-create-user', {
        user: req.session.user
    });
});

app.post('/admin/users/create', checkActiveUser, requireRole('admin'), (req, res) => {
    const { full_name, email, password, role, contact } = req.body;
    try {
        const checkSql = 'SELECT * FROM users WHERE email = ?';
        db.query(checkSql, [email], async (err, results) => {
            if (err) throw err;
            if (results.length > 0) {
                return res.send('Email already exists');
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            const insertSql = `
                INSERT INTO users (full_name, email, password, role, contact)
                VALUES (?, ?, ?, ?, ?)`;
            db.query(insertSql, [full_name, email, hashedPassword, role, contact || null], (err) => {
                if (err) throw err;
                res.redirect('/admin/users');
            });
        });
    } catch (error) {
        console.error(error);
        res.send('Error creating user');
    }
});

app.post('/admin/users/delete', checkActiveUser, requireRole('admin'), (req, res) => {
    const { user_id } = req.body;
    if (parseInt(user_id) === req.session.user.id) {
        return res.send('You cannot deactivate your own account');
    }
    const sql = "UPDATE users SET status = 'inactive' WHERE user_id = ?";
    db.query(sql, [user_id], (err) => {
        if (err) throw err;
        res.redirect('/admin/users');
    });
});

app.post('/admin/users/toggle-status', checkActiveUser, requireRole('admin'), (req, res) => {
    const { user_id, status } = req.body;
    if (parseInt(user_id) === req.session.user.id) {
        return res.send('You cannot change your own status');
    }
    const sql = 'UPDATE users SET status = ? WHERE user_id = ?';
    db.query(sql, [status, user_id], (err) => {
        if (err) throw err;
        res.redirect('/admin/users');
    });
});

app.get('/admin/users/edit/:id', checkActiveUser, requireRole('admin'), (req, res) => {
    const userId = req.params.id;
    const sql = `
        SELECT user_id, full_name, email, contact, role, status, position
        FROM users
        WHERE user_id = ?
    `;
    db.query(sql, [userId], (err, results) => {
        if (err) throw err;
        if (results.length === 0) {
            return res.send('User not found');
        }
        res.render('admin-edit-user', {
            user: req.session.user,
            editUser: results[0]
        });
    });
});

app.post('/admin/users/update', checkActiveUser, requireRole('admin'), (req, res) => {
    const { user_id, full_name, contact, role, status, position } = req.body;
    if (parseInt(user_id) === req.session.user.id) {
        return res.send('You cannot modify your own role or status');
    }
    const sql = `
        UPDATE users
        SET full_name = ?, contact = ?, role = ?, status = ?, position = ?
        WHERE user_id = ?
    `;
    db.query(sql, [
        full_name,
        contact || null,
        role,
        status,
        position || null,
        user_id
    ], (err) => {
        if (err) throw err;
        res.redirect('/admin/users');
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

app.get('/tickets/create', checkActiveUser, (req, res) => {
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

app.post('/tickets/create', checkActiveUser, (req, res) => {
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

app.get('/tickets/view/:id', checkActiveUser, (req, res) => {
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
                    userId: req.session.user.id,
                    backUrl: req.session.user.role === 'admin'
                        ? '/admin'
                        : req.session.user.role === 'technician'
                        ? '/technician'
                        : '/dashboard'
                });
            });
        });
    });
});

app.get('/tickets/my', checkActiveUser, (req, res) => {
    const userId = req.session.user.id;
    const sql = `
        SELECT * FROM tickets
        WHERE created_by = ? OR assigned_to = ?
        ORDER BY 
            CASE WHEN status = 'closed' THEN 1 ELSE 0 END,
            created_at DESC
        `;
    db.query(sql, [userId, userId], (err, results) => {
        if (err) throw err;
        res.render('my-tickets', { 
            tickets: results,
            dashtitle: 'My Tickets',
            backUrl: req.session.user.role === 'admin' 
                ? '/admin' 
                : req.session.user.role === 'technician' 
                ? '/technician' 
                : '/dashboard'
        });
    });
});

app.get('/tickets/all', checkActiveUser, (req, res) => {
    const role = req.session.user.role;
    if (role !== 'technician' && role !== 'admin') {
        return res.redirect('/dashboard');
    }
    const sql = `
        SELECT t.*, u.full_name AS created_by_name
        FROM tickets t
        JOIN users u ON t.created_by = u.user_id
        ORDER BY 
           CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END,
           t.created_at DESC
        `;
    db.query(sql, (err, results) => {
        if (err) throw err;
        res.render('my-tickets', { 
            tickets: results,
            dashtitle: 'All Tickets',
            backUrl: req.session.user.role === 'admin' 
                ? '/admin' 
                : '/technician'
        });
    });
});

app.post('/tickets/assign', checkActiveUser, requireRole('technician', 'admin'), (req, res) => {
    const { ticket_id, assigned_to } = req.body;
    const currentUserId = req.session.user.id;
    const ticketSql = "SELECT * FROM tickets WHERE ticket_id = ?";
    db.query(ticketSql, [ticket_id], (err, ticketResults) => {
        if (err) throw err;
        if (ticketResults.length === 0) {
            return res.send("Ticket not found");
        }
        const userSql = "SELECT full_name, role FROM users WHERE user_id = ?";
        db.query(userSql, [assigned_to], (err, result) => {
            if (err) throw err;
            if (result.length === 0 || result[0].role !== 'technician') {
                return res.send("Invalid technician selected");
            }
            const techName = result[0].full_name;
            const updateSql = `
                UPDATE tickets
                SET assigned_to = ?
                WHERE ticket_id = ?
            `;
            db.query(updateSql, [assigned_to, ticket_id], (err) => {
                if (err) throw err;
                const assignedBy = req.session.user.name;
                const role = req.session.user.role;
                const message = `Ticket assigned to ${techName} by ${assignedBy} (${role})`;
                const commentSql = `
                    INSERT INTO ticket_comments (ticket_id, user_id, comment)
                    VALUES (?, ?, ?)
                `;
                db.query(commentSql, [ticket_id, currentUserId, message], (err) => {
                    if (err) throw err;
                    res.redirect('/tickets/view/' + ticket_id);
                });
            });
        });
    });
});

app.post('/comments/add', checkActiveUser, (req, res) => {
    const { comment, ticket_id } = req.body;
    const userId = req.session.user.id;
    const role = req.session.user.role;
    if (!comment || comment.trim() === '') {
        return res.send("Comment cannot be empty");
    }
    const cleanComment = comment.trim();
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
        if (ticket.status === 'closed') {
            return res.send("Cannot comment on closed ticket");
        }
        const isOwner = ticket.created_by === userId;
        const isAssignedTech = ticket.assigned_to === userId;
        const isAdmin = role === 'admin';
        if (!isOwner && !isAssignedTech && !isAdmin) {
            return res.send("Unauthorized");
        }
        db.query(insertSql, [ticket_id, userId, cleanComment], (err) => {
            if (err) throw err;
            res.redirect(`/tickets/view/${ticket_id}`);
        });
    });
});

app.post('/update-contact', checkActiveUser, (req, res) => {
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

app.post('/tickets/close', checkActiveUser, (req, res) => {
    const userId = req.session.user.id;
    const ticketId = req.body.ticket_id;
    const checkSql = `
        SELECT * FROM tickets 
        WHERE ticket_id = ?
    `;
    db.query(checkSql, [ticketId], (err, results) => {
        if (err) throw err;
        if (results.length === 0) {
            return res.send("Ticket not found");
        }
        const ticket = results[0];
        const isOwner = ticket.created_by === userId;
        const isAssigned = ticket.assigned_to === userId;
        const isAdmin = req.session.user.role === 'admin';
        if (!isOwner && !isAssigned && !isAdmin) {
            return res.send("Unauthorized action");
        }
        const updateSql = "UPDATE tickets SET status = 'closed' WHERE ticket_id = ?";
        db.query(updateSql, [ticketId], (err) => {
            if (err) throw err;
            let closedBy;
            if (isAdmin) {
                closedBy = 'admin';
            } else if (isOwner) {
                closedBy = 'customer';
            } else {
                closedBy = 'technician';
            }
            const systemMessage = `This ticket was closed by ${req.session.user.name} (${closedBy})`;
            const commentSql = `
                INSERT INTO ticket_comments (ticket_id, user_id, comment)
                VALUES (?, ?, ?)
            `;
            db.query(commentSql, [ticketId, userId, systemMessage], (err) => {
                if (err) throw err;
                res.redirect('/tickets/view/' + ticketId);
            });
        });
    });
});

app.post('/tickets/reopen', checkActiveUser, (req, res) => {
    const userId = req.session.user.id;
    const { ticket_id, reopen_reason } = req.body;
    const checkSql = "SELECT * FROM tickets WHERE ticket_id = ?";
    db.query(checkSql, [ticket_id], (err, results) => {
        if (err) throw err;
        if (results.length === 0) {
            return res.send("Ticket not found");
        }
        const ticket = results[0];
        const isOwner = ticket.created_by === userId;
        const isAdmin = req.session.user.role === 'admin';
        if (!isOwner && !isAdmin) {
            return res.send("Unauthorized action");
        }
        if (ticket.status !== 'closed') {
            return res.send("Ticket is not closed");
        }
        const updateSql = "UPDATE tickets SET status = 'open' WHERE ticket_id = ?";
        db.query(updateSql, [ticket_id], (err) => {
            if (err) throw err;
            let reopenedBy;
            if (isAdmin) {
                reopenedBy = 'admin';
            } else {
                reopenedBy = 'customer';
            }
            const message = `Ticket reopened by ${req.session.user.name} (${reopenedBy}): ${reopen_reason}`;
            const commentSql = `
                INSERT INTO ticket_comments (ticket_id, user_id, comment)
                VALUES (?, ?, ?)
            `;
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

function checkActiveUser(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/');
    }
    const userId = req.session.user.id;
    const sql = "SELECT status FROM users WHERE user_id = ?";
    db.query(sql, [userId], (err, results) => {
        if (err) throw err;
        if (results.length === 0) {
            req.session.destroy();
            return res.redirect('/');
        }
        if (results[0].status === 'inactive') {
            req.session.destroy();
            return res.send('Your account has been deactivated.');
        }
        next();
    });
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        const userRole = req.session.user.role;
        if (!allowedRoles.includes(userRole)) {
            if (userRole === 'technician') return res.redirect('/technician');
            if (userRole === 'admin') return res.redirect('/admin');
            return res.redirect('/dashboard');
        }
        next();
    };
}